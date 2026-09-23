import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../../lib/i18n/context";
import { UpdateNoticeModal } from "./UpdateNoticeModal";

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<I18nProvider initialLocale="ko">{node}</I18nProvider>));
  return {
    host,
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("업데이트 안내는 열리는 순간 확인 처리하고 해당 릴리스 노트로 연결한다", async () => {
  let seen = 0;
  const m = await mount(
    <UpdateNoticeModal
      version="2026.921.3"
      latestVersion="2026.922.0"
      onSeen={() => seen++}
      onClose={() => {}}
    />,
  );
  assert.equal(seen, 1);
  assert.ok(m.host.textContent?.includes("v2026.922.0"));
  const link = [...m.host.querySelectorAll("a")].find((a) => a.href.includes("/releases/tag/"));
  assert.equal(
    link?.getAttribute("href"),
    "https://github.com/Nova-B/crew-office/releases/tag/2026.922.0",
  );
  await m.cleanup();
});

/** 실제 브라우저처럼 body 에서 올라가는 취소 가능한 Esc 하나. jsdom 의 리스너 순서에 기대지 않는다. */
function pressEscape(consumedAbove = false) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (consumedAbove) event.preventDefault();
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

test("업데이트 안내는 Esc 로 닫히고 그 Esc 를 소비한다, 위 레이어가 소비한 Esc 는 무시한다", async () => {
  let closed = 0;
  const m = await mount(
    <UpdateNoticeModal
      version="2026.921.3"
      latestVersion="2026.922.0"
      onSeen={() => {}}
      onClose={() => closed++}
    />,
  );
  pressEscape(true);
  assert.equal(closed, 0);
  const event = pressEscape();
  assert.equal(closed, 1);
  assert.equal(event.defaultPrevented, true);
  await m.cleanup();
});
