import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { ensureSqliteCompatibility as ensureViaApiPath } from "./index";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js") as {
  SQLITE_BASE_SCHEMA: string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropHermesSchema, HERMES_TABLES } = require("./sqlite-drop-hermes.js") as {
  dropHermesSchema: (sqlite: Database.Database) => {
    droppedTables: string[];
    rebuiltNpcs: boolean;
  } | null;
  HERMES_TABLES: string[];
};

// 소켓 서버 경로(server-db.js). DB_TYPE 이 sqlite 가 아니면 모듈 로드가 파일을 열지 않는다 —
// pg Pool 은 만들어지지만 질의 전에는 접속하지 않는다. 여기서는 내보낸 함수만 쓴다.
function loadServerDbPath(): (sqlite: Database.Database) => void {
  const prev = process.env.DB_TYPE;
  process.env.DB_TYPE = "postgresql";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./server-db.js") as {
      ensureSqliteCompatibility: (s: Database.Database) => void;
    };
    return mod.ensureSqliteCompatibility;
  } finally {
    if (prev === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = prev;
  }
}
const ensureViaServerPath = loadServerDbPath();

const SURVIVING_TABLES = [
  "channel_members",
  "channels",
  "characters",
  "chat_messages",
  "chat_room_members",
  "chat_room_messages",
  "chat_rooms",
  "group_invites",
  "group_join_requests",
  "group_members",
  "group_permissions",
  "groups",
  "meeting_minutes",
  "npc_sessions",
  "npcs",
  "user_permission_overrides",
  "users",
].sort();

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  )
    .map((r) => r.name)
    .sort();
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

/**
 * slice 3 직전 crew-office 의 SQLite 모양(sqlite-npc-cli-employees 적용 뒤) 중 Hermes 가 걸린 부분.
 * 나머지 표는 새 SQLITE_BASE_SCHEMA 가 채운다(CREATE IF NOT EXISTS 라 아래 정의가 이긴다).
 */
