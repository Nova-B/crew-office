// src/db/schema-sqlite.ts
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  unique,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  loginId: text("login_id").unique().notNull(),
  nickname: text("nickname").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  systemRole: text("system_role").notNull().default("user"),
  /** 관리자·CLI 가 임시 비밀번호를 발급하면 참이 된다. 본인이 바꾸면 거짓으로 돌아간다. */
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  lastActiveAt: text("last_active_at"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const characters = sqliteTable(
  "characters",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    appearance: text("appearance").notNull(),
    bio: text("bio"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_characters_user_id").on(table.userId)],
);

export const groups = sqliteTable("groups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  description: text("description"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const channels = sqliteTable("channels", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
  mapData: text("map_data"),
  mapConfig: text("map_config"),
  isPublic: integer("is_public", { mode: "boolean" }).default(true),
  inviteCode: text("invite_code").unique(),
  maxPlayers: integer("max_players").default(50),
  password: text("password"),
  gatewayConfig: text("gateway_config"),
  /** NPC 걸음 속도(`npc-motion-config`). 비어 있으면 기본값 — 채널 공유 설정이다. */
  motionConfig: text("motion_config"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: text("approved_at"),
    joinedAt: text("joined_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_members_group_id").on(table.groupId),
    index("idx_group_members_user_id").on(table.userId),
    unique("group_members_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupInvites = sqliteTable(
  "group_invites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: text("token").unique().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetLoginId: text("target_login_id"),
    expiresAt: text("expires_at"),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: text("accepted_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_invites_group_id").on(table.groupId),
    index("idx_group_invites_target_user_id").on(table.targetUserId),
  ],
);

export const groupJoinRequests = sqliteTable(
  "group_join_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_join_requests_group_id").on(table.groupId),
    index("idx_group_join_requests_user_id").on(table.userId),
    unique("group_join_requests_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupPermissions = sqliteTable(
  "group_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    effect: text("effect").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_permissions_group_id").on(table.groupId),
    unique("group_permissions_group_permission_unique").on(table.groupId, table.permissionKey),
  ],
);

export const userPermissionOverrides = sqliteTable(
  "user_permission_overrides",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    effect: text("effect").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_user_permission_overrides_group_id").on(table.groupId),
    index("idx_user_permission_overrides_user_id").on(table.userId),
    unique("user_permission_overrides_group_user_permission_unique").on(
      table.groupId,
      table.userId,
      table.permissionKey,
    ),
  ],
);

export const channelMembers = sqliteTable(
  "channel_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    lastX: integer("last_x"),
    lastY: integer("last_y"),
    joinedAt: text("joined_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_channel_members_channel_id").on(table.channelId),
    index("idx_channel_members_user_id").on(table.userId),
    unique("channel_members_channel_user_unique").on(table.channelId, table.userId),
  ],
);

export const npcs = sqliteTable(
  "npcs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: text("name"),
    positionX: integer("position_x"),
    positionY: integer("position_y"),
    direction: text("direction").default("down"),
    appearance: text("appearance"),
    adapterType: text("adapter_type").notNull().default("hermes"),
    adapterConfig: text("adapter_config"),
    agentConfig: text("agent_config"),
    /** 이 채널에 출근 중인가. false 면 자리는 기억한 채 맵에서 빠진다. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_npcs_channel_id").on(table.channelId),
    unique("npcs_channel_position_unique").on(table.channelId, table.positionX, table.positionY),
  ],
);

export const npcSessions = sqliteTable(
  "npc_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    npcId: text("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    adapterType: text("adapter_type").notNull(),
    sessionType: text("session_type").notNull(),
    sessionRef: text("session_ref").notNull(),
    contextKey: text("context_key").notNull(),
    lastSummary: text("last_summary"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_npc_sessions_npc").on(table.npcId),
    uniqueIndex("npc_sessions_npc_user_context_idx").on(
      table.npcId,
      table.userId,
      table.contextKey,
    ),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id),
    npcId: text("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_chat_messages_lookup").on(table.characterId, table.npcId, table.createdAt),
  ],
);

export const chatRooms = sqliteTable(
  "chat_rooms",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    replyPolicy: text("reply_policy").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    lastMessageAt: text("last_message_at"),
  },
  (t) => [
    index("idx_chat_rooms_channel").on(t.channelId, t.lastMessageAt),
    uniqueIndex("uq_chat_rooms_office_per_channel")
      .on(t.channelId)
      .where(sql`kind = 'office'`),
  ],
);

export const chatRoomMembers = sqliteTable(
  "chat_room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    memberKind: text("member_kind").notNull(),
    memberId: text("member_id").notNull(),
    invitedBy: text("invited_by").references(() => users.id),
    joinedAt: text("joined_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.memberKind, t.memberId] })],
);

export const chatRoomMessages = sqliteTable(
  "chat_room_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    senderKind: text("sender_kind").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name").notNull(),
    content: text("content").notNull(),
    // 시스템 메시지의 구조화 페이로드(JSON 문자열). 회의 결과 알림 같은 것이 본문(content) 과
    // 별도로 카드 렌더링에 쓸 데이터를 여기 담는다(src/lib/chat-rooms-policy.ts RoomNotice). 일반 메시지는 NULL.
    noticeJson: text("notice_json"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("idx_chat_room_messages_room").on(t.roomId, t.createdAt)],
);

export const meetingMinutes = sqliteTable(
  "meeting_minutes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    transcript: text("transcript").notNull(),
    participants: text("participants").notNull().default("[]"),
    totalTurns: integer("total_turns").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    initiatorId: text("initiator_id").references(() => users.id, { onDelete: "set null" }),
    keyTopics: text("key_topics").notNull().default("[]"),
    conclusions: text("conclusions"),
    // 구조화된 회의 결과(결정·후속 업무·프로젝트 권고). 초안이지 카드 사본이 아니다.
    outcomeJson: text("outcome_json"),
    summaryStatus: text("summary_status").notNull().default("ok"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_meeting_minutes_channel").on(table.channelId),
    index("idx_meeting_minutes_created").on(table.createdAt),
  ],
);
