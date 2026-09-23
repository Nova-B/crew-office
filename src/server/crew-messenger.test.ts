import assert from "node:assert/strict";
import test from "node:test";

import { createCrewMessenger, type Colleague, type CrewMessengerDeps } from "./crew-messenger";

const MINA: Colleague = { id: "n-mina", name: "미나", adapterType: "claude" };
const DEV: Colleague = { id: "n-dev", name: "Dev", adapterType: "codex" };
const DEVOPS: Colleague = { id: "n-devops", name: "DevOps", adapterType: "claude" };

function setup(overrides: Partial<CrewMessengerDeps> = {}) {
  const posts: string[] = [];
  const turns: Array<{ from: string; to: string; question: string; childToken: string }> = [];
  const deps: CrewMessengerDeps = {
    listColleagues: async () => [MINA, DEV],
    runColleagueTurn: async ({ from, to, question, childToken }) => {
      turns.push({ from: from.name, to: to.name, question, childToken });
      return `answer to ${question}`;
    },
    post: async (_channelId, sender, content) => {
      posts.push(`${sender.name}: ${content}`);
    },
    ...overrides,
  };
  const messenger = createCrewMessenger(deps);
  const token = messenger.mint({ npcId: MINA.id, channelId: "c1", userId: "u1", depth: 0 });
  return { messenger, token, posts, turns };
}

test("ask 는 동료의 턴을 돌려 답을 돌려주고, 질문과 답을 오피스 방에 올린다", async () => {
  const { messenger, token, posts, turns } = setup();
  const out = await messenger.call(token, "ask", { to: "dev", question: "세션 만료는?" });
  assert.deepEqual(out, { text: "Dev: answer to 세션 만료는?" });
  assert.deepEqual(posts, ["미나: @Dev 세션 만료는?", "Dev: @미나 answer to 세션 만료는?"]);
  assert.equal(turns[0].to, "Dev");
});

test("동료의 턴에 준 토큰으로 되물을 수 있고, 되묻기 깊이 한도에서 멈춘다", async () => {
  const ref: { current?: ReturnType<typeof createCrewMessenger> } = {};
  const nested: string[] = [];
  const { messenger, token } = setup({
    runColleagueTurn: async ({ to, childToken }) => {
      // B 가 A 에게 되묻고, A 가 다시 B 에게 물으려 한다.
      const other = to.name === "미나" ? "Dev" : "미나";
      const back = await ref.current!.call(childToken, "ask", { to: other, question: "q2" });
      nested.push(`${to.name}->${other}: ${back.text}`);
      return "done";
    },
  });
  ref.current = messenger;
  await messenger.call(token, "ask", { to: "Dev", question: "q1" });
  assert.equal(nested.length, 2, "A→B→A 까지는 간다");
  assert.match(nested[0], /되묻기 한도/, "깊이 2 에서 세 번째 묻기는 거절된다");
});

test("턴이 끝나 회수된 토큰과 모르는 토큰은 거절한다", async () => {
  const { messenger, token, turns } = setup();
  await messenger.call(token, "ask", { to: "Dev", question: "q" });
  const stale = await messenger.call(turns[0].childToken, "list_colleagues");
  assert.equal(stale.isError, true);
  assert.equal((await messenger.call("nope", "list_colleagues")).isError, true);
});

test("자기 자신·없는 동료·겹치는 이름은 이유를 알려 준다", async () => {
  const { messenger, token } = setup({ listColleagues: async () => [MINA, DEV, DEVOPS] });
  assert.match(
    (await messenger.call(token, "ask", { to: "미나", question: "q" })).text,
    /없습니다/,
  );
  assert.match(
    (await messenger.call(token, "ask", { to: "Bob", question: "q" })).text,
    /Dev, DevOps/,
  );
  assert.match((await messenger.call(token, "ask", { to: "dev", question: "q" })).text, /^Dev:/);
  assert.match((await messenger.call(token, "ask", { to: "De", question: "q" })).text, /여럿/);
});

test("동료가 제한 시간 안에 답하지 못하면 오류로 돌려준다", async () => {
  const { messenger, token } = setup({
    runColleagueTurn: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  const out = await messenger.call(token, "ask", { to: "Dev", question: "q" });
  assert.equal(out.isError, true);
  assert.match(out.text, /제한 시간/);
});

test("같은 동료에게 온 질문은 차례로 처리한다", async () => {
  let running = 0;
  let maxRunning = 0;
  const { messenger, token } = setup({
    runColleagueTurn: async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return "ok";
    },
  });
  await Promise.all([
    messenger.call(token, "ask", { to: "Dev", question: "a" }),
    messenger.call(token, "ask", { to: "Dev", question: "b" }),
  ]);
  assert.equal(maxRunning, 1);
});

test("list_colleagues 는 자기를 뺀 동료를 보여 준다", async () => {
  const { messenger, token } = setup();
  const out = await messenger.call(token, "list_colleagues");
  assert.equal(out.text, "- Dev (codex)");
});
