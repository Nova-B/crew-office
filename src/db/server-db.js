// src/db/server-db.js
// CommonJS Drizzle ORM wrapper for server.js (CJS land)
// Supports PostgreSQL (default) and SQLite via DB_TYPE env var

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ensureSqliteBaseSchema } = require("./sqlite-base-schema.js");
const { retireOpenclawConfig } = require("./sqlite-openclaw-retirement.js");
const { ensureChatRoomTables } = require("./sqlite-chat-rooms.js");
const { dropLegacyTaskTables } = require("./sqlite-legacy-tasks-drop.js");
const { retireMapEditor } = require("./sqlite-map-editor-drop.js");
const { dropHermesSchema } = require("./sqlite-drop-hermes.js");

const DB_TYPE = (process.env.DB_TYPE || "postgresql").toLowerCase();
const isPostgres = DB_TYPE === "postgresql" || DB_TYPE === "postgres";

let db;
let schema;

function sqliteTableExists(sqlite, tableName) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function sqliteColumnExists(sqlite, tableName, columnName) {
  if (!sqliteTableExists(sqlite, tableName)) return false;

  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function applySqliteAlterStatements(sqlite, tableName, statements) {
  if (!sqliteTableExists(sqlite, tableName)) return;

  for (const statement of statements) {
    try {
      sqlite.exec(statement);
    } catch (error) {
      if (!String(error).includes("duplicate column name")) throw error;
    }
  }
}

function getSqliteUserOrderBy(sqlite) {
  return sqliteColumnExists(sqlite, "users", "created_at")
    ? "created_at IS NULL ASC, created_at ASC, rowid ASC"
    : "rowid ASC";
}

function ensureSqliteBootstrapUser(sqlite) {
  if (!sqliteTableExists(sqlite, "users") || !sqliteColumnExists(sqlite, "users", "system_role")) {
    return null;
  }

  const orderBy = getSqliteUserOrderBy(sqlite);
  const existingAdmin = sqlite
    .prepare(`SELECT id FROM users WHERE system_role = 'system_admin' ORDER BY ${orderBy} LIMIT 1`)
    .get();
  if (existingAdmin) return existingAdmin.id;

  const earliestUser = sqlite.prepare(`SELECT id FROM users ORDER BY ${orderBy} LIMIT 1`).get();
  if (!earliestUser) return null;

  sqlite.prepare("UPDATE users SET system_role = 'system_admin' WHERE id = ?").run(earliestUser.id);
  return earliestUser.id;
}

function ensureSqliteDefaultGroup(sqlite, createdBy) {
  if (!sqliteTableExists(sqlite, "groups") || !sqliteTableExists(sqlite, "users")) return null;

  const existingGroup = sqlite
    .prepare("SELECT id FROM groups WHERE slug = 'default' ORDER BY rowid ASC LIMIT 1")
    .get();
  if (existingGroup) {
    sqlite.prepare("UPDATE groups SET is_default = 1 WHERE id = ?").run(existingGroup.id);
    return existingGroup.id;
  }

  const now = new Date().toISOString();
  const groupId = randomUUID();
  sqlite
    .prepare(
      `
    INSERT OR IGNORE INTO groups (id, name, slug, description, is_default, created_by, created_at, updated_at)
    VALUES (?, 'Default', 'default', 'Default workspace', 1, ?, ?, ?)
  `,
    )
    .run(groupId, createdBy, now, now);

  const defaultGroup = sqlite
    .prepare("SELECT id FROM groups WHERE slug = 'default' ORDER BY rowid ASC LIMIT 1")
    .get();
  return defaultGroup ? defaultGroup.id : null;
}

function ensureSqliteBootstrapGroupAdminMembership(sqlite, groupId, userId) {
  if (!groupId || !userId || !sqliteTableExists(sqlite, "group_members")) return;

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `
    INSERT OR IGNORE INTO group_members (id, group_id, user_id, role, approved_by, approved_at, joined_at)
    VALUES (?, ?, ?, 'group_admin', ?, ?, ?)
  `,
    )
    .run(randomUUID(), groupId, userId, userId, now, now);
  sqlite
    .prepare(
      `
    UPDATE group_members
    SET role = 'group_admin',
        approved_by = COALESCE(approved_by, ?),
        approved_at = COALESCE(approved_at, ?)
    WHERE group_id = ? AND user_id = ?
  `,
    )
    .run(userId, now, groupId, userId);
}

