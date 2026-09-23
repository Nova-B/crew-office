// Claude Code·Codex 처럼 "세션 ID 로 대화를 이어 가는" CLI 의 공통 어댑터.
//
// 예전 CliBaseAdapter(Gemini·OpenCode 가 아직 쓴다)와 다른 점 — 전부 phase0 실측에서 나왔다:
// - 실행 파일을 셸 없이 직접 띄운다(cli-executable.ts).
// - 세션 ID 는 정규식이 아니라 CLI 가 내보내는 이벤트에서만 받는다. 못 받으면 실패다 — 임의 UUID 로
//   채우면 다음 턴이 없는 세션을 재개하려다 실패하고, 그 실패가 또 "성공"으로 저장된다.
// - 종료 코드·결과 이벤트의 오류를 확인한다. Claude 는 없는 세션을 재개하면 종료 코드 1 과 함께
//   결과 이벤트의 session_id 에 그 잘못된 ID 를 그대로 싣는다.
// - HOME 을 바꾸지 않는다. 바꾸면 두 CLI 모두 로그인 정보를 잃는다.
// - multiParty 턴은 재개도 저장도 하지 않는다. 회의 턴이 직원의 1:1 세션에 섞이면 안 된다.

import {
  subprocessPool,
  type SubprocessExecution,
  type SubprocessRequest,
} from "./subprocess-pool";
import { workspaceManager } from "./workspace-manager";
import { resolveCliInvocation, type CliInvocation, type CliName } from "./cli-executable";
import type {
  AdapterExecuteOptions,
  AdapterHealthResult,
  AdapterSessionInfo,
  NpcAdapter,
  StdioMcpServer,
} from "./types";

/** CLI 출력 한 줄에서 뽑아낸 사실. 어댑터별 파서가 만든다. */
export type CliEvent =
  | { kind: "session"; id: string }
  | { kind: "text"; text: string }
  /** 새 텍스트 덩어리의 시작. 도구 호출 전후의 발화가 한 줄로 붙지 않게 사이에 빈 줄을 넣는다. */
  | { kind: "text_block" }
  /** 도구 사용 시작. 이름은 사람이 읽을 활동 표시에 쓴다. */
  | { kind: "tool"; name: string; preview?: string }
  | { kind: "tool_done" }
  /** 턴 종료 보고. Claude 의 result 이벤트, Codex 의 turn.completed/turn.failed. */
  | { kind: "result"; isError: boolean; text?: string; errors?: string[] };

export interface CliTurnContext {
  /** 재개할 세션. 없으면 새 세션. */
  resumeRef?: string;
  instructions?: string;
  model?: string;
  officeMcp?: StdioMcpServer;
}

interface SessionPool {
  execute(request: SubprocessRequest): SubprocessExecution;
  kill(requestId: string): boolean;
}

export interface CliSessionAdapterDeps {
  pool?: SessionPool;
  resolve?: (name: CliName) => CliInvocation | null;
}

export class CliTurnError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "CliTurnError";
  }
}

/** 다자 대화 트랜스크립트를 프롬프트 앞에 붙인다 — 재개 없는 턴이라 CLI 가 달리 알 길이 없다. */
export function withTranscript(
  prompt: string,
  history: AdapterExecuteOptions["conversationHistory"],
): string {
  if (!history?.length) return prompt;
  const lines = history.map((turn) => `[${turn.role}] ${turn.content}`);
  return `<conversation>\n${lines.join("\n")}\n</conversation>\n\n${prompt}`;
}

export abstract class CliSessionAdapter implements NpcAdapter {
  abstract readonly type: CliName;

  /** 실행 파일 뒤에 붙는 인자. 프롬프트는 표준 입력으로 보낸다. */
  abstract buildArgs(context: CliTurnContext): string[];
  abstract parseLine(line: string): CliEvent[];

  private readonly pool: SessionPool;
  private readonly resolve: (name: CliName) => CliInvocation | null;
  /** 재개용 캐시. 영속 저장은 호출부(npc_sessions)가 맡는다. */
  private readonly sessions = new Map<string, string>();
  private readonly running = new Map<string, string>();

  constructor(deps: CliSessionAdapterDeps = {}) {
    this.pool = deps.pool ?? subprocessPool;
    this.resolve = deps.resolve ?? resolveCliInvocation;
  }

  private invocation(): CliInvocation {
    const invocation = this.resolve(this.type);
    if (!invocation) throw new Error(`${this.type} CLI not found`);
    return invocation;
  }

