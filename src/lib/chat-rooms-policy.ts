export type ReplyPolicy = "mention" | "members";
export type RoomRow = {
  id: string;
  channelId: string;
  kind: "office" | "group";
  name: string;
  replyPolicy: ReplyPolicy;
  createdBy: string;
  createdAt: Date;
  lastMessageAt: Date | null;
};
/**
 * 방의 한 줄. `chat-rooms.ts`(서버 전용, `@/db` 를 끈다) 가 아니라 여기 있다 —
 * 클라이언트가 이 타입을 필요로 하는데, 서버 모듈에서 `import type` 으로 가져와도
 * `client-bundle-boundary.test.ts` 의 import 추적에 걸린다.
 */
export type RoomMessage = {
  id: string;
  roomId: string;
  senderKind: "user" | "npc" | "system";
  senderId: string | null;
  senderName: string;
  content: string;
  createdAt: string;
  /** 구조화 알림(회의 결과)의 구조. 일반 메시지에는 없다. */
  notice?: RoomNotice | null;
};

/**
 * `chat_room_messages.notice_json` 의 모양. `content` 는 로케일 무관 폴백(회의 주제)이고,
 * 렌더링에 필요한 나머지는 여기 실린다 — 서버가 한국어 문장을 굳히지
 * 않기 위해서다(시스템 메시지와 같은 원칙).
 */
export type RoomNotice = {
  /**
   * 후속 업무가 나온 회의가 끝났다 — 방에 한 줄을 남긴다. 이름이 아니라 **id 와 개수만** 싣는다
   * (사본이 낡지 않게).
   */
  kind: "meeting_outcome";
  minutesId: string;
  topic: string;
  followUpCount: number;
  recommended: boolean;
};

// crew-office: 칸반 카드·승인 요청·카드 제안·크론 결과 알림은 Hermes 와 함께 걷어냈다. DB 에 남은 옛 알림은
// 모르는 kind 라 notice 없이 읽혀 일반 줄(`content`)로 보인다 — 메시지 자체는 살린다.
const ROOM_NOTICE_KINDS = new Set(["meeting_outcome"]);

/** 저장된 JSON 문자열을 되읽는다. 깨진 값·모르는 kind 는 null — 메시지 자체는 살린다. */
export function parseRoomNotice(raw: string | null | undefined): RoomNotice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    return typeof kind === "string" && ROOM_NOTICE_KINDS.has(kind) ? (parsed as RoomNotice) : null;
  } catch {
    return null;
  }
}

export type RoomSummary = {
  id: string;
  kind: "office" | "group";
  name: string;
  replyPolicy: ReplyPolicy;
  createdBy: string;
  lastMessageAt: string | null;
  members: { kind: "user" | "npc"; id: string; name: string }[];
  lastMessage?: { senderName: string; content: string; createdAt: string };
};

/** 방 정책 × 지명 → 이번 메시지에 대답할 NPC. office(mention)는 지명만, group(members)는 전원 또는 지명된 부분집합. */
export function decideResponders(
  policy: ReplyPolicy,
  mentionedIds: string[],
  memberNpcIds: string[],
): string[] {
  const members = new Set(memberNpcIds);
  const mentioned = mentionedIds.filter((id) => members.has(id));
  if (policy === "mention") return mentioned;
  return mentionedIds.length > 0 ? mentioned : [...memberNpcIds];
}

export function sortRooms(rooms: RoomSummary[]): RoomSummary[] {
  return [...rooms].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "office" ? -1 : 1;
    return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
  });
}

export type RoomAccess =
  { ok: true; room: RoomRow } | { ok: false; code: "not_found" | "forbidden" };
export function resolveRoomAccessDecision(args: {
  room: RoomRow | null;
  channelAllowed: boolean;
  isMember: boolean;
}): RoomAccess {
  if (!args.room) return { ok: false, code: "not_found" };
  if (!args.channelAllowed) return { ok: false, code: "forbidden" };
  if (args.room.kind === "group" && !args.isMember) return { ok: false, code: "forbidden" };
  return { ok: true, room: args.room };
}
