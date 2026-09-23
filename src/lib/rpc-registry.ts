/**
 * In-process RPC registry.
 *
 * When the socket server and Next.js run in the same process (dev), the socket
 * server registers a handler here. internalRpc() finds it and calls it directly
 * — no HTTP, no port dependency.
 *
 * In production the two servers are separate processes so the registry is empty
 * and internalRpc() falls back to HTTP (PORT+1, as server.js expects).
 */

type RpcHandler = (
  channelId: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

type GatewayConfigUpdatedHandler = (channelId: string) => Promise<void> | void;

const KEY = "__deskrpg_rpc_handler__";
const GATEWAY_CONFIG_UPDATED_KEY = "__deskrpg_gateway_config_updated_handler__";
const g = globalThis as typeof globalThis &
  Record<string, RpcHandler | GatewayConfigUpdatedHandler | undefined>;

export function registerRpcHandler(handler: RpcHandler): void {
  g[KEY] = handler;
}

export function getLocalRpcHandler(): RpcHandler | undefined {
  const handler = g[KEY];
  return typeof handler === "function" ? (handler as RpcHandler) : undefined;
}

export function registerGatewayConfigUpdatedHandler(handler: GatewayConfigUpdatedHandler): void {
  g[GATEWAY_CONFIG_UPDATED_KEY] = handler;
}

export function getGatewayConfigUpdatedHandler(): GatewayConfigUpdatedHandler | undefined {
  const handler = g[GATEWAY_CONFIG_UPDATED_KEY];
  return typeof handler === "function" ? (handler as GatewayConfigUpdatedHandler) : undefined;
}

// crew-office: API 라우트가 같은 프로세스의 소켓 서버로 방 이벤트를 보낸다. `/_internal/emit` HTTP 브리지는
// server.js 에만 있어 개발 서버(dev-server.ts)에서는 조용히 실패했다. 소켓 서버가 떠 있으면 이것을 쓰고,
// 없을 때만 호출부가 HTTP 로 넘어간다.
type RoomEmitter = (room: string, event: string, payload: unknown) => void;
const ROOM_EMITTER_KEY = "__crew_office_room_emitter__";
const emitters = globalThis as typeof globalThis & Record<string, RoomEmitter | undefined>;

export function registerRoomEmitter(emitter: RoomEmitter): void {
  emitters[ROOM_EMITTER_KEY] = emitter;
}

export function getRoomEmitter(): RoomEmitter | undefined {
  const emitter = emitters[ROOM_EMITTER_KEY];
  return typeof emitter === "function" ? emitter : undefined;
}

// crew-office: 사내 메신저(src/server/crew-messenger.ts). 소켓 서버가 등록하고 /api/crew/messenger 가 부른다.
export type CrewMessengerCall = (
  token: string,
  tool: string,
  args: Record<string, unknown>,
) => Promise<{ text: string; isError?: boolean }>;
const CREW_MESSENGER_KEY = "__crew_office_messenger__";
const messengers = globalThis as typeof globalThis & Record<string, CrewMessengerCall | undefined>;

export function registerCrewMessenger(call: CrewMessengerCall): void {
  messengers[CREW_MESSENGER_KEY] = call;
}

export function getCrewMessenger(): CrewMessengerCall | undefined {
  const call = messengers[CREW_MESSENGER_KEY];
  return typeof call === "function" ? call : undefined;
}

// crew-office: 이미 저장된 방 메시지(회의 결과 알림 등)를 그 방에 방송한다. 예전 automation-registry 의
// 훅에서 방송만 남겼다 — 자동화 폴러는 Hermes 와 함께 걷어냈다. 행은 `appendRoomMessage` 가 쓰고, 이것은
// 방송만 한다. 소켓 서버가 없으면 조용히 no-op — 행은 DB 에 있으니 방을 열면 보인다.
type RoomMessageBroadcaster = (roomId: string, message: unknown) => void;
const ROOM_MESSAGE_KEY = "__crew_office_room_message_broadcaster__";
const broadcasters = globalThis as typeof globalThis &
  Record<string, RoomMessageBroadcaster | undefined>;

export function registerRoomMessageBroadcaster(
  broadcast: RoomMessageBroadcaster | undefined,
): void {
  broadcasters[ROOM_MESSAGE_KEY] = broadcast;
}

/** 방송 실패가 알림을 만든 작업을 실패시키면 안 된다 — 던지지 않는다. */
export function requestEmitRoomMessage(roomId: string, message: unknown): void {
  const broadcast = broadcasters[ROOM_MESSAGE_KEY];
  if (typeof broadcast !== "function") return;
  try {
    broadcast(roomId, message);
  } catch {
    // 소켓 방송이 깨져도 호출자는 계속 간다.
  }
}
