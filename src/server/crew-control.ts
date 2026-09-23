// crew-office: CLI 직원의 폭주 방지 제어(기획안 §4 "폭주 방지 장치", §6 MVP).
//
// - 오피스(채널)별 전체 일시정지: 새 CLI 턴을 막고, 돌고 있는 턴은 멈춘다.
// - 오피스별 동료 묻기 한도: 한 시간 창 안의 묻기 횟수 상한. 자동으로 서로 떠드는 루프가 구독 한도를 태우지 않게.
// 상태는 메모리에만 둔다 — 서버를 재시작하면 일시정지는 풀린다(화면이 그렇게 안내한다).

export const DEFAULT_ASKS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export type CrewState = { paused: boolean; asksUsed: number; asksLimit: number };

export interface CrewControlOptions {
  asksPerHour?: number;
  now?: () => number;
}

export function createCrewControl(options: CrewControlOptions = {}) {
  const asksLimit = options.asksPerHour ?? DEFAULT_ASKS_PER_HOUR;
  const now = options.now ?? Date.now;
  const paused = new Set<string>();
  const asks = new Map<string, number[]>();
  const running = new Map<string, Set<() => void>>();

  function recentAsks(channelId: string): number[] {
    const cutoff = now() - HOUR_MS;
    const kept = (asks.get(channelId) ?? []).filter((at) => at > cutoff);
    asks.set(channelId, kept);
    return kept;
  }

  return {
    isPaused: (channelId: string) => paused.has(channelId),

    /** 일시정지하면 돌고 있는 턴을 모두 멈춘다. 멈춘 턴 수를 돌려준다. */
    setPaused(channelId: string, value: boolean): number {
      if (!value) {
        paused.delete(channelId);
        return 0;
      }
      paused.add(channelId);
      const turns = [...(running.get(channelId) ?? [])];
      for (const abort of turns) abort();
      return turns.length;
    },

    /** 턴이 시작될 때 멈출 방법을 등록한다. 반환한 함수로 턴이 끝날 때 해제한다. */
    track(channelId: string, abort: () => void): () => void {
      const set = running.get(channelId) ?? new Set();
      set.add(abort);
      running.set(channelId, set);
      return () => {
        set.delete(abort);
        if (set.size === 0) running.delete(channelId);
      };
    },

    /** 동료 묻기 한 번을 쓴다. 한도에 닿았으면 false. */
    consumeAsk(channelId: string): boolean {
      const recent = recentAsks(channelId);
      if (recent.length >= asksLimit) return false;
      recent.push(now());
      return true;
    },

    state(channelId: string): CrewState {
      return { paused: paused.has(channelId), asksUsed: recentAsks(channelId).length, asksLimit };
    },
  };
}

export type CrewControl = ReturnType<typeof createCrewControl>;
