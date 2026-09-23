import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider, type Locale } from "@/lib/i18n";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import RoomNoticeMessage from "./RoomNoticeMessage";

// 알림 문장은 보는 사람의 로케일로 만든다. 모르는 kind 는 content 폴백, notice 가 없으면 이
// 컴포넌트를 타지 않는다. crew-office: 칸반·승인·크론 알림은 Hermes 와 함께 걷어냈다.

function message(overrides: Partial<RoomMessage>): RoomMessage {
  return {
    id: "m1",
    roomId: "office",
    senderKind: "npc",
    senderId: "npc-a",
    senderName: "소피",
    content: "fallback content",
    createdAt: "2026-09-14T00:00:00Z",
    notice: null,
    ...overrides,
  };
}

async function render(
  node: React.ReactElement,
  locale: Locale,
): Promise<{ host: HTMLElement; cleanup: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const LOCALES: Locale[] = ["ko", "en", "ja", "zh"];

test("meeting_outcome — 네 로케일 모두 회의 주제·개수 + '회의록 보기' 버튼", async () => {
  for (const locale of LOCALES) {
    const opened: string[] = [];
    const notice = {
      kind: "meeting_outcome" as const,
      minutesId: "min-1",
      topic: "가격 개편",
      followUpCount: 3,
      recommended: true,
    };
    const view = await render(
      <RoomNoticeMessage message={message({ notice })} onOpenMinutes={(id) => opened.push(id)} />,
      locale,
    );
    const text = view.host.textContent ?? "";
    assert.ok(text.includes("가격 개편"), `${locale}: 회의 주제가 없다`);
    assert.ok(text.includes("3"), `${locale}: 후속 업무 개수가 없다`);
    const button = view.host.querySelector("[data-meeting-outcome-open]");
    assert.equal(button?.getAttribute("data-meeting-outcome-open"), "view", `${locale}`);
    await act(async () => (button as HTMLElement).click());
    assert.deepEqual(opened, ["min-1"]);
    await view.cleanup();
  }
});

test("meeting_outcome — 열 길이 없으면 버튼을 그리지 않는다", async () => {
  const view = await render(
    <RoomNoticeMessage
      message={message({
        notice: {
          kind: "meeting_outcome",
          minutesId: "min-2",
          topic: "가격 개편",
          followUpCount: 1,
          recommended: false,
        },
      })}
    />,
    "ko",
  );
  assert.equal(view.host.querySelectorAll("button").length, 0);
  await view.cleanup();
});

test("알 수 없는 notice.kind — content 폴백, 링크 없음", async () => {
  const { host, cleanup } = await render(
    <RoomNoticeMessage
      message={message({
        content: "raw fallback",
        // 서버가 나중에 더한 kind 를 옛 클라이언트가 만나는 경우.
        notice: { kind: "something_new" } as unknown as RoomMessage["notice"],
      })}
      onOpenMinutes={() => assert.fail("호출되면 안 된다")}
    />,
    "en",
  );
  assert.ok((host.textContent ?? "").includes("raw fallback"));
  assert.equal(host.querySelector("button"), null);
  assert.equal(
    host.querySelector("[data-room-notice]")?.getAttribute("data-room-notice"),
    "unknown",
  );
  await cleanup();
});
