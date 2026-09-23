// Phase 0: 셸 없이 claude.exe 직접 실행 + 도구 대기 중 강제 종료 → MCP 서버·세션 상태 확인
const { spawn } = require("node:child_process");
const path = require("node:path");
const exe = path.join(process.env.APPDATA, "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe");
const child = spawn(exe, ["-p", "--model", "haiku", "--mcp-config", path.join(__dirname, "mcp-claude.json"),
  "--strict-mcp-config", "--allowedTools", "mcp__office__ask", "--output-format", "stream-json", "--verbose"],
  { cwd: path.join(__dirname, "work"), shell: false });
child.stdin.end("Use the office ask tool: ask 'Bob' the question 'status?' with delay_s 60. Then reply with what Bob said.");
let sid = null, buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  for (const line of buf.split("\n").slice(0, -1)) {
    try { const j = JSON.parse(line); sid ??= j.session_id;
      if (j.type === "assistant") for (const c of j.message.content) if (c.type === "tool_use") console.log(`tool_use ${c.name} at ${new Date().toISOString()}`);
    } catch {}
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
setTimeout(() => { console.log(`killing at ${new Date().toISOString()} sid=${sid}`); child.kill(); }, 25000);
child.on("close", (code, sig) => console.log(`closed code=${code} sig=${sig} sid=${sid}`));
