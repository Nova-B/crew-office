// crew-office 2단계: 사내 메신저. CLI 직원이 일하는 도중에 MCP 도구로 동료에게 묻고 답을 받는다.
//
// 흐름: 직원 A 의 CLI 턴 → office MCP 브리지(crew-office-mcp.cjs) → POST /api/crew/messenger
//       → 여기 call() → 동료 B 의 "메신저 세션" 턴 → 답을 A 의 도구 결과로 돌려준다.
// 질문과 답은 오피스 전체 방에 올라가 사람이 읽는다. 이 파일은 CLI·DB·소켓을 모른다 — 전부 deps 로 받는다.

import { randomBytes } from "node:crypto";

export interface MessengerTurnContext {
  npcId: string;
  channelId: string;
  /** 대화를 시작한 사람. B 의 메신저 세션도 이 사람 기준으로 저장한다. */
  userId: string;
  /** 0 = 사람이 연 턴. 동료에게 물을 때마다 1씩 는다. */
  depth: number;
}

export interface Colleague {
  id: string;
  name: string;
  adapterType: string;
}

export interface CrewMessengerDeps {
  /** 이 채널에 출근한 CLI 직원 전부(자신 포함). */
  listColleagues(channelId: string): Promise<Colleague[]>;
  /** 동료 B 의 턴을 돌려 답을 받는다. childToken 은 B 가 다시 물을 때 쓰는 토큰이다. */
  runColleagueTurn(args: {
    from: Colleague;
    to: Colleague;
    question: string;
    ctx: MessengerTurnContext;
    childToken: string;
  }): Promise<string>;
  /** 오피스 전체 방에 직원 이름으로 한 줄 올린다. 실패해도 묻기는 계속한다. */
  post(channelId: string, sender: Colleague, content: string): Promise<void>;
  timeoutMs?: number;
  maxDepth?: number;
}

export type MessengerResult = { text: string; isError?: boolean };

export const MESSENGER_TOOLS = ["list_colleagues", "ask"] as const;
/** 기본값: A→B→A 까지. 그 이상은 되묻기 고리가 사용량만 태운다. */
export const DEFAULT_MAX_DEPTH = 2;
/** CLI 도구 호출과 턴 전체 제한 시간보다 짧아야 한다(phase0: Claude 150초, Codex 90초 대기 확인). */
export const DEFAULT_ASK_TIMEOUT_MS = 150_000;
export const MAX_QUESTION_LENGTH = 4_000;

