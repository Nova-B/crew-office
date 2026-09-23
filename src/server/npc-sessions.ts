// src/server/npc-sessions.ts
// CLI 직원(Claude Code·Codex)의 대화 세션 연속성 — npc_sessions 행을 읽고 쓴다.
//
// crew-office: 예전 hermes-dispatch.ts 에서 Hermes 와 무관하게 쓰이던 부분만 옮겨 왔다. Hermes 어댑터·
// 실행(run) 레지스트리·디스패치 분류는 Hermes 와 함께 걷어냈다.

import { and, eq } from "drizzle-orm";

import { db, isPostgres, npcSessions } from "@/db";

// 호출부는 sessionKey 를 `${sessionKeyPrefix}-<contextKey>` 로 만든다
// (예: `${prefix}-dm-${userId}`, `${prefix}-meeting-${channelId}`). contextKey 를 이렇게 되찾으면
// npc_sessions 행이 호출부의 sessionKey 모양과 어긋나지 않는다 — 두 번째 규약을 만들지 않는다.
export function deriveContextKey(sessionKey: string, sessionKeyPrefix: string): string {
  const prefixWithDash = `${sessionKeyPrefix}-`;
  if (sessionKey.startsWith(prefixWithDash)) {
    return sessionKey.slice(prefixWithDash.length);
  }
  return sessionKey;
}

function nowForDb() {
  return (isPostgres ? new Date() : new Date().toISOString()) as unknown as Date;
}

/**
 * npc_sessions 에 저장된 세션. 어댑터 종류가 다르면 없는 것으로 본다 — 같은 직원이 Claude 에서
 * Codex 로 바뀌었을 때 Claude 세션 ID 로 Codex 를 재개하려 들면 안 된다.
 */
export async function getStoredNpcSessionRef(
  npcId: string,
  userId: string,
  contextKey: string,
  adapterType: string,
): Promise<string | null> {
  const rows = await db
    .select({ sessionRef: npcSessions.sessionRef })
    .from(npcSessions)
    .where(
      and(
        eq(npcSessions.npcId, npcId),
        eq(npcSessions.userId, userId),
        eq(npcSessions.contextKey, contextKey),
        eq(npcSessions.adapterType, adapterType),
      ),
    )
    .limit(1);

  return rows[0]?.sessionRef ?? null;
}

export async function persistNpcSessionRef(
  npcId: string,
  userId: string,
  contextKey: string,
  adapterType: string,
  sessionRef: string,
): Promise<void> {
  const existing = await db
    .select({ id: npcSessions.id })
    .from(npcSessions)
    .where(
      and(
        eq(npcSessions.npcId, npcId),
        eq(npcSessions.userId, userId),
        eq(npcSessions.contextKey, contextKey),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(npcSessions)
      .set({ sessionRef, adapterType, updatedAt: nowForDb() })
      .where(eq(npcSessions.id, existing[0].id));
    return;
  }

  await db.insert(npcSessions).values({
    npcId,
    userId,
    adapterType,
    sessionType: contextKey.startsWith("task-")
      ? "task"
      : contextKey.startsWith("meeting-")
        ? "meeting"
        : "dm",
    sessionRef,
    contextKey,
    createdAt: nowForDb(),
    updatedAt: nowForDb(),
  });
}
