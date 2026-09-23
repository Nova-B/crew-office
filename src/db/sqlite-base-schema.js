"use strict";

const SQLITE_BASE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      login_id TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      system_role TEXT NOT NULL DEFAULT 'user',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      appearance TEXT NOT NULL,
      bio TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);

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

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id),
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      map_data TEXT,
      map_config TEXT,
      is_public INTEGER DEFAULT 1,
      invite_code TEXT UNIQUE,
      max_players INTEGER DEFAULT 50,
      password TEXT,
      gateway_config TEXT,
      motion_config TEXT,
      created_at TEXT,
      updated_at TEXT
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
    CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_group_user_unique ON group_join_requests(group_id, user_id);

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

    CREATE TABLE IF NOT EXISTS channel_members (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      last_x INTEGER,
      last_y INTEGER,
      joined_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_channel_members_channel_id ON channel_members(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_members_user_id ON channel_members(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS channel_members_channel_user_unique ON channel_members(channel_id, user_id);

    CREATE TABLE IF NOT EXISTS npcs (
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
    CREATE INDEX IF NOT EXISTS idx_npcs_channel_id ON npcs(channel_id);

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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id),
      npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_lookup ON chat_messages(character_id, npc_id, created_at);

    CREATE TABLE IF NOT EXISTS chat_rooms (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      reply_policy TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      last_message_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chat_rooms_channel ON chat_rooms(channel_id, last_message_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_office_per_channel ON chat_rooms(channel_id) WHERE kind = 'office';
    CREATE TABLE IF NOT EXISTS chat_room_members (
      room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL,
      member_id TEXT NOT NULL,
      invited_by TEXT REFERENCES users(id),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, member_kind, member_id)
    );
    CREATE TABLE IF NOT EXISTS chat_room_messages (
      id TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      sender_kind TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      notice_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_room_messages_room ON chat_room_messages(room_id, created_at);

    CREATE TABLE IF NOT EXISTS meeting_minutes (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      transcript TEXT NOT NULL,
      participants TEXT NOT NULL DEFAULT '[]',
      total_turns INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      initiator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      key_topics TEXT NOT NULL DEFAULT '[]',
      conclusions TEXT,
      outcome_json TEXT,
      summary_status TEXT NOT NULL DEFAULT 'ok',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_minutes_channel ON meeting_minutes(channel_id);
    CREATE INDEX IF NOT EXISTS idx_meeting_minutes_created ON meeting_minutes(created_at);

  `;

function ensureSqliteBaseSchema(sqlite) {
  sqlite.exec(SQLITE_BASE_SCHEMA);
}

module.exports = { ensureSqliteBaseSchema, SQLITE_BASE_SCHEMA };
