// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  // Selalu pakai res yang sama agar cookies dari Supabase tersimpan di response yang direturn.
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Ambil user dari Supabase (server-side, aman)
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user ?? null;

  const { pathname } = req.nextUrl;

  // 1) Selalu izinkan /login (JANGAN redirect walau ada session)
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return res;
  }

  // 2) (Opsional) Izinkan static assets kalau nanti matcher-mu diperluas
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/images") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico");

  if (isPublicAsset) {
    return res;
  }

  // 3) Proteksi halaman private
  const isProtectedPage =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/progress");

  if (isProtectedPage && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // info kecil: asal redirect (opsional)
    url.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(url);
  }

  // 4) Biarkan selain itu lewat apa adanya
  return res;
}

// HANYA pasang matcher untuk halaman private agar /login tidak ikut di-handle,
// sehingga tidak ada auto-redirect dari /login.
export const config = {
  matcher: ["/dashboard/:path*", "/progress/:path*"],
};
