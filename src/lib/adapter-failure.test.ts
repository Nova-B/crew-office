import assert from "node:assert/strict";
import test from "node:test";

import { classifyGatewayFailure, gatewayFailureMessageCode } from "./adapter-failure";

test("연결이 끊기면 도달 불가로 분류한다", () => {
  assert.equal(classifyGatewayFailure(new TypeError("fetch failed")), "unreachable");
});

test("중단된 요청은 도달 불가가 아니라 타임아웃으로 분류한다", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(classifyGatewayFailure(abort), "timeout");
  assert.equal(classifyGatewayFailure(new Error("This operation was aborted")), "timeout");
});

test("소켓 타임아웃 cause 코드는 타임아웃으로 분류한다", () => {
  const err = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
  });
  assert.equal(classifyGatewayFailure(err), "timeout");
});

test("연결 거부 cause 코드는 도달 불가로 분류한다", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"]) {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code } });
    assert.equal(classifyGatewayFailure(err), "unreachable", code);
  }
});

test("구조화된 정보가 전혀 없으면 알 수 없는 오류로 분류한다", () => {
  assert.equal(classifyGatewayFailure(new Error("boom")), "unknown");
  assert.equal(classifyGatewayFailure(null), "unknown");
  assert.equal(classifyGatewayFailure("something"), "unknown");
});

test("문구로 인증 실패를 알아본다", () => {
  assert.equal(classifyGatewayFailure(new Error("invalid api key")), "auth");
  assert.equal(classifyGatewayFailure(new Error("Unauthorized")), "auth");
});

test("분류 결과가 npc:response 메시지 코드로 옮겨진다", () => {
  assert.equal(gatewayFailureMessageCode(new TypeError("fetch failed")), "gateway_unreachable");
  assert.equal(gatewayFailureMessageCode(new Error("Unauthorized")), "gateway_auth_failed");
  assert.equal(gatewayFailureMessageCode(new Error("boom")), "gateway_unknown_error");
});