const LEGACY_HERMES_DDL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL, login_id TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, system_role TEXT NOT NULL DEFAULT 'user',
    must_change_password INTEGER NOT NULL DEFAULT 0, last_active_at TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE channels (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id), group_id TEXT, map_data TEXT, map_config TEXT,
    is_public INTEGER DEFAULT 1, invite_code TEXT UNIQUE, max_players INTEGER DEFAULT 50,
    password TEXT, gateway_config TEXT, motion_config TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE gateway_resources (
    id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL, base_url TEXT NOT NULL, token_encrypted TEXT NOT NULL,
    plugin_info_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE gateway_shares (
    id TEXT PRIMARY KEY NOT NULL, gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'use',
    created_at TEXT NOT NULL
  );
  CREATE TABLE hermes_profiles (
    id TEXT PRIMARY KEY NOT NULL, gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL, token_encrypted TEXT NOT NULL, display_name TEXT, appearance TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE provider_resources (
    id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL, auth_method TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE provider_shares (
    id TEXT PRIMARY KEY NOT NULL, provider_id TEXT NOT NULL REFERENCES provider_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'use',
    created_at TEXT NOT NULL
  );
  CREATE TABLE channel_gateway_bindings (
    id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE,
    bound_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, bound_at TEXT NOT NULL,
    UNIQUE(channel_id)
  );
  CREATE TABLE npcs (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name TEXT, position_x INTEGER, position_y INTEGER, direction TEXT DEFAULT 'down', appearance TEXT,
    adapter_type TEXT NOT NULL DEFAULT 'hermes', adapter_config TEXT,
    hermes_profile_id TEXT REFERENCES hermes_profiles(id) ON DELETE CASCADE,
    agent_config TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT,
    UNIQUE(channel_id, position_x, position_y),
    UNIQUE(channel_id, hermes_profile_id)
  );
  CREATE INDEX idx_npcs_channel_id ON npcs(channel_id);
  CREATE TABLE chat_rooms (
    id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL, reply_policy TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, last_message_at TEXT
  );
  CREATE TABLE chat_room_messages (
    id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_kind TEXT NOT NULL, sender_id TEXT, sender_name TEXT NOT NULL, content TEXT NOT NULL,
    notice_json TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX idx_chat_room_messages_room ON chat_room_messages(room_id, created_at);
  CREATE TABLE channel_kanban_boards (
    id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE, board_slug TEXT NOT NULL,
    is_event_carrier INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE cron_job_origins (
    id TEXT PRIMARY KEY NOT NULL, gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL, job_id TEXT NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, created_at TEXT NOT NULL
  );
  CREATE TABLE channel_projects (
    id TEXT PRIMARY KEY NOT NULL,
    board_link_id TEXT NOT NULL UNIQUE REFERENCES channel_kanban_boards(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    lead_npc_id TEXT REFERENCES npcs(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE channel_subprojects (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES channel_projects(id) ON DELETE CASCADE,
    tenant_slug TEXT NOT NULL, name TEXT NOT NULL,
    lead_npc_id TEXT REFERENCES npcs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    type TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL, title TEXT NOT NULL,
    source_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE approval_targets (
    approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE, task_id TEXT NOT NULL,
    decision TEXT, PRIMARY KEY (approval_id, task_id)
  );
  CREATE TABLE npc_panel_reads (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
    tab TEXT NOT NULL, seen_at TEXT NOT NULL, seen_ids TEXT, PRIMARY KEY (user_id, npc_id, tab)
  );
`;

const NOW = "2026-09-01T00:00:00.000Z";

/** 레거시 모양 DB + CLI 직원·Hermes 직원·세션·대화·Hermes 표 행. */
function legacyDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(LEGACY_HERMES_DDL);
  db.exec(SQLITE_BASE_SCHEMA);
  db.exec(`
    INSERT INTO users (id, login_id, nickname, password_hash, system_role, created_at)
      VALUES ('u1', 'u1', 'owner', 'x', 'system_admin', '${NOW}');
    INSERT INTO characters (id, user_id, name, appearance) VALUES ('ch1', 'u1', 'me', '{}');
    INSERT INTO channels (id, name, owner_id) VALUES ('c1', 'office', 'u1');
    INSERT INTO gateway_resources (id, owner_user_id, display_name, base_url, token_encrypted, created_at, updated_at)
      VALUES ('g1', 'u1', 'gw', 'http://gw', 'enc', '${NOW}', '${NOW}');
    INSERT INTO hermes_profiles (id, gateway_id, profile_name, token_encrypted, created_at, updated_at)
      VALUES ('p1', 'g1', 'oliver', 'enc', '${NOW}', '${NOW}');
    INSERT INTO channel_gateway_bindings (id, channel_id, gateway_id, bound_by_user_id, bound_at)
      VALUES ('b1', 'c1', 'g1', 'u1', '${NOW}');
    INSERT INTO npcs (id, channel_id, name, position_x, position_y, adapter_type, hermes_profile_id, agent_config, active)
      VALUES ('cli', 'c1', 'Mina', 3, 4, 'claude', NULL, '{"cwd":"C:/work"}', 1);
    INSERT INTO npcs (id, channel_id, name, position_x, position_y, adapter_type, hermes_profile_id, active)
      VALUES ('herm', 'c1', 'Oliver', 5, 6, 'hermes', 'p1', 0);
    INSERT INTO npc_sessions (id, npc_id, user_id, adapter_type, session_type, session_ref, context_key, created_at, updated_at)
      VALUES ('s1', 'cli', 'u1', 'claude', 'dm', 'sess-abc', 'dm:u1', '${NOW}', '${NOW}');
    INSERT INTO chat_messages (id, character_id, npc_id, role, content, created_at)
      VALUES ('m1', 'ch1', 'cli', 'user', 'hi', '${NOW}');
    INSERT INTO chat_messages (id, character_id, npc_id, role, content, created_at)
      VALUES ('m2', 'ch1', 'herm', 'user', 'old hermes chat', '${NOW}');
    INSERT INTO chat_rooms (id, channel_id, kind, name, reply_policy, created_by, created_at)
      VALUES ('r1', 'c1', 'office', 'Office', 'mention', 'u1', '${NOW}');
    INSERT INTO chat_room_messages (id, room_id, sender_kind, sender_name, content, notice_json, created_at)
      VALUES ('rm1', 'r1', 'user', 'owner', 'hello room', '{"kind":"meeting_outcome"}', '${NOW}');
    INSERT INTO npc_panel_reads (user_id, npc_id, tab, seen_at) VALUES ('u1', 'cli', 'cards', '${NOW}');
    INSERT INTO approvals (id, channel_id, type, status, requested_by, title, source_json, created_at)
      VALUES ('a1', 'c1', 'task_execution', 'pending', 'oliver', 't', '{}', '${NOW}');
    INSERT INTO approval_targets (approval_id, task_id) VALUES ('a1', 't1');
  `);
  return db;
}

function assertLegacyRowsSurvived(db: Database.Database) {
  assert.deepEqual(
    (
      db.prepare("SELECT id, name, adapter_type, active FROM npcs ORDER BY id").all() as object[]
    ).map((r) => ({ ...r })),
    [
      { id: "cli", name: "Mina", adapter_type: "claude", active: 1 },
      { id: "herm", name: "Oliver", adapter_type: "hermes", active: 0 },
    ],
  );
  const cli = db
    .prepare("SELECT agent_config, position_x, position_y FROM npcs WHERE id = 'cli'")
    .get();
  assert.deepEqual(
    { ...(cli as object) },
    { agent_config: '{"cwd":"C:/work"}', position_x: 3, position_y: 4 },
  );
  const session = db.prepare("SELECT session_ref FROM npc_sessions WHERE id = 's1'").get();
  assert.deepEqual({ ...(session as object) }, { session_ref: "sess-abc" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n, 2);
  const roomMsg = db
    .prepare("SELECT content, notice_json FROM chat_room_messages WHERE id = 'rm1'")
    .get();
  assert.deepEqual(
    { ...(roomMsg as object) },
    { content: "hello room", notice_json: '{"kind":"meeting_outcome"}' },
  );
}

test("신규 DB 는 두 부트 경로 모두 살아남는 17개 표만 만들고, 마지막 단계는 아무것도 하지 않는다", () => {
  for (const ensure of [ensureViaApiPath, ensureViaServerPath]) {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(SQLITE_BASE_SCHEMA);
    ensure(db);
    assert.deepEqual(tableNames(db), SURVIVING_TABLES);
    assert.ok(!columnNames(db, "npcs").includes("hermes_profile_id"));
    assert.ok(
      columnNames(db, "chat_room_messages").includes("notice_json"),
      "회의 알림 열은 남는다",
    );
    assert.equal(dropHermesSchema(db), null, "이미 깨끗한 DB 에서는 no-op 이어야 한다");
    // 두 번째 부팅도 표를 되살리지 않는다.
    ensure(db);
    assert.deepEqual(tableNames(db), SURVIVING_TABLES);
    db.close();
  }
});

test("레거시 DB 는 두 부트 경로 모두 Hermes 표·컬럼을 잃고 직원·세션·대화 행은 지킨다", () => {
  for (const ensure of [ensureViaApiPath, ensureViaServerPath]) {
    const db = legacyDb();
    ensure(db);
    assert.deepEqual(tableNames(db), SURVIVING_TABLES);
    assert.ok(!columnNames(db, "npcs").includes("hermes_profile_id"));
    assert.ok(
      columnNames(db, "chat_room_messages").includes("notice_json"),
      "회의 알림 열은 남는다",
    );
    assertLegacyRowsSurvived(db);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1, "FK 검사는 다시 켜져 있어야 한다");
    // 재부팅은 no-op.
    ensure(db);
    assert.deepEqual(tableNames(db), SURVIVING_TABLES);
    assertLegacyRowsSurvived(db);
    db.close();
  }
});

test("dropHermesSchema: npcs 재생성 뒤에도 제약·인덱스·CASCADE 가 산다", () => {
  const db = legacyDb();
  const result = dropHermesSchema(db);
  assert.ok(result);
  assert.deepEqual([...result.droppedTables].sort(), [...HERMES_TABLES].sort());
  assert.equal(result.rebuiltNpcs, true);
  assertLegacyRowsSurvived(db);

  // 인덱스와 (channel_id, position_x, position_y) 유니크.
  const indexes = (db.prepare("PRAGMA index_list(npcs)").all() as Array<{ name: string }>).map(
    (i) => i.name,
  );
  assert.ok(indexes.includes("idx_npcs_channel_id"));
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO npcs (id, channel_id, position_x, position_y) VALUES ('dup', 'c1', 3, 4)",
        )
        .run(),
    /UNIQUE/,
  );
  // CLI 직원은 한 채널에 여럿 둘 수 있다(프로필 유니크가 사라졌다).
  db.prepare(
    "INSERT INTO npcs (id, channel_id, adapter_type) VALUES ('cli2', 'c1', 'codex')",
  ).run();
  db.prepare(
    "INSERT INTO npcs (id, channel_id, adapter_type) VALUES ('cli3', 'c1', 'codex')",
  ).run();
  assert.equal((db.pragma("foreign_key_check") as unknown[]).length, 0);

  // 직원을 지우면 세션·대화가 따라간다(자식 표의 FK 가 새 npcs 를 가리킨다).
  db.prepare("DELETE FROM npcs WHERE id = 'cli'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM npc_sessions").get() as { n: number }).n, 0);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE npc_id = 'cli'").get() as {
        n: number;
      }
    ).n,
    0,
  );
  // 채널을 지우면 남은 직원도 따라간다.
  db.prepare("DELETE FROM chat_rooms").run();
  db.prepare("DELETE FROM chat_messages").run();
  db.prepare("DELETE FROM channels WHERE id = 'c1'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM npcs").get() as { n: number }).n, 0);

  assert.equal(dropHermesSchema(db), null, "두 번째 실행은 no-op");
  db.close();
});
