import type { Page } from "@playwright/test";

/**
 * requestAnimationFrame 이 실제로 도는지 확인한다.
 *
 * headed 로 띄우면 창이 가려지는 순간 Chrome 이 rAF 를 초당 1프레임으로 스로틀하고,
 * 시뮬레이션 틱 루프가 멈춰 캐릭터가 영영 이동하지 않는다. document.visibilityState 는 그때도
 * "visible" 이라 코드로는 안 보인다 — 그래서 상태 플래그가 아니라 프레임을 직접 센다.
 */
export async function waitForGameLoop(page: Page, minFps = 10): Promise<number> {
  const fps = await page.evaluate(async () => {
    const t0 = performance.now();
    let frames = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return frames;
  });
  if (fps < minFps) {
    throw new Error(
      `게임 루프가 ${fps}fps 로 돌고 있습니다(최소 ${minFps} 필요). 창이 가려져 Chrome 이 ` +
        "requestAnimationFrame 을 스로틀하는 상태입니다 — headless 로 실행하거나 " +
        "브라우저 창을 앞으로 올리십시오.",
    );
  }
  return fps;
}

/** 메시지를 보내고 NPC 답변 한 건이 끝날 때까지 기다린 뒤 그 텍스트를 돌려준다. */
export async function sendAndAwaitReply(page: Page, message: string): Promise<string> {
  const before = await page.locator('[data-chat-bubble="npc"]').count();

  const input = page.locator('textarea, input[type="text"]').last();
  await input.fill(message);
  await input.press("Enter");

  const reply = page.locator('[data-chat-bubble="npc"]').nth(before);
  await reply.waitFor({ timeout: 150_000 });
  // 스트리밍이 끝나야 최종 텍스트다.
  await reply.locator('xpath=self::*[@data-streaming="false"]').waitFor({ timeout: 150_000 });
  return (await reply.innerText()).trim();
}

/**
 * 텍스트가 자기 자신을 정확히 두 번 담고 있는지.
 *
 * 에이전트가 완성된 답변 전체를 진행 이벤트로 한 번 더 보내고 그걸 본문 스트림에 섞으면
 * 결과가 정확히 2배가 된다. 업스트림(Hermes 시절)에서 실제로 났던 회귀다.
 */
export function isDoubled(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (t.length < 2 || t.length % 2 !== 0) return false;
  const half = t.length / 2;
  return t.slice(0, half) === t.slice(half);
}
