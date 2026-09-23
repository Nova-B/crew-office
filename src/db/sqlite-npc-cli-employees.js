// crew-office: Hermes 프로필 없이 Claude Code·Codex CLI 직원을 둘 수 있게 npcs.hermes_profile_id 를
// NULL 허용으로 바꾼다. SQLite 는 ALTER 로 NOT NULL 을 못 풀므로 npcs 를 같은 정의로 다시 만든다.
// PostgreSQL 쪽 같은 작업은 drizzle/0021_npc_cli_employees.sql 이다.
//
// 유니크 (channel_id, hermes_profile_id) 는 그대로 둔다 — NULL 은 서로 같지 않으므로 CLI 직원은
// 한 채널에 여럿 둘 수 있고, Hermes 직원의 "프로필당 채널 하나" 규칙은 유지된다.
"use strict";

// sqlite-base-schema.js 의 npcs 정의와 같아야 한다(hermes_profile_id 의 NOT NULL 만 다르다).
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
  "hermes_profile_id",
  "agent_config",
  "active",
  "created_at",
  "updated_at",
];

function tableInfo(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all();
}

function tableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

function allowCliEmployees(sqlite) {
  if (!tableExists(sqlite, "npcs")) return null;
  const info = tableInfo(sqlite, "npcs");
  const profile = info.find((c) => c.name === "hermes_profile_id");
  if (!profile || profile.notnull === 0) return null; // 이미 적용됐거나 다른 모양
  // 프로필 소유 이관(sqlite-npc-profile-ownership.js) 뒤의 모양만 다룬다 — 그 이관이 active 를 만든다.
  const present = new Set(info.map((c) => c.name));
  if (!present.has("active")) return null;
  const copied = NPC_COLUMNS.filter((c) => present.has(c)).join(", ");

  // FK 검사는 트랜잭션 밖에서 잠시 끈다 — 트랜잭션 안에서는 이 PRAGMA 가 무시된다.
  sqlite.pragma("foreign_keys = OFF");
  const rebuild = sqlite.transaction(() => {
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
        hermes_profile_id TEXT REFERENCES hermes_profiles(id) ON DELETE CASCADE,
        agent_config TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(channel_id, position_x, position_y),
        UNIQUE(channel_id, hermes_profile_id)
      );
      INSERT INTO npcs_new (${copied}) SELECT ${copied} FROM npcs;
      DROP TABLE npcs;
      ALTER TABLE npcs_new RENAME TO npcs;
      CREATE INDEX IF NOT EXISTS idx_npcs_channel_id ON npcs(channel_id);
    `);
  });
  try {
    rebuild();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }

  const broken = sqlite.pragma("foreign_key_check(npcs)");
  if (broken.length > 0) {
    throw new Error(
      `npcs 재생성 후 외래키 무결성이 깨졌습니다(${broken.length}건): ` +
        JSON.stringify(broken.slice(0, 5)),
    );
  }
  return { rebuilt: true };
}

module.exports = { allowCliEmployees };
