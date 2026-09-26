import { NextResponse } from "next/server";

import { readMobileAppBinary } from "@/lib/mobile-app-download";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { downloadInfo, binary } = await readMobileAppBinary();

    return new NextResponse(binary, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="${downloadInfo.fileName}"`,
        "Content-Length": String(binary.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "mobile_app_not_found",
        message: error instanceof Error ? error.message : "APK build artifact was not found.",
      },
      { status: 404 }
    );
  }
}
