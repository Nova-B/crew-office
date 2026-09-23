import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n/context";
import type { MeetingOutcome } from "@/lib/meeting-outcome";

import MeetingOutcomePanel, { type MeetingOutcomePanelProps } from "./MeetingOutcomePanel";

const outcome: MeetingOutcome = {
  decisions: ["A안 채택"],
  followUps: [
    {
      title: "경쟁사 가격 조사",
      summary: "세 곳을 본다",
      acceptance: null,
      assigneeNpcId: "npc-1",
      assigneeName: "소피",
      after: [],
    },
    {
      title: "초안 작성",
      summary: null,
      acceptance: null,
      assigneeNpcId: null,
      assigneeName: "리나",
      after: [0],
    },
  ],
  project: { recommended: true, name: "가격 개편", reason: "세 단계로 이어진다" },
};

const npcs = [
  { id: "npc-1", name: "소피" },
  { id: "npc-2", name: "노아" },
];
async function mount(props: Partial<MeetingOutcomePanelProps>): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <I18nProvider initialLocale="ko">
        <MeetingOutcomePanel
          outcome={outcome}
          summaryStatus="ok"
          npcs={npcs}
          canManage
          onRetrySummary={async () => {}}
          {...props}
        />
      </I18nProvider>,
    ),
  );
  return el;
}

// crew-office: 후속 업무를 Hermes 칸반에 등록하던 초안 편집·등록 버튼은 걷어냈다 — 결과는 읽기 전용이다.
test("결정과 후속 업무를 읽기 전용으로 그린다 — 등록 버튼·입력칸이 없다", async () => {
  const el = await mount({});
  assert.match(el.textContent ?? "", /A안 채택/);
  assert.equal(el.querySelectorAll("[data-outcome-item]").length, 2);
  assert.equal(el.querySelector("[data-outcome-register]"), null);
  assert.equal(el.querySelector("input, select"), null);
});

test("후속 업무가 없으면 결정만 그린다", async () => {
  const el = await mount({ outcome: { ...outcome, followUps: [] } });
  assert.equal(el.querySelector("[data-outcome-item]"), null);
  assert.match(el.textContent ?? "", /A안 채택/);
});

test("담당은 참석자 이름으로 풀고, 풀리지 않으면 모델이 쓴 이름을 보여 준다", async () => {
  const el = await mount({});
  const [first, second] = [...el.querySelectorAll("[data-outcome-item]")];
  assert.match(first.textContent ?? "", /소피/);
  assert.match(second.textContent ?? "", /리나/);
  assert.match(second.textContent ?? "", /경쟁사 가격 조사/, "선행 업무 제목을 보여 준다");
});

test("요약이 실패했으면 그 사실을 말하고 다시 시도하게 한다", async () => {
  let retried = 0;
  const el = await mount({
    outcome: null,
    summaryStatus: "failed",
    onRetrySummary: async () => {
      retried++;
    },
  });
  const retry = el.querySelector("[data-outcome-retry]") as HTMLElement;
  assert.ok(retry, "다시 시도 버튼이 없다");
  await act(async () => retry.click());
  assert.equal(retried, 1);
});

test("요약 다시 시키기 권한이 없으면 버튼이 없다", async () => {
  const el = await mount({ outcome: null, summaryStatus: "failed", canManage: false });
  assert.equal(el.querySelector("[data-outcome-retry]"), null);
});
