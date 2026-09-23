import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";

// 브리지를 실제로 띄워 JSON-RPC 로 말을 걸고, 도구 호출이 앱 엔드포인트로 넘어가는지 본다.
test("office MCP 브리지는 도구 목록을 주고, 호출을 토큰과 함께 메신저로 넘긴다", async () => {
  const received: unknown[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ text: "Dev: 42" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const child = spawn(process.execPath, [path.join(__dirname, "crew-office-mcp.cjs")], {
    env: { ...process.env, CREW_OFFICE_URL: `http://127.0.0.1:${port}`, CREW_OFFICE_TOKEN: "t0k" },
  });
  const replies = new Map<number, Record<string, unknown>>();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (const line of buffer.split("\n").slice(0, -1)) {
      const msg = JSON.parse(line) as { id: number };
      replies.set(msg.id, msg);
    }
    buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
  });
  const rpc = (id: number, method: string, params?: unknown) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise<Record<string, unknown>>((resolve) => {
      const poll = setInterval(() => {
        if (replies.has(id)) {
          clearInterval(poll);
          resolve(replies.get(id)!);
        }
      }, 5);
    });
  };

  try {
    await rpc(1, "initialize", { protocolVersion: "2025-06-18" });
    const list = (await rpc(2, "tools/list")) as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      ["list_colleagues", "ask"],
    );
    const call = (await rpc(3, "tools/call", {
      name: "ask",
      arguments: { to: "Dev", question: "answer?" },
    })) as { result: { content: Array<{ text: string }>; isError: boolean } };
    assert.equal(call.result.content[0].text, "Dev: 42");
    assert.equal(call.result.isError, false);
    assert.deepEqual(received, [
      {
        url: "/api/crew/messenger",
        body: { token: "t0k", tool: "ask", arguments: { to: "Dev", question: "answer?" } },
      },
    ]);
  } finally {
    child.kill();
    server.close();
  }
});
