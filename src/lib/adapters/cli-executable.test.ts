import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveCliInvocation, type ResolveDeps } from "./cli-executable";

const APPDATA = path.join("C:", "Users", "u", "AppData", "Roaming");
const NPM = path.join(APPDATA, "npm", "node_modules");

function deps(files: string[], overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    platform: "win32",
    env: { APPDATA, USERPROFILE: path.join("C:", "Users", "u") },
    nodePath: "C:/node.exe",
    exists: (file) => files.includes(file),
    ...overrides,
  };
}

test("Windows: npm 래퍼 대신 claude.exe 를 직접 띄운다", () => {
  const exe = path.join(NPM, "@anthropic-ai", "claude-code", "bin", "claude.exe");
  assert.deepEqual(resolveCliInvocation("claude", deps([exe])), { command: exe, baseArgs: [] });
});

test("Windows: codex 는 node 로 codex.js 를 띄운다", () => {
  const js = path.join(NPM, "@openai", "codex", "bin", "codex.js");
  assert.deepEqual(resolveCliInvocation("codex", deps([js])), {
    command: "C:/node.exe",
    baseArgs: [js],
  });
});

test("Windows: Claude 네이티브 설치본(.local\\bin)도 찾는다", () => {
  const exe = path.join("C:", "Users", "u", ".local", "bin", "claude.exe");
  assert.equal(resolveCliInvocation("claude", deps([exe]))?.command, exe);
});

test("Windows: 아무것도 없으면 null — 셸 이름으로 대충 띄우지 않는다", () => {
  assert.equal(resolveCliInvocation("claude", deps([])), null);
});

test("환경 변수 재정의가 우선이고, 파일이 없으면 null 이다", () => {
  const custom = "D:/tools/codex.js";
  const env = { APPDATA, CREW_CODEX_PATH: custom };
  assert.deepEqual(resolveCliInvocation("codex", deps([custom], { env })), {
    command: "C:/node.exe",
    baseArgs: [custom],
  });
  assert.equal(resolveCliInvocation("codex", deps([], { env })), null);
});

test("Windows 가 아니면 PATH 의 이름을 그대로 쓴다", () => {
  assert.deepEqual(resolveCliInvocation("claude", deps([], { platform: "linux" })), {
    command: "claude",
    baseArgs: [],
  });
});
