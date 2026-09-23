import "../../test-setup/dom";

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";

import MeetingOutcomeSection from "./MeetingOutcomeSection";

const outcome = {
  decisions: ["A안 채택"],
  followUps: [
    {
      title: "조사",
      summary: null,
      acceptance: null,
      assigneeNpcId: "npc-1",
      assigneeName: "소피",
      after: [],
    },
  ],
  project: { recommended: true, name: "가격 개편", reason: null },
};

type Call = { url: string; method: string; body: unknown };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(routes: Record<string, () => { status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url}`];
    assert.ok(route, `예상하지 않은 요청: ${method} ${url}`);
    const { status, body } = route();
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

async function mount(
  extra: Partial<React.ComponentProps<typeof MeetingOutcomeSection>> = {},
): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <MeetingOutcomeSection minutesId="m1" npcs={[{ id: "npc-1", name: "소피" }]} {...extra} />
      </I18nProvider>,
    ),
  );
  await act(async () => {});
  return el;
}

// crew-office: Hermes 칸반 등록(자동화 상태 조회·등록 라우트)은 걷어냈다 — 회의록 조회와 요약 다시
// 시키기만 부른다.
test("회의록 조회 결과를 읽기 전용으로 그린다 — 등록 버튼·자동화 조회가 없다", async () => {
  const calls = stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome, summaryStatus: "ok" }, canManage: true },
    }),
  });
  const loaded: number[] = [];
  const el = await mount({ onOutcomeLoaded: () => loaded.push(1) });
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 1);
  assert.equal(el.querySelector("[data-outcome-register]"), null);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    ["GET /api/meetings/m1"],
  );
  assert.deepEqual(loaded, [1], "종료 화면은 결과를 읽었다는 알림을 한 번 받는다");
});

test("실패한 요약을 다시 시키면 새 결과로 패널이 바뀐다", async () => {
  stubFetch({
    "GET /api/meetings/m1": () => ({
      status: 200,
      body: { minutes: { outcome: null, summaryStatus: "failed" }, canManage: true },
    }),
    "POST /api/meetings/m1/summarize": () => ({
      status: 200,
      body: { summaryStatus: "ok", keyTopics: ["a"], conclusions: "b", outcome },
    }),
  });
  const el = await mount();
  await act(async () => (el.querySelector("[data-outcome-retry]") as HTMLElement).click());
  await act(async () => {});
  assert.equal(el.querySelector("[data-outcome-retry]"), null);
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 1);
});

test("회의록을 못 읽어도 한 번 알리고 패널은 그리지 않는다", async () => {
  stubFetch({ "GET /api/meetings/m1": () => ({ status: 404, body: { errorCode: "not_found" } }) });
  const loaded: number[] = [];
  const el = await mount({ onOutcomeLoaded: () => loaded.push(1) });
  assert.deepEqual(loaded, [1]);
  assert.equal(el.querySelector("[data-outcome]"), null);
});