function assignLegacyChannelsToDefaultGroup(sqlite, groupId) {
  if (
    !groupId ||
    !sqliteTableExists(sqlite, "channels") ||
    !sqliteColumnExists(sqlite, "channels", "group_id")
  ) {
    return;
  }

  sqlite.prepare("UPDATE channels SET group_id = ? WHERE group_id IS NULL").run(groupId);
}

function dedupeSqliteGroupJoinRequests(sqlite) {
  if (
    !sqliteTableExists(sqlite, "group_join_requests") ||
    !sqliteTableExists(sqlite, "users") ||
    !sqliteTableExists(sqlite, "groups")
  ) {
    return;
  }

  const rows = sqlite
    .prepare(
      `
    SELECT rowid, group_id, user_id, status, created_at
    FROM group_join_requests
    ORDER BY
      group_id ASC,
      user_id ASC,
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END ASC,
      created_at DESC,
      rowid DESC
  `,
    )
    .all();

  const seen = new Set();
  const deleteStmt = sqlite.prepare("DELETE FROM group_join_requests WHERE rowid = ?");
  for (const row of rows) {
    const key = `${row.group_id}:${row.user_id}`;
    if (seen.has(key)) {
      deleteStmt.run(row.rowid);
      continue;
    }
    seen.add(key);
  }
}

