// crew-office: POST /api/crew/messenger — CLI 직원의 office MCP 브리지(src/server/crew-office-mcp.cjs)가
// 도구 호출을 넘기는 곳. 로그인 쿠키가 없으므로 proxy 의 공개 경로이고, 인증은 턴마다 발급해 턴이 끝나면
// 회수하는 메신저 토큰으로 한다(src/server/crew-messenger.ts).
import { NextRequest, NextResponse } from "next/server";

import { getCrewMessenger } from "@/lib/rpc-registry";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
    tool?: unknown;
    arguments?: unknown;
  } | null;
  if (!body || typeof body.token !== "string" || typeof body.tool !== "string") {
    return NextResponse.json(
      { text: "token 과 tool 이 필요합니다.", isError: true },
      { status: 400 },
    );
  }
  const call = getCrewMessenger();
  if (!call) {
    return NextResponse.json(
      { text: "사내 메신저가 아직 준비되지 않았습니다.", isError: true },
      { status: 503 },
    );
  }
  const args =
    body.arguments && typeof body.arguments === "object"
      ? (body.arguments as Record<string, unknown>)
      : {};
  return NextResponse.json(await call(body.token, body.tool, args));
}
