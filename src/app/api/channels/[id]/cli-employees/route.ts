// crew-office: POST /api/channels/:id/cli-employees — 채널 소유자가 Claude Code·Codex CLI 직원을 고용한다.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, channels } from "@/db";
import { getUserId } from "@/lib/internal-rpc";
import { validateCliEmployeeInput } from "@/lib/cli-employees";
import { hireCliEmployee } from "@/lib/cli-employee-hire";
import { selectNpcById } from "@/lib/npc-projection";
import internalTransport from "@/lib/internal-transport.js";
import { getRoomEmitter } from "@/lib/rpc-registry";

const { buildInternalAuthHeaders, getInternalSocketBaseUrl } = internalTransport as {
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

/** 출근부 토글과 같은 이벤트로 알린다 — 씬은 모르는 id 의 `{ npc }` 를 받으면 스프라이트를 만든다. */
async function announceHire(channelId: string, npcId: string) {
  const npc = await selectNpcById(npcId);
  const local = getRoomEmitter();
  if (local) {
    local(channelId, "npc:updated", { npc });
    return npc;
  }
  try {
    await fetch(`${getInternalSocketBaseUrl()}/_internal/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildInternalAuthHeaders() },
      body: JSON.stringify({ event: "npc:updated", room: channelId, payload: { npc } }),
    });
  } catch {
    // 알림 실패는 고용 실패가 아니다 — 새로고침하면 보인다.
    console.warn("[cli-employees] failed to emit npc:updated");
  }
  return npc;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId)
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel)
    return NextResponse.json({ errorCode: "not_found", error: "not_found" }, { status: 404 });
  if (channel.ownerId !== userId)
    return NextResponse.json({ errorCode: "forbidden", error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const validated = validateCliEmployeeInput(body);
  if (!validated.ok)
    return NextResponse.json(
      { errorCode: validated.error, error: validated.error },
      { status: 400 },
    );

  const { id } = await hireCliEmployee(channelId, validated.value);
  const npc = await announceHire(channelId, id);
  return NextResponse.json({ npc }, { status: 201 });
}
