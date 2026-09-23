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
