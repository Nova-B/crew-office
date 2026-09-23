import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { setupThrowawaySqlite } from "@/test-setup/npc-seed";
import { deriveContextKey } from "./npc-sessions";

// 세션 영속은 DB(drizzle over @/db) 위에 있다 — `db` 를 흉내 내지 않고 임시 SQLite 로 확인한다.
setupThrowawaySqlite("npc-sessions-test");

describe("deriveContextKey", () => {
  test("strips the session key prefix to recover the dm context", () => {
    assert.equal(deriveContextKey("npc-1-dm-user-9", "npc-1"), "dm-user-9");
  });

  test("strips the session key prefix to recover a meeting context", () => {
    assert.equal(deriveContextKey("npc-1-meeting-ch-3", "npc-1"), "meeting-ch-3");
  });

  test("falls back to the full session key when the prefix does not match", () => {
    assert.equal(deriveContextKey("other-dm-user-9", "npc-1"), "other-dm-user-9");
  });
});

async function seedCliNpc() {
  const { seedUser, seedChannel, seedNpc } = await import("@/test-setup/npc-seed");
  const user = await seedUser();
  const channel = await seedChannel(user.id);
  const npc = await seedNpc({ channelId: channel.id, adapterType: "claude" });
  return { user, npc };
}

describe("npc session persistence", () => {
  test("returns null when no session has been stored yet", async () => {
    const { getStoredNpcSessionRef } = await import("./npc-sessions");
    const { user, npc } = await seedCliNpc();

    assert.equal(await getStoredNpcSessionRef(npc.id, user.id, "dm-" + user.id, "claude"), null);
  });

  test("round-trips a stored session ref and updates it on a second write", async () => {
    const { getStoredNpcSessionRef, persistNpcSessionRef } = await import("./npc-sessions");
    const { user, npc } = await seedCliNpc();
    const contextKey = "dm-" + user.id;

    await persistNpcSessionRef(npc.id, user.id, contextKey, "claude", "session-1");
    assert.equal(await getStoredNpcSessionRef(npc.id, user.id, contextKey, "claude"), "session-1");

    await persistNpcSessionRef(npc.id, user.id, contextKey, "claude", "session-2");
    assert.equal(await getStoredNpcSessionRef(npc.id, user.id, contextKey, "claude"), "session-2");
  });

  test("CLI 직원 세션은 같은 행에 저장되고, 어댑터 종류가 바뀌면 이전 세션을 재개하지 않는다", async () => {
    const { getStoredNpcSessionRef, persistNpcSessionRef } = await import("./npc-sessions");
    const { user, npc } = await seedCliNpc();
    const contextKey = "dm-" + user.id;

    await persistNpcSessionRef(npc.id, user.id, contextKey, "claude", "claude-session");
    assert.equal(
      await getStoredNpcSessionRef(npc.id, user.id, contextKey, "claude"),
      "claude-session",
    );
    // 같은 직원이 Codex 로 바뀌면 Claude 세션 ID 로 Codex 를 재개하려 들면 안 된다.
    assert.equal(await getStoredNpcSessionRef(npc.id, user.id, contextKey, "codex"), null);

    await persistNpcSessionRef(npc.id, user.id, contextKey, "codex", "codex-thread");
    assert.equal(
      await getStoredNpcSessionRef(npc.id, user.id, contextKey, "codex"),
      "codex-thread",
    );
    assert.equal(await getStoredNpcSessionRef(npc.id, user.id, contextKey, "claude"), null);
  });
});
