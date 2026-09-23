import { eq } from "drizzle-orm";
import { db, npcs, nowForDb } from "@/db";
import { placeUnplacedNpcs } from "./npc-seating";

// crew-office: Hermes 게이트웨이 프로필을 채널에 출근·퇴근시키던 고용 경로(hireGatewayProfilesIntoChannel·
// hireProfileIntoBoundChannels·sleepChannelNpcs)는 Hermes 와 함께 걷어냈다. 직원은 CLI 직원 고용 라우트가 만든다.

/** NPC 하나의 출근 상태를 직접 토글한다. */
export async function setNpcActive(npcId: string, active: boolean): Promise<void> {
  // `updated_at` 은 마이그레이션이 "최신 하나" 를 고르는 기준이다 — 상태를 바꾸는
  // 경로가 전부 같이 갱신해야 그 판단이 낡은 값 위에서 이뤄지지 않는다.
  await db.update(npcs).set({ active, updatedAt: nowForDb() }).where(eq(npcs.id, npcId));
  if (!active) return;
  // 자리 없이 잠들었던 직원(이 기능 이전 데이터)은 되살아나면서 자리를 받는다.
  const [row] = await db
    .select({ channelId: npcs.channelId })
    .from(npcs)
    .where(eq(npcs.id, npcId))
    .limit(1);
  if (row) await placeUnplacedNpcs(row.channelId);
}
