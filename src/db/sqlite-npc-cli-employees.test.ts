import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { allowCliEmployees } = require("./sqlite-npc-cli-employees.js") as {
  allowCliEmployees: (sqlite: Database.Database) => { rebuilt: true } | null;
};

/** 프로필 소유 이관 직후의 모양 — hermes_profile_id 가 NOT NULL 이다. */
function legacyDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE hermes_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE npcs (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name TEXT, position_x INTEGER, position_y INTEGER, direction TEXT DEFAULT 'down',
      appearance TEXT, adapter_type TEXT NOT NULL DEFAULT 'hermes', adapter_config TEXT,
      hermes_profile_id TEXT NOT NULL REFERENCES hermes_profiles(id) ON DELETE CASCADE,
      agent_config TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT,
      UNIQUE(channel_id, position_x, position_y), UNIQUE(channel_id, hermes_profile_id)
    );
    CREATE TABLE npc_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE
    );
    INSERT INTO channels VALUES ('c1');
    INSERT INTO hermes_profiles VALUES ('p1');
    INSERT INTO npcs (id, channel_id, hermes_profile_id, position_x, position_y, active)
      VALUES ('n1', 'c1', 'p1', 3, 4, 0);
    INSERT INTO npc_sessions VALUES ('s1', 'n1');
  `);
  return sqlite;
}

test("hermes_profile_id 를 NULL 허용으로 바꾸고 기존 행·자식 행을 그대로 둔다", () => {
  const sqlite = legacyDb();
  assert.deepEqual(allowCliEmployees(sqlite), { rebuilt: true });

  const col = (
    sqlite.prepare("PRAGMA table_info(npcs)").all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === "hermes_profile_id");
  assert.equal(col?.notnull, 0);
  assert.deepEqual(sqlite.prepare("SELECT id, position_x, active FROM npcs").all(), [
    { id: "n1", position_x: 3, active: 0 },
  ]);

  // 프로필 없는 CLI 직원 둘을 같은 채널에 둘 수 있다 — NULL 은 유니크 충돌이 아니다.
  sqlite.exec(`INSERT INTO npcs (id, channel_id, adapter_type) VALUES ('cli1', 'c1', 'claude'),
               ('cli2', 'c1', 'codex')`);
  // 자식 행의 FK 는 새 npcs 를 가리킨다 — 직원을 지우면 세션도 지워진다.
  sqlite.exec(`DELETE FROM npcs WHERE id = 'n1'`);
  const { n } = sqlite.prepare("SELECT COUNT(*) AS n FROM npc_sessions").get() as { n: number };
  assert.equal(n, 0);
});

test("이미 적용된 DB 에서는 아무것도 하지 않는다", () => {
  const sqlite = legacyDb();
  allowCliEmployees(sqlite);
  assert.equal(allowCliEmployees(sqlite), null);
});
