import { NextResponse } from "next/server";

import { createMobilePairingCode, getMobilePairingCodes } from "@/lib/mobile-detector";

export async function GET() {
  const pairingCodes = await getMobilePairingCodes(8);
  return NextResponse.json({
    pairing_codes: pairingCodes,
  });
}

export async function POST() {
  try {
    const pairingCode = await createMobilePairingCode({
      label: "FlowFit 폰 연결",
      max_uses: 1,
      expires_in_hours: 24,
    });
    return NextResponse.json(pairingCode, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "pairing_code_create_failed",
      },
      { status: 500 },
    );
  }
}
