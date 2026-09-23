import { test, expect, type Page } from "@playwright/test";
import { sendAndAwaitReply, isDoubled, waitForGameLoop } from "./helpers";

// crew-office: Hermes 없이 이 PC 의 Claude Code CLI 로 일하는 직원을 고용하고 1:1 로 대화한다.
//
// 실행 전제: 빈 DB 로 띄운 `npm run dev`(DESKRPG_E2E_BASE_URL), 그리고 이 PC 에 로그인된
// Claude Code CLI. 계정·캐릭터·채널은 이 스펙이 API 로 만든다 — 시드된 개발 DB 가 필요 없다.
// 실제 CLI 를 부르므로 구독 사용량이 조금 든다(Haiku, 짧은 턴 두 번).

const MODEL = process.env.DESKRPG_E2E_CLI_MODEL ?? "haiku";

async function bootstrap(page: Page): Promise<string> {
  const suffix = Date.now().toString(36);
  // 빈 DB 의 첫 가입자가 관리자가 되어 채널을 만들 수 있다. 다시 돌릴 때는 같은 계정으로 로그인한다.
  const loginId = process.env.DESKRPG_E2E_LOGIN_ID ?? "crewadmin";
  const password = process.env.DESKRPG_E2E_PASSWORD ?? "crew-office-e2e-2026";
  await page.request.post("/api/auth/register", {
    data: { loginId, nickname: "Crew Admin", password },
  });
  const login = await page.request.post("/api/auth/login", { data: { loginId, password } });
  expect(login.ok(), await login.text()).toBe(true);

  const character = await page.request.post("/api/characters", {
    data: { name: "Tester", appearance: { officeLookId: "office-jun" } },
  });
  // 사용자당 캐릭터는 하나다 — 다시 돌리면 이미 있다.
  const characterBody = await character.text();
  expect(character.ok() || characterBody.includes("character_already_exists"), characterBody).toBe(
    true,
  );

  const groups = (await (await page.request.get("/api/groups")).json()) as {
    groups: Array<{ id: string; isDefault?: boolean }>;
  };
  const group = groups.groups.find((g) => g.isDefault) ?? groups.groups[0];
  const channel = await page.request.post("/api/channels", {
    data: { name: `Crew ${suffix}`, isPublic: true, environmentId: "tech", groupId: group.id },
  });
  expect(channel.ok(), await channel.text()).toBe(true);
  const { channel: created } = (await channel.json()) as { channel: { id: string } };
  return created.id;
}

// helpers.enterFirstChannel 은 예전 "캐릭터 목록" 화면을 가정한다(지금은 편집기다). 채널 id 를
// 알고 있으니 게임 화면으로 바로 들어간다.
async function enterChannel(page: Page, channelId: string) {
  await page.goto(`/game?channelId=${channelId}`);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  // 대화를 보는 테스트라 프레임 수는 최소로만 확인한다 — GPU 없는 headless 는 소프트웨어 WebGL 로 6fps 안팎이다.
  await waitForGameLoop(page, 1);
}

