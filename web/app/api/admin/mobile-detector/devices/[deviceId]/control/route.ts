import { NextResponse } from "next/server";

import { setMobileDetectorDeviceEnabled } from "@/lib/mobile-detector";

export async function POST(
  request: Request,
  { params }: { params: { deviceId: string } }
) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      action?: string;
    };
    const enabled =
      typeof body.enabled === "boolean" ? body.enabled : String(body.action || "").toLowerCase() !== "disable";

    const result = await setMobileDetectorDeviceEnabled(params.deviceId, enabled);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "mobile_device_control_failed",
      },
      { status: 500 }
    );
  }
}
