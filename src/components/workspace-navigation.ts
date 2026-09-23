/**
 * 사이드바 메뉴 — **온보딩 순서 그대로** 둔다: 내 캐릭터 → 사무실.
 *
 * 이 순서가 곧 신규 사용자가 밟는 길이다. **먼저 "나" 를 만든다**(캐릭터가 없으면 사무실 화면이
 * 캐릭터 화면으로 되돌려 보낸다 — `src/app/channels/page.tsx` 의 리다이렉트). 그 다음 사무실을 만들어
 * 입주하고, 직원은 사무실 안에서 CLI 직원으로 고용한다.
 *
 * crew-office: Hermes 게이트웨이·프로필 화면(/gateways, /profiles)은 Hermes 와 함께 걷어냈다.
 */
export type WorkspaceNavKey = "characters" | "channels";

export const WORKSPACE_NAV: ReadonlyArray<{ key: WorkspaceNavKey; href: string }> = [
  { key: "characters", href: "/characters" },
  { key: "channels", href: "/channels" },
];
