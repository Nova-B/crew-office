// src/server/socket-event-parity.test.ts
//
// SOCKET EVENT PARITY GUARD
// -------------------------
// 프로덕션은 `node server.js`, 개발은 `npx tsx dev-server.ts` → socket-handlers.ts 를 쓴다.
// 2026-08 이전까지 두 파일은 각자 핸들러를 갖고 있었고, 한쪽에만 기능이 추가되는
// 드리프트가 실제로 발생했다(프로덕션에 Hermes/CLI 어댑터 디스패치가 없었다).
// P1b에서 server.js 가 setupSocketHandlers 를 호출하도록 통합했으므로,
// 이 테스트는 server.js 안에 소켓 핸들러가 다시 생겨나는 것을 막는다.
//
// 추출 정규식은 `/socket\.on\(\s*"([^"]+)"/g` — `\s*`가 개행을 포함하므로
// socket.on(\n  "player:join",\n  ...) 같은 여러 줄 등록도 잡는다. 실측 확인:
// socket-handlers.ts에서 `\s*` 없는 단순 단일행 정규식은 18개만 잡지만
// 이 정규식은 23개를 잡는다 — multi-line 등록을 놓치는 위험이 이 파일에
// 실제로 존재한다는 뜻이다. 아래 별도 테스트가 이 위험을 직접 가드한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function socketEventsIn(...relPaths: string[]): string[] {
  const events = new Set<string>();
  for (const relPath of relPaths) {
    const src = readFileSync(path.join(repoRoot, relPath), "utf8");
    for (const m of src.matchAll(/socket\.on\(\s*"([^"]+)"/g)) events.add(m[1]);
    // The coordinator's validated wrapper registers each literal event through socket.on(name).
    if (relPath === "src/server/npc-coordination.ts")
      for (const m of src.matchAll(/handle\(\s*"([^"]+)"/g)) events.add(m[1]);
  }
  return [...events].sort();
}

/**
 * 소켓 핸들러는 더 이상 한 파일에 있지 않다. socket-handlers.ts 가 방·출근부 핸들러를
 * 각 모듈에 위임하고, 그 모듈이 자기 `socket.on` 을 등록한다 — 그래서 "이 이벤트가
 * 배선돼 있는가" 는 세 파일의 합집합으로 봐야 한다. socket-handlers.ts 안에 이름만
 * 다시 늘어놓아 이 가드를 만족시키는 것은 등록 지점을 둘로 만드는 꼼수다.
 */
const HANDLER_FILES = [
  "src/server/socket-handlers.ts",
  "src/server/room-socket.ts",
  "src/server/npc-roster-socket.ts",
  "src/server/npc-coordination.ts",
];

test("server.js registers no socket handlers of its own", () => {
  const events = socketEventsIn("server.js");
  assert.deepEqual(
    events,
    [],
    `server.js가 소켓 핸들러를 직접 등록하고 있습니다: ${events.join(", ")}\n` +
      "핸들러는 src/server/socket-handlers.ts 한 곳에만 있어야 합니다 " +
      "(server.js는 setupSocketHandlers(io)를 호출하기만 합니다).",
  );
});

test("server.js delegates to setupSocketHandlers", () => {
  const src = readFileSync(path.join(repoRoot, "server.js"), "utf8");
  assert.match(
    src,
    /setupSocketHandlers\s*\(/,
    "server.js가 setupSocketHandlers를 호출하지 않습니다 — 소켓 핸들러가 배선되지 않았습니다.",
  );
});

test("socket-handlers still registers the events server.js used to own", () => {
  const events = socketEventsIn(...HANDLER_FILES);
  for (const required of [
    "player:join",
    "player:move",
    "room:send",
    "room:open",
    "room:create",
    "map:object-add",
    "map:object-remove",
    "map:tiles-update",
    "npc:chat",
    "npc:position-update",
  ]) {
    assert.ok(
      events.includes(required),
      `"${required}" 핸들러가 어디에도 없습니다(${HANDLER_FILES.join(", ")}) — ` +
        "프로덕션에서 그 기능이 사라집니다.",
    );
  }
});

// 2026-04 태스크 시스템은 2026-09 에 데이터째 폐기됐다(스펙 R33·R34, 0012). 그 소켓 이벤트가
// 어느 핸들러 파일에든 다시 등록되면 서버는 지워진 태스크·보고 테이블을 다시 찾게 된다.
test("legacy task-system socket events are not registered anywhere", () => {
  const events = socketEventsIn(...HANDLER_FILES);
  const revived = events.filter(
    (e) => e.startsWith("task:") || e.startsWith("npc:task-") || e.startsWith("npc:report-"),
  );
  assert.deepEqual(
    revived,
    [],
    `폐기된 태스크 시스템의 소켓 이벤트가 되살아났습니다: ${revived.join(", ")}`,
  );
});

test("socket-handlers enforces single-session-per-user by emitting session:kicked", () => {
  // Regression guard for the P1b unification: pre-refactor server.js kicked
  // any prior live session for the same user account on player:join. The
  // unification onto socket-handlers.ts silently dropped that rule (dev's
  // handler never had it). This pins the emit so a future refactor that
  // drops session:kicked again fails loudly instead of surviving unnoticed.
  const src = readFileSync(path.join(repoRoot, "src/server/socket-handlers.ts"), "utf8");
  assert.match(
    src,
    /session:kicked/,
    'socket-handlers.ts가 "session:kicked"를 더 이상 emit하지 않습니다 — ' +
      "단일 세션 강제(single-session-per-user)가 다시 사라졌습니다. " +
      "player:join 핸들러에서 이전 세션을 disconnect하는 로직을 복원하세요.",
  );
});

test("socket-handlers extraction regex captures multi-line socket.on() registrations", () => {
  // 회귀 방지: 단순 `/socket\.on\("/` 정규식은 여러 줄에 걸친
  //   socket.on(
  //     "player:join",
  //     async (data) => { ... },
  //   );
  // 형태를 놓친다. socket-handlers.ts는 실제로 "player:join"을 이 여러 줄
  // 형태로 등록한다 — 매직 카운트(예: "N개 이상")는 핸들러가 정당하게
  // 늘거나 옮겨질 때마다 깨지고, 다음 사람이 추출기 동작을 확인하지 않은
  // 채 숫자만 올려서 고치게 만든다. 그러면 가드가 있으나 마나 해진다.
  // 그래서 위험 자체를 직접 단언한다: "player:join"이 빠지면 추출기가
  // 여러 줄 등록을 못 잡는 것이고, 이 가드 전체를 신뢰할 수 없다는 뜻이다.
  const events = socketEventsIn("src/server/socket-handlers.ts");
  assert.ok(
    events.includes("player:join"),
    'socket-handlers.ts에서 "player:join"을 추출하지 못했습니다 — ' +
      '이 이벤트는 socket.on(\\n  "player:join",\\n  ...) 형태의 여러 줄 등록입니다. ' +
      "추출 정규식이 개행을 포함한 socket.on(...) 등록을 놓치고 있다는 뜻이며, " +
      "이 파일의 다른 어서션들도 신뢰할 수 없습니다 — 정규식부터 고치세요.",
  );
});

// 이 브랜치의 서명 결함 가드: 자유채팅 서버가 쏘는 이벤트에 맵 클라이언트 리스너가 있는가.
//
// C1 이 정확히 이 모양이었다 — 서버는 npc:come-to-player 를 쐈지만 클라이언트 리스너의
// 조건(targetPlayerId === socket.id)이 절대 참이 될 수 없어 아무도 반응하지 않았다.
// 이름이 있어도 소비자가 없으면 검증할 수 없는 죽은 배선이므로, 이름 존재만이라도 묶어 둔다.
test("map chat events emitted by the server have a listener in the map client", () => {
  const client = readFileSync(path.join(repoRoot, "src/app/game/GamePageClient.tsx"), "utf8");
  for (const event of ["npc:come-to-player", "room:mention-skipped", "room:npc-aborted"]) {
    // 공백에 둔감하게 — 포매터가 `socketInstance.on(` 다음에서 줄을 바꿔도
    // 리스너는 그대로 있다. 형식이 바뀌었을 뿐인데 빨개지는 가드는 신뢰를 잃는다.
    assert.ok(
      new RegExp(`socketInstance\\.on\\(\\s*"${event}"`).test(client),
      `서버가 ${event} 를 쏘지만 맵 클라이언트에 리스너가 없습니다 — 죽은 배선입니다.`,
    );
  }
});

// 회의 전용 이벤트를 맵 룸으로 재사용하면 회의 중인 사람의 트랜스크립트에 남의 맵 사건이
// 삽입된다(회의 참가자는 맵 룸을 떠나지 않는다).
test("socket-handlers never broadcasts meeting-only events to the map room", () => {
  const src = readFileSync(path.join(repoRoot, "src/server/socket-handlers.ts"), "utf8");
  // 회의 전용 이벤트 자체는 정상이다 — 문제는 **어느 방으로** 쏘느냐다. 회의 룸
  // (`meeting-<id>`)이 아닌 방으로 나가는 meeting:* 만 잡는다.
  const leaked = [...src.matchAll(/\.to\(([^)]*)\)\s*\.emit\(\s*"(meeting:[^"]+)"/g)]
    .filter((m) => !m[1].includes("meeting-"))
    .map((m) => `${m[2]} → ${m[1]}`);
  assert.deepEqual(
    leaked,
    [],
    `맵 룸 브로드캐스트에 회의 전용 이벤트가 섞였습니다: ${leaked.join(", ")}`,
  );
});

// 위 가드는 **이름**만 본다. C1 은 이름이 멀쩡한 채로 죽어 있던 결함이었다 — 서버가
// targetPlayerId: null 을 실었고, 클라이언트 조건(=== socket.id)이 어떤 소켓에서도 참이
// 될 수 없었다. 그래서 그 두 끝을 각각 못박는다. 이 테스트가 없으면 C1 을 되돌리는
// 한 줄짜리 뮤테이션이 684개 테스트를 전부 초록으로 통과한다(재리뷰에서 실측).
test("npc:come-to-player always carries a real caller socket id", () => {
  const src = readFileSync(path.join(repoRoot, "src/server/npc-coordination.ts"), "utf8");
  assert.match(src, /targetPlayerId:\s*socket\.id/);
  const dead = [...src.matchAll(/emit\(\s*"npc:come-to-player"\s*,\s*\{([^}]*)\}/g)]
    .filter((m) => /targetPlayerId\s*:\s*(null|undefined)/.test(m[1]))
    .map((m) => m[1].trim());
  assert.deepEqual(
    dead,
    [],
    "npc:come-to-player 가 targetPlayerId 없이 나갑니다 — 클라이언트 조건이 " +
      "어떤 소켓에서도 참이 되지 않아 NPC 가 걸어오지 않습니다(무음 실패).",
  );
});

test("the map client still gates A* on being the caller", () => {
  const client = readFileSync(path.join(repoRoot, "src/app/game/GamePageClient.tsx"), "utf8");
  assert.ok(
    /data\.targetPlayerId\s*===\s*socketInstance\.id/.test(client),
    "npc:come-to-player 리스너가 호출자 판정을 잃었습니다 — 조건이 늘 거짓이면 아무도 " +
      "경로탐색을 돌리지 않고, 늘 참이면 모든 클라이언트가 같은 NPC 를 각자 움직입니다.",
  );
});

// 자유채팅 런타임은 첫 지명 때의 참가자 목록을 채널 수명 내내 들고 산다(회의 브로커와
// 달리 종료 시점이 없다). NPC 가 추가·수정·해고될 때 캐시를 버리지 않으면 해고된 NPC 가
// 계속 대답하고 새 NPC 는 불러도 오지 않는다 — 에러가 아니라 "왜 아직 대답하지" 로만
// 드러나므로 배선 자체를 붙들어 둔다.
test("every npc:broadcast-* handler drops the room runtime cache", () => {
  const src = readFileSync(path.join(repoRoot, "src/server/socket-handlers.ts"), "utf8");
  for (const event of ["npc:broadcast-add", "npc:broadcast-update", "npc:broadcast-remove"]) {
    const start = src.indexOf(`socket.on("${event}"`);
    assert.notEqual(start, -1, `socket-handlers.ts 에 ${event} 핸들러가 없습니다.`);
    // 창을 **그 핸들러 본문으로** 잘라야 한다. 고정 길이로 자르면 창이 다음
    // socket.on 까지 넘어가 옆 갈래의 delete 를 보고 통과한다 — 실제로 첫 판이
    // 그랬고, update 갈래의 무효화를 지워도 빨개지지 않았다.
    const next = src.indexOf("socket.on(", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert.ok(
      /invalidateRoomRuntimesForChannel\(/.test(body),
      `${event} 가 방 런타임 캐시를 버리지 않습니다 — 해고된 NPC 가 계속 대답합니다.`,
    );
  }
});

// crew-office: Hermes 게이트웨이·프로필·자동화 폴러는 걷어냈다. 그 사건 이름이 소켓 서버에 되살아나지 않게 막는다.
test("Hermes 자동화 소켓 이벤트는 소켓 서버에 없다", () => {
  const src = readFileSync(path.join(repoRoot, "src/server/socket-handlers.ts"), "utf8");
  for (const name of ["kanban:event", "cron:event", "npc:working", "artifact:event"]) {
    assert.ok(!src.includes(`"${name}"`), `${name} 이 socket-handlers 에 되살아났습니다`);
  }
  assert.doesNotMatch(src, /startAutomationPollers|getWorkingSnapshot|hermes-dispatch/);
});

// DM 을 대화 목록에 올린 배선(카드: "직원과의 DM 이 대화 목록에 없다").
//
// 서버가 목록을 돌려줘도 클라이언트에 리스너가 없으면 목록은 영원히 비어 있고, 테스트는
// 초록인 채로 결함이 되살아난다 — 이 파일이 이미 C1 에서 겪은 모양이다.
test("npc:dm-threads 는 서버 핸들러와 맵 클라이언트 리스너가 함께 있다", () => {
  const events = socketEventsIn(...HANDLER_FILES);
  assert.ok(
    events.includes("npc:dm-threads"),
    '"npc:dm-threads" 핸들러가 없습니다 — 대화 목록에 DM 줄을 채울 데이터가 오지 않습니다.',
  );
  const client = readFileSync(path.join(repoRoot, "src/app/game/GamePageClient.tsx"), "utf8");
  assert.ok(
    /socketInstance\.on\(\s*"npc:dm-threads"/.test(client),
    "서버가 npc:dm-threads 를 돌려주지만 맵 클라이언트에 리스너가 없습니다 — 죽은 배선입니다.",
  );
  assert.ok(
    /emit\(\s*"npc:dm-threads"/.test(client),
    "클라이언트가 npc:dm-threads 를 요청하지 않습니다 — 목록이 비어 있게 됩니다.",
  );
});

// 단테 지시: 목록에서 여는 것만으로는 호출하지 않고 **보내는 시점에** 호출한다.
// 이 두 줄이 갈라지면 (a) 열자마자 직원이 걸어오거나 (b) 보내도 아무도 오지 않는다.
test("DM 은 열 때가 아니라 보낼 때 직원을 호출한다", () => {
  const client = readFileSync(path.join(repoRoot, "src/app/game/GamePageClient.tsx"), "utf8");
  const openHandler = client.slice(
    client.indexOf("const handleSelectNpc = useCallback"),
    client.indexOf("const handleDialogSend = useCallback"),
  );
  assert.ok(openHandler.length > 0, "handleSelectNpc / handleDialogSend 를 찾지 못했습니다");
  assert.equal(
    /npc:call|approach-and-interact/.test(openHandler),
    false,
    "DM 을 여는 것만으로 직원을 호출하고 있습니다 — 여는 것은 읽기뿐이어야 합니다.",
  );
  const sendHandler = client.slice(
    client.indexOf("const handleDialogSend = useCallback"),
    client.indexOf("const handleRoomSend = useCallback"),
  );
  assert.match(
    sendHandler,
    /needsCallBeforeDmSend[\s\S]*"npc:call"/,
    "DM 을 보낼 때 직원을 호출하지 않습니다 — 목록에서 연 대화는 아무도 대답하지 않습니다.",
  );
});
