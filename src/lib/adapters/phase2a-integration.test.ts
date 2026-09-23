/**
 * Phase 2A Integration Tests — CLI Adapter Pipeline
 *
 * Verifies the complete CLI adapter stack:
 * 1. All 4 CLI adapters instantiate and have correct types
 * 2. buildArgs produces correct flags for each adapter
 * 3. WorkspaceManager creates correct persona files per adapter
 * 4. SubprocessPool executes real subprocesses
 * 5. CliBaseAdapter end-to-end with a TestAdapter
 * 6. Adapter registry holds all adapters
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { AdapterRegistry } from "./types";
import { ClaudeAdapter } from "./claude-adapter";
import { CodexAdapter } from "./codex-adapter";
import { GeminiAdapter } from "./gemini-adapter";
import { WorkspaceManager } from "./workspace-manager";
import { SubprocessPool } from "./subprocess-pool";

// Dynamic import for OpenCodeAdapter (may be named OpencodeAdapter)
let OpenCodeAdapterClass: new () => InstanceType<typeof GeminiAdapter>;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./opencode-adapter");
  OpenCodeAdapterClass = mod.OpenCodeAdapter || mod.OpencodeAdapter;
} catch {
  // Will skip opencode tests if not found
}

// ---------------------------------------------------------------------------
// 1. All CLI adapters instantiate with correct types
// ---------------------------------------------------------------------------

describe("Phase2A: Adapter instantiation", () => {
  test("ClaudeAdapter has type 'claude'", () => {
    const adapter = new ClaudeAdapter();
    assert.equal(adapter.type, "claude");
  });

  test("CodexAdapter has type 'codex'", () => {
    const adapter = new CodexAdapter();
    assert.equal(adapter.type, "codex");
  });

  test("GeminiAdapter has type 'gemini'", () => {
    const adapter = new GeminiAdapter();
    assert.equal(adapter.type, "gemini");
    assert.equal(adapter.cliCommand, "gemini");
  });

  test("OpenCodeAdapter has type 'opencode'", () => {
    if (!OpenCodeAdapterClass) {
      assert.ok(true, "OpenCodeAdapter not available — skipping");
      return;
    }
    const adapter = new OpenCodeAdapterClass();
    assert.ok(["opencode", "openCode"].includes(adapter.type));
  });
});

// ---------------------------------------------------------------------------
// 2. buildArgs for each adapter
// ---------------------------------------------------------------------------

describe("Phase2A: buildArgs output", () => {
  // Claude·Codex 의 인자 계약은 cli-session-adapter.test.ts 가 본다(crew-office: 권한 확인을 끄는 옵션을 뺐다).
  test("ClaudeAdapter args keep stream-json with --verbose and drop skip-permissions", () => {
    const args = new ClaudeAdapter().buildArgs({
      model: "claude-sonnet-4-20250514",
      resumeRef: "s-1",
    });
    assert.ok(args.includes("stream-json") && args.includes("--verbose"));
    assert.ok(!args.some((a) => a.includes("dangerously")));
    assert.ok(args.includes("claude-sonnet-4-20250514") && args.includes("s-1"));
  });

  test("CodexAdapter args use exec --json without the bypass flag", () => {
    const args = new CodexAdapter().buildArgs({});
    assert.equal(args[0], "exec");
    assert.ok(args.includes("--json"));
    assert.ok(!args.some((a) => a.includes("bypass")));
  });

  test("GeminiAdapter default args include yolo approval mode", () => {
    const adapter = new GeminiAdapter();
    const args = adapter.buildArgs({ sessionKey: "k", prompt: "p" });
    assert.ok(
      args.some((a) => a === "yolo" || a.includes("yolo")),
      "should include yolo approval mode",
    );
  });

  test("GeminiAdapter adds -m model when specified", () => {
    const adapter = new GeminiAdapter();
    const args = adapter.buildArgs({ sessionKey: "k", prompt: "p", model: "gemini-2.5-pro" });
    assert.ok(args.includes("-m") || args.includes("--model"), "should include model flag");
    assert.ok(args.includes("gemini-2.5-pro"), "should include model name");
  });
});

// ---------------------------------------------------------------------------
// 3. WorkspaceManager persona files per adapter
// ---------------------------------------------------------------------------

describe("Phase2A: WorkspaceManager persona per adapter", () => {
  let tmpDir: string;

  test("creates CLAUDE.md for claude adapter", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-test-"));
    const wm = new WorkspaceManager();

    await wm.writePersonaFiles(
      tmpDir,
      "claude",
      { identity: "You are a developer", soul: "Be helpful" },
      "en",
    );

    const content = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(content.includes("You are a developer"));
    assert.ok(content.includes("Be helpful"));
    await fs.rm(tmpDir, { recursive: true });
  });

  test("creates AGENTS.md for codex adapter", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-test-"));
    const wm = new WorkspaceManager();

    await wm.writePersonaFiles(
      tmpDir,
      "codex",
      { identity: "You are a coder", soul: "Be precise" },
      "en",
    );

    const content = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    assert.ok(content.includes("You are a coder"));
    await fs.rm(tmpDir, { recursive: true });
  });

  test("creates GEMINI.md for gemini adapter", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-test-"));
    const wm = new WorkspaceManager();

    await wm.writePersonaFiles(
      tmpDir,
      "gemini",
      { identity: "You are an analyst", soul: "Be thorough" },
      "en",
    );

    const content = await fs.readFile(path.join(tmpDir, "GEMINI.md"), "utf-8");
    assert.ok(content.includes("You are an analyst"));
    await fs.rm(tmpDir, { recursive: true });
  });

  test("no-op for openclaw adapter", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-test-"));
    const wm = new WorkspaceManager();

    await wm.writePersonaFiles(tmpDir, "openclaw", { identity: "test", soul: "test" }, "en");

    const files = await fs.readdir(tmpDir);
    assert.equal(files.length, 0, "openclaw should not create any files");
    await fs.rm(tmpDir, { recursive: true });
  });

  test("all adapter persona files can coexist in same directory", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-test-"));
    const wm = new WorkspaceManager();

    await wm.writePersonaFiles(tmpDir, "claude", { identity: "Claude persona", soul: "s" }, "en");
    await wm.writePersonaFiles(tmpDir, "codex", { identity: "Codex persona", soul: "s" }, "en");
    await wm.writePersonaFiles(tmpDir, "gemini", { identity: "Gemini persona", soul: "s" }, "en");

    const files = (await fs.readdir(tmpDir)).sort();
    assert.deepEqual(files, ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

    // Each file has its own content
    const claude = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    const agents = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    const gemini = await fs.readFile(path.join(tmpDir, "GEMINI.md"), "utf-8");
    assert.ok(claude.includes("Claude persona"));
    assert.ok(agents.includes("Codex persona"));
    assert.ok(gemini.includes("Gemini persona"));
    await fs.rm(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// 4. SubprocessPool real execution
// ---------------------------------------------------------------------------

describe("Phase2A: SubprocessPool real execution", () => {
  test("executes node -e and captures stdout", async () => {
    const pool = new SubprocessPool();
    const result = await pool.execute({
      command: "node",
      args: ["-e", 'process.stdout.write("phase2a-test")'],
      timeoutMs: 5000,
    });
    assert.equal(result.fullOutput, "phase2a-test");
    assert.equal(result.exitCode, 0);
  });

  test("pipes stdin to subprocess", async () => {
    const pool = new SubprocessPool();
    const result = await pool.execute({
      command: "node",
      args: [
        "-e",
        'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(d.toUpperCase()))',
      ],
      stdin: "hello adapters",
      timeoutMs: 5000,
    });
    assert.equal(result.fullOutput, "HELLO ADAPTERS");
  });

  test("captures streaming onStdout callbacks", async () => {
    const pool = new SubprocessPool();
    const chunks: string[] = [];
    await pool.execute({
      command: "node",
      args: [
        "-e",
        'process.stdout.write("a");setTimeout(()=>process.stdout.write("b"),50);setTimeout(()=>process.stdout.write("c"),100)',
      ],
      onStdout: (chunk) => chunks.push(chunk),
      timeoutMs: 5000,
    });
    assert.ok(chunks.length >= 1, "should receive at least one chunk");
    assert.equal(chunks.join(""), "abc");
  });
});

// ---------------------------------------------------------------------------
// 5. Full registry with all adapters
// ---------------------------------------------------------------------------

describe("Phase2A: Full adapter registry", () => {
  test("registry holds every CLI adapter type", () => {
    const registry = new AdapterRegistry();
    registry.register(new ClaudeAdapter());
    registry.register(new CodexAdapter());
    registry.register(new GeminiAdapter());
    if (OpenCodeAdapterClass) {
      registry.register(new OpenCodeAdapterClass());
    }

    assert.ok(registry.has("claude"));
    assert.ok(registry.has("codex"));
    assert.ok(registry.has("gemini"));

    const installed = registry.listInstalled();
    assert.ok(installed.length >= 4);
  });

  test("each adapter implements NpcAdapter interface", async () => {
    const adapters = [new ClaudeAdapter(), new CodexAdapter(), new GeminiAdapter()];

    for (const adapter of adapters) {
      assert.ok(typeof adapter.type === "string", `${adapter.type} should have type`);
      assert.ok(typeof adapter.execute === "function", `${adapter.type} should have execute`);
      assert.ok(
        typeof adapter.testConnection === "function",
        `${adapter.type} should have testConnection`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. parseStreamChunk robustness
// ---------------------------------------------------------------------------

describe("Phase2A: parseStreamChunk robustness", () => {
  test("Gemini adapter handles JSON content", () => {
    const adapter = new GeminiAdapter();
    const result = adapter.parseStreamChunk('{"content":"gemini response"}');
    assert.ok(typeof result === "string");
  });

  test("All adapters handle empty string without error", () => {
    // Claude·Codex 는 parseLine 으로 바뀌었다 — cli-session-adapter.test.ts 참고.
    const adapters = [new GeminiAdapter()];
    for (const adapter of adapters) {
      const result = adapter.parseStreamChunk("");
      assert.ok(typeof result === "string", `${adapter.type} should handle empty string`);
    }
  });
});
