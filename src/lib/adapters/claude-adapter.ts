import { CliSessionAdapter, type CliEvent, type CliTurnContext } from "./cli-session-adapter";

type ClaudeLine = {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  event?: {
    type?: string;
    content_block?: { type?: string; name?: string };
    delta?: { type?: string; text?: string };
  };
  message?: { content?: Array<{ type?: string }> | string };
};

/**
 * `claude -p --output-format stream-json --verbose --include-partial-messages` 출력 파서.
 * 이벤트 모양은 fixtures/claude-*.jsonl 이 실측 원본이다(Claude Code 2.1.280).
 */
export class ClaudeAdapter extends CliSessionAdapter {
  readonly type = "claude";

  buildArgs({ resumeRef, instructions, model, officeMcp }: CliTurnContext): string[] {
    // --verbose 는 선택이 아니다: -p 에서 stream-json 은 --verbose 없이 거부된다.
    // 권한 확인을 끄는 옵션은 쓰지 않는다 — -p 의 기본 권한 모드는 읽기 도구만 통과시킨다.
    // 직원별 권한 프로필(기획안 §5.2)이 생기면 그때 넓힌다.
    const args = [
      "-p",
      "-",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (model) args.push("--model", model);
    if (resumeRef) args.push("--resume", resumeRef);
    if (instructions) args.push("--append-system-prompt", instructions);
    if (officeMcp) {
      // 인라인 JSON 으로 넘긴다(파일 없이). --strict-mcp-config 로 사용자 전역 MCP 서버는 끌어오지 않는다 —
      // 직원에게는 의도한 서버만 보여야 한다(기획안 §5.3). office 도구는 승인 없이 부르게 연다.
      const { command, args: serverArgs, env } = officeMcp;
      args.push(
        "--mcp-config",
        JSON.stringify({ mcpServers: { office: { command, args: serverArgs, env } } }),
        "--strict-mcp-config",
        "--allowedTools",
        officeMcp.tools.map((tool) => `mcp__office__${tool}`).join(","),
      );
    }
    return args;
  }

  parseLine(line: string): CliEvent[] {
    let parsed: ClaudeLine;
    try {
      parsed = JSON.parse(line) as ClaudeLine;
    } catch {
      return [];
    }

    switch (parsed.type) {
      case "system":
        // 세션 ID 는 init 에서만 받는다. 결과 이벤트의 session_id 는 재개 실패 때도 요청한 ID 를 그대로 싣는다.
        return parsed.subtype === "init" && parsed.session_id
          ? [{ kind: "session", id: parsed.session_id }]
          : [];
      case "stream_event": {
        const event = parsed.event;
        if (event?.type === "content_block_start") {
          if (event.content_block?.type === "text") return [{ kind: "text_block" }];
          if (event.content_block?.type === "tool_use" && event.content_block.name)
            return [{ kind: "tool", name: event.content_block.name }];
          return [];
        }
        if (event?.type === "content_block_delta" && event.delta?.type === "text_delta")
          return [{ kind: "text", text: event.delta.text ?? "" }];
        return [];
      }
      case "user": {
        const content = parsed.message?.content;
        return Array.isArray(content) && content.some((c) => c.type === "tool_result")
          ? [{ kind: "tool_done" }]
          : [];
      }
      case "result":
        return [
          {
            kind: "result",
            isError: parsed.is_error === true,
            text: parsed.result,
            errors: parsed.errors,
          },
        ];
      default:
        return [];
    }
  }
}
