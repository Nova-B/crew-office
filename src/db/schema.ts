// src/db/schema.ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
  unique,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  loginId: varchar("login_id", { length: 50 }).unique().notNull(),
  nickname: varchar("nickname", { length: 50 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  systemRole: varchar("system_role", { length: 20 }).notNull().default("user"),
  /** 관리자·CLI 가 임시 비밀번호를 발급하면 참이 된다. 본인이 바꾸면 거짓으로 돌아간다. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    appearance: jsonb("appearance").notNull(),
    /** 자유 텍스트 소개 — 직원에게 가는 모든 대화 앞머리에 붙는다(스펙 2026-09-18). 상한 2,000자는 서버가 지킨다. */
    bio: text("bio"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_characters_user_id").on(table.userId)],
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  description: varchar("description", { length: 500 }),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  mapData: jsonb("map_data"),
  mapConfig: jsonb("map_config"),
  isPublic: boolean("is_public").default(true),
  inviteCode: varchar("invite_code", { length: 20 }).unique(),
  maxPlayers: integer("max_players").default(50),
  password: varchar("password", { length: 255 }),
  gatewayConfig: jsonb("gateway_config"),
  /** NPC 걸음 속도(`npc-motion-config`). 비어 있으면 기본값 — 채널 공유 설정이다. */
  motionConfig: jsonb("motion_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_members_group_id").on(table.groupId),
    index("idx_group_members_user_id").on(table.userId),
    unique("group_members_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 64 }).unique().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetLoginId: varchar("target_login_id", { length: 50 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_invites_group_id").on(table.groupId),
    index("idx_group_invites_target_user_id").on(table.targetUserId),
  ],
);

export const groupJoinRequests = pgTable(
  "group_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    message: text("message"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_join_requests_group_id").on(table.groupId),
    index("idx_group_join_requests_user_id").on(table.userId),
    unique("group_join_requests_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupPermissions = pgTable(
  "group_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 50 }).notNull(),
    effect: varchar("effect", { length: 10 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_permissions_group_id").on(table.groupId),
    unique("group_permissions_group_permission_unique").on(table.groupId, table.permissionKey),
  ],
);

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 50 }).notNull(),
    effect: varchar("effect", { length: 10 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
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

export const channelMembers = pgTable(
  "channel_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    lastX: integer("last_x"),
    lastY: integer("last_y"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_channel_members_channel_id").on(table.channelId),
    index("idx_channel_members_user_id").on(table.userId),
    unique("channel_members_channel_user_unique").on(table.channelId, table.userId),
  ],
);

export const npcs = pgTable(
  "npcs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }),
    positionX: integer("position_x"),
    positionY: integer("position_y"),
    direction: varchar("direction", { length: 10 }).default("down"),
    appearance: jsonb("appearance"),
    adapterType: varchar("adapter_type", { length: 20 }).notNull().default("hermes"),
    adapterConfig: jsonb("adapter_config"),
    agentConfig: jsonb("agent_config"),
    /** 이 채널에 출근 중인가. false 면 자리는 기억한 채 맵에서 빠진다. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_npcs_channel_id").on(table.channelId),
    unique("npcs_channel_position_unique").on(table.channelId, table.positionX, table.positionY),
  ],
);

export const npcSessions = pgTable(
  "npc_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    npcId: uuid("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    adapterType: varchar("adapter_type", { length: 20 }).notNull(),
    sessionType: varchar("session_type", { length: 20 }).notNull(),
    sessionRef: varchar("session_ref", { length: 200 }).notNull(),
    contextKey: varchar("context_key", { length: 200 }).notNull(),
    lastSummary: text("last_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id),
    npcId: uuid("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_chat_messages_lookup").on(table.characterId, table.npcId, table.createdAt),
  ],
);

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 10 }).notNull(), // "office" | "group"
    name: varchar("name", { length: 60 }).notNull(),
    replyPolicy: varchar("reply_policy", { length: 10 }).notNull(), // "mention" | "members"
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_chat_rooms_channel").on(t.channelId, t.lastMessageAt),
    uniqueIndex("uq_chat_rooms_office_per_channel")
      .on(t.channelId)
      .where(sql`kind = 'office'`),
  ],
);

export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    memberKind: varchar("member_kind", { length: 8 }).notNull(), // "user" | "npc"
    memberId: uuid("member_id").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.memberKind, t.memberId] })],
);

export const chatRoomMessages = pgTable(
  "chat_room_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    senderKind: varchar("sender_kind", { length: 8 }).notNull(), // "user" | "npc" | "system"
    senderId: uuid("sender_id"),
    senderName: varchar("sender_name", { length: 100 }).notNull(),
    content: text("content").notNull(),
    // 시스템 메시지의 구조화 페이로드(JSON 문자열). 회의 결과 알림 같은 것이 본문(content) 과
    // 별도로 카드 렌더링에 쓸 데이터를 여기 담는다(src/lib/chat-rooms-policy.ts RoomNotice). 일반 메시지는 NULL.
    noticeJson: text("notice_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_chat_room_messages_room").on(t.roomId, t.createdAt)],
);

export const meetingMinutes = pgTable(
  "meeting_minutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    transcript: text("transcript").notNull(),
    participants: jsonb("participants").notNull().default([]),
    totalTurns: integer("total_turns").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    initiatorId: uuid("initiator_id").references(() => users.id, { onDelete: "set null" }),
    keyTopics: jsonb("key_topics").notNull().default([]),
    conclusions: text("conclusions"),
    // 구조화된 회의 결과(결정·후속 업무·프로젝트 권고). 초안이지 카드 사본이 아니다.
    outcomeJson: jsonb("outcome_json"),
    summaryStatus: text("summary_status").notNull().default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_meeting_minutes_channel").on(table.channelId),
    index("idx_meeting_minutes_created").on(table.createdAt),
  ],
);
