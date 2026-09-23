import assert from "node:assert/strict";
import test from "node:test";

import { setupThrowawaySqlite, seedChannelWithNpcs } from "@/test-setup/npc-seed";
import { buildOfficeEnvironment } from "@/game/three/office-environments";

// `db` 는 지연 초기화 싱글턴이고 node:test 는 파일마다 프로세스를 나누므로, 모듈
// 최상단에서 한 번 임시 DB 를 잡으면 이 파일의 모든 테스트가 그 DB 를 쓴다.
setupThrowawaySqlite("npc-roster-test");

test("자리 없이 잠들었던 직원도 되살아나면 자리를 받는다", async () => {
  const { setNpcActive } = await import("./npc-roster");
  const { selectChannelNpcs } = await import("./npc-projection");
  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { channelId, npcIds } = await seedChannelWithNpcs({
    unplaced: 1,
    mapData: buildOfficeEnvironment("executive"),
  });
  await db.update(npcs).set({ active: false }).where(eq(npcs.id, npcIds[0]));
  await setNpcActive(npcIds[0], true);
  const [row] = await selectChannelNpcs(channelId);
  assert.ok(row && row.positionX !== null);
});

test("M3: 출근 토글이 updated_at 을 갱신한다", async () => {
  const { setNpcActive } = await import("./npc-roster");
  const { selectChannelNpcs } = await import("./npc-projection");
  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { isPostgres } = await import("@/db");
  const STALE = (isPostgres
    ? new Date("2020-01-01T00:00:00Z")
    : "2020-01-01T00:00:00.000Z") as unknown as Date;

  // `updated_at` 은 마이그레이션이 "최신 하나" 를 고르는 기준이다. 상태를 바꾸는
  // 경로가 이것을 놔두면 그 판단이 낡은 값 위에서 이뤄진다.
  const { channelId } = await seedChannelWithNpcs({ placedActive: 1 });
  const [seeded] = await selectChannelNpcs(channelId, { roster: true });

  async function updatedAt(id: string) {
    const [row] = await db
      .select({ updatedAt: npcs.updatedAt })
      .from(npcs)
      .where(eq(npcs.id, id))
      .limit(1);
    return row.updatedAt;
  }

  await db.update(npcs).set({ updatedAt: STALE }).where(eq(npcs.id, seeded.id));
  const stale = await updatedAt(seeded.id);

  await setNpcActive(seeded.id, true);
  assert.notDeepEqual(await updatedAt(seeded.id), stale, "출근이 updated_at 을 갱신한다");

  await db.update(npcs).set({ updatedAt: STALE }).where(eq(npcs.id, seeded.id));
  await setNpcActive(seeded.id, false);
  assert.notDeepEqual(await updatedAt(seeded.id), stale, "토글이 updated_at 을 갱신한다");
});
