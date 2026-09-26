import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.NEBIUS_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
const BASE_URL = (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");

const SYSTEM = `You convert a small-business request into strict JSON only.
Return exactly these fields:
taskType, title, summary, confidence, riskLevel, recommendedAction, missingFields.
taskType must be one of: order_request, quote_request, delivery_inquiry, payment_report, reply_draft, complaint, automation_request, report_request, inventory_inquiry, invoice_request, return_exchange, order_update, data_update, general_request, unknown.
riskLevel must be one of: low, medium, high, uncertain.
confidence must be 0..1.
Do not invent missing facts. Keep user-facing text in the user's language.`;

function deterministicGate(result: Record<string, unknown>) {
  const risk = String(result.riskLevel ?? "uncertain");
  const taskType = String(result.taskType ?? "unknown");
  if (risk === "high" || risk === "uncertain") {
    return { outcome: "HUMAN_APPROVAL_REQUIRED", reason: "High or uncertain risk is never auto-authorized in this demo." };
  }
  if (["quote_request", "reply_draft", "complaint", "order_update"].includes(taskType)) {
    return { outcome: "HUMAN_REVIEW", reason: "Customer-facing or modifying work stays behind a human review boundary." };
  }
  return { outcome: "PROPOSED_ACTION_ONLY", reason: "The model may propose; this demo does not grant execution authority." };
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "NEBIUS_API_KEY is not configured" }, { status: 503 });
  }

  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text.slice(0, 6000) },
      ],
    }),
  });

  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.error?.message ?? `Nebius request failed: ${response.status}` },
      { status: 502 },
    );
  }

  const raw = String(payload?.choices?.[0]?.message?.content ?? "")
    .replace(/```json|```/g, "")
    .trim();
  if (!raw) return NextResponse.json({ error: "Empty model response" }, { status: 502 });

  const result = JSON.parse(raw) as Record<string, unknown>;
  return NextResponse.json({
    prototype: true,
    activeDevelopment: true,
    provider: "Nebius",
    model: MODEL,
    route: "task_understanding",
    latencyMs: Date.now() - startedAt,
    succeededAt: new Date().toISOString(),
    understanding: result,
    gate: deterministicGate(result),
  });
}
