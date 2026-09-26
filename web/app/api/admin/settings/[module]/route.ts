import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  getWholesaleModuleSettings,
  updateWholesaleModuleSettings,
  wholesaleSettingsRouteMeta,
} from "@/lib/wholesale-settings";
import type { WholesaleSettingsModuleRoute } from "@/lib/types";

function isModuleRoute(value: string): value is WholesaleSettingsModuleRoute {
  return value in wholesaleSettingsRouteMeta;
}

export async function GET(
  _request: Request,
  { params }: { params: { module: string } },
) {
  if (!isModuleRoute(params.module)) {
    return NextResponse.json({ ok: false, message: "알 수 없는 설정 모듈입니다." }, { status: 404 });
  }

  const settings = await getWholesaleModuleSettings(params.module);
  return NextResponse.json({ ok: true, module: params.module, settings });
}

export async function POST(
  request: Request,
  { params }: { params: { module: string } },
) {
  if (!isModuleRoute(params.module)) {
    return NextResponse.json({ ok: false, message: "알 수 없는 설정 모듈입니다." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const settings = await updateWholesaleModuleSettings(params.module, body);

  revalidatePath("/admin/settings");
  revalidatePath(`/admin/settings/${params.module}`);

  return NextResponse.json({
    ok: true,
    module: params.module,
    settings,
    savedAt: new Date().toISOString(),
  });
}
