// 회의 결과 방 알림 — 언제 내는가(순수 판정)와, 방에 남고 방송되는가(일회용 SQLite).
import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingOutcome } from "@/lib/meeting-outcome";
import { seedChannel, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

import { buildMeetingOutcomeNotice, shouldAnnounceOutcome } from "./meeting-outcome-notice";

setupThrowawaySqlite("meeting-outcome-notice-test");

const followUp = {
  title: "경쟁사 가격 조사",
  summary: null,
  acceptance: null,
  assigneeNpcId: null,
  assigneeName: null,
  after: [],
};

const outcome: MeetingOutcome = {
  decisions: ["A안 채택"],
  followUps: [followUp, { ...followUp, title: "초안 작성" }],
  project: { recommended: true, name: "가격 개편", reason: null },
};

test("후속 업무가 있고 요약이 성공했을 때만 알린다", () => {
  assert.equal(shouldAnnounceOutcome(outcome, "ok"), true);
  // 짧은 확인 회의가 다수다 — 제안할 것이 없는데 줄을 남기면 방이 소음으로 찬다.
  assert.equal(shouldAnnounceOutcome({ ...outcome, followUps: [] }, "ok"), false);
  assert.equal(shouldAnnounceOutcome(null, "ok"), false);
  // 요약 실패는 "제안할 것이 없음" 과 다르다. 실패는 회의 화면이 다시 시도를 권한다 — 방에는 남기지 않는다.
  assert.equal(shouldAnnounceOutcome(outcome, "failed"), false);
  assert.equal(shouldAnnounceOutcome(outcome, "skipped"), false);
});

test("알림은 id 와 개수만 싣는다 — 프로젝트 이름 같은 낡는 사본을 두지 않는다", () => {
  assert.deepEqual(buildMeetingOutcomeNotice({ minutesId: "m-1", topic: "가격 개편", outcome }), {
    kind: "meeting_outcome",
    minutesId: "m-1",
    topic: "가격 개편",
    followUpCount: 2,
    recommended: true,
  });
});

async function officeNotices(channelId: string) {
  const { ensureOfficeRoom, recentRoomMessages, getChannelOwnerId } =
    await import("@/lib/chat-rooms");
  const ownerId = await getChannelOwnerId(channelId);
  assert.ok(ownerId);
  const room = await ensureOfficeRoom(channelId, ownerId!);
  const messages = await recentRoomMessages(room.id, 20);
  return messages.filter((m) => m.notice?.kind === "meeting_outcome");
}

async function seed() {
  const owner = await seedUser(`mon-${Math.random().toString(36).slice(2, 8)}`);
  const channel = await seedChannel(owner.id, "회의 알림 채널");
  return { ownerId: owner.id, channelId: channel.id };
}

test("알리면 사무실 방에 시스템 알림이 남고 방송 훅이 불린다", async () => {
  const { channelId } = await seed();
  const { registerRoomMessageBroadcaster } = await import("@/lib/rpc-registry");
  const emitted: unknown[] = [];
  registerRoomMessageBroadcaster((_roomId: string, message: unknown) => {
    emitted.push(message);
  });
  try {
    const { announceMeetingOutcome } = await import("./meeting-outcome-notice");
    await announceMeetingOutcome({
      channelId,
      minutesId: "m-2",
      topic: "가격 개편",
      outcome,
      summaryStatus: "ok",
    });
  } finally {
    registerRoomMessageBroadcaster(undefined);
  }

  const rows = await officeNotices(channelId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].senderKind, "system");
  assert.equal(rows[0].content, "가격 개편", "로케일 무관 폴백은 회의 주제다");
  assert.equal(emitted.length, 1, "저장만 하고 방송하지 않으면 새로고침 전까지 보이지 않는다");
});

test("알릴 조건이 아니면 방에 아무것도 남기지 않는다", async () => {
  const { channelId } = await seed();
  const { announceMeetingOutcome } = await import("./meeting-outcome-notice");
  await announceMeetingOutcome({
    channelId,
    minutesId: "m-3",
    topic: "확인",
    outcome: { ...outcome, followUps: [] },
    summaryStatus: "ok",
  });
  assert.equal((await officeNotices(channelId)).length, 0);
});
