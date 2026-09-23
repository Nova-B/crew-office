import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { authHeaders, seedChannel, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

// crew-office: Hermes 프로필 없이 CLI 직원을 고용한다.
setupThrowawaySqlite("cli-employees-route-test");

async function hire(channelId: string, userId: string, body: unknown) {
  const { POST } = await import("./[id]/cli-employees/route");
  return POST(
    new NextRequest(`http://localhost/api/channels/${channelId}/cli-employees`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: channelId }) },
  );
}

test("채널 소유자는 프로필 없는 Claude·Codex 직원을 여럿 고용하고, 명단에 이름·외형·설정이 보인다", async () => {
  const owner = await seedUser("owner");
  const channel = await seedChannel(owner.id);
  const { selectChannelNpcs } = await import("@/lib/npc-projection");

  const res = await hire(channel.id, owner.id, {
    name: "  Mina  ",
    adapterType: "claude",
    model: "haiku",
    soul: "You are a cheerful planner.",
    appearance: { officeLookId: "no-such-look" },
  });
  assert.equal(res.status, 201);
  const { npc } = (await res.json()) as { npc: { id: string } };

  assert.equal(
    (await hire(channel.id, owner.id, { name: "Dev", adapterType: "codex" })).status,
    201,
  );

  const roster = await selectChannelNpcs(channel.id, { roster: true });
  assert.equal(roster.length, 2, "NULL 프로필 둘은 유니크 충돌이 아니다");
  const mina = roster.find((n) => n.id === npc.id)!;
  assert.equal(mina.name, "Mina");
  assert.equal(mina.adapterType, "claude");
  assert.equal(mina.active, true);
  assert.deepEqual(mina.adapterConfig, { model: "haiku" });
  assert.deepEqual(mina.agentConfig, { soul: "You are a cheerful planner." });
  assert.ok(
    (mina.appearance as { officeLookId?: string }).officeLookId,
    "모르는 룩은 기본 룩으로 접힌다",
  );
});

test("소유자가 아니면 403, 입력이 틀리면 400 이고 아무것도 만들지 않는다", async () => {
  const owner = await seedUser("owner");
  const stranger = await seedUser("stranger");
  const channel = await seedChannel(owner.id);
  const { selectChannelNpcs } = await import("@/lib/npc-projection");

  assert.equal(
    (await hire(channel.id, stranger.id, { name: "X", adapterType: "claude" })).status,
    403,
  );
  const bad = await hire(channel.id, owner.id, { name: "X", adapterType: "hermes" });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { errorCode: string }).errorCode, "invalid_adapter");
  assert.equal((await selectChannelNpcs(channel.id, { roster: true })).length, 0);
});

test("게이트웨이가 없는 채널에서도 CLI 직원은 /api/npcs 명단에 보인다", async () => {
  // 회귀: /api/npcs 는 유효한 게이트웨이가 없으면 명단을 통째로 비웠다 — 고용은 성공했는데 화면에는 0명이었다.
  const owner = await seedUser("owner");
  const channel = await seedChannel(owner.id);
  assert.equal(
    (await hire(channel.id, owner.id, { name: "Mina", adapterType: "claude" })).status,
    201,
  );

  // 출근부(roster=1)로 본다 — 맵용 기본 목록은 자리를 잡은 직원만 내고, 테스트 채널 맵에는 좌석이 없다.
  const { GET } = await import("../npcs/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/npcs?channelId=${channel.id}&roster=1`, {
      headers: authHeaders(owner.id),
    }),
  );
  assert.equal(res.status, 200);
  const { npcs } = (await res.json()) as { npcs: Array<{ name: string }> };
  assert.deepEqual(
    npcs.map((n) => n.name),
    ["Mina"],
  );
});
