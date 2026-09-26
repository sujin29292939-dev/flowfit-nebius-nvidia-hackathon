import { NextResponse } from "next/server";

import { getMobileDetectorOverview } from "@/lib/mobile-detector";

export async function GET() {
  const overview = await getMobileDetectorOverview();
  return NextResponse.json(overview);
}
