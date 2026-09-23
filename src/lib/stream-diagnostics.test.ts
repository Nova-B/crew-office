import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatResponseTracker } from "../server/chat-response-tracker";
import { streamDiagnostic, withStreamDiagnosticRequest } from "./stream-diagnostics";

// crew-office: Hermes SSE 클라이언트가 빠져 응답 방출(response-emit) 단계만 남았다.
test("opt-in diagnostics correlate response emits without content or credentials", async (t) => {
  const env: Record<string, string | undefined> = process.env;
  const originalNodeEnv = env.NODE_ENV;
  const originalOptIn = env.DESKRPG_STREAM_DIAGNOSTICS;
  t.after(() => {
    for (const [key, value] of [
      ["NODE_ENV", originalNodeEnv],
      ["DESKRPG_STREAM_DIAGNOSTICS", originalOptIn],
    ]) {
      if (value === undefined) delete env[key!];
      else env[key!] = value;
    }
  });
  env.NODE_ENV = "development";
  env.DESKRPG_STREAM_DIAGNOSTICS = "1";
  const logs: string[] = [];
  t.mock.method(console, "info", (...args: unknown[]) => logs.push(args.join(" ")));
  const tracker = new ChatResponseTracker(() => {});
  tracker.accept({
    requestId: "request-test",
    sourceMessageId: "source",
    npcId: "npc",
    npcName: "PRIVATE-NAME",
  });
  await withStreamDiagnosticRequest("request-test", async () => {
    streamDiagnostic({ stage: "sse-event", runId: "run-test", event: "message.delta" });
    tracker.update("request-test", { status: "streaming", content: "PRIVATE-BODY" });
  });
  assert.ok(
    logs.some(
      (line) => line.includes('"stage":"sse-event"') && line.includes('"runId":"run-test"'),
    ),
  );
  assert.ok(
    logs.some((line) => line.includes('"stage":"response-emit"') && line.includes('"length":12')),
  );
  assert.ok(logs.every((line) => line.includes('"requestId":"request-test"')));
  assert.ok(!logs.join("\n").includes("PRIVATE-"));
  const count = logs.length;
  env.NODE_ENV = "production";
  streamDiagnostic({ stage: "sse-read", bytes: 10 });
  env.NODE_ENV = "development";
  env.DESKRPG_STREAM_DIAGNOSTICS = "0";
  streamDiagnostic({ stage: "sse-read", bytes: 10 });
  assert.equal(logs.length, count);
});
