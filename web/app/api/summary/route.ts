import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE_BASE_URL = (
  process.env.FLOWFIT_BROWSER_ENGINE_BASE_URL ??
  process.env.FLOWFIT_MOBILE_ENGINE_BASE_URL ??
  process.env.FLOWFIT_ENGINE_BASE_URL ??
  "http://127.0.0.1:3001"
).replace(/\/$/, "");

export async function GET() {
  try {
    const response = await fetch(`${ENGINE_BASE_URL}/api/summary`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      return NextResponse.json(
        {
          ok: false,
          autoProcessedToday: 0,
          pendingApproval: 0,
          inProgress: 0,
          lastUpdated: new Date().toISOString(),
        },
        { status: 200 },
      );
    }

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        autoProcessedToday: 0,
        pendingApproval: 0,
        inProgress: 0,
        lastUpdated: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}
