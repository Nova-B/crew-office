"use client";

/**
 * 회의 결과(결정·후속 업무). 새로고침해도, 회의록에서 다시 열어도 같은 모습이다.
 *
 * crew-office: 후속 업무를 Hermes 칸반 카드로 "프로젝트에 등록" 하던 초안 편집·등록 흐름은 Hermes 와
 * 함께 걷어냈다. 이제는 결과를 읽기 전용으로 보여 주고, 요약이 실패했으면 다시 시키게만 한다.
 */
import { useState } from "react";

import { useT } from "@/lib/i18n";
import type { MeetingOutcome, MeetingSummaryStatus } from "@/lib/meeting-outcome";

export type MeetingOutcomePanelProps = {
  outcome: MeetingOutcome | null;
  summaryStatus: MeetingSummaryStatus;
  /** 담당 이름을 풀 채널 직원. */
  npcs: Array<{ id: string; name: string }>;
  /** 회의 주재자·채널 소유자만 요약을 다시 시킬 수 있다. */
  canManage: boolean;
  onRetrySummary: () => Promise<void>;
};

export default function MeetingOutcomePanel({
  outcome,
  summaryStatus,
  npcs,
  canManage,
  onRetrySummary,
}: MeetingOutcomePanelProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRetrySummary();
    } catch (cause) {
      // 거절을 조용히 삼키지 않는다 — 이유를 보이고 버튼을 남긴다.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (summaryStatus === "failed" || !outcome) {
    if (summaryStatus !== "failed") return null;
    return (
      <div className="bg-surface rounded-lg p-4 border border-npc-dark/40 space-y-2" data-outcome>
        <p className="text-caption text-text-secondary">{t("meeting.outcome.summaryFailed")}</p>
        {canManage && (
          <button
            type="button"
            data-outcome-retry
            disabled={busy}
            onClick={() => void retry()}
            className="px-3 py-1.5 rounded text-caption font-semibold bg-surface-raised text-text-secondary border border-border disabled:opacity-50"
          >
            {busy ? t("meeting.outcome.retrying") : t("meeting.outcome.retry")}
          </button>
        )}
        {error && (
          <p className="text-caption text-danger" data-outcome-error>
            {error}
          </p>
        )}
      </div>
    );
  }

  if (outcome.decisions.length === 0 && outcome.followUps.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg p-4 border border-border space-y-3" data-outcome>
      {outcome.decisions.length > 0 && (
        <div className="space-y-1">
          <p className="text-caption text-text-dim font-medium">{t("meeting.outcome.decisions")}</p>
          <ul className="space-y-0.5">
            {outcome.decisions.map((decision, index) => (
              <li key={index} className="text-caption text-text-secondary flex items-start gap-1.5">
                <span className="text-info mt-0.5">•</span>
                <span>{decision}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome.followUps.length > 0 && (
        <div className="space-y-2">
          <p className="text-caption text-text-dim font-medium">
            {t("meeting.outcome.followUps", { count: outcome.followUps.length })}
          </p>
          <ul className="space-y-1.5">
            {outcome.followUps.map((item, index) => {
              const assignee =
                (item.assigneeNpcId && npcs.find((npc) => npc.id === item.assigneeNpcId)?.name) ||
                item.assigneeName;
              return (
                <li
                  key={index}
                  data-outcome-item
                  className="rounded border border-border bg-surface-raised/40 px-2 py-1.5 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 text-caption text-text">{item.title}</span>
                    <span className="shrink-0 max-w-[40%] truncate text-caption text-text-secondary">
                      {assignee || t("meeting.outcome.unassigned")}
                    </span>
                  </div>
                  {item.summary && <p className="text-micro text-text-muted">{item.summary}</p>}
                  {item.after.length > 0 && (
                    <p className="text-micro text-text-dim">
                      {t("meeting.outcome.after", {
                        titles: item.after
                          .map((target) => outcome.followUps[target]?.title)
                          .filter(Boolean)
                          .join(", "),
                      })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
