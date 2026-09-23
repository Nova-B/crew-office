import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildHandoffCommand, openTerminal, type OpenTerminalDeps } from "./terminal-handoff";

test("Claude 는 --resume, Codex 는 resume 하위 명령으로 같은 세션을 연다", () => {
  const claude = buildHandoffCommand(
    "claude",
    { command: "C:/npm/claude.exe", baseArgs: [] },
    "s-1",
  );
  assert.deepEqual(claude, {
    command: "C:/npm/claude.exe",
    args: ["--resume", "s-1"],
    display: "claude --resume s-1",
  });
  const codex = buildHandoffCommand(
    "codex",
    { command: "C:/node.exe", baseArgs: ["C:/npm/codex.js"] },
    "t-1",
  );
  assert.deepEqual(codex.args, ["C:/npm/codex.js", "resume", "t-1"]);
  assert.equal(codex.display, "codex resume t-1");
});

function deps(overrides: Partial<OpenTerminalDeps> = {}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const LOCALAPPDATA = path.join("C:", "Users", "u", "AppData", "Local");
  const wt = path.join(LOCALAPPDATA, "Microsoft", "WindowsApps", "wt.exe");
  const value: OpenTerminalDeps = {
    platform: "win32",
    env: { LOCALAPPDATA },
    exists: (file) => file === wt,
    spawn: (command, args) => {
      calls.push({ command, args });
      return { unref() {}, on() {} };
    },
    ...overrides,
  };
  return { value, calls, wt };
}

test("Windows 에서는 wt.exe 로 직원 작업 폴더에서 새 창을 연다", () => {
  const { value, calls, wt } = deps();
  const handoff = buildHandoffCommand("claude", { command: "claude.exe", baseArgs: [] }, "s-1");
  assert.equal(openTerminal("D:/ws/npc-1", handoff, value), true);
  assert.deepEqual(calls, [
    { command: wt, args: ["-w", "new", "-d", "D:/ws/npc-1", "claude.exe", "--resume", "s-1"] },
  ]);
});

test("wt.exe 가 없거나 Windows 가 아니면 열지 않고 false — 사람이 명령을 직접 친다", () => {
  const handoff = buildHandoffCommand("claude", { command: "claude", baseArgs: [] }, "s-1");
  assert.equal(openTerminal("/ws", handoff, deps({ exists: () => false }).value), false);
  assert.equal(openTerminal("/ws", handoff, deps({ platform: "darwin" }).value), false);
  const off = deps();
  off.value.env.CREW_HANDOFF_NO_TERMINAL = "1";
  assert.equal(openTerminal("/ws", handoff, off.value), false, "e2e 는 창을 띄우지 않는다");
  assert.equal(off.calls.length, 0);
});
