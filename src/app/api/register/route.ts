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

    // Check if email already exists
    const { data: existingUsers, error: listError } =
      await supabase.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json(
        { ok: false, error: listError.message },
        { status: 500 }
      );
    }

    const isTaken = existingUsers.users.some(
      (user) => user.email?.toLowerCase() === email.toLowerCase()
    );

    if (isTaken) {
      return NextResponse.json(
        { ok: false, error: "Email already registered" },
        { status: 400 }
      );
    }

    // Create user
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip verification (optional)
      user_metadata: { source: "external-app" },
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, user_id: data.user?.id });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 400 }
    );
  }
}
