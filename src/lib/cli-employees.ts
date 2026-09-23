// crew-office: Hermes 프로필 없이 이 PC 의 Claude Code·Codex CLI 로 일하는 직원.
// 이 파일은 DB 를 모른다 — 고용 화면(클라이언트)과 API 가 같은 규칙을 쓴다. 저장은 cli-employee-hire.ts.

import { normalizeOfficeAppearance, defaultOfficeAppearance } from "@/game/three/office-appearance";

export const CLI_EMPLOYEE_ADAPTERS = ["claude", "codex"] as const;
export type CliEmployeeAdapter = (typeof CLI_EMPLOYEE_ADAPTERS)[number];

export function isCliEmployeeAdapter(value: unknown): value is CliEmployeeAdapter {
  return typeof value === "string" && (CLI_EMPLOYEE_ADAPTERS as readonly string[]).includes(value);
}

/**
 * crew-office: Hermes·OpenClaw 는 걷어냈다. 그 어댑터로 남은 옛 NPC(와 이관 표시 "unbound")는 대화할 수
 * 없으니 "다시 연결(고용)해야 한다"(`npc_unbound`)로 알린다. 모르는 어댑터는 `unsupported_adapter` 다.
 */
const RETIRED_NPC_ADAPTERS: readonly string[] = ["unbound", "hermes", "openclaw"];

export function isRetiredNpcAdapter(value: unknown): boolean {
  return typeof value === "string" && RETIRED_NPC_ADAPTERS.includes(value);
}

export const CLI_EMPLOYEE_LIMITS = { name: 40, model: 80, soul: 8_000 } as const;

export interface CliEmployeeInput {
  name: string;
  adapterType: CliEmployeeAdapter;
  /** 비우면 CLI 의 기본 모델. */
  model: string | null;
  /** 성격·역할. 시스템 지시의 persona 층으로 실린다(npc-prompt-layers.ts). */
  soul: string | null;
  appearance: ReturnType<typeof defaultOfficeAppearance>;
}

export type CliEmployeeValidation =
  | { ok: true; value: CliEmployeeInput }
  | {
      ok: false;
      error:
        | "invalid_body"
        | "name_required"
        | "name_too_long"
        | "invalid_adapter"
        | "model_too_long"
        | "soul_too_long";
    };

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validateCliEmployeeInput(body: unknown): CliEmployeeValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const raw = body as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "name_required" };
  if (name.length > CLI_EMPLOYEE_LIMITS.name) return { ok: false, error: "name_too_long" };
  if (!isCliEmployeeAdapter(raw.adapterType)) return { ok: false, error: "invalid_adapter" };

  const model = optionalText(raw.model);
  if (model && model.length > CLI_EMPLOYEE_LIMITS.model)
    return { ok: false, error: "model_too_long" };
  const soul = optionalText(raw.soul);
  if (soul && soul.length > CLI_EMPLOYEE_LIMITS.soul) return { ok: false, error: "soul_too_long" };

  return {
    ok: true,
    value: {
      name,
      adapterType: raw.adapterType,
      model,
      soul,
      appearance: normalizeOfficeAppearance(raw.appearance) ?? defaultOfficeAppearance(),
    },
  };
}
