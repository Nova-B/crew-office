import "../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import type { RoomState } from "@/app/game/room-state";
import type { RoomSummary } from "@/lib/chat-rooms-policy";
import ChatPanel from "./ChatPanel";

function room(id: string, kind: RoomSummary["kind"], name: string): RoomSummary {
  return {
    id,
    kind,
    name,
    replyPolicy: kind === "office" ? "mention" : "members",
    createdBy: "u1",
    lastMessageAt: null,
    members: [],
  };
}

function listState(): RoomState {
  return {
    rooms: [room("office", "office", "사무실"), room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "list",
    messages: {},
  };
}

// 필수 prop 만 채운 뼈대. 목록 뷰의 닫기 동작만 검증한다.
function panel(roomState: RoomState, props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  return (
    <I18nProvider initialLocale="ko">
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={roomState}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        {...props}
      />
    </I18nProvider>
  );
}

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return el;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  assert.ok(btn, `button "${text}" 를 찾지 못했다`);
  return btn as HTMLButtonElement;
}

async function click(node: Element) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const OPEN = "▶"; // ▶ 다시 열기
const BACK = "◀"; // ◀ 뒤로

test("방이 여러 개인 목록 뷰에서 ◀ 는 패널을 접는다 (I-2)", async () => {
  const el = await mount(panel(listState()));

  // 처음엔 닫혀 있고 다시 열기 버튼만 보인다.
  await click(buttonByText(el, OPEN));

  // 패널이 열리며 목록 헤더의 ◀ 가 나타난다.
  const back = buttonByText(el, BACK);
  await click(back);

  // 방이 2개여도 목록의 ◀ 는 패널을 닫아야 한다 — 다시 열기 버튼만 남는다.
  const reopen = Array.from(el.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").trim() === OPEN,
  );
  assert.equal(reopen.length, 1, "패널이 접혀 다시 열기 버튼만 남아야 한다");
  assert.equal(
    Array.from(el.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === BACK),
    false,
    "접힌 패널에는 ◀ 가 없어야 한다",
  );
});

test("shared room shows responder receipt under another user's source message", async () => {
  const state: RoomState = {
    ...listState(),
    view: "room",
    messages: {
      g1: [
        {
          id: "source-other",
          roomId: "g1",
          senderKind: "user",
          senderId: "u2",
          senderName: "Other",
          content: "@Sophie help",
          createdAt: "2026-09-10T00:00:00Z",
        },
      ],
    },
  };
  const el = await mount(
    <I18nProvider>
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={state}
        channelChatOpen
        roomResponses={[
          {
            requestId: "reply",
            sourceMessageId: "source-other",
            npcId: "n1",
            npcName: "Sophie",
            status: "thinking",
            content: "",
            updatedAt: 1,
          },
        ]}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        currentPlayerName="Me"
      />
    </I18nProvider>,
  );
  assert.match(el.textContent ?? "", /👌 Sophie/);
});

test("workspace presentation stays open and renders as an embedded conversation surface", async () => {
  const el = await mount(
    <I18nProvider>
      <ChatPanel
        presentation="workspace"
        width={388}
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={listState()}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
      />
    </I18nProvider>,
  );

  const panel = el.querySelector<HTMLElement>("[data-chat-panel='workspace']");
  assert.ok(panel);
  assert.equal(panel.style.width, "388px");
  assert.doesNotMatch(panel.className, /fixed/);
  assert.equal(
    [...el.querySelectorAll("button")].some((node) => node.textContent?.trim() === OPEN),
    false,
  );
});

