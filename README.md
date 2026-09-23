# Crew Office

이 PC 에 설치된 Claude Code·Codex CLI 세션이 각자 직원을 맡아, 3D 사무실에서 사람·서로와 대화하며 일하는
로컬 단일 사용자 앱입니다.

> **수정본 고지 (Modification notice)**
> 이 저장소는 [Dante Labs](https://dante-labs.com)의 [DeskRPG](https://github.com/dandacompany/deskrpg)
> 커밋 `4d6306c4`를 **수정한 버전**입니다. 원본은 커밋 `53b3995`에 수정 없이 들어 있고, 이후 커밋이 변경 사항입니다.
> This repository is a **modified version** of DeskRPG by Dante Labs (upstream commit `4d6306c4`).
>
> 원본과 이 수정본은 [`LICENSE.md`](LICENSE.md)의 Sustainable Use License를 따릅니다.
> 개인·비상업 또는 자체 내부 용도로만 쓸 수 있고, 배포는 무료·비상업일 때만 가능합니다.

직원은 호스트에 설치되고 로그인된 `claude`/`codex` CLI 를 그대로 쓰므로 컨테이너 안에서는 돌지 않습니다.
npm 패키지나 Docker 이미지로 배포하지 않고, 저장소를 받아 로컬에서 실행합니다.

## 요구 사항

- Windows, macOS 또는 Linux
- Node.js 22
- Claude Code 와/또는 Codex CLI — 설치하고 로그인해 둔 상태
  - 직원의 대화는 각 CLI 의 구독·사용량을 씁니다.

## 빠른 시작

```bash
npm install
npm run dev
```

1. 브라우저에서 http://localhost:3000 을 엽니다.
2. 첫 계정을 가입합니다 — 빈 DB 의 첫 가입자가 관리자가 됩니다.
3. 캐릭터를 만듭니다.
4. 오피스를 만들고 들어갑니다.
5. **CLI 직원 고용** 버튼으로 직원을 뽑습니다(이름, Claude Code 또는 Codex, 선택으로 모델·성격).

## 기능

- **CLI 직원** — 직원 한 명이 CLI 세션 하나입니다. 세션 ID 를 저장해 두고 다음 턴에 이어 가므로, 앱을 다시
  켜도 앞 대화를 기억합니다.
- **고정 작업 폴더** — 직원마다 `~/.deskrpg/employees/<직원 id>` 에서 실행됩니다. 기본은 읽기 전용입니다.
- **사내 메신저** — 앱이 여는 로컬 MCP 서버로 직원끼리 `list_colleagues`·`ask` 를 씁니다. 되묻기 깊이 2,
  질문당 150초, 오피스마다 시간당 30회로 제한합니다.
- **모두 멈추기** — 오피스의 CLI 직원 전체를 일시정지해 새 작업을 시작하지 않게 합니다.
- **회의·채팅방** — DeskRPG 의 회의실·채팅방에서 사람과 CLI 직원이 함께 이야기합니다.

## 데이터 위치

런타임 데이터는 `~/.deskrpg` 에 있습니다(`DESKRPG_HOME` 으로 바꿀 수 있음).

- `data/deskrpg.db` — SQLite DB(계정·오피스·직원·대화)
- `employees/<직원 id>/` — 직원별 작업 폴더
- `uploads/`, `logs/`

CLI 의 세션 기록 자체는 각 CLI 가 자기 위치(예: `~/.claude/projects/`)에 저장합니다.
관리자 비밀번호를 잊었다면 `node bin/deskrpg.js reset-password <로그인 ID>` 로 임시 비밀번호를 발급합니다.

환경변수는 [`.env.example`](.env.example) 과 [`ENVIRONMENT.md`](ENVIRONMENT.md) 를 보세요.

## 테스트

```bash
npm run test        # 단위 테스트
npm run typecheck
npm run lint
```

E2E(`e2e/cli-employee.spec.ts`)는 **실제 CLI 를 부르므로** 구독 사용량이 조금 듭니다. 평소 쓰는 서버 말고,
빈 DB 로 따로 띄운 서버에 대고 돌립니다.

```bash
# 예: 별도 포트·별도 DESKRPG_HOME 으로 띄운 서버
DESKRPG_E2E_BASE_URL=http://localhost:3300 DESKRPG_E2E_CHANNEL=msedge npx playwright test e2e/cli-employee.spec.ts
```

`DESKRPG_E2E_CHANNEL` 은 Chrome 이 없는 Windows 에서 기본 설치된 Edge 를 쓰기 위한 것입니다(기본 `chrome`).

## 더 보기

- 0단계 검증 결과: [`spikes/phase0/RESULTS.md`](spikes/phase0/RESULTS.md)
- 원본 DeskRPG 안내: [`README.upstream.md`](README.upstream.md) / [한국어](README.upstream.ko.md)