test("CLI 직원을 고용하고 1:1 대화에서 앞 턴을 기억한다", async ({ page }) => {
  const channelId = await bootstrap(page);
  await enterChannel(page, channelId);

  await page.getByRole("button", { name: "CLI 직원 고용" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("이름").fill("미나");
  await dialog.getByRole("button", { name: /Claude Code/ }).click();
  await dialog.getByLabel("모델 (선택)").fill(MODEL);
  await dialog
    .getByLabel("성격·역할")
    .fill("너는 Crew Office 의 명랑한 기획자 미나다. 한국어로 짧게 답한다.");
  await dialog.getByRole("button", { name: "고용", exact: true }).click();
  await expect(dialog).toBeHidden();

  // 명단에서 새 직원을 골라 1:1 대화를 연다.
  await page.getByRole("button", { name: "미나" }).first().click();
  await page
    .locator('[data-chat-bubble], textarea, input[type="text"]')
    .last()
    .waitFor({ timeout: 60_000 });

  const token = `모카${Date.now() % 100000}`;
  const first = await sendAndAwaitReply(
    page,
    `내 고양이 이름은 ${token} 이야. 한 문장으로 짧게 대답해.`,
  );
  expect(first.length, "CLI 직원 응답이 비어 있습니다").toBeGreaterThan(0);

  const recall = await sendAndAwaitReply(page, "내 고양이 이름이 뭐라고 했지? 이름만 말해줘.");
  expect(recall.replace(/\s+/g, ""), `앞 턴을 기억하지 못했습니다: ${recall}`).toContain(token);
  expect(isDoubled(recall), `응답이 두 번 반복됩니다:\n${recall}`).toBe(false);
});

// 서버를 재시작한 뒤에 따로 돌린다: 위 테스트가 남긴 토큰을 DESKRPG_E2E_RESTART_TOKEN 으로 넘긴다.
// 어댑터의 메모리 캐시는 재시작으로 비었으므로, 기억이 이어지면 npc_sessions 에서 재개한 것이다.
test("서버를 재시작해도 CLI 직원이 앞 대화를 기억한다", async ({ page }) => {
  const token = process.env.DESKRPG_E2E_RESTART_TOKEN;
  test.skip(
    !token,
    "DESKRPG_E2E_RESTART_TOKEN 이 있을 때만 — 첫 테스트 뒤 서버를 재시작하고 돌린다",
  );

  const loginId = process.env.DESKRPG_E2E_LOGIN_ID ?? "crewadmin";
  const password = process.env.DESKRPG_E2E_PASSWORD ?? "crew-office-e2e-2026";
  expect((await page.request.post("/api/auth/login", { data: { loginId, password } })).ok()).toBe(
    true,
  );
  const { channels } = (await (await page.request.get("/api/channels")).json()) as {
    channels: Array<{ id: string }>;
  };
  await enterChannel(page, channels[0].id);

  await page.getByRole("button", { name: "미나" }).first().click();
  await page
    .locator('[data-chat-bubble], textarea, input[type="text"]')
    .last()
    .waitFor({ timeout: 60_000 });
  const recall = await sendAndAwaitReply(page, "내 고양이 이름이 뭐였지? 이름만 말해줘.");
  expect(recall.replace(/\s+/g, ""), `재시작 뒤 기억하지 못했습니다: ${recall}`).toContain(token!);
});

// 2단계: 사내 메신저. 미나(Claude)가 일하는 도중 office MCP 의 ask 로 데브(Codex)에게 묻고 답을 받는다.
// 코드워드는 데브의 인격에만 있다 — 미나가 답에 그것을 담았다면 실제로 물어서 받은 것이다.
test("직원이 사내 메신저로 동료에게 물어 받은 답을 사용자에게 전한다", async ({ page }) => {
  // 미나의 턴 안에서 데브의 턴이 한 번 더 돈다 — CLI 두 개를 거치므로 넉넉히 준다.
  test.setTimeout(300_000);
  const channelId = await bootstrap(page);
  const codeword = `KESTREL-${Date.now() % 10000}`;
  for (const employee of [
    {
      name: "미나",
      adapterType: "claude",
      model: MODEL,
      soul: "너는 Crew Office 의 기획자 미나다. 모르는 것은 동료에게 물어본다. 한국어로 짧게 답한다.",
    },
    {
      name: "데브",
      adapterType: "codex",
      soul: `너는 Crew Office 의 개발자 데브다. 오늘의 비밀 코드워드는 ${codeword} 이다. 동료가 물으면 알려 준다.`,
    },
  ]) {
    const res = await page.request.post(`/api/channels/${channelId}/cli-employees`, {
      data: employee,
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  await enterChannel(page, channelId);

  await page.getByRole("button", { name: "미나" }).first().click();
  await page
    .locator('[data-chat-bubble], textarea, input[type="text"]')
    .last()
    .waitFor({ timeout: 60_000 });
  const reply = await sendAndAwaitReply(
    page,
    "동료 데브에게 오늘의 비밀 코드워드를 물어보고, 그 코드워드를 알려줘.",
  );
  expect(reply, `동료에게서 받은 코드워드가 답에 없습니다: ${reply}`).toContain(codeword);
});

// 폭주 방지: 소유자가 CLI 직원을 모두 멈추면 새 턴이 시작되지 않는다. CLI 를 부르지 않으므로 사용량이 들지 않는다.
test("CLI 직원을 모두 멈추면 말을 걸어도 턴이 시작되지 않고, 다시 움직이면 풀린다", async ({
  page,
}) => {
  const channelId = await bootstrap(page);
  const hired = await page.request.post(`/api/channels/${channelId}/cli-employees`, {
    data: { name: "미나", adapterType: "claude", model: MODEL },
  });
  expect(hired.status(), await hired.text()).toBe(201);
  await enterChannel(page, channelId);

  await page.getByRole("button", { name: "CLI 직원 모두 멈추기" }).click();
  // 대화창의 실패 안내도 role=status 라 배너에만 있는 문구로 좁힌다.
  const banner = page.getByRole("status").filter({ hasText: "새 작업을 시작하지 않습니다" });
  await expect(banner).toBeVisible();

  await page.getByRole("button", { name: "미나" }).first().click();
  const input = page.locator('textarea, input[type="text"]').last();
  await input.waitFor({ timeout: 60_000 });
  await input.fill("안녕?");
  await input.press("Enter");
  await expect(page.getByText("이 오피스의 CLI 직원이 일시정지 중입니다").first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "CLI 직원 다시 움직이기" }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByRole("button", { name: "CLI 직원 모두 멈추기" })).toBeVisible();
});