function ensureSqliteCompatibility(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT,
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
    CREATE TABLE IF NOT EXISTS group_invites (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_login_id TEXT,
      expires_at TEXT,
      accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_group_invites_group_id ON group_invites(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_invites_target_user_id ON group_invites(target_user_id);
    CREATE TABLE IF NOT EXISTS group_join_requests (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_id ON group_join_requests(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_join_requests_user_id ON group_join_requests(user_id);
    CREATE TABLE IF NOT EXISTS group_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      effect TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(group_id, permission_key)
    );
    CREATE INDEX IF NOT EXISTS idx_group_permissions_group_id ON group_permissions(group_id);
    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      effect TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(group_id, user_id, permission_key)
    );
    CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_group_id ON user_permission_overrides(group_id);
    CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user_id ON user_permission_overrides(user_id);
    CREATE TABLE IF NOT EXISTS npc_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      adapter_type TEXT NOT NULL,
      session_type TEXT NOT NULL,
      session_ref TEXT NOT NULL,
      context_key TEXT NOT NULL,
      last_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_npc_sessions_npc ON npc_sessions(npc_id);
    CREATE UNIQUE INDEX IF NOT EXISTS npc_sessions_npc_user_context_idx ON npc_sessions(npc_id, user_id, context_key);
  `);

  applySqliteAlterStatements(sqlite, "npcs", [
    "ALTER TABLE npcs ADD COLUMN adapter_type TEXT NOT NULL DEFAULT 'hermes'",
    "ALTER TABLE npcs ADD COLUMN adapter_config TEXT",
    "ALTER TABLE npcs ADD COLUMN agent_config TEXT",
    // 프로필 소유 이관(0008) 이전의 아주 옛 npcs 에는 출근 여부 열이 없다.
    "ALTER TABLE npcs ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  ]);
  // 컬럼이 갖춰진 다음에 은퇴 마이그레이션을 돌린다(이관 대상 열이 둘 다 있어야 한다).
  retireOpenclawConfig(sqlite);
  ensureChatRoomTables(sqlite);
  // 회의 결과 알림의 구조화 페이로드. 방 테이블이 선 다음이라야 더할 수 있다.
  applySqliteAlterStatements(sqlite, "chat_room_messages", [
    "ALTER TABLE chat_room_messages ADD COLUMN notice_json TEXT",
  ]);
  // 2026-04 태스크 시스템 폐기 — 옛 태스크·보고 테이블은 데이터째 지운다.
  dropLegacyTaskTables(sqlite);
  // 맵 에디터 폐기 — 옛 외형을 오피스 룩으로 접고 맵 에디터 표 8개를 지운다.
  // index.ts 의 동명 함수와 **같은 순서**를 지킨다.
  retireMapEditor(sqlite);

  applySqliteAlterStatements(sqlite, "characters", ["ALTER TABLE characters ADD COLUMN bio TEXT"]);
  applySqliteAlterStatements(sqlite, "meeting_minutes", [
    "ALTER TABLE meeting_minutes ADD COLUMN outcome_json TEXT",
    "ALTER TABLE meeting_minutes ADD COLUMN summary_status TEXT NOT NULL DEFAULT 'ok'",
  ]);
  applySqliteAlterStatements(sqlite, "users", [
    "ALTER TABLE users ADD COLUMN system_role TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
  ]);
  applySqliteAlterStatements(sqlite, "channels", [
    "ALTER TABLE channels ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL",
    "ALTER TABLE channels ADD COLUMN motion_config TEXT",
  ]);
  // crew-office slice 3: Hermes 시절 표·npcs.hermes_profile_id·notice_json 을 걷어낸다.
  // 옛 모양을 앞 단계들이 다 정리한 뒤라야 하므로 스키마 단계 중 **마지막**이다. index.ts 와 같은 순서.
  dropHermesSchema(sqlite);

  dedupeSqliteGroupJoinRequests(sqlite);
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_group_user_unique ON group_join_requests(group_id, user_id)",
  );

  sqlite.transaction(() => {
    const bootstrapUserId = ensureSqliteBootstrapUser(sqlite);
    const defaultGroupId = bootstrapUserId
      ? ensureSqliteDefaultGroup(sqlite, bootstrapUserId)
      : null;

    ensureSqliteBootstrapGroupAdminMembership(sqlite, defaultGroupId, bootstrapUserId);
    assignLegacyChannelsToDefaultGroup(sqlite, defaultGroupId);
  })();
}

// ─── Drizzle query helpers (shared) ──────────────────────────────────────────
const { eq, and, desc, sql } = require("drizzle-orm");

// ─── PostgreSQL mode ──────────────────────────────────────────────────────────
if (isPostgres) {
  const { drizzle } = require("drizzle-orm/node-postgres");
  const { Pool } = require("pg");

  schema = require("./schema.pg.cjs");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });

  console.log("[server-db] PostgreSQL mode — Drizzle ORM initialized");

  // ─── SQLite mode ──────────────────────────────────────────────────────────────
} else {
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const Database = require("better-sqlite3");

  // Ensure data/ directory exists for the DB file
  const deskRpgHome = process.env.DESKRPG_HOME || path.join(os.homedir(), ".deskrpg");
  const dbPath = process.env.SQLITE_PATH || path.join(deskRpgHome, "data", "deskrpg.db");
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  schema = require("./schema.sqlite.cjs");

  const sqlite = new Database(dbPath);

  // Enable WAL mode and foreign key enforcement
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  ensureSqliteBaseSchema(sqlite);
  ensureSqliteCompatibility(sqlite);

  db = drizzle(sqlite, { schema });

  console.log(`[server-db] SQLite mode — Drizzle ORM initialized (${dbPath})`);
}

module.exports = {
  db,
  schema,
  isPostgres,
  eq,
  and,
  desc,
  sql,
  ensureSqliteBaseSchema,
  ensureSqliteCompatibility,
};
