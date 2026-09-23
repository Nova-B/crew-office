import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { employeeWorkspacePath, ensureEmployeeWorkspace } from "./employee-workspace";

test("직원 작업 폴더는 런타임 홈 아래 직원 ID 로 고정된다", () => {
  const home = path.join("C:", "home", ".deskrpg");
  assert.equal(employeeWorkspacePath("npc-1", home), path.join(home, "employees", "npc-1"));
  assert.equal(employeeWorkspacePath("npc-1", home), employeeWorkspacePath("npc-1", home));
});

test("폴더 밖을 가리키는 직원 ID 는 거절한다", () => {
  for (const bad of ["..", "../x", "a/b", "a\\b", ""]) {
    assert.throws(() => employeeWorkspacePath(bad, "/home"), /invalid employee id/);
  }
});

test("ensureEmployeeWorkspace 는 폴더를 만든다", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "crew-ws-"));
  try {
    const dir = await ensureEmployeeWorkspace("npc-2", home);
    assert.ok(fs.statSync(dir).isDirectory());
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