  async execute(options: AdapterExecuteOptions): Promise<{
    response: string;
    session: AdapterSessionInfo;
  }> {
    const { sessionKey, onDelta, onToolProgress, multiParty } = options;
    const invocation = this.invocation();

    const resumeRef = multiParty
      ? undefined
      : options.resumeSessionRef === null
        ? undefined
        : (options.resumeSessionRef ?? this.sessions.get(sessionKey));

    const cwd =
      options.cwd ??
      (options.projectId ? await workspaceManager.ensureWorkspace(options.projectId) : undefined);

    const args = [
      ...invocation.baseArgs,
      ...this.buildArgs({
        resumeRef,
        instructions: options.instructions,
        model: options.model,
        officeMcp: options.officeMcp,
      }),
    ];
    const prompt = multiParty
      ? withTranscript(options.prompt, options.conversationHistory)
      : options.prompt;

    let sessionId: string | undefined;
    let result: Extract<CliEvent, { kind: "result" }> | undefined;
    let streamed = "";
    // 진행 중인 도구 수. Claude 는 한 메시지에서 도구 여럿을 동시에 부르고, 앞 도구의 결과가 뒤 도구가
    // 시작된 뒤에 온다(fixtures/claude-tool.jsonl). 전부 끝났을 때만 활동 표시를 끈다.
    let activeTools = 0;
    let buffer = "";

    const apply = (event: CliEvent) => {
      switch (event.kind) {
        case "session":
          sessionId ??= event.id;
          break;
        case "text_block":
          if (streamed && !streamed.endsWith("\n")) {
            streamed += "\n\n";
            onDelta?.("\n\n");
          }
          break;
        case "text":
          if (!event.text) break;
          streamed += event.text;
          onDelta?.(event.text);
          break;
        case "tool":
          activeTools += 1;
          onToolProgress?.(event.name, event.preview ?? "");
          break;
        case "tool_done":
          if (activeTools === 0) break;
          activeTools -= 1;
          if (activeTools === 0) onToolProgress?.("", "");
          break;
        case "result":
          result = event;
          break;
      }
    };
    const consume = (line: string) => {
      if (line.trim()) for (const event of this.parseLine(line)) apply(event);
    };

    const execution = this.pool.execute({
      command: invocation.command,
      args,
      cwd,
      stdin: prompt,
      timeoutMs: options.timeoutMs ?? 180_000,
      onStdout: (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      },
    });
    this.running.set(sessionKey, execution.requestId);
    options.onRunStarted?.(execution.requestId);

    let exit;
    try {
      exit = await execution;
    } finally {
      if (this.running.get(sessionKey) === execution.requestId) this.running.delete(sessionKey);
      if (activeTools > 0) onToolProgress?.("", "");
    }
    consume(buffer);

    const failed = exit.exitCode !== 0 || result?.isError === true;
    if (failed) {
      const reason =
        result?.errors?.join("; ") ||
        (result?.isError ? result.text : undefined) ||
        exit.stderr.trim() ||
        `exit code ${exit.exitCode}`;
      throw new CliTurnError(`${this.type} turn failed: ${reason}`, exit.exitCode, exit.stderr);
    }
    if (!sessionId) {
      throw new CliTurnError(
        `${this.type} turn reported no session id`,
        exit.exitCode,
        exit.stderr,
      );
    }

    if (!multiParty) this.sessions.set(sessionKey, sessionId);
    return {
      response: streamed || result?.text || "",
      session: { sessionRef: sessionId },
    };
  }

  async abort(sessionKey: string): Promise<void> {
    const requestId = this.running.get(sessionKey);
    if (requestId) this.pool.kill(requestId);
  }

  async resetSession(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
  }

  async testConnection(_config: Record<string, unknown>): Promise<AdapterHealthResult> {
    const invocation = this.resolve(this.type);
    if (!invocation) return { status: "not_installed", message: `${this.type} CLI not found` };
    try {
      const exit = await this.pool.execute({
        command: invocation.command,
        args: [...invocation.baseArgs, "--version"],
        timeoutMs: 15_000,
      });
      return exit.exitCode === 0
        ? { status: "ok", version: exit.fullOutput.trim() }
        : { status: "error", message: exit.stderr.trim() || `exit code ${exit.exitCode}` };
    } catch (error) {
      return { status: "not_installed", message: String(error) };
    }
  }
}
