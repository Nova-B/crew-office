import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * NPC 관련 라우트/서버 테스트가 공유하는 씨앗 헬퍼.
 *
 * crew-office 의 직원은 로컬 CLI 세션(`npcs.adapter_type` "claude"|"codex")이라 NPC 행 하나면
 * 된다 — 게이트웨이·프로필 사슬은 Hermes 와 함께 사라졌다. 관심사별로 함수를 하나씩 나눠
 * 두었으니 필요한 조각만 골라 조립하면 된다.
 *
 * `db` 는 지연 초기화되는 모듈 싱글턴이라, 임시 SQLite 를 쓰려면 `@/db` 가 처음
 * 로드되기 **전에** 환경변수가 잡혀 있어야 한다. 그래서 이 파일의 모든 헬퍼는
 * `@/db` 를 동적 import 한다 — 테스트 파일이 모듈 최상단에서 `setupThrowawaySqlite()`
 * 를 부르기만 하면 된다.
 */

/** 이 테스트 프로세스 전용 SQLite 파일을 잡고, 종료 시 지운다. */
export function setupThrowawaySqlite(label: string): string {
  const sqlitePath = path.join(os.tmpdir(), `${label}-${crypto.randomUUID()}.db`);
  // DATABASE_URL 이 환경에 있으면 @/db 는 그것을 보고 Postgres 로 붙는다(src/db/index.ts:22).
  // 임시 SQLite 를 쓰겠다는 의사를 명시한다 — 개발자의 셸에서 그냥 돌려도 같은 결과가 나온다.
  process.env.DB_TYPE = "sqlite";
  process.env.DESKRPG_HOME = os.tmpdir();
  process.env.SQLITE_PATH = sqlitePath;
  for (const ext of ["", "-wal", "-shm"]) {
    process.on("exit", () => fs.rmSync(`${sqlitePath}${ext}`, { force: true }));
  }
  return sqlitePath;
}

async function loadDb() {
  return import("@/db");
}

export async function seedUser(prefix = "user") {
  const { db, users } = await loadDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      loginId: `${prefix}-${suffix}`,
      nickname: `${prefix}-${suffix}`,
      passwordHash: "hash",
    })
    .returning();
  return user;
}

export async function seedChannel(ownerId: string, name = "Test Channel", mapData?: unknown) {
  const { db, channels, jsonForDb } = await loadDb();
  const [channel] = await db
    .insert(channels)
    .values(
      mapData !== undefined ? { name, ownerId, mapData: jsonForDb(mapData) } : { name, ownerId },
    )
    .returning();
  return channel;
}

export async function seedNpc(input: {
  channelId: string;
  name?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  active?: boolean;
  /** 기본은 CLI 직원 "claude". 은퇴한 어댑터("hermes" 등) 동작을 볼 때만 바꾼다. */
  adapterType?: string;
  appearance?: unknown;
  agentConfig?: unknown;
}) {
  const { db, npcs, jsonForDb } = await loadDb();
  const [npc] = await db
    .insert(npcs)
    .values({
      channelId: input.channelId,
      name: input.name ?? "Test NPC",
      positionX: input.positionX ?? null,
      positionY: input.positionY ?? null,
      active: input.active ?? true,
      adapterType: input.adapterType ?? "claude",
      appearance: jsonForDb(input.appearance ?? {}),
      agentConfig: jsonForDb(input.agentConfig ?? {}),
    })
    .returning();
  return npc;
}

/**
 * 채널 하나 + 요청한 조합의 CLI 직원(NPC) 들.
 *
 * - `placedActive`: 자리 있고 출근 중 — `/api/npcs` 의 기본 응답에 나와야 하는 유일한 종류
 * - `unplaced`: 고용됐고 아직 자리가 없음 (`position_x/y` NULL)
 * - `dormant`: 자리는 기억하지만 퇴근 (`active = 0`)
 */
export async function seedChannelWithNpcs(opts: {
  placedActive?: number;
  unplaced?: number;
  dormant?: number;
  /** 첫 NPC 의 이름 — 응답의 `name` 은 이것이어야 한다. 나머지는 "Test NPC". */
  firstName?: string;
  /** 채널의 맵 데이터 — 있으면 자리 배정 테스트가 실제 좌석을 계산할 수 있다. */
  mapData?: unknown;
  /** NPC 의 어댑터. 기본은 CLI 직원 "claude" — `/api/npcs` 는 은퇴한 어댑터를 숨긴다. */
  adapterType?: string;
}) {
  const { placedActive = 0, unplaced = 0, dormant = 0 } = opts;

  const user = await seedUser("channel-owner");
  const channel = await seedChannel(user.id, undefined, opts.mapData);

  const npcIds: string[] = [];
  // 자리는 채널 안에서 유일해야 한다(npcs_channel_position_unique). 배치되는 NPC 마다
  // 한 칸씩 옆으로 민다.
  let nextColumn = 0;
  let isFirst = true;

  async function add(kind: "placedActive" | "unplaced" | "dormant") {
    const placed = kind !== "unplaced";
    const npc = await seedNpc({
      channelId: channel.id,
      name: isFirst ? (opts.firstName ?? "Test NPC") : "Test NPC",
      positionX: placed ? nextColumn++ : null,
      positionY: placed ? 0 : null,
      active: kind !== "dormant",
      adapterType: opts.adapterType,
    });
    npcIds.push(npc.id);
    isFirst = false;
  }

  for (let i = 0; i < placedActive; i += 1) await add("placedActive");
  for (let i = 0; i < unplaced; i += 1) await add("unplaced");
  for (let i = 0; i < dormant; i += 1) await add("dormant");

  return {
    channelId: channel.id,
    npcIds,
    userId: user.id,
  };
}

/** 라우트 핸들러에 넘길 인증 헤더 — `getUserId` 는 `x-user-id` 하나만 본다. */
export function authHeaders(userId: string): Record<string, string> {
  return { "x-user-id": userId, "Content-Type": "application/json" };
}

/** 채널에 회의록 한 건. */
export async function seedMeetingMinutes(channelId: string, topic = "주간 회의") {
  const { db, meetingMinutes } = await loadDb();
  const [row] = await db
    .insert(meetingMinutes)
    .values({ channelId, topic, transcript: "..." })
    .returning();
  return row;
}

export async function countMeetingMinutes(channelId: string): Promise<number> {
  const { db, meetingMinutes } = await loadDb();
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ id: meetingMinutes.id })
    .from(meetingMinutes)
    .where(eq(meetingMinutes.channelId, channelId));
  return rows.length;
}
