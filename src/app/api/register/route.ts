import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const { email, password } = Body.parse(json);

    const supabase = createAdminClient();

    // LANGSUNG create, lalu tangani error "already registered"
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip verifikasi (opsional)
      user_metadata: { source: "external-app" },
    });

    if (error) {
      // Beberapa server mengirim status di error
      const status =
        typeof (error as { status?: number }).status === "number"
          ? (error as { status: number }).status
          : 400;

      // Normalisasi pesan "sudah terdaftar"
      const msg = (error.message || "").toLowerCase();
      if (
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exists")
      ) {
        return NextResponse.json(
          { ok: false, error: "Email already registered" },
          { status: 409 }
        );
      }

      return NextResponse.json({ ok: false, error: error.message }, { status });
    }

    return NextResponse.json({ ok: true, user_id: data.user?.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
