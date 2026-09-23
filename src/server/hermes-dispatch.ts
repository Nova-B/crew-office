// src/server/hermes-dispatch.ts
// Routes NPC socket dispatch to the right backend (Hermes / OpenClaw / CLI registry /
// unbound) and owns the pieces that a per-dispatch HermesAdapter cannot: session
// continuity (read/write npc_sessions) and run tracking across socket events
// (abort/steer arrive on a later event than the HermesAdapter instance that started
// the run).
//
// classifyNpcDispatch stays pure and I/O-free by design — everything that touches the
// DB or a live client lives in the functions below it, so the routing decision itself
// stays trivially testable.

import { and, eq } from "drizzle-orm";

import { db, isPostgres, npcSessions } from "@/db";
import { getProfileClientForNpc } from "@/lib/hermes-profiles";
import { HermesAdapter } from "@/lib/adapters/hermes-adapter";

export type NpcDispatchKind = "hermes" | "openclaw" | "registry" | "unbound";

export function classifyNpcDispatch(npc: {
  adapterType: string;
  hermesProfileId: string | null;
}): NpcDispatchKind {
  if (npc.adapterType === "unbound") return "unbound";
  if (npc.adapterType === "hermes") return npc.hermesProfileId ? "hermes" : "unbound";
  if (npc.adapterType === "openclaw") return "openclaw";
  return "registry";
}

// The rest of the codebase builds sessionKey as `${sessionKeyPrefix}-<contextKey>`
// (e.g. `${prefix}-dm-${userId}`, `${prefix}-task-${taskId}`). Recovering the
// contextKey this way keeps npc_sessions rows aligned with whatever sessionKey shape
// the caller already uses, instead of inventing a second convention.
export function deriveHermesContextKey(sessionKey: string, sessionKeyPrefix: string): string {
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
 * npc_sessions 에 저장된 세션. 어댑터 종류가 다르면 없는 것으로 본다 — 같은 직원이 Hermes 에서
 * Claude 로 바뀌었을 때 Hermes 세션 ID 로 Claude 를 재개하려 들면 안 된다.
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

export function getStoredHermesSessionRef(
  npcId: string,
  userId: string,
  contextKey: string,
): Promise<string | null> {
  return getStoredNpcSessionRef(npcId, userId, contextKey, "hermes");
}

export function persistHermesSessionRef(
  npcId: string,
  userId: string,
  contextKey: string,
  sessionRef: string,
): Promise<void> {
  return persistNpcSessionRef(npcId, userId, contextKey, "hermes", sessionRef);
}

/**
 * Builds a fresh HermesAdapter for one dispatch. Never share this instance across
 * dispatches or NPCs/users — HermesAdapter keeps sessionId/lastRunId as instance
 * fields, and sharing it would cross-contaminate concurrent conversations. Session
 * continuity lives in npc_sessions (read here, written by the caller after execute()
 * returns), not in the adapter instance.
 */
export async function createHermesAdapterForNpc(
  npcId: string,
  userId: string,
  contextKey: string,
): Promise<HermesAdapter | null> {
  const client = await getProfileClientForNpc(npcId);
  if (!client) return null;

  const storedSessionRef = await getStoredHermesSessionRef(npcId, userId, contextKey);
  return new HermesAdapter(client, { sessionId: storedSessionRef ?? undefined });
}

// Run registry — abort/steer arrive on later, independent socket events, after the
// HermesAdapter that started the run has already gone out of scope. Keyed by the same
// sessionKey the dispatch used, populated from the adapter's onRunStarted callback and
// cleared once the turn ends (success or failure).
const hermesRunRegistry = new Map<string, string>();

export function registerHermesRun(sessionKey: string, runId: string): void {
  hermesRunRegistry.set(sessionKey, runId);
}

export function getHermesRun(sessionKey: string): string | undefined {
  return hermesRunRegistry.get(sessionKey);
}

export function clearHermesRun(sessionKey: string): void {
  hermesRunRegistry.delete(sessionKey);
}
