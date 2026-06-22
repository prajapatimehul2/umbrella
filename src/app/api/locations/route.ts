import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { geocode, getVerdict, type Verdict } from "@/lib/weather";
import { getUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

type LocationRow = { id: number; name: string; latitude: number; longitude: number };

function unauthorized() {
  return NextResponse.json({ error: "Please sign in." }, { status: 401 });
}

// GET /api/locations — the user's saved cities, each enriched with today's verdict.
export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    const rows = await query<LocationRow>(
      "SELECT id, name, latitude, longitude FROM locations WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    const enriched = await Promise.all(
      rows.map(async (loc) => {
        let verdict: Verdict | null = null;
        let error: string | null = null;
        try {
          verdict = await getVerdict(loc.latitude, loc.longitude);
        } catch (e) {
          error = e instanceof Error ? e.message : "weather lookup failed";
        }
        return { ...loc, verdict, error };
      })
    );

    return NextResponse.json({ locations: enriched });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

// POST /api/locations  body: { name: string } — geocode then save for this user.
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const geo = await geocode(name);
    if (!geo) return NextResponse.json({ error: `Couldn't find "${name}"` }, { status: 404 });

    const [row] = await query<LocationRow>(
      "INSERT INTO locations (user_id, name, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING id, name, latitude, longitude",
      [userId, geo.country ? `${geo.name}, ${geo.country}` : geo.name, geo.latitude, geo.longitude]
    );

    return NextResponse.json({ location: row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

// DELETE /api/locations?id=123 — only deletes if it belongs to this user.
export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await query("DELETE FROM locations WHERE id = $1 AND user_id = $2", [id, userId]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
