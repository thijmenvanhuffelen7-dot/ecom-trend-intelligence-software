import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

// Openbaar: auth-pagina's, prijzen, webhooks (eigen handtekening) en cron (eigen CRON_SECRET)
const PUBLIC_PATHS = ["/login", "/sign-in", "/sign-up", "/pricing", "/api/webhooks", "/api/cron", "/media/demo", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function devMiddleware(req: NextRequest) {
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();
  const secret = process.env.AUTH_SECRET ?? "";
  const session = secret.length >= 32 ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Clerk: middleware zet alleen de auth-context; elke pagina/route controleert zelf (requireSession).
const clerk = clerkMiddleware();

export default process.env.AUTH_MODE === "clerk" ? clerk : devMiddleware;

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
