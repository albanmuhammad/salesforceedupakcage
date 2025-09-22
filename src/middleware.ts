// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  // Selalu pakai res yang sama supaya cookies yang di-set tersimpan
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Penting: set di 'res' yang akan DIRETURN
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // ✅ Aman: verifikasi user (server contact ke Supabase Auth)
  const { data: userData, error: userErr } = await supabase.auth.getUser();

  const user = userData?.user ?? null;

  console.log("Middleware - path:", req.nextUrl.pathname);
  console.log("Middleware - cookies count:", req.cookies.getAll().length);
  console.log(
    "Middleware - raw cookies:",
    req.cookies.getAll().map((c) => c.name)
  );
  console.log(
    "Middleware - session(user) exists:",
    !!user,
    "email:",
    user?.email
  );
  if (userErr) console.log("Middleware - getUser error:", userErr);

  // Proteksi halaman saja (dashboard & progress).
  // Biarkan API handle auth sendiri (Route Handler kamu sudah pakai getUser()).
  const isProtectedPage =
    req.nextUrl.pathname.startsWith("/dashboard") ||
    req.nextUrl.pathname.startsWith("/progress");

  if (isProtectedPage && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // ❌ Hapus blok injeksi header ke API.
  // Itu membuat kamu return response BARU dan kehilangan cookies yang sudah di-set.

  return res;
}

export const config = {
  // Proteksi hanya halaman; API dibiarkan ke Route Handler auth sendiri
  matcher: ["/dashboard/:path*", "/progress/:path*"],
  // Jika mau tetap proteksi API dari middleware, tambahkan "/api/salesforce/:path*"
  // TAPI pastikan fetch dari server KE API mengirim cookie (pakai relative URL atau kirim header cookie manual).
};