// R29·R30: `notice` 가 있는 줄만 알림 렌더러로 가고, 없는 줄은 예전 그대로다(system 줄 포함).
test("방 메시지 — notice 가 있으면 알림 렌더러, 없으면 기존 렌더 그대로", async () => {
  const opened: string[] = [];
  const state: RoomState = {
    ...listState(),
    view: "room",
    messages: {
      g1: [
        {
          id: "plain-npc",
          roomId: "g1",
          senderKind: "npc",
          senderId: "n1",
          senderName: "Sophie",
          content: "plain npc line",
          createdAt: "2026-09-10T00:00:00Z",
        },
        {
          id: "plain-system",
          roomId: "g1",
          senderKind: "system",
          senderId: null,
          senderName: "",
          content: JSON.stringify({ kind: "left", name: "Other" }),
          createdAt: "2026-09-10T00:00:01Z",
        },
        {
          id: "notice-meeting",
          roomId: "g1",
          senderKind: "system",
          senderId: null,
          senderName: "",
          content: "가격 개편",
          createdAt: "2026-09-10T00:00:02Z",
          notice: {
            kind: "meeting_outcome",
            minutesId: "minutes-1",
            topic: "가격 개편",
            followUpCount: 2,
            recommended: false,
          },
        },
      ],
    },
  };
  const el = await mount(
    <I18nProvider initialLocale="ko">
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={state}
        channelChatOpen
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        currentPlayerName="Me"
        onOpenNoticeMinutes={(minutesId) => opened.push(minutesId)}
      />
    </I18nProvider>,
  );
  // notice 없는 NPC 줄은 말풍선 그대로.
  assert.ok(
    Array.from(el.querySelectorAll('[data-chat-bubble="npc"]')).some((b) =>
      (b.textContent ?? "").includes("plain npc line"),
    ),
    "일반 NPC 줄이 말풍선으로 남아야 한다",
  );
  // notice 없는 system 줄은 기존 시스템 문장.
  assert.match(el.textContent ?? "", /Other 님이 나갔습니다/);
  // notice 줄은 알림 렌더러 — content 의 접두가 아니라 로케일 문장.
  const notice = el.querySelector('[data-room-notice="meeting_outcome"]');
  assert.ok(notice, "알림 렌더러가 그리지 않았다");
  assert.match(notice!.textContent ?? "", /가격 개편/);
  await click(buttonByText(el, "회의록 보기"));
  assert.deepEqual(opened, ["minutes-1"]);
});

// ── 아바타 ────────────────────────────────────────────────────────────────────

function avatarPanel(roomState: RoomState, extra: Record<string, unknown> = {}) {
  const asked: Array<{ kind: string; id?: string | null; name: string }> = [];
  const node = (
    <I18nProvider>
      <ChatPanel
        dialogNpc={null}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {}}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={roomState}
        channelChatOpen
        currentPlayerName="단테"
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
        avatarFor={(who) => {
          asked.push(who);
          return null;
        }}
        {...extra}
      />
    </I18nProvider>
  );
  return { node, asked };
}

function roomMessage(id: string, kind: "user" | "npc", senderId: string, senderName: string) {
  return {
    id,
    roomId: "g1",
    senderKind: kind,
    senderId,
    senderName,
    content: `${senderName} 의 말 ${id}`,
    createdAt: "2026-09-20T00:00:00.000Z",
  };
}

