// GET /api/admin/diagnostics — `deskrpg doctor` 가 보던 것을 브라우저에서 본다. system_admin 전용.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, getDefaultSqlitePath, users } from "@/db";
import { getUserId } from "@/lib/internal-rpc";
import startupCheck from "@/lib/startup-check.js";

export type DiagnosticsReport = {
  environment: { errors: string[]; warnings: string[]; dbTarget: "postgresql" | "sqlite" };
  database: { ok: boolean; target: string; message: string };
};
// crew-office: Hermes 호스트 설정(연결 마법사·설치)과 게이트웨이 요약 항목은 Hermes 와 함께 걷어냈다.

/**
 * 관리자가 아니면 403 이 아니라 404 다 — 이 화면이 존재한다는 사실 자체를 알리지 않는다.
 * 로그인하지 않은 요청도 같은 404 를 받는다(401 이면 "로그인하면 뭔가 있다" 가 된다).
 */
const notFound = () =>
  NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return notFound();

  // 역할 확인이 DB 를 타므로 DB 가 완전히 죽으면 관리자도 404 를 받는다. 그래도 fail-closed 를
  // 택한다 — 확인되지 않은 요청에 호스트 상태를 넘기는 것보다 낫다.
  let systemRole: string | undefined;
  try {
    const [row] = await db
      .select({ systemRole: users.systemRole })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    systemRole = row?.systemRole ?? undefined;
  } catch {
    return notFound();
  }
  if (systemRole !== "system_admin") return notFound();

  const inspected = startupCheck.inspectEnvironment(process.env);
  // startup-check.js 는 CommonJS 라 dbTarget 이 string 으로 추론된다 — 그 파일이 쓰는 것과
  // 같은 규칙으로 여기서 좁힌다(둘 중 하나만 나온다).
  const dbTarget: "postgresql" | "sqlite" =
    inspected.dbTarget === "postgresql" ? "postgresql" : "sqlite";
  const environment = { errors: inspected.errors, warnings: inspected.warnings, dbTarget };
  // server.js 와 같은 인자로 부른다 — 앱이 실제로 쓰는 DB 를 찌른다.
  const database = await startupCheck.checkDatabaseReachable({
    databaseUrl: process.env.DATABASE_URL,
    sqlitePath: getDefaultSqlitePath(),
    target: dbTarget,
  });

  const report: DiagnosticsReport = {
    environment,
    database,
  };
  return NextResponse.json(report);
}
