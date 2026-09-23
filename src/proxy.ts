import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/lib/jwt";

// crew-office: /api/crew/messenger 는 CLI 직원의 MCP 브리지가 쿠키 없이 부른다 — 라우트가 메신저 토큰으로 인증한다.
const PUBLIC_PATHS = [
  "/",
  "/auth",
  "/api/auth",
  "/api/health",
  "/api/crew/messenger",
  "/robots.txt",
  "/sitemap.xml",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/assets")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  const payload = await verifyJWT(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL("/auth", req.url));
    response.cookies.delete("token");
    return response;
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-user-id", payload.userId);
  requestHeaders.set("x-user-nickname", encodeURIComponent(payload.nickname));

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