test("방 말풍선 — 상대에게만 아바타, 같은 발화자가 이어 말하면 자리만 남긴다", async () => {
  const state: RoomState = {
    rooms: [room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "room",
    messages: {
      g1: [
        roomMessage("m1", "npc", "npc-noah", "noah"),
        roomMessage("m2", "npc", "npc-noah", "noah"),
        roomMessage("m3", "user", "u1", "단테"),
        roomMessage("m4", "npc", "npc-sophie", "sophie"),
      ],
    },
  };
  const { node, asked } = avatarPanel(state);
  const el = await mount(node);
  const slots = [...el.querySelectorAll("[data-chat-avatar]")].map((n) =>
    n.getAttribute("data-chat-avatar"),
  );
  assert.deepEqual(
    slots,
    ["shown", "spacer", "shown"],
    "noah·(noah 이어서)·sophie — 내 말에는 없다",
  );
  assert.ok(
    asked.some((who) => who.kind === "npc" && who.id === "npc-noah"),
    "발화자 id 로 외형을 묻는다",
  );
});

test("NPC DM — 헤더 이름 앞과 상대 말풍선에 아바타가 붙는다", async () => {
  const state: RoomState = {
    rooms: [room("office", "office", "오피스")],
    viewerUserId: "u1",
    currentRoomId: "office",
    view: "room",
    messages: {},
  };
  const { node, asked } = avatarPanel(state, {
    dialogNpc: { npcId: "npc-noah", npcName: "noah" },
    npcMessages: [
      { id: "a", role: "player", content: "안녕" },
      { id: "b", role: "npc", content: "안녕하세요" },
      { id: "c", role: "npc", content: "무엇을 도울까요" },
    ],
  });
  const el = await mount(node);
  assert.ok(el.querySelector("[data-chat-header-avatar]"), "DM 헤더에 아바타가 없다");
  const slots = [...el.querySelectorAll("[data-chat-avatar]")].map((n) =>
    n.getAttribute("data-chat-avatar"),
  );
  assert.deepEqual(slots, ["shown", "spacer"]);
  assert.ok(asked.every((who) => who.id === "npc-noah"));
});

test("방 헤더 — 참여자를 최대 5명까지 겹쳐 쌓고 나머지는 +N", async () => {
  const members = Array.from({ length: 7 }, (_, i) => ({
    kind: "npc" as const,
    id: `npc-${i}`,
    name: `직원${i}`,
  }));
  const state: RoomState = {
    rooms: [{ ...room("g1", "group", "기획팀"), members }],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "room",
    messages: {},
  };
  const { node } = avatarPanel(state);
  const el = await mount(node);
  const stack = el.querySelector("[data-room-avatars]");
  assert.ok(stack, "방 헤더에 아바타 묶음이 없다");
  assert.equal(stack.querySelectorAll("[data-room-avatar]").length, 5);
  assert.equal(stack.querySelector("[data-room-avatar-more]")?.textContent, "+2");
});

test("avatarFor 가 없으면 아바타를 그리지 않는다 — 기존 화면 그대로", async () => {
  const state: RoomState = {
    rooms: [room("g1", "group", "기획팀")],
    viewerUserId: "u1",
    currentRoomId: "g1",
    view: "room",
    messages: { g1: [roomMessage("m1", "npc", "npc-noah", "noah")] },
  };
  const { node } = avatarPanel(state, { avatarFor: undefined });
  const el = await mount(node);
  assert.equal(el.querySelector("[data-chat-avatar]"), null);
  assert.equal(el.querySelector("[data-room-avatars]"), null);
});

test("모달이 떠 있으면 Esc 는 모달만 닫고 뒤의 직원 대화창은 닫지 않는다", async () => {
  let closed = 0;
  const node = (
    <I18nProvider>
      <ChatPanel
        dialogNpc={{ npcId: "sophie", npcName: "소피" }}
        npcMessages={[]}
        isNpcStreaming={false}
        onSend={() => {}}
        onClose={() => {
          closed += 1;
        }}
        npcSelectList={null}
        onSelectNpc={() => {}}
        roomState={listState()}
        onRoomSend={() => {}}
        onRoomAction={() => {}}
        onRoomCreate={() => {}}
        onRoomInvite={() => {}}
        onRoomLeave={() => {}}
        onRoomRename={() => {}}
        onRoomDelete={() => {}}
        mentionCandidatesFor={() => []}
        onlinePlayers={[]}
      />
    </I18nProvider>
  );
  await mount(node);
  const modal = document.createElement("div");
  modal.setAttribute("aria-modal", "true");
  document.body.appendChild(modal);
  const esc = () =>
    act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
  await esc();
  assert.equal(closed, 0, "모달이 있으면 대화창은 그대로다");
  modal.remove();
  await esc();
  assert.equal(closed, 1, "모달이 없으면 Esc 가 대화창을 닫는다");
});
