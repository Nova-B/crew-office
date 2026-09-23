// CLI 실행 파일을 셸 없이 띄울 수 있는 형태로 찾는다.
//
// 왜 필요한가(2026-09-23 실측, spikes/phase0/RESULTS.md): Windows 에서 npm 으로 깐 `claude`·`codex` 는
// `.ps1`/`.cmd` 래퍼라, `spawn("claude", args, { shell: false })` 는 ENOENT, `spawn("claude.cmd", …)` 는
// EINVAL 로 죽는다. 셸을 거치면 뜨지만 그러면 인자가 셸 문법으로 다시 해석된다. 래퍼가 가리키는 실제
// 실행 파일(`claude.exe`, `node codex.js`)을 직접 띄우면 셸 없이 그대로 된다.

import fs from "node:fs";
import path from "node:path";

export type CliName = "claude" | "codex";

export interface CliInvocation {
  command: string;
  /** 어댑터 인자 앞에 붙는 인자. `node codex.js` 처럼 스크립트를 띄울 때 스크립트 경로가 온다. */
  baseArgs: string[];
}

export interface ResolveDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  nodePath: string;
  exists: (file: string) => boolean;
}

const defaultDeps = (): ResolveDeps => ({
  platform: process.platform,
  env: process.env,
  nodePath: process.execPath,
  exists: (file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
});

const OVERRIDE_ENV: Record<CliName, string> = {
  claude: "CREW_CLAUDE_PATH",
  codex: "CREW_CODEX_PATH",
};

/** npm 전역 설치 기준, 래퍼가 실제로 실행하는 파일(패키지 루트 기준 상대 경로). */
const NPM_ENTRY: Record<CliName, string> = {
  claude: path.join("@anthropic-ai", "claude-code", "bin", "claude.exe"),
  codex: path.join("@openai", "codex", "bin", "codex.js"),
};

function asInvocation(file: string, nodePath: string): CliInvocation {
  return /\.(c|m)?js$/i.test(file)
    ? { command: nodePath, baseArgs: [file] }
    : { command: file, baseArgs: [] };
}

function windowsCandidates(name: CliName, env: ResolveDeps["env"]): string[] {
  const roots = [env.CREW_NPM_ROOT, env.APPDATA && path.join(env.APPDATA, "npm", "node_modules")];
  const candidates = roots
    .filter((r): r is string => !!r)
    .map((r) => path.join(r, NPM_ENTRY[name]));
  // Claude 네이티브 설치본은 사용자 폴더의 .local\bin 에 놓인다.
  if (name === "claude" && env.USERPROFILE) {
    candidates.push(path.join(env.USERPROFILE, ".local", "bin", "claude.exe"));
  }
  return candidates;
}

/**
 * 못 찾으면 null — 호출부가 "설치되지 않음"으로 다룬다.
 * 우선순위: 환경 변수 재정의 → (Windows) 알려진 설치 위치 → (그 외) PATH 의 이름 그대로.
 */
export function resolveCliInvocation(
  name: CliName,
  deps: ResolveDeps = defaultDeps(),
): CliInvocation | null {
  const override = deps.env[OVERRIDE_ENV[name]];
  if (override) return deps.exists(override) ? asInvocation(override, deps.nodePath) : null;

  if (deps.platform !== "win32") return { command: name, baseArgs: [] };

  const found = windowsCandidates(name, deps.env).find((file) => deps.exists(file));
  return found ? asInvocation(found, deps.nodePath) : null;
}
