// crew-office: CLI 직원이 띄우는 stdio MCP 서버("office"). 도구 호출을 앱의 사내 메신저로 넘기기만 한다.
//
// Claude Code·Codex 가 이 파일을 `node crew-office-mcp.cjs` 로 띄운다(env: CREW_OFFICE_URL,
// CREW_OFFICE_TOKEN). 의존성 없는 최소 구현이다 — 두 CLI 와의 연결은 spikes/phase0 에서 실측했다.
"use strict";

const OFFICE_URL = process.env.CREW_OFFICE_URL || "";
const TOKEN = process.env.CREW_OFFICE_TOKEN || "";

const TOOLS = [
  {
    name: "list_colleagues",
    description: "List the colleagues (other AI employees) currently at work in this office.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ask",
    description:
      "Ask a colleague in the office a question and wait for their answer (up to a few minutes). " +
      "Use the colleague's name from list_colleagues.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Colleague name" },
        question: { type: "string", description: "What you want to ask" },
      },
      required: ["to", "question"],
    },
  },
];

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

async function callOffice(tool, args) {
  if (!OFFICE_URL || !TOKEN) return { text: "office 메신저가 연결되지 않았습니다.", isError: true };
  try {
    const res = await fetch(`${OFFICE_URL}/api/crew/messenger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, tool, arguments: args || {} }),
    });
    const data = await res.json().catch(() => null);
    if (!data || typeof data.text !== "string") {
      return { text: `office 메신저 응답 오류 (HTTP ${res.status})`, isError: true };
    }
    return data;
  } catch (error) {
    return { text: `office 메신저에 연결하지 못했습니다: ${error.message}`, isError: true };
  }
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "office", version: "0.1.0" },
      },
    });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/call") {
    const result = await callOffice(params && params.name, params && params.arguments);
    return send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: result.text }], isError: Boolean(result.isError) },
    });
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message).catch((error) => {
      if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(error) } });
      }
    });
  }
});
