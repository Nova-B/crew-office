// crew-office: 회의·채팅방처럼 호출부가 제어 상태를 모르는 경로에서도 CLI 직원 턴에 일시정지·터미널 인계를
// 적용한다(1:1 과 동료 묻기는 socket-handlers 가 직접 검사한다).
//
// 이 프로세스의 제어 상태는 하나다 — 소켓 서버와 회의 코드가 같은 인스턴스를 본다.

import type { NpcAdapter } from "../lib/adapters/types";
import { createCrewControl, type CrewControl } from "./crew-control";

export const crewControl: CrewControl = createCrewControl();

export class CrewBlockedError extends Error {
  constructor(readonly code: "crew_paused" | "crew_handoff") {
    super(code === "crew_paused" ? "office is paused" : "employee is handed off to a terminal");
    this.name = "CrewBlockedError";
  }
}

/**
 * 막혀 있으면 턴을 시작하지 않고 CrewBlockedError 를 던진다. 도는 동안에는 제어에 등록해 일시정지 때 멈추고,
 * 그 직원을 "일하는 중" 으로 잡아 터미널로 넘기지 못하게 한다.
 */
export function withCrewGuard(
  adapter: NpcAdapter,
  npcId: string,
  channelId: string | undefined,
  control: CrewControl = crewControl,
): NpcAdapter {
  return {
    type: adapter.type,
    execute: async (options) => {
      if (channelId && control.isPaused(channelId)) throw new CrewBlockedError("crew_paused");
      if (control.isHandedOff(npcId)) throw new CrewBlockedError("crew_handoff");
      const untrack = control.track(
        channelId ?? "",
        () => void adapter.abort?.(options.sessionKey),
        npcId,
      );
      try {
        return await adapter.execute(options);
      } finally {
        untrack();
      }
    },
    abort: adapter.abort && ((sessionKey) => adapter.abort!(sessionKey)),
    resetSession: adapter.resetSession && ((sessionKey) => adapter.resetSession!(sessionKey)),
    testConnection: (config) => adapter.testConnection(config),
  };
}
