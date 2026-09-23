import assert from "node:assert/strict";
import test from "node:test";
import { projectNpcRow, filterForMap } from "./npc-projection";

const npc = {
  id: "n1",
  channelId: "c1",
  name: "미나",
  appearance: JSON.stringify({ officeLookId: "office-nari" }),
  positionX: 3,
  positionY: 4,
  direction: "down",
  adapterType: "claude",
  adapterConfig: null,
  agentConfig: null,
  active: true,
  createdAt: null,
  updatedAt: null,
};

test("이름과 외형은 npcs 행이 정본이다", () => {
  const p = projectNpcRow(npc);
  assert.equal(p.name, "미나");
  assert.deepEqual(p.appearance, { officeLookId: "office-nari" });
});

test("이름이 비었으면 어댑터 이름으로 떨어진다", () => {
  assert.equal(projectNpcRow({ ...npc, name: "  " }).name, "claude");
  assert.equal(projectNpcRow({ ...npc, name: null }).name, "claude");
});

test("맵 필터는 자리 미정과 휴면을 뺀다", () => {
  const placed = projectNpcRow(npc);
  const unplaced = projectNpcRow({ ...npc, id: "n2", positionX: null, positionY: null });
  const dormant = projectNpcRow({ ...npc, id: "n3", active: false });
  assert.deepEqual(
    filterForMap([placed, unplaced, dormant]).map((n) => n.id),
    ["n1"],
  );
});
