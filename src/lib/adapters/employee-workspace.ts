// CLI 직원 한 명의 고정 작업 폴더.
//
// Claude Code 는 세션을 작업 폴더별로 저장한다(~/.claude/projects/<폴더 경로>/<세션ID>.jsonl). 그래서 같은
// 직원을 다른 폴더에서 부르면 이전 세션을 찾지 못한다. 폴더는 직원 ID 로 고정하고, OS 임시 폴더가 아니라
// 런타임 홈(~/.deskrpg) 아래에 둔다 — 임시 폴더가 정리되면 직원의 기억이 사라진다.

import fs from "node:fs/promises";
import path from "node:path";

import { getDeskRpgHomeDir } from "../runtime-paths";
import type { NpcAdapter } from "./types";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function employeeWorkspacePath(npcId: string, homeDir = getDeskRpgHomeDir()): string {
  // 직원 ID 가 경로 조각이 되므로, 폴더 밖으로 나가는 값은 받지 않는다.
  if (!SAFE_ID.test(npcId)) throw new Error(`invalid employee id for workspace: ${npcId}`);
  return path.join(homeDir, "employees", npcId);
}

export async function ensureEmployeeWorkspace(
  npcId: string,
  homeDir = getDeskRpgHomeDir(),
): Promise<string> {
  const dir = employeeWorkspacePath(npcId, homeDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 호출부가 작업 폴더를 모르는 경로(회의 엔진 등)에서 CLI 직원을 부를 때, 직원 작업 폴더를 끼워 넣는다.
 * 없으면 CLI 가 서버 cwd — 앱 저장소 — 에서 돈다.
 */
export function withEmployeeWorkspace(
  adapter: NpcAdapter,
  npcId: string,
  homeDir?: string,
): NpcAdapter {
  return {
    type: adapter.type,
    execute: async (options) =>
      adapter.execute({
        ...options,
        cwd: options.cwd ?? (await ensureEmployeeWorkspace(npcId, homeDir)),
      }),
    abort: adapter.abort && ((sessionKey) => adapter.abort!(sessionKey)),
    resetSession: adapter.resetSession && ((sessionKey) => adapter.resetSession!(sessionKey)),
    testConnection: (config) => adapter.testConnection(config),
  };
}
