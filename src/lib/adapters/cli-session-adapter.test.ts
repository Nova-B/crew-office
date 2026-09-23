import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { ClaudeAdapter } from "./claude-adapter";
import { CodexAdapter } from "./codex-adapter";
import { CliTurnError, type CliSessionAdapterDeps } from "./cli-session-adapter";
import type { SubprocessRequest, SubprocessResult } from "./subprocess-pool";

// 픽스처는 2026-09-23 에 Claude Code 2.1.280 / codex-cli 0.156.1 을 실제로 돌려 받은 출력이다
// (개인 설정이 든 init 페이로드만 걷어냈다). spikes/phase0/RESULTS.md 참고.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

type Run = { stdout: string; exitCode?: number; stderr?: string };

/** 픽스처를 17글자씩 흘려보내는 가짜 풀 — 줄이 청크 경계에서 잘려도 파싱되는지 함께 본다. */
function fakePool(runs: Run[]) {
  const requests: SubprocessRequest[] = [];
  const killed: string[] = [];
  let n = 0;
  const pool = {
    execute(request: SubprocessRequest) {
      requests.push(request);
      const run = runs.shift() ?? { stdout: "" };
      const requestId = `req-${++n}`;
      const result = new Promise<SubprocessResult>((resolve) =>
        setImmediate(() => {
          for (let i = 0; i < run.stdout.length; i += 17)
            request.onStdout?.(run.stdout.slice(i, i + 17));
          resolve({
            fullOutput: run.stdout,
            exitCode: run.exitCode ?? 0,
            stderr: run.stderr ?? "",
            durationMs: 1,
          });
        }),
      );
      return Object.assign(result, { requestId, result });
    },
    kill(requestId: string) {
      killed.push(requestId);
      return true;
    },
  };
  return { pool, requests, killed };
}

const found: CliSessionAdapterDeps["resolve"] = (name) =>
  name === "claude"
    ? { command: "C:/npm/claude.exe", baseArgs: [] }
    : { command: "C:/node.exe", baseArgs: ["C:/npm/codex.js"] };

