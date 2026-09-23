import { eq } from "drizzle-orm";
import { db, npcs } from "@/db";
import { parseDbJson } from "./db-json";

type NpcRow = typeof npcs.$inferSelect;

export type ProjectedNpc = {
  id: string;
  channelId: string;
  name: string;
  appearance: unknown;
  positionX: number | null;
  positionY: number | null;
  direction: string | null;
  adapterType: string;
  adapterConfig: unknown;
  agentConfig: unknown;
  active: boolean;
};

/**
 * `npcs` 행 → 소비자들이 쓰는 NPC 모양.
 *
 * crew-office 의 직원(CLI 직원)은 `npcs.name`/`appearance` 가 정본이다. 이름이 비었으면
 * 어댑터 이름으로 떨어진다.
 */
export function projectNpcRow(npc: NpcRow): ProjectedNpc {
  return {
    id: npc.id,
    channelId: npc.channelId,
    name: npc.name?.trim() || npc.adapterType,
    appearance: parseDbJson<unknown>(npc.appearance) ?? npc.appearance ?? null,
    positionX: npc.positionX ?? null,
    positionY: npc.positionY ?? null,
    direction: npc.direction ?? null,
    adapterType: npc.adapterType,
    adapterConfig: parseDbJson<unknown>(npc.adapterConfig) ?? npc.adapterConfig ?? null,
    agentConfig: parseDbJson<unknown>(npc.agentConfig) ?? npc.agentConfig ?? null,
    active: Boolean(npc.active),
  };
}

/** 맵에 그릴 수 있는 것만 — 자리가 있고 출근 중. 기존 `/api/npcs` 계약이 이것이다. */
export function filterForMap(list: ProjectedNpc[]): ProjectedNpc[] {
  return list.filter((n) => n.active && n.positionX !== null && n.positionY !== null);
}

async function selectWhere(where: ReturnType<typeof eq>) {
  const rows = await db.select().from(npcs).where(where);
  return rows.map((r) => projectNpcRow(r));
}

/**
 * `roster` 는 "출근부" — 자리 미정과 휴면까지 전부 준다(관리 화면용).
 * `includeDormant: false` 는 그중 휴면만 뺀다 — 대화 참가자 명단이 이것이다.
 * 자리 미정은 남는다: 맵 밖에 있을 뿐 출근 중이고, 스펙상 휴면만 대화를 떠난다.
 */
export async function selectChannelNpcs(
  channelId: string,
  opts: { roster?: boolean; includeDormant?: boolean } = {},
) {
  const all = await selectWhere(eq(npcs.channelId, channelId));
  if (!opts.roster) return filterForMap(all);
  return opts.includeDormant === false ? all.filter((n) => n.active) : all;
}

export async function selectNpcById(npcId: string): Promise<ProjectedNpc | null> {
  const [one] = await selectWhere(eq(npcs.id, npcId));
  return one ?? null;
}
