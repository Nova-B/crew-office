"use client";

/**
 * 회의록 하나의 결과 패널을 서버 상태와 잇는다. 회의 종료 화면과 회의록 보기 양쪽에서 같은
 * 회의록 id 로 쓴다.
 *
 * 요약 다시 시키기 권한(`canManage`)은 클라이언트가 추측하지 않고 회의록 조회가 돌려준 값을 쓴다.
 * crew-office: 후속 업무를 Hermes 칸반에 등록하던 흐름은 Hermes 와 함께 걷어냈다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import { getLocalizedMessage } from "@/lib/i18n/error-codes";
import type { MeetingOutcome, MeetingSummaryStatus } from "@/lib/meeting-outcome";

import MeetingOutcomePanel from "./MeetingOutcomePanel";

type Loaded = {
  /** 어느 회의록의 값인가. 다른 회의록으로 바뀌면 새 값이 올 때까지 그리지 않는다. */
  minutesId: string;
  outcome: MeetingOutcome | null;
  summaryStatus: MeetingSummaryStatus;
  canManage: boolean;
};

export type MeetingOutcomeSectionProps = {
  minutesId: string;
  npcs: Array<{ id: string; name: string }>;
  /** 요약이 다시 만들어졌을 때 — 바깥 화면의 주제·결론 표시를 새로 고칠 기회. */
  onSummaryChanged?: (summary: { keyTopics: string[]; conclusions: string | null }) => void;
  /** 결과를 읽었을 때(못 읽었어도 한 번) 알린다 — 종료 화면은 이때 자동 복귀 안내를 띄운다. */
  onOutcomeLoaded?: () => void;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { errorCode?: string; code?: string; error?: string };
    return data.errorCode || data.code || data.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export default function MeetingOutcomeSection({
  minutesId,
  npcs,
  onSummaryChanged,
  onOutcomeLoaded,
}: MeetingOutcomeSectionProps) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 알림 콜백이 바뀌어도 회의록을 다시 읽지 않는다.
  const report = useRef(onOutcomeLoaded);
  useEffect(() => {
    report.current = onOutcomeLoaded;
  }, [onOutcomeLoaded]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/meetings/${minutesId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as {
          minutes: { outcome: MeetingOutcome | null; summaryStatus?: MeetingSummaryStatus };
          canManage?: boolean;
        };
      })
      .then((data) => {
        if (cancelled) return;
        report.current?.();
        setLoaded({
          minutesId,
          outcome: data.minutes.outcome,
          summaryStatus: data.minutes.summaryStatus ?? "ok",
          canManage: data.canManage === true,
        });
      })
      .catch(() => {
        // 회의록을 못 읽으면 패널을 그리지 않는다. 회의록 본문은 바깥 화면이 따로 보여 준다.
        if (!cancelled) report.current?.();
      });
    return () => {
      cancelled = true;
    };
  }, [minutesId]);

  const retry = useCallback(async () => {
    const res = await fetch(`/api/meetings/${minutesId}/summarize`, { method: "POST" });
    if (!res.ok) throw new Error(getLocalizedMessage(t, await readError(res)));
    const data = (await res.json()) as {
      summaryStatus: MeetingSummaryStatus;
      keyTopics: string[];
      conclusions: string | null;
      outcome: MeetingOutcome | null;
    };
    setLoaded((prev) =>
      prev ? { ...prev, outcome: data.outcome, summaryStatus: data.summaryStatus } : prev,
    );
    onSummaryChanged?.({ keyTopics: data.keyTopics, conclusions: data.conclusions });
  }, [minutesId, onSummaryChanged, t]);

  if (!loaded || loaded.minutesId !== minutesId) return null;
  return (
    <MeetingOutcomePanel
      outcome={loaded.outcome}
      summaryStatus={loaded.summaryStatus}
      npcs={npcs}
      canManage={loaded.canManage}
      onRetrySummary={retry}
    />
  );
}
