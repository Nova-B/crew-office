// crew-office 는 Hermes 게이트웨이 없이 이 PC 의 Claude Code·Codex CLI 직원으로 돈다(README 참고).
//
// Hermes 전용 화면·진입점(게이트웨이, Hermes 프로필, 칸반, 크론, 판단 모음, 결과물 …)은 이 값으로 숨긴다.
// 기획안 3단계의 첫 조각이다 — 코드 자체는 다음 조각에서 걷어낸다. 그때까지 한 곳에서 되돌릴 수 있게 모아 둔다.
export const HERMES_UI_ENABLED = false;

/** 로그인한 사람이 처음 가는 곳. DeskRPG 는 Hermes 게이트웨이 화면(/gateways)이었다. */
export const HOME_PATH = HERMES_UI_ENABLED ? "/gateways" : "/channels";
