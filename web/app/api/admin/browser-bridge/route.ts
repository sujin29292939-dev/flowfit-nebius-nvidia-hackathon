import { NextResponse } from "next/server";

import { getBrowserAutomationOverview } from "@/lib/browser-automation-bridge";

export async function GET() {
  const overview = await getBrowserAutomationOverview();
  return NextResponse.json(overview);
}
