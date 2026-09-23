import assert from "node:assert/strict";
import test from "node:test";

import { APP_VERSION, compareCalVer, isNewer } from "./app-meta";
import pkg from "../../package.json";

test("앱 버전은 package.json 에서 읽는다", () => {
  assert.equal(APP_VERSION, pkg.version);
});

test("달력식 버전은 자리마다 숫자로 비교한다", () => {
  assert.equal(compareCalVer("2026.921.3", "2026.921.10"), -1);
  assert.equal(compareCalVer("v2026.1001.0", "2026.921.3"), 1);
  assert.equal(compareCalVer("2026.921.3", "v2026.921.3"), 0);
  assert.equal(compareCalVer("nightly", "2026.921.3"), 0);
});

test("최신 버전이 없거나 읽을 수 없으면 새 버전으로 보지 않는다", () => {
  assert.equal(isNewer("2026.922.0", "2026.921.3"), true);
  assert.equal(isNewer(null, "2026.921.3"), false);
  assert.equal(isNewer("garbage", "2026.921.3"), false);
});
