import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

test("an explicit DB_TYPE survives the runtime home's DB_TYPE=sqlite line", () => {
  const { applyEnvText } = createRequire(import.meta.url)("./runtime-env-bootstrap.js");
  const home = "DB_TYPE=sqlite\nSQLITE_PATH=/app/data/data/deskrpg.db\n";

  const explicit = { DB_TYPE: "postgresql", DATABASE_URL: "postgresql://x" };
  applyEnvText(home, explicit);
  assert.equal(explicit.DB_TYPE, "postgresql");

  // 외부 DATABASE_URL 은 홈의 SQLite 기본값보다 우선한다.
  const inferred = { DATABASE_URL: "postgresql://x" };
  applyEnvText(home, inferred);
  assert.equal(inferred.DB_TYPE, undefined);
  const { inspectEnvironment } = createRequire(import.meta.url)("./startup-check.js");
  assert.equal(inspectEnvironment(inferred).dbTarget, "postgresql");
  assert.equal(inferred.SQLITE_PATH, undefined);
});
