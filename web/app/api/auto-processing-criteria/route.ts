import { NextResponse } from "next/server";

import {
  addAutoProcessingKeyword,
  deleteAutoProcessingKeyword,
  readAutoProcessingCriteria,
} from "@/services/autoProcessingCriteriaStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const criteria = await readAutoProcessingCriteria();
  return NextResponse.json({ criteria });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { criterionId?: unknown; keyword?: unknown } | null;
  const criterionId = typeof body?.criterionId === "string" ? body.criterionId : "";
  const keyword = typeof body?.keyword === "string" ? body.keyword : "";

  if (!criterionId || !keyword.trim()) {
    return NextResponse.json({ error: "criterionId and keyword are required" }, { status: 400 });
  }

  const criteria = await addAutoProcessingKeyword(criterionId, keyword);
  return NextResponse.json({ criteria }, { status: 201 });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { criterionId?: unknown; keywordId?: unknown } | null;
  const criterionId = typeof body?.criterionId === "string" ? body.criterionId : "";
  const keywordId = typeof body?.keywordId === "string" ? body.keywordId : "";

  if (!criterionId || !keywordId) {
    return NextResponse.json({ error: "criterionId and keywordId are required" }, { status: 400 });
  }

  const criteria = await deleteAutoProcessingKeyword(criterionId, keywordId);
  return NextResponse.json({ criteria });
}
