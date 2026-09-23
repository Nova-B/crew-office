// crew-office slice 3: Hermes 시절 표·컬럼을 SQLite 에서 걷어낸다.
//
// 두 부트스트랩(src/db/index.ts 의 ensureSqliteCompatibility, server-db.js 의 동명 함수)이
// **마지막 단계로** 부른다 — 앞선 레거시 단계(OpenClaw 은퇴, 맵 에디터 폐기 등)가 옛 모양을
// 다 정리한 뒤라야 npcs 를 한 번에 새 정의로 다시 만들 수 있다.
// PostgreSQL 쪽 같은 작업은 drizzle/0022_drop_hermes_tables.sql 이다.
//
// 멱등이다: 이미 깨끗한 DB 에서는 아무것도 하지 않고 null 을 돌려준다.
// npcs·npc_sessions·chat_messages 등 살아남는 표의 행은 한 건도 지우지 않는다.
"use strict";

// 자식 표부터 — FK 검사는 어차피 꺼 두지만 PG 마이그레이션과 순서를 맞춰 둔다.
const HERMES_TABLES = [
  "approval_targets",
  "approvals",
  "npc_panel_reads",
  "channel_subprojects",
  "channel_projects",
  "cron_job_origins",
  "channel_kanban_boards",
  "channel_gateway_bindings",
  "hermes_profiles",
  "gateway_shares",
  "gateway_resources",
  "provider_shares",
  "provider_resources",
];

// sqlite-base-schema.js 의 npcs 정의와 같아야 한다.
const NPC_COLUMNS = [
  "id",
  "channel_id",
  "name",
  "position_x",
  "position_y",
  "direction",
  "appearance",
  "adapter_type",
  "adapter_config",
  "agent_config",
  "active",
  "created_at",
  "updated_at",
];

function tableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

function columns(sqlite, table) {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

/**
 * @param {import('better-sqlite3').Database} sqlite
 * @returns {{droppedTables: string[], rebuiltNpcs: boolean} | null}
 *   실제로 무언가 한 경우에만 non-null
 */
function dropHermesSchema(sqlite) {
  const droppedTables = HERMES_TABLES.filter((t) => tableExists(sqlite, t));

  const npcCols = tableExists(sqlite, "npcs") ? columns(sqlite, "npcs") : [];
  // hermes_profile_id 가 남은 Hermes 시절 npcs 만 새 정의로 다시 만든다. 다른 열 누락
  // (adapter_type·active 등)은 앞선 ALTER 단계의 몫이다.
  const rebuildNpcs = npcCols.includes("hermes_profile_id");

  if (droppedTables.length === 0 && !rebuildNpcs) return null;

  const copied = NPC_COLUMNS.filter((c) => npcCols.includes(c)).join(", ");

  // FK 검사는 트랜잭션 밖에서 잠시 끈다 — 트랜잭션 안에서는 이 PRAGMA 가 무시된다.
  // 켜 둔 채로 hermes_profiles 를 지우면 npcs.hermes_profile_id 의 ON DELETE CASCADE 가
  // 직원 행과 그 대화 기록까지 지워 버린다.
  sqlite.pragma("foreign_keys = OFF");
  const run = sqlite.transaction(() => {
    if (rebuildNpcs) {
      // 앞선 실행이 CREATE 와 DROP 사이에서 죽었으면 npcs_new 가 남아 다음 부팅을 막는다.
      sqlite.exec(`DROP TABLE IF EXISTS npcs_new`);
      sqlite.exec(`
        CREATE TABLE npcs_new (
          id TEXT PRIMARY KEY NOT NULL,
          channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          name TEXT,
          position_x INTEGER,
          position_y INTEGER,
          direction TEXT DEFAULT 'down',
          appearance TEXT,
          adapter_type TEXT NOT NULL DEFAULT 'hermes',
          adapter_config TEXT,
          agent_config TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT,
          updated_at TEXT,
          UNIQUE(channel_id, position_x, position_y)
        );
        INSERT INTO npcs_new (${copied}) SELECT ${copied} FROM npcs;
        DROP TABLE npcs;
        ALTER TABLE npcs_new RENAME TO npcs;
        CREATE INDEX IF NOT EXISTS idx_npcs_channel_id ON npcs(channel_id);
      `);
    }
    for (const table of droppedTables) {
      sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  });
  try {
    run();
  } finally {
    // 던지더라도 이 커넥션이 FK 검사 없이 계속 사는 일은 없어야 한다.
    sqlite.pragma("foreign_keys = ON");
  }

  if (rebuildNpcs) {
    // npcs 로 좁힌다 — DB 전체를 훑으면 npcs 와 무관한 낡은 고아 행 하나에 기동이 막힌다.
    const broken = sqlite.pragma("foreign_key_check(npcs)");
    if (broken.length > 0) {
      throw new Error(
        `npcs 재생성 후 외래키 무결성이 깨졌습니다(${broken.length}건): ` +
          JSON.stringify(broken.slice(0, 5)),
      );
    }
  }

  console.log(
    `[db] Hermes 시절 스키마 정리: 표 ${droppedTables.length}개 삭제` +
      (rebuildNpcs ? ", npcs 재생성(hermes_profile_id 제거)" : ""),
  );
  return { droppedTables, rebuiltNpcs: rebuildNpcs };
}

module.exports = { HERMES_TABLES, dropHermesSchema };
