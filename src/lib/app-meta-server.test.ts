import assert from "node:assert/strict";
import test from "node:test";

import { createAppMetaCache } from "./app-meta-server";

const REPO = "https://api.github.com/repos/Nova-B/crew-office";

function fakeFetch(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    const r = responses[url];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchJson, calls };
}

test("최신 릴리스 태그를 돌려주고 TTL 안에서는 다시 묻지 않는다", async () => {
  let now = 0;
  const { fetchJson, calls } = fakeFetch({
    [`${REPO}/releases/latest`]: { tag_name: "2026.922.0" },
  });
  const cache = createAppMetaCache({ fetchJson, now: () => now, ttlMs: 1000, failureTtlMs: 100 });
  const first = await cache.get();
  assert.equal(first.latestVersion, "2026.922.0");
  await cache.get();
  assert.equal(calls.length, 1);
  now = 1001;
  await cache.get();
  assert.equal(calls.length, 2);
});

test("호출이 실패하면 null 로 두고, 실패는 짧게 캐시한다", async () => {
  let now = 0;
  const { fetchJson, calls } = fakeFetch({
    [`${REPO}/releases/latest`]: new Error("rate limited"),
  });
  const cache = createAppMetaCache({ fetchJson, now: () => now, ttlMs: 1000, failureTtlMs: 100 });
  const meta = await cache.get();
  assert.equal(meta.latestVersion, null);
  now = 50;
  await cache.get();
  assert.equal(calls.length, 1);
  now = 101;
  await cache.get();
  assert.equal(calls.length, 2);
});

test("v 접두사는 떼고, 형식이 맞지 않는 응답은 null 로 본다", async () => {
  const withPrefix = fakeFetch({ [`${REPO}/releases/latest`]: { tag_name: "v2026.922.0" } });
  assert.equal(
    (await createAppMetaCache({ fetchJson: withPrefix.fetchJson, now: () => 0 }).get())
      .latestVersion,
    "2026.922.0",
  );
  const { fetchJson } = fakeFetch({ [`${REPO}/releases/latest`]: {} });
  const meta = await createAppMetaCache({ fetchJson, now: () => 0 }).get();
  assert.equal(meta.latestVersion, null);
});
