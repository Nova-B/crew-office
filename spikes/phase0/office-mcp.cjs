// Phase 0: 의존성 없는 최소 stdio MCP 서버.
// 도구 `ask(to, question, delay_s)` 는 delay_s 초 기다렸다가 가짜 동료 답을 돌려준다.
// 목적: 두 CLI가 오래 걸리는 MCP 도구 호출을 얼마나 기다리는지 / 언제 끊는지 측정.
const fs = require("node:fs");
const path = require("node:path");

const LOG = path.join(__dirname, "logs", "mcp-server.log");
const tag = process.env.OFFICE_EMPLOYEE || "unknown";
const log = (msg) =>
  fs.appendFileSync(LOG, `${new Date().toISOString()} [${tag} pid=${process.pid}] ${msg}\n`);

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const TOOLS = [
  {
    name: "ask",
    description:
      "Ask a colleague in the office a question and wait for their answer. Returns the colleague's reply.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Colleague name" },
        question: { type: "string" },
        delay_s: { type: "number", description: "Test only: seconds to wait before answering" },
      },
      required: ["to", "question"],
    },
  },
];

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    log(`initialize client=${JSON.stringify(params?.clientInfo)} proto=${params?.protocolVersion}`);
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "office", version: "0.0.1" },
      },
    });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/call") {
    const args = params?.arguments ?? {};
    const delay = Number(args.delay_s ?? 0);
    const started = Date.now();
    log(`ask START id=${id} to=${args.to} delay_s=${delay} q=${JSON.stringify(args.question)}`);
    await new Promise((r) => setTimeout(r, delay * 1000));
    const text = `${args.to} says: the answer is PELICAN-${Math.round(delay)}`;
    log(`ask DONE id=${id} waited_ms=${Date.now() - started}`);
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
  }
  if (method?.startsWith("notifications/")) {
    log(`notification ${method} ${JSON.stringify(params ?? {})}`);
    return;
  }
  if (id !== undefined)
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch (e) {
      log(`parse error ${e.message}`);
    }
  }
});
process.stdin.on("end", () => log("stdin closed (client disconnected)"));
log("server started");
