// lib/supabase/server.ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies(); // tidak perlu await

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Bisa gagal saat initial server render
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options, maxAge: 0 });
          } catch {
            // Bisa gagal saat initial server render
          }
        },
      },
    }
  );
}

// Special client for API routes that reads from request headers
export function createClientFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";

  // Parse cookies manually from header
  const cookieMap = new Map<string, string>();
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split("=");
      if (name && rest.length > 0) {
        cookieMap.set(name, rest.join("="));
      }
    });
  }

  console.log("Cookies from request header:", Array.from(cookieMap.keys()));

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieMap.get(name);
        },
        // No-op di API routes; tetap ketikkan signature yang benar agar lolos tipe
        set(_name: string, _value: string, _options: CookieOptions) {},
        remove(_name: string, _options: CookieOptions) {},
      },
    }
  );
}