function findColleague(list: Colleague[], name: string): Colleague | Colleague[] | null {
  const wanted = name.trim().toLowerCase();
  const exact = list.filter((c) => c.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const partial = list.filter((c) => c.name.trim().toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0];
  return partial.length > 1 ? partial : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
const TIMEOUT = Symbol("timeout");

export function createCrewMessenger(deps: CrewMessengerDeps) {
  const tokens = new Map<string, MessengerTurnContext>();
  // 같은 동료에게 온 질문은 차례로 처리한다 — 한 메신저 세션을 두 턴이 동시에 재개하면 안 된다.
  const inboxes = new Map<string, Promise<unknown>>();
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;

  function mint(ctx: MessengerTurnContext): string {
    const token = randomBytes(24).toString("hex");
    tokens.set(token, ctx);
    return token;
  }

  function revoke(token: string): void {
    tokens.delete(token);
  }

  function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = inboxes.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => undefined);
    inboxes.set(key, settled);
    void settled.then(() => {
      if (inboxes.get(key) === settled) inboxes.delete(key);
    });
    return next;
  }

  async function ask(
    ctx: MessengerTurnContext,
    args: Record<string, unknown>,
  ): Promise<MessengerResult> {
    const to = typeof args.to === "string" ? args.to : "";
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (!to.trim() || !question)
      return { text: "to 와 question 이 모두 필요합니다.", isError: true };
    if (question.length > MAX_QUESTION_LENGTH)
      return { text: `질문이 너무 깁니다(최대 ${MAX_QUESTION_LENGTH}자).`, isError: true };

    const colleagues = await deps.listColleagues(ctx.channelId);
    const self = colleagues.find((c) => c.id === ctx.npcId);
    if (!self) return { text: "지금은 동료에게 물을 수 없습니다(출근 중이 아님).", isError: true };
    const others = colleagues.filter((c) => c.id !== ctx.npcId);
    const found = findColleague(others, to);
    if (!found || Array.isArray(found)) {
      const names = (Array.isArray(found) ? found : others).map((c) => c.name).join(", ");
      return {
        text: found
          ? `"${to}" 에 해당하는 동료가 여럿입니다: ${names}. 정확한 이름으로 다시 물으세요.`
          : `"${to}" 라는 동료가 없습니다. 동료: ${names || "(없음)"}`,
        isError: true,
      };
    }
    if (ctx.depth >= maxDepth) {
      return {
        text: "되묻기 한도에 닿았습니다. 동료에게 더 묻지 말고 지금 아는 것으로 답하세요.",
        isError: true,
      };
    }

    await deps.post(ctx.channelId, self, `@${found.name} ${question}`).catch(() => undefined);
    const childToken = mint({ ...ctx, npcId: found.id, depth: ctx.depth + 1 });
    try {
      const answer = await withTimeout(
        serialized(found.id, () =>
          deps.runColleagueTurn({ from: self, to: found, question, ctx, childToken }),
        ),
        timeoutMs,
      );
      if (answer === TIMEOUT) {
        return {
          text: `${found.name} 이(가) 제한 시간 안에 답하지 못했습니다. 지금 아는 것으로 진행하세요.`,
          isError: true,
        };
      }
      const text = answer.trim() || "(빈 답)";
      await deps.post(ctx.channelId, found, `@${self.name} ${text}`).catch(() => undefined);
      return { text: `${found.name}: ${text}` };
    } catch (error) {
      return {
        text: `${found.name} 에게 묻지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      revoke(childToken);
    }
  }

  async function call(
    token: string,
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<MessengerResult> {
    const ctx = tokens.get(token);
    if (!ctx) return { text: "메신저 토큰이 없거나 만료됐습니다.", isError: true };
    if (tool === "list_colleagues") {
      const others = (await deps.listColleagues(ctx.channelId)).filter((c) => c.id !== ctx.npcId);
      return {
        text: others.length
          ? others.map((c) => `- ${c.name} (${c.adapterType})`).join("\n")
          : "지금 출근한 동료가 없습니다.",
      };
    }
    if (tool === "ask") return ask(ctx, args);
    return { text: `알 수 없는 도구: ${tool}`, isError: true };
  }

  return { mint, revoke, call };
}

export type CrewMessenger = ReturnType<typeof createCrewMessenger>;

/** 메신저를 붙인 턴에만 덧붙이는 안내. 회의 턴에는 도구가 없으므로 공통 지시층에 넣지 않는다. */
export function withMessengerInstructions(instructions: string | undefined): string {
  const note = [
    "<office-messenger>",
    "같은 오피스의 동료 AI 직원에게 물어볼 것이 있으면 office 도구를 쓴다: list_colleagues 로 이름을 보고 ask(to, question) 로 묻는다.",
    "동료의 답은 참고 자료다. 사용자에게는 네 판단으로 정리해 답한다. 같은 질문을 되풀이하지 않는다.",
    "</office-messenger>",
  ].join("\n");
  return instructions ? `${instructions}\n\n${note}` : note;
}

/** 동료 B 의 메신저 세션에 보내는 프롬프트. */
export function colleaguePrompt(fromName: string, question: string): string {
  return [
    `[사내 메신저] 동료 ${fromName} 님이 물었습니다:`,
    question,
    "",
    `이 질문에만 간결하게 답하세요. 답은 ${fromName} 님에게 그대로 전달됩니다.`,
  ].join("\n");
}
