// crew-office: CLI 직원의 폭주 방지 제어(기획안 §4 "폭주 방지 장치", §6 MVP)와 터미널 인계 잠금(§3).
//
// - 오피스(채널)별 전체 일시정지: 새 CLI 턴을 막고, 돌고 있는 턴은 멈춘다.
// - 오피스별 동료 묻기 한도: 한 시간 창 안의 묻기 횟수 상한. 자동으로 서로 떠드는 루프가 구독 한도를 태우지 않게.
// - 터미널 인계: 사람이 터미널에서 직원 세션을 쓰는 동안 앱은 그 직원에게 턴을 보내지 않는다 —
//   같은 세션을 두 곳이 동시에 이어 쓰면 기록이 엉킨다. 일하는 중인 직원은 넘기지 않는다.
// 상태는 메모리에만 둔다 — 서버를 재시작하면 일시정지·인계는 풀린다.

export const DEFAULT_ASKS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export type CrewState = {
  paused: boolean;
  asksUsed: number;
  asksLimit: number;
  /** 지금 터미널에서 사람이 조작 중인 직원 id. */
  handedOff: string[];
};

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
  /** 직원 id → 지금 돌고 있는 그 직원의 턴 수. */
  const busy = new Map<string, number>();
  /** 직원 id → 넘겨받은 오피스. */
  const handoffs = new Map<string, string>();

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

    /**
     * 턴이 시작될 때 멈출 방법을 등록한다. 반환한 함수로 턴이 끝날 때 해제한다.
     * `npcId` 를 주면 그 직원이 "일하는 중" 으로 잡혀 터미널로 넘길 수 없다.
     */
    track(channelId: string, abort: () => void, npcId?: string): () => void {
      const set = running.get(channelId) ?? new Set();
      set.add(abort);
      running.set(channelId, set);
      if (npcId) busy.set(npcId, (busy.get(npcId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set.delete(abort);
        if (set.size === 0) running.delete(channelId);
        if (npcId) {
          const left = (busy.get(npcId) ?? 1) - 1;
          if (left > 0) busy.set(npcId, left);
          else busy.delete(npcId);
        }
      };
    },

    /** 동료 묻기 한 번을 쓴다. 한도에 닿았으면 false. */
    consumeAsk(channelId: string): boolean {
      const recent = recentAsks(channelId);
      if (recent.length >= asksLimit) return false;
      recent.push(now());
      return true;
    },

    isBusy: (npcId: string) => busy.has(npcId),
    isHandedOff: (npcId: string) => handoffs.has(npcId),

    /** 터미널로 넘긴다. 일하는 중이면 넘기지 않고 false. 이미 넘겼으면 true. */
    handOff(npcId: string, channelId: string): boolean {
      if (handoffs.has(npcId)) return true;
      if (busy.has(npcId)) return false;
      handoffs.set(npcId, channelId);
      return true;
    },

    /** 앱으로 되돌린다. 넘긴 적이 없었으면 false. */
    reclaim: (npcId: string) => handoffs.delete(npcId),

    state(channelId: string): CrewState {
      return {
        paused: paused.has(channelId),
        asksUsed: recentAsks(channelId).length,
        asksLimit,
        handedOff: [...handoffs].filter(([, ch]) => ch === channelId).map(([id]) => id),
      };
    },
  };
}

export type CrewControl = ReturnType<typeof createCrewControl>;