const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("Claude: 세션 ID 는 init 에서, 응답은 텍스트 델타에서 받는다", async () => {
  const { pool, requests } = fakePool([{ stdout: fixture("claude-text.jsonl") }]);
  const deltas: string[] = [];
  const out = await new ClaudeAdapter({ pool, resolve: found }).execute({
    sessionKey: "npc-dm-u1",
    prompt: "say hello",
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(out.session.sessionRef, "07ded2de-b1a5-4a57-9ab6-3ac0707a7997");
  assert.equal(out.response, "hello there");
  assert.equal(deltas.join(""), "hello there");
  assert.equal(requests[0].stdin, "say hello");
  assert.equal(requests[0].command, "C:/npm/claude.exe");
});

test("Claude: 동시에 부른 도구가 모두 끝나야 활동 표시를 끄고, 도구 전후 발화는 빈 줄로 가른다", async () => {
  // 실측: Read 와 Write 를 한 메시지에서 부르고, Read 결과가 Write 가 시작된 뒤에 온다.
  const { pool } = fakePool([{ stdout: fixture("claude-tool.jsonl") }]);
  const activity: string[] = [];
  const out = await new ClaudeAdapter({ pool, resolve: found }).execute({
    sessionKey: "k",
    prompt: "p",
    onToolProgress: (name) => activity.push(name),
  });
  assert.deepEqual(activity, ["Read", "Write", ""]);
  assert.match(out.response, /3pm/);
  assert.doesNotMatch(out.response, /[^\n]\*\*Meeting/, "도구 뒤 발화가 앞 문장에 붙으면 안 된다");
});

test("Claude: 없는 세션 재개는 실패다 — 결과 이벤트가 싣는 잘못된 ID 를 저장하지 않는다", async () => {
  const { pool, requests } = fakePool([
    { stdout: fixture("claude-resume-missing.jsonl"), exitCode: 1 },
    { stdout: fixture("claude-text.jsonl") },
  ]);
  const adapter = new ClaudeAdapter({ pool, resolve: found });
  await assert.rejects(
    adapter.execute({ sessionKey: "k", prompt: "p", resumeSessionRef: "0000-missing" }),
    (err: unknown) => err instanceof CliTurnError && /No conversation found/.test(err.message),
  );
  // 실패한 ID 가 캐시에 남았다면 다음 턴이 그걸 다시 재개하려 들었을 것이다.
  await adapter.execute({ sessionKey: "k", prompt: "p" });
  assert.ok(!requests[1].args.includes("--resume"));
});

test("종료 코드 0 이어도 세션 ID 가 없으면 실패다 — 임의 UUID 로 채우지 않는다", async () => {
  const noInit = fixture("claude-text.jsonl")
    .split("\n")
    .filter((line) => !line.includes('"subtype":"init"'))
    .join("\n");
  const { pool } = fakePool([{ stdout: noInit }]);
  await assert.rejects(
    new ClaudeAdapter({ pool, resolve: found }).execute({ sessionKey: "k", prompt: "p" }),
    /no session id/,
  );
});

test("재개: 성공한 세션은 캐시해 다음 턴에 재개하고, resumeSessionRef 가 캐시보다 우선한다", async () => {
  const { pool, requests } = fakePool([
    { stdout: fixture("claude-text.jsonl") },
    { stdout: fixture("claude-text.jsonl") },
    { stdout: fixture("claude-text.jsonl") },
    { stdout: fixture("claude-text.jsonl") },
  ]);
  const adapter = new ClaudeAdapter({ pool, resolve: found });
  await adapter.execute({ sessionKey: "k", prompt: "1" });
  await adapter.execute({ sessionKey: "k", prompt: "2" });
  assert.equal(flagValue(requests[1].args, "--resume"), "07ded2de-b1a5-4a57-9ab6-3ac0707a7997");

  await adapter.execute({ sessionKey: "k", prompt: "3", resumeSessionRef: "from-db" });
  assert.equal(flagValue(requests[2].args, "--resume"), "from-db");

  await adapter.execute({ sessionKey: "k", prompt: "4", resumeSessionRef: null });
  assert.ok(!requests[3].args.includes("--resume"), "null 은 새 세션 강제");
});

test("multiParty 턴은 재개도 캐시도 하지 않고, 트랜스크립트를 프롬프트에 싣는다", async () => {
  const { pool, requests } = fakePool([
    { stdout: fixture("claude-text.jsonl") },
    { stdout: fixture("claude-text.jsonl") },
  ]);
  const adapter = new ClaudeAdapter({ pool, resolve: found });
  await adapter.execute({
    sessionKey: "k",
    prompt: "your turn",
    multiParty: true,
    resumeSessionRef: "dm-session",
    conversationHistory: [{ role: "Mina", content: "hi all" }],
  });
  assert.ok(!requests[0].args.includes("--resume"));
  assert.match(requests[0].stdin ?? "", /\[Mina\] hi all[\s\S]*your turn$/);

  await adapter.execute({ sessionKey: "k", prompt: "dm" });
  assert.ok(!requests[1].args.includes("--resume"), "회의 턴의 세션이 1:1 캐시에 들어가면 안 된다");
});

test("Claude 인자: --verbose 필수, 권한 확인을 끄지 않는다, 지시는 시스템 자리에 싣는다", () => {
  const args = new ClaudeAdapter().buildArgs({ instructions: "You are Mina.", model: "haiku" });
  assert.deepEqual(args.slice(0, 6), [
    "-p",
    "-",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ]);
  assert.equal(flagValue(args, "--append-system-prompt"), "You are Mina.");
  assert.equal(flagValue(args, "--model"), "haiku");
  assert.ok(!args.some((a) => a.includes("dangerously")));
});

test("Codex: thread_id 가 세션이고, 셸 명령·MCP 호출을 활동 신호로 내보낸다", async () => {
  const { pool, requests } = fakePool([
    { stdout: fixture("codex-command.jsonl") },
    { stdout: fixture("codex-mcp.jsonl") },
  ]);
  const adapter = new CodexAdapter({ pool, resolve: found });
  const activity: Array<[string, string]> = [];
  const first = await adapter.execute({
    sessionKey: "k",
    prompt: "p",
    onToolProgress: (name, preview) => activity.push([name, preview]),
  });
  assert.equal(first.session.sessionRef, "01a0ccbd-f522-7f00-8c52-5ef9e3d71ae8");
  assert.equal(activity[0][0], "shell");
  assert.match(activity[0][1], /echo crew-check/);
  assert.deepEqual(activity[1], ["", ""]);
  assert.match(first.response, /Mina/);
  assert.equal(requests[0].command, "C:/node.exe");
  assert.equal(requests[0].args[0], "C:/npm/codex.js");

  const tools: string[] = [];
  const second = await adapter.execute({
    sessionKey: "k",
    prompt: "p",
    onToolProgress: (name) => tools.push(name),
  });
  assert.deepEqual(tools, ["mcp__office__ask", ""]);
  assert.deepEqual(requests[1].args.slice(1, 4), ["exec", "resume", first.session.sessionRef]);
  assert.match(second.response, /\n\n/, "도구 전후의 두 메시지는 빈 줄로 갈린다");
});

test("Codex: turn.failed 는 실패다", async () => {
  const { pool } = fakePool([{ stdout: fixture("codex-turn-failed.jsonl"), exitCode: 1 }]);
  await assert.rejects(
    new CodexAdapter({ pool, resolve: found }).execute({ sessionKey: "k", prompt: "p" }),
    /401 Unauthorized/,
  );
});

test("Codex 인자: 읽기 전용 샌드박스, 우회 옵션 없음, 지시는 TOML 문자열로 싣는다", () => {
  const instructions = 'Mina says "hi"\nline two';
  const args = new CodexAdapter().buildArgs({ instructions, resumeRef: "t-1" });
  assert.deepEqual(args.slice(0, 5), ["exec", "resume", "t-1", "--json", "--skip-git-repo-check"]);
  assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.ok(args.includes(`developer_instructions=${JSON.stringify(instructions)}`));
  assert.equal(args.at(-1), "-");
  assert.ok(!args.some((a) => a.includes("bypass")));
});

test("abort 는 그 세션 키로 돌고 있는 프로세스를 죽인다", async () => {
  const { pool, killed } = fakePool([{ stdout: fixture("codex-command.jsonl") }]);
  const adapter = new CodexAdapter({ pool, resolve: found });
  const running = adapter.execute({ sessionKey: "k", prompt: "p" });
  await adapter.abort("k");
  await adapter.abort("other");
  await running;
  assert.deepEqual(killed, ["req-1"]);
});

test("CLI 를 못 찾으면 실행은 실패하고 연결 검사는 not_installed 다", async () => {
  const { pool } = fakePool([]);
  const adapter = new ClaudeAdapter({ pool, resolve: () => null });
  await assert.rejects(adapter.execute({ sessionKey: "k", prompt: "p" }), /not found/);
  assert.equal((await adapter.testConnection({})).status, "not_installed");
});

const OFFICE = {
  command: "C:/node.exe",
  args: ["C:/app/crew-office-mcp.cjs"],
  env: { CREW_OFFICE_URL: "http://127.0.0.1:3000", CREW_OFFICE_TOKEN: "t0k" },
  tools: ["list_colleagues", "ask"],
};

test("Claude: office MCP 는 인라인 설정·strict·도구 허용으로 붙인다", () => {
  const args = new ClaudeAdapter().buildArgs({ officeMcp: OFFICE });
  const config = JSON.parse(flagValue(args, "--mcp-config")) as {
    mcpServers: { office: { command: string; args: string[]; env: Record<string, string> } };
  };
  assert.deepEqual(config.mcpServers.office, {
    command: OFFICE.command,
    args: OFFICE.args,
    env: OFFICE.env,
  });
  assert.ok(args.includes("--strict-mcp-config"), "사용자 전역 MCP 서버는 직원에게 보이지 않는다");
  assert.equal(flagValue(args, "--allowedTools"), "mcp__office__list_colleagues,mcp__office__ask");
});

test("Codex: office MCP 는 -c 설정과 도구별 자동 승인으로 붙이고, 프롬프트 표시(-)는 맨 끝이다", () => {
  const args = new CodexAdapter().buildArgs({ officeMcp: OFFICE });
  const configs = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));
  assert.ok(configs.includes(`mcp_servers.office.command=${JSON.stringify(OFFICE.command)}`));
  assert.ok(configs.includes(`mcp_servers.office.args=${JSON.stringify(OFFICE.args)}`));
  assert.ok(
    configs.includes(
      'mcp_servers.office.env={ CREW_OFFICE_URL="http://127.0.0.1:3000", CREW_OFFICE_TOKEN="t0k" }',
    ),
  );
  assert.ok(configs.includes('mcp_servers.office.tools.ask.approval_mode="approve"'));
  assert.ok(configs.includes('mcp_servers.office.tools.list_colleagues.approval_mode="approve"'));
  assert.equal(args.at(-1), "-");
});

test("officeMcp 옵션은 어댑터 인자까지 전달된다", async () => {
  const { pool, requests } = fakePool([{ stdout: fixture("claude-text.jsonl") }]);
  await new ClaudeAdapter({ pool, resolve: found }).execute({
    sessionKey: "k",
    prompt: "p",
    officeMcp: OFFICE,
  });
  assert.ok(requests[0].args.includes("--strict-mcp-config"));
});
