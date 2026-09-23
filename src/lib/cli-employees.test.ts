import assert from "node:assert/strict";
import test from "node:test";

import {
  CLI_EMPLOYEE_LIMITS,
  isCliEmployeeAdapter,
  validateCliEmployeeInput,
} from "./cli-employees";

test("claude·codex 만 CLI 직원이다", () => {
  assert.ok(isCliEmployeeAdapter("claude"));
  assert.ok(isCliEmployeeAdapter("codex"));
  for (const other of ["hermes", "gemini", "", undefined, null, 1]) {
    assert.equal(isCliEmployeeAdapter(other), false);
  }
});

test("이름은 다듬고, 빈 모델·인격은 null 로 둔다", () => {
  const out = validateCliEmployeeInput({
    name: " Mina ",
    adapterType: "codex",
    model: " ",
    soul: "",
  });
  assert.ok(out.ok);
  assert.equal(out.value.name, "Mina");
  assert.equal(out.value.model, null);
  assert.equal(out.value.soul, null);
  assert.ok(out.value.appearance.officeLookId, "외형이 없으면 기본 룩");
});

test("틀린 입력은 이유와 함께 거절한다", () => {
  const cases: Array<[unknown, string]> = [
    [null, "invalid_body"],
    [{ adapterType: "claude" }, "name_required"],
    [{ name: "x".repeat(CLI_EMPLOYEE_LIMITS.name + 1), adapterType: "claude" }, "name_too_long"],
    [{ name: "Mina", adapterType: "hermes" }, "invalid_adapter"],
    [{ name: "Mina", adapterType: "claude", model: "m".repeat(81) }, "model_too_long"],
    [
      { name: "Mina", adapterType: "claude", soul: "s".repeat(CLI_EMPLOYEE_LIMITS.soul + 1) },
      "soul_too_long",
    ],
  ];
  for (const [input, error] of cases) {
    assert.deepEqual(validateCliEmployeeInput(input), { ok: false, error });
  }
});
