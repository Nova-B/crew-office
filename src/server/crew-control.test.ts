import assert from "node:assert/strict";
import test from "node:test";

import { createCrewControl } from "./crew-control";

test("일시정지는 오피스별이고, 걸면 그 오피스에서 돌던 턴만 멈춘다", () => {
  const control = createCrewControl();
  const stopped: string[] = [];
  control.track("c1", () => stopped.push("c1-a"));
  const releaseB = control.track("c1", () => stopped.push("c1-b"));
  control.track("c2", () => stopped.push("c2-a"));
  releaseB(); // 끝난 턴은 멈출 대상이 아니다

  assert.equal(control.setPaused("c1", true), 1);
  assert.deepEqual(stopped, ["c1-a"]);
  assert.equal(control.isPaused("c1"), true);
  assert.equal(control.isPaused("c2"), false);

  control.setPaused("c1", false);
  assert.equal(control.isPaused("c1"), false);
});

test("동료 묻기는 한 시간 창 안에서 한도까지만 허용하고, 창이 지나면 다시 허용한다", () => {
  let clock = 0;
  const control = createCrewControl({ asksPerHour: 2, now: () => clock });
  assert.equal(control.consumeAsk("c1"), true);
  assert.equal(control.consumeAsk("c1"), true);
  assert.equal(control.consumeAsk("c1"), false);
  assert.equal(control.consumeAsk("c2"), true, "한도는 오피스별이다");
  assert.deepEqual(control.state("c1"), { paused: false, asksUsed: 2, asksLimit: 2 });

  clock += 60 * 60 * 1000 + 1;
  assert.equal(control.consumeAsk("c1"), true);
  assert.equal(control.state("c1").asksUsed, 1);
});
