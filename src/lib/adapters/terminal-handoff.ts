// crew-office 4단계: 직원의 1:1 세션을 사람이 터미널에서 직접 이어받는다(기획안 §3 "터미널로 인계").
//
// 앱은 헤드리스로 턴을 돌리지만 세션 기록은 대화형 CLI 와 같은 저장소에 남는다(phase0: Claude 는
// ~/.claude/projects/<작업 폴더>/, Codex 는 ~/.codex/sessions/). 그래서 같은 작업 폴더에서
// `claude --resume <id>` / `codex resume <id>` 를 열면 그 세션을 그대로 이어 쓴다.

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { CliInvocation, CliName } from "./cli-executable";

export interface HandoffCommand {
  command: string;
  args: string[];
  /** 사람이 직접 칠 때의 모양. 터미널을 못 열었을 때 안내에 쓴다. */
  display: string;
}

export function buildHandoffCommand(
  name: CliName,
  invocation: CliInvocation,
  sessionRef: string,
): HandoffCommand {
  const cliArgs = name === "claude" ? ["--resume", sessionRef] : ["resume", sessionRef];
  return {
    command: invocation.command,
    args: [...invocation.baseArgs, ...cliArgs],
    display: [name, ...cliArgs].join(" "),
  };
}

export interface OpenTerminalDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists: (file: string) => boolean;
  spawn: (
    command: string,
    args: string[],
    options: { detached: boolean; stdio: "ignore" },
  ) => { unref(): void; on(event: "error", listener: () => void): unknown };
}

const defaultDeps = (): OpenTerminalDeps => ({
  platform: process.platform,
  env: process.env,
  exists: (file) => fs.existsSync(file),
  spawn: nodeSpawn,
});

/**
 * Windows Terminal 새 창에서 연다. 열었으면 true.
 * Windows 가 아니거나 wt.exe 가 없으면 false — 호출부가 `display` 명령을 안내한다.
 * wt.exe 는 앱 실행 별칭이라 존재를 먼저 확인한다 — spawn 의 ENOENT 는 비동기라 결과로 돌려줄 수 없다.
 */
export function openTerminal(
  cwd: string,
  handoff: HandoffCommand,
  deps: OpenTerminalDeps = defaultDeps(),
): boolean {
  // 자동 테스트(e2e)가 사용자 화면에 창을 띄우지 않게 끌 수 있다 — 그때는 명령 안내 경로로 간다.
  if (deps.env.CREW_HANDOFF_NO_TERMINAL === "1") return false;
  if (deps.platform !== "win32" || !deps.env.LOCALAPPDATA) return false;
  const wt = path.join(deps.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "wt.exe");
  if (!deps.exists(wt)) return false;
  try {
    const child = deps.spawn(wt, ["-w", "new", "-d", cwd, handoff.command, ...handoff.args], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
