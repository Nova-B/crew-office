// Phase 1: 새 CLI 어댑터를 실제 Claude Code·Codex 로 돌려 본다(앱 없이).
// 실행: npx tsx spikes/phase1/adapter-live.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ClaudeAdapter } from "../../src/lib/adapters/claude-adapter";
import { CodexAdapter } from "../../src/lib/adapters/codex-adapter";
import type { CliSessionAdapter } from "../../src/lib/adapters/cli-session-adapter";

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function codexProcesses(): number {
  if (process.platform !== "win32") return 0;
  const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq codex.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  return out.split(/\r?\n/).filter((l) => l.startsWith('"codex.exe"')).length;
}

async function twoTurns(name: string, adapter: CliSessionAdapter, model?: string) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `crew-live-${name}-`));
  const instructions = "Your name is Mina. You are a cheerful planner at Crew Office.";
  const activity: string[] = [];
  const first = await adapter.execute({
    sessionKey: `${name}-dm`,
    prompt: "Remember the code word HERON-7731. Also tell me your name. One short sentence.",
    instructions,
    model,
    cwd,
    resumeSessionRef: null,
    onToolProgress: (tool) => activity.push(tool),
  });
  log(name, "turn1 session", first.session.sessionRef, "|", first.response.replace(/\s+/g, " "));

  // 메모리 캐시가 아니라 DB 에서 읽어 온 것처럼 명시적으로 넘긴다(새 어댑터 인스턴스).
  const fresh = name === "claude" ? new ClaudeAdapter() : new CodexAdapter();
  const second = await fresh.execute({
    sessionKey: `${name}-dm`,
    prompt: "What code word did I give you? Reply with just the word.",
    instructions,
    model,
    cwd,
    resumeSessionRef: first.session.sessionRef,
  });
  const same = second.session.sessionRef === first.session.sessionRef;
  log(name, "turn2 same session:", same, "| recalled:", /HERON-7731/.test(second.response), "|", second.response.trim());
  return { cwd, ok: same && /HERON-7731/.test(second.response) && /Mina/i.test(first.response) };
}

async function main() {
  const results: Record<string, boolean> = {};
  for (const [name, adapter, model] of [
    ["claude", new ClaudeAdapter(), "haiku"],
    ["codex", new CodexAdapter(), undefined],
  ] as const) {
    const health = await adapter.testConnection({});
    log(name, "testConnection:", health.status, health.version ?? health.message);
    const r = await twoTurns(name, adapter, model);
    results[name] = r.ok;
  }

  // 취소: Codex 는 node 가 codex.exe 를 다시 띄운다. node 만 죽이면 codex.exe 가 남는지 본다.
  const before = codexProcesses();
  const codex = new CodexAdapter();
  const running = codex
    .execute({
      sessionKey: "abort-test",
      prompt: "Run the shell command: powershell -Command Start-Sleep 60 ; then say done.",
      resumeSessionRef: null,
      cwd: os.tmpdir(),
    })
    .then(
      () => "resolved",
      (e: Error) => `rejected: ${e.message.slice(0, 120)}`,
    );
  await new Promise((r) => setTimeout(r, 12_000));
  const during = codexProcesses();
  await codex.abort("abort-test");
  log("abort ->", await running);
  await new Promise((r) => setTimeout(r, 3_000));
  const after = codexProcesses();
  log(`codex.exe processes before=${before} during=${during} after=${after}`);
  results.codexAbortCleansUp = after <= before;

  log("RESULTS", JSON.stringify(results));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
