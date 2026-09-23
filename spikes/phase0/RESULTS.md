# Phase 0 검증 스파이크 결과 (2026-09-23)

제품 코드 없이 이 PC(Windows 11, Node 22.17.0)에서 두 CLI를 직접 실행해 확인했다.
버전: Claude Code 2.1.280 (`--model haiku`로 테스트), codex-cli 0.156.1 (`model_reasoning_effort=low`).
원본 로그는 `logs/`에 있다.

## 요약

| 항목 | Claude Code | Codex | 결론 |
|---|---|---|---|
| 창 없이 새 세션 실행 | ✅ `claude -p --output-format stream-json --verbose` | ✅ `codex exec --json -` | 둘 다 JSON 이벤트 스트림 |
| 세션 ID 얻기 | `system/init` 이벤트와 `result` 이벤트의 `session_id` | 첫 이벤트 `thread.started`의 `thread_id` | 정규식 말고 이벤트 필드로 얻는다 |
| 재개 후 기억 | ✅ `--resume <id>` → `ZEBRA-4417` 기억, 같은 ID | ✅ `codex exec resume <id> --json -` → `OTTER-2291` 기억, 같은 ID | 직원 = 세션 가능 |
| 없는 ID로 재개 | 종료 코드 1, `result.is_error:true`, **`session_id`에 잘못된 ID가 그대로** 들어감 | 종료 코드 1, stderr `no rollout found`, `thread.started` 없음 | 종료 코드와 `is_error`를 반드시 확인 |
| 사용량 | `result.usage`, `total_cost_usd`, `modelUsage` | `turn.completed.usage` (토큰만, 비용 없음) | Codex는 비용 환산 불가 → 턴·시간 상한 필요 |
| MCP 연결 | ✅ `--mcp-config <json> --strict-mcp-config --allowedTools mcp__office__ask` | ✅ `-c mcp_servers.office.*` | 둘 다 앱이 띄운 로컬 MCP 서버에 붙는다 |
| MCP 도구 승인 | `--allowedTools`로 허용하면 바로 실행 | ❌ 기본값에서는 **`MCP tool call requires approval, but approval policy is never`로 실패** → `-c mcp_servers.office.tools.ask.approval_mode="approve"`로 해결 | Codex는 도구별 승인 설정이 필수 |
| MCP 도구 노출 | 처음엔 숨겨져 있어서 `ToolSearch`로 찾은 뒤 호출 (턴 1개 추가) | 바로 호출 | Claude는 지연·토큰이 조금 더 든다 |
| 긴 대기 (`ask`) | ✅ 150초 대기 후 답 수신 | ✅ 90초 대기 후 답 수신 | 수 분 이내 동기 `ask`는 가능. 상한은 미측정 |
| 도구 대기 중 강제 종료 | MCP 서버 자식 프로세스도 함께 종료됨(고아 없음). 재개하면 "도구 호출이 중단됐다"고 인지 | 미측정 | 취소 후 재개 가능 |
| Node `spawn` (`shell:false`) | ❌ `claude` → `ENOENT`, `claude.cmd` → `EINVAL` | ❌ `codex` → `ENOENT` | **deskrpg 어댑터는 이 PC에서 그대로 안 돈다** |
| 해결책 | ✅ `node_modules/@anthropic-ai/claude-code/bin/claude.exe` 직접 실행 | ✅ `node <npm>/node_modules/@openai/codex/bin/codex.js` 직접 실행 | 셸을 거치지 않으니 인자 따옴표 문제·주입 위험도 없음 |
| `HOME`/`USERPROFILE` 교체 | ❌ `Not logged in · Please run /login` | ❌ `401 Unauthorized` (`CODEX_HOME`도 필요) | deskrpg의 사용자별 HOME 교체는 로그인을 깬다 |
| 세션 저장 위치 | `~/.claude/projects/<작업폴더 경로>/<id>.jsonl` — **작업 폴더별** | `~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl` | 대화형 CLI와 같은 저장소 → 인계 가능성 높음 |

## 설계에 반영할 것

1. **실행**: 두 CLI 모두 셸 없이 실제 실행 파일을 띄운다. 설치 경로는 `npm root -g`로 찾고, 못 찾으면 `claude`/`codex` 명령을 PATH에서 찾아 `where`로 해석한다.
2. **세션 ID**: Claude는 `system/init`, Codex는 `thread.started`에서 받는다. 종료 코드 0이고 (Claude는) `is_error:false`일 때만 저장한다. 정규식으로 추출하거나 임의 UUID를 넣는 방식은 쓰지 않는다.
3. **Claude는 작업 폴더가 세션 키의 일부다.** 직원 작업 폴더를 바꾸면 이전 세션을 못 찾는다. 직원별 작업 폴더를 고정하고 DB에 함께 저장한다.
4. **Codex MCP**: 직원 세션마다 `-c mcp_servers.office.command/args/env`와 `tools.<도구>.approval_mode="approve"`를 넣는다. 직원 식별은 `env`(예: 직원별 토큰)로 한다. 사용자 전역 `~/.codex/config.toml`의 다른 MCP 서버도 함께 로드되는지는 아직 확인하지 않았다.
5. **인증**: HOME을 바꾸지 않는다. 직원 격리는 작업 폴더와 권한 모드로 한다.
6. **`ask`**: 150초까지는 동기 대기로 충분하다. 앱 쪽 제한 시간(예: 120초)을 두고, 넘으면 "접수됨"을 돌려준 뒤 비동기로 넘긴다.

## 아직 검증하지 않은 것

- **터미널 인계**: 대화형 `claude --resume <id>` / `codex resume <id>`로 이 세션들을 여는 건 사람이 직접 해 봐야 한다. 확인 방법: Windows Terminal에서 `spikes/phase0/work` 폴더로 이동 → `claude --resume b3cb7ced-ee8f-49f9-83a3-79d7cbca84fc` → 코드워드를 물어본다. Codex는 `codex resume 01a0cc9d-1f85-7be3-b67c-c8b57593215a`.
- Codex 도구 대기의 실제 상한(90초는 통과), Codex 강제 종료 후 재개.
- 권한 모드(`--permission-mode`, `--sandbox`)와 MCP 도구가 함께 있을 때의 동작.
- 동시에 여러 직원 세션을 띄웠을 때의 부하와 사용 한도.

## 사용량 (참고)

두 CLI 모두 API 키가 아니라 계정 로그인으로 실행했다(Claude init 이벤트 `apiKeySource:"none"`). 따라서 호출마다 요금이 청구되지 않고 **구독 사용 한도에서 차감**된다.

- Claude Haiku: 사용량이 든 호출 6회(모델에 닿지 않은 실패 2회는 0). `result.total_cost_usd`는 1회당 약 $0.02인데, `costBasis:"list"`, 즉 API 정가로 환산한 **추정치**이지 청구 금액이 아니다. 강제 종료한 1회는 결과 이벤트가 없어 추정치가 남지 않았다.
- Codex: 결과에 토큰 수만 나온다. 호출당 입력 1.5만~12.6만 토큰(대부분 캐시). 긴 대기 자체는 토큰을 쓰지 않지만 기본 컨텍스트가 커서 턴당 입력이 크다. Codex 로그인 방식(ChatGPT 계정 / API 키)은 확인하지 않았다.
- 이 프로젝트에서 관리할 대상은 금액보다 **사용 한도**다. 직원끼리 자동 대화는 한도를 빠르게 소모한다.
