// src/db/index.ts
import { randomUUID } from "node:crypto";
import * as pgSchema from "./schema";
import type BetterSqlite3 from "better-sqlite3";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDeskRpgSqlitePath } from "../lib/runtime-paths";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { retireOpenclawConfig } = require("./sqlite-openclaw-retirement.js") as {
  retireOpenclawConfig: (
    sqlite: BetterSqlite3.Database,
  ) => { migrated: number; removed: number } | null;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureSqliteBaseSchema } = require("./sqlite-base-schema.js") as {
  ensureSqliteBaseSchema: (sqlite: BetterSqlite3.Database) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ensureChatRoomTables } = require("./sqlite-chat-rooms.js") as {
  ensureChatRoomTables: (sqlite: BetterSqlite3.Database) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropLegacyTaskTables } = require("./sqlite-legacy-tasks-drop.js") as {
  dropLegacyTaskTables: (sqlite: BetterSqlite3.Database) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { retireMapEditor } = require("./sqlite-map-editor-drop.js") as {
  retireMapEditor: (sqlite: BetterSqlite3.Database) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dropHermesSchema } = require("./sqlite-drop-hermes.js") as {
  dropHermesSchema: (sqlite: BetterSqlite3.Database) => unknown;
};

const DB_TYPE = (
  process.env.DB_TYPE || (process.env.DATABASE_URL ? "postgresql" : "sqlite")
).toLowerCase();
export const isPostgres = DB_TYPE === "postgresql" || DB_TYPE === "postgres";

export function getDefaultSqlitePath() {
  return process.env.SQLITE_PATH || getDeskRpgSqlitePath();
}

/** Serialize JSON for DB insert — PG handles objects natively, SQLite needs strings */
export function jsonForDb(value: unknown): unknown {
  if (isPostgres) return value;
  return value == null ? null : JSON.stringify(value);
}

/**
 * "Now" for a timestamp column — PG driver wants a `Date`, SQLite's TEXT columns want
 * an ISO string. The single definition.
 */
export function nowForDb(): Date {
  return (isPostgres ? new Date() : new Date().toISOString()) as unknown as Date;
}

// Schema re-export: use the correct schema for the active DB dialect at runtime.
// PG schema uses uuid().defaultRandom() → gen_random_uuid() (PG-only),
// SQLite schema uses text().$defaultFn(() => crypto.randomUUID()) (JS-level).
// We cast to PG schema types so TypeScript sees the correct column types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const activeSchema: typeof pgSchema = isPostgres ? pgSchema : require("./schema-sqlite");

// Re-export all table objects from the active schema
export const users = activeSchema.users;
export const characters = activeSchema.characters;
export const groups = activeSchema.groups;
export const channels = activeSchema.channels;
export const groupMembers = activeSchema.groupMembers;
export const groupInvites = activeSchema.groupInvites;
export const groupJoinRequests = activeSchema.groupJoinRequests;
export const groupPermissions = activeSchema.groupPermissions;
export const userPermissionOverrides = activeSchema.userPermissionOverrides;
export const channelMembers = activeSchema.channelMembers;
export const npcs = activeSchema.npcs;
export const npcSessions = activeSchema.npcSessions;
export const chatMessages = activeSchema.chatMessages;
export const meetingMinutes = activeSchema.meetingMinutes;
export const chatRooms = activeSchema.chatRooms;
export const chatRoomMembers = activeSchema.chatRoomMembers;
export const chatRoomMessages = activeSchema.chatRoomMessages;

// Use PG type for all API routes — Drizzle's runtime API is identical across dialects.
type DbInstance = NodePgDatabase<typeof pgSchema>;

let _db: DbInstance | null = null;

function sqliteTableExists(sqlite: BetterSqlite3.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function sqliteColumnExists(
  sqlite: BetterSqlite3.Database,
  tableName: string,
  columnName: string,
): boolean {
  if (!sqliteTableExists(sqlite, tableName)) return false;

  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

function applySqliteAlterStatements(
  sqlite: BetterSqlite3.Database,
  tableName: string,
  statements: string[],
) {
  if (!sqliteTableExists(sqlite, tableName)) return;

  for (const statement of statements) {
    try {
      sqlite.exec(statement);
    } catch (error) {
      if (!String(error).includes("duplicate column name")) throw error;
    }
  }
}

function getSqliteUserOrderBy(sqlite: BetterSqlite3.Database): string {
  return sqliteColumnExists(sqlite, "users", "created_at")
    ? "created_at IS NULL ASC, created_at ASC, rowid ASC"
    : "rowid ASC";
}

function ensureSqliteBootstrapUser(sqlite: BetterSqlite3.Database): string | null {
  if (!sqliteTableExists(sqlite, "users") || !sqliteColumnExists(sqlite, "users", "system_role")) {
    return null;
  }

  const orderBy = getSqliteUserOrderBy(sqlite);
  const existingAdmin = sqlite
    .prepare(`SELECT id FROM users WHERE system_role = 'system_admin' ORDER BY ${orderBy} LIMIT 1`)
    .get() as { id: string } | undefined;
  if (existingAdmin) return existingAdmin.id;

  const earliestUser = sqlite.prepare(`SELECT id FROM users ORDER BY ${orderBy} LIMIT 1`).get() as
    { id: string } | undefined;
  if (!earliestUser) return null;

  sqlite.prepare("UPDATE users SET system_role = 'system_admin' WHERE id = ?").run(earliestUser.id);
  return earliestUser.id;
}

function ensureSqliteDefaultGroup(
  sqlite: BetterSqlite3.Database,
  createdBy: string | null,
): string | null {
  if (!sqliteTableExists(sqlite, "groups") || !sqliteTableExists(sqlite, "users")) return null;

  const existingGroup = sqlite
    .prepare("SELECT id FROM groups WHERE slug = 'default' ORDER BY rowid ASC LIMIT 1")
    .get() as { id: string } | undefined;
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
    .get() as { id: string } | undefined;
  return defaultGroup?.id ?? null;
}

function ensureSqliteBootstrapGroupAdminMembership(
  sqlite: BetterSqlite3.Database,
  groupId: string | null,
  userId: string | null,
) {
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

function assignLegacyChannelsToDefaultGroup(
  sqlite: BetterSqlite3.Database,
  groupId: string | null,
) {
  if (
    !groupId ||
    !sqliteTableExists(sqlite, "channels") ||
    !sqliteColumnExists(sqlite, "channels", "group_id")
  ) {
    return;
  }

  sqlite.prepare("UPDATE channels SET group_id = ? WHERE group_id IS NULL").run(groupId);
}

function dedupeSqliteGroupJoinRequests(sqlite: BetterSqlite3.Database) {
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
    .all() as Array<{ rowid: number; group_id: string; user_id: string }>;

  const seen = new Set<string>();
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

export function ensureSqliteCompatibility(sqlite: BetterSqlite3.Database) {
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
  retireMapEditor(sqlite);
  // crew-office slice 3: Hermes 시절 표·npcs.hermes_profile_id·notice_json 을 걷어낸다.
  // 옛 모양을 앞 단계들이 다 정리한 뒤라야 하므로 스키마 단계 중 **마지막**이다. server-db.js 와 같은 순서.
  dropHermesSchema(sqlite);
  // 이 함수와 server-db.js 의 동명 함수는 **서로 다른 경로**다 — API 라우트는 이쪽,
  // 소켓 서버는 저쪽을 탄다. 한쪽에만 컬럼을 더하면 그 경로에서만 조용히
  // "no such column" 이 난다(실제로 그렇게 났다). 새 컬럼은 양쪽에 넣을 것.

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

export function getDb(): DbInstance {
  if (!_db) {
    if (isPostgres) {
      const { drizzle } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require("pg") as typeof import("pg");
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error("Missing env var: DATABASE_URL");
      const pool = new Pool({ connectionString: databaseUrl });
      _db = drizzle(pool, { schema: pgSchema });
    } else {
      const { drizzle } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3") as typeof import("better-sqlite3");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path") as typeof import("node:path");

      const dbPath = getDefaultSqlitePath();
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

      const sqlite = new Database(dbPath);
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
      ensureSqliteBaseSchema(sqlite);
      ensureSqliteCompatibility(sqlite);
      _db = drizzle(sqlite, { schema: activeSchema }) as unknown as DbInstance;
    }
  }
  return _db;
}

// Proxy for backward compatibility — lazy initialization
export const db = new Proxy({} as DbInstance, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type DB = ReturnType<typeof getDb>;
