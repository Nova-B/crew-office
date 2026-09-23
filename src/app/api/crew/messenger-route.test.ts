import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { registerCrewMessenger } from "@/lib/rpc-registry";

const post = async (body: unknown) => {
  const { POST } = await import("./messenger/route");
  return POST(
    new NextRequest("http://localhost/api/crew/messenger", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
};

test("사내 메신저 라우트는 토큰·도구가 없으면 400, 메신저가 없으면 503 이다", async () => {
  assert.equal((await post({ tool: "ask" })).status, 400);
  registerCrewMessenger(undefined as never);
  assert.equal((await post({ token: "t", tool: "ask" })).status, 503);
});

test("사내 메신저 라우트는 토큰·도구·인자를 등록된 메신저에 그대로 넘긴다", async () => {
  const calls: unknown[] = [];
  registerCrewMessenger(async (token, tool, args) => {
    calls.push({ token, tool, args });
    return { text: "Dev: 42" };
  });
  const res = await post({ token: "t0k", tool: "ask", arguments: { to: "Dev", question: "q" } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: "Dev: 42" });
  assert.deepEqual(calls, [{ token: "t0k", tool: "ask", args: { to: "Dev", question: "q" } }]);
});
