import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    const mail = email?.trim().toLowerCase();

    if (!mail || !EMAIL_RE.test(mail)) {
      return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const existing = await query("SELECT id FROM users WHERE email = $1", [mail]);
    if (existing.length) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const [user] = await query<{ id: number }>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [mail, hashPassword(password)]
    );

    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, email: mail } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
