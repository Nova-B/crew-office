import { CliSessionAdapter, type CliEvent, type CliTurnContext } from "./cli-session-adapter";

type CodexItem = {
  type?: string;
  text?: string;
  command?: string;
  server?: string;
  tool?: string;
};

type CodexLine = {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  error?: { message?: string };
};

function toolOf(item: CodexItem): { name: string; preview?: string } | null {
  switch (item.type) {
    case "command_execution":
      return { name: "shell", preview: item.command };
    case "mcp_tool_call":
      return { name: `mcp__${item.server}__${item.tool}` };
    case "agent_message":
    case "reasoning":
    case undefined:
      return null;
    default:
      // file_change, web_search 등 — 이름만으로도 활동 표시에 충분하다.
      return { name: item.type };
  }
}

/**
 * `codex exec --json` 출력 파서. 이벤트 모양은 fixtures/codex-*.jsonl 이 실측 원본이다(codex-cli 0.156.1).
 * Codex 는 글자 단위 델타를 내보내지 않는다 — 메시지가 완성될 때 한 덩어리로 온다.
 */
export class CodexAdapter extends CliSessionAdapter {
  readonly type = "codex";

  buildArgs({ resumeRef, instructions, model }: CliTurnContext): string[] {
    const args = resumeRef ? ["exec", "resume", resumeRef] : ["exec"];
    // 직원 작업 폴더는 git 저장소가 아닐 수 있다.
    args.push("--json", "--skip-git-repo-check");
    // `exec resume` 에는 --sandbox 가 없어 -c 로 통일한다. 1단계 기본값은 읽기 전용(기획안 §5.2).
    args.push("-c", 'sandbox_mode="read-only"');
    if (model) args.push("--model", model);
    // developer_instructions 는 실측으로 시스템 지시 자리에 들어가는 것을 확인했다.
    // 값은 TOML 로 파싱된다 — JSON 문자열은 그대로 TOML 기본 문자열이다.
    if (instructions) args.push("-c", `developer_instructions=${JSON.stringify(instructions)}`);
    args.push("-");
    return args;
  }

  parseLine(line: string): CliEvent[] {
    let parsed: CodexLine;
    try {
      parsed = JSON.parse(line) as CodexLine;
    } catch {
      return [];
    }

    switch (parsed.type) {
      case "thread.started":
        return parsed.thread_id ? [{ kind: "session", id: parsed.thread_id }] : [];
      case "item.started": {
        const tool = parsed.item && toolOf(parsed.item);
        return tool ? [{ kind: "tool", ...tool }] : [];
      }
      case "item.completed": {
        const item = parsed.item;
        if (item?.type === "agent_message")
          return [{ kind: "text_block" }, { kind: "text", text: item.text ?? "" }];
        return item && toolOf(item) ? [{ kind: "tool_done" }] : [];
      }
      case "turn.completed":
        return [{ kind: "result", isError: false }];
      case "turn.failed":
        return [
          {
            kind: "result",
            isError: true,
            errors: parsed.error?.message ? [parsed.error.message] : undefined,
          },
        ];
      default:
        return [];
    }
  }
}
