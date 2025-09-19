import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Create supabase client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  console.log("Middleware - path:", req.nextUrl.pathname);
  console.log("Middleware - cookies count:", req.cookies.getAll().length);
  console.log(
    "Middleware - raw cookies:",
    req.cookies.getAll().map((c) => c.name)
  );
  console.log(
    "Middleware - session exists:",
    !!session,
    "email:",
    session?.user?.email
  );

  if (error) {
    console.log("Middleware - session error:", error);
  }

  // Check if it's a protected route
  const isPrivate =
    req.nextUrl.pathname.startsWith("/dashboard") ||
    req.nextUrl.pathname.startsWith("/progress") ||
    req.nextUrl.pathname.startsWith("/api/salesforce");

  if (isPrivate && !session) {
    console.log("Middleware - blocking access to:", req.nextUrl.pathname);

    // For API routes, return 401
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "unauthorized from middleware" },
        { status: 401 }
      );
    }

    // For pages, redirect to login
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // IMPORTANT: For API routes with valid session, pass user info via headers
  if (req.nextUrl.pathname.startsWith("/api/") && session) {
    console.log("Middleware - setting headers for API route");

    // Clone the request with additional headers
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-email", session.user.email || "");
    requestHeaders.set("x-user-id", session.user.id);
    requestHeaders.set("x-session-access-token", session.access_token);

    // Create new response with modified request headers
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/progress/:path*", "/api/salesforce/:path*"],
};
