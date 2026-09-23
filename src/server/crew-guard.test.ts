import assert from "node:assert/strict";
import test from "node:test";

import type { NpcAdapter } from "../lib/adapters/types";
import { createCrewControl } from "./crew-control";
import { CrewBlockedError, withCrewGuard } from "./crew-guard";

function fakeAdapter() {
  const aborted: string[] = [];
  let release: () => void = () => {};
  const adapter: NpcAdapter = {
    type: "claude",
    execute: () =>
      new Promise((resolve) => {
        release = () => resolve({ response: "ok", session: { sessionRef: "s" } });
      }),
    abort: async (sessionKey) => {
      aborted.push(sessionKey);
      release();
    },
    testConnection: async () => ({ status: "ok" }),
  };
  return { adapter, aborted, finish: () => release() };
}

test("일시정지·인계 중이면 회의 턴을 시작하지 않는다", async () => {
  const control = createCrewControl();
  const { adapter } = fakeAdapter();
  const guarded = withCrewGuard(adapter, "npc-1", "c1", control);

  control.setPaused("c1", true);
  await assert.rejects(
    guarded.execute({ sessionKey: "k", prompt: "p" }),
    (err: unknown) => err instanceof CrewBlockedError && err.code === "crew_paused",
  );
  control.setPaused("c1", false);

  assert.equal(control.handOff("npc-1", "c1"), true);
  await assert.rejects(
    guarded.execute({ sessionKey: "k", prompt: "p" }),
    (err: unknown) => err instanceof CrewBlockedError && err.code === "crew_handoff",
  );
});

test("도는 회의 턴은 일하는 중으로 잡히고, 일시정지하면 멈춘다", async () => {
  const control = createCrewControl();
  const { adapter, aborted } = fakeAdapter();
  const guarded = withCrewGuard(adapter, "npc-1", "c1", control);

  const running = guarded.execute({ sessionKey: "meet-k", prompt: "p" });
  assert.equal(control.isBusy("npc-1"), true);
  assert.equal(control.handOff("npc-1", "c1"), false, "회의 중인 직원은 넘기지 않는다");

  assert.equal(control.setPaused("c1", true), 1);
  await running;
  assert.deepEqual(aborted, ["meet-k"]);
  assert.equal(control.isBusy("npc-1"), false);
});
