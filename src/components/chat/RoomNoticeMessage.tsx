"use client";
/**
 * 구조화 알림 한 줄. 서버는 로케일을 모른 채 `notice` 만 싣고, 문장은 여기서 보는
 * 사람의 언어로 만든다.
 *
 * - `meeting_outcome`: 후속 업무가 나온 회의 한 줄 + "회의록 보기".
 * - 모르는 kind: `content` 폴백 — 알림 자체를 삼키지 않는다.
 *
 * crew-office: 칸반 카드·승인 요청·카드 제안·크론 결과 알림은 Hermes 와 함께 걷어냈다.
 */
import type { RoomMessage, RoomNotice } from "@/lib/chat-rooms-policy";
import { useT } from "@/lib/i18n";

/**
 * 여기서 문장을 만들 수 있는 kind 인지 — 아니면 `content` 폴백으로 간다.
 * 지원 목록을 양성적으로 적는다: 새 kind 가 유니온에 들어와도 여기서 빠지면 자동으로 폴백이 된다.
 */
export function isKnownNotice(notice: RoomNotice | null | undefined): notice is RoomNotice {
  return !!notice && notice.kind === "meeting_outcome";
}

export interface RoomNoticeMessageProps {
  message: RoomMessage;
  /** 회의 결과 알림 — 그 회의의 회의록을 연다. 없으면 버튼이 없다. */
  onOpenMinutes?: (minutesId: string) => void;
}

export default function RoomNoticeMessage({ message, onOpenMinutes }: RoomNoticeMessageProps) {
  const t = useT();
  const notice = message.notice ?? null;

  if (!isKnownNotice(notice)) {
    // 알 수 없는 kind — 일반 NPC/시스템 줄처럼 content 만.
    const name = message.senderName;
    return (
      <div className="flex justify-start" data-room-notice="unknown">
        <div className="max-w-[85%] px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary">
          {name && <div className="text-caption font-semibold text-npc mb-0.5">{name}</div>}
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start" data-room-notice={notice.kind}>
      <div className="max-w-[85%] px-3 py-2 rounded-lg text-body bg-surface-raised text-text-secondary border border-border">
        <div className="break-words">
          {/* 프로젝트 등록 권유(recommended)는 Hermes 칸반과 함께 사라졌다 — 같은 문장으로 알린다. */}
          {t("notice.meetingOutcome", { topic: notice.topic, count: notice.followUpCount })}
        </div>
        {onOpenMinutes && (
          <button
            type="button"
            data-meeting-outcome-open="view"
            className="text-caption font-semibold text-primary hover:underline mt-1"
            onClick={() => onOpenMinutes(notice.minutesId)}
          >
            {t("notice.meetingOutcome.view")}
          </button>
        )}
      </div>
    </div>
  );
}
