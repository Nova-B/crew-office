# 환경변수

`npm run dev` 는 저장소의 `.env.local`(그리고 `.env`)을 읽습니다. [`.env.example`](.env.example) 을
복사해 시작하세요. 아무것도 넣지 않아도 개발 서버는 돌며, 이때 DB 는 `~/.deskrpg/data/deskrpg.db`
(SQLite)입니다.

## 기본

| 변수           | 설명                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`   | 세션 토큰 서명 키. 개발 모드에서는 비워 두면 개발용 기본값을 쓰지만, `NODE_ENV=production` 이면 필수다. 바꾸면 모든 세션이 끊긴다 |
| `DESKRPG_HOME` | 런타임 데이터 폴더. 기본 `~/.deskrpg` — DB, 직원 작업 폴더(`employees/<id>`), 업로드, 로그가 여기에 있다                          |
| `PORT`         | 서버 포트. 기본 `3000`                                                                                                            |

## 선택 — CLI 실행 파일

직원은 이 PC 에 설치된 `claude`/`codex` CLI 를 셸 없이 직접 실행한다(`src/lib/adapters/cli-executable.ts`).
Windows 에서는 npm 전역 설치 위치와 Claude 네이티브 설치 위치(`%USERPROFILE%\.local\bin`)를 찾아보고,
그 외 OS 에서는 PATH 의 이름을 그대로 쓴다. 자동으로 못 찾을 때만 지정한다.

| 변수               | 설명                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `CREW_CLAUDE_PATH` | Claude Code 실행 파일 경로(예: `claude.exe`)                             |
| `CREW_CODEX_PATH`  | Codex 실행 파일 경로(`codex.js` 면 현재 Node 로 실행한다)                |
| `CREW_NPM_ROOT`    | npm 전역 `node_modules` 경로. 기본 `%APPDATA%\npm\node_modules`(Windows) |

## 선택 — 데이터베이스

| 변수                      | 설명                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `DB_TYPE` / `SQLITE_PATH` | SQLite 경로를 바꿀 때. 기본은 `DESKRPG_HOME` 아래 `data/`       |
| `DATABASE_URL`            | PostgreSQL 을 쓸 때의 접속 문자열(업스트림 호환, 기본은 SQLite) |

## 선택 — 기타

| 변수                                                          | 설명                                                                                                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COOKIE_SECURE`                                               | `true` 면 쿠키에 `Secure` 가 붙어 HTTP 로는 로그인이 저장되지 않는다. 주지 않으면 `npm run start`(server.js)는 `false`, 그 밖에는 `NODE_ENV === "production"` 일 때 `true` 다 |
| `REGISTRATION_DISABLED` / `NEXT_PUBLIC_REGISTRATION_DISABLED` | 공개 가입을 막는다. 둘을 함께 설정한다                                                                                                                                        |
| `DESKRPG_FEEDBACK_URL`                                        | 설문·비공개 버그 신고를 보낼 서버. 설정이 없거나 빈 값이면 둘 다 끈다(기본). 업스트림 서버로는 보내지 않는다                                                                  |
