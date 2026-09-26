// understanding/llm.ts
// LLM을 사용할 수 있으면 원문을 더 정교하게 구조화하고, 실패하면 휴리스틱으로 돌아간다.

import Anthropic from "@anthropic-ai/sdk";
import { TaskUnderstandingSchema } from "./schema.js";
import type { TaskUnderstandingResult, UnderstandingInput } from "./types.js";
import { getTaskUnderstandingModel, getTaskUnderstandingProvider } from "../llm/modelConfig.js";
import { callGeminiGenerateContent, extractGeminiText } from "../llm/gemini.js";
import { recordAiRuntimeFailure, recordAiRuntimeSuccess } from "../llm/runtimeTelemetry.js";

const PROVIDER = getTaskUnderstandingProvider();
const MODEL = getTaskUnderstandingModel(PROVIDER);

const SYSTEM = `You convert messy small-business work inputs into structured operational tasks.
Classify ONLY into one of: order_request, quote_request, delivery_inquiry, payment_report, reply_draft, complaint, automation_request, report_request, inventory_inquiry, invoice_request, return_exchange, order_update, data_update, general_request, unknown.
Return strict JSON only. No markdown.

Rules:
- Keep user-facing string values in the same language as the user's input unless preserving an original proper noun, product name, order number, or channel value.
- Payment work is read/matching only. Never recommend transfer/refund automation.
- automation_request is for reminders, scheduled follow-ups, monitoring, recurring rules, or workflow setup requests.
- report_request is for summarizing, prioritizing, status reporting, or daily work overview requests.
- reply_draft is for drafting customer/vendor/staff messages.
- complaint is for angry customers, claims, apology handling, or service recovery.
- inventory_inquiry is for stock level checks or availability questions (read only).
- invoice_request is for tax invoice / receipt issuance requests.
- return_exchange is for returns, exchanges, or defective item pickups.
- order_update is for changing or canceling an existing order (quantity, due date, address).
- data_update is for updating master data: customer info, contacts, unit prices.
- general_request is for broad operational instructions that do not fit a narrower class.
- If required fields are unclear, put them in missingFields.
- confidence must be 0..1.
- riskLevel: payment_report is high, unclear cases uncertain, customer-facing replies usually medium.
- Do not invent customer, item, amount, order numbers, or dates.`;

export async function llmUnderstand(input: UnderstandingInput): Promise<TaskUnderstandingResult> {
  if (process.env.TASK_UNDERSTANDING_MODE === "heuristic") {
    throw new Error("Task Understanding LLM disabled");
  }

  if (PROVIDER === "groq") {
    return groqUnderstand(input);
  }

  if (PROVIDER === "gemini") {
    return geminiUnderstand(input);
  }

  if (PROVIDER === "nebius") {
    return nebiusUnderstand(input);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Task Understanding LLM disabled");
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    temperature: 0,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        `sourceType: ${input.sourceType}`,
        `sourceName: ${input.sourceName ?? ""}`,
        `receivedAt: ${input.receivedAt ?? ""}`,
        "",
        "Raw text:",
        input.rawText.slice(0, 6000),
        "",
        "JSON shape:",
        `{
  "taskType": "order_request | quote_request | delivery_inquiry | payment_report | reply_draft | complaint | automation_request | report_request | inventory_inquiry | invoice_request | return_exchange | order_update | data_update | general_request | unknown",
  "title": "short task title in the user's language",
  "summary": "short summary in the user's language",
  "fields": {
    "customerName": "...",
    "itemName": "...",
    "quantity": 0,
    "unit": "...",
    "dueDateText": "...",
    "deliveryAddress": "...",
    "orderNumber": "...",
    "trackingNumber": "...",
    "amount": 0,
    "depositorName": "...",
    "contactName": "...",
    "requestedReplyChannel": "sms | email | kakao | ..."
  },
  "missingFields": ["..."],
  "confidence": 0.0,
  "riskLevel": "low | medium | high | uncertain",
  "recommendedAction": "...",
  "evidence": ["short original words that support classification"],
  "needsHumanReview": true
}`,
      ].join("\n"),
    }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  const parsed = JSON.parse(text) as unknown;
  const result = TaskUnderstandingSchema.parse(parsed);
  return { ...result, engine: "llm" };
}

async function geminiUnderstand(input: UnderstandingInput): Promise<TaskUnderstandingResult> {
  const body = await callGeminiGenerateContent({
    model: MODEL,
    system: SYSTEM,
    temperature: 0,
    maxOutputTokens: 1200,
    responseMimeType: "application/json",
    contents: [{
      role: "user",
      parts: [{
        text: [
          `sourceType: ${input.sourceType}`,
          `sourceName: ${input.sourceName ?? ""}`,
          `receivedAt: ${input.receivedAt ?? ""}`,
          "",
          "Raw text:",
          input.rawText.slice(0, 6000),
          "",
          "JSON shape:",
          JSON_SHAPE,
          "",
          "Return only the JSON object with the exact enum values shown above.",
        ].join("\n"),
      }],
    }],
  });

  const text = extractGeminiText(body).replace(/```json|```/g, "").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = normalizeProviderJson(JSON.parse(text) as unknown);
  const result = TaskUnderstandingSchema.parse(parsed);
  return { ...result, engine: "llm" };
}

async function nebiusUnderstand(input: UnderstandingInput): Promise<TaskUnderstandingResult> {
  const startedAt = Date.now();
  try {
    const apiKey = process.env.NEBIUS_API_KEY;
    if (!apiKey) throw new Error("NEBIUS_API_KEY is required");
    const baseUrl = (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [
            `sourceType: ${input.sourceType}`,
            `sourceName: ${input.sourceName ?? ""}`,
            `receivedAt: ${input.receivedAt ?? ""}`,
            "", "Raw text:", input.rawText.slice(0, 6000), "", "JSON shape:", JSON_SHAPE,
            "", "Return only the JSON object with the exact enum values shown above."
          ].join("\n") }
        ]
      })
    });
    const body = await response.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    } | null;
    if (!response.ok) throw new Error(body?.error?.message ?? `Nebius request failed: ${response.status}`);
    const text = body?.choices?.[0]?.message?.content?.replace(/\`\`\`json|\`\`\`/g, "").trim();
    if (!text) throw new Error("Nebius returned an empty response");
    const parsed = normalizeProviderJson(JSON.parse(text) as unknown);
    const result = TaskUnderstandingSchema.parse(parsed);
    recordAiRuntimeSuccess({
      provider: "nebius",
      model: MODEL,
      route: "task_understanding",
      latencyMs: Date.now() - startedAt,
    });
    return { ...result, engine: "llm" };
  } catch (error) {
    recordAiRuntimeFailure(error);
    throw error;
  }
}

async function groqUnderstand(input: UnderstandingInput): Promise<TaskUnderstandingResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_completion_tokens: 1200,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "flowfit_task_understanding",
          strict: true,
          schema: GROQ_TASK_UNDERSTANDING_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            `sourceType: ${input.sourceType}`,
            `sourceName: ${input.sourceName ?? ""}`,
            `receivedAt: ${input.receivedAt ?? ""}`,
            "",
        "Raw text:",
        input.rawText.slice(0, 6000),
        "",
        "JSON shape:",
        JSON_SHAPE,
        "",
        "Return only the JSON object with the exact enum values shown above.",
      ].join("\n"),
        },
      ],
    }),
  });

  const body = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Groq request failed: ${response.status}`);
  }

  const text = body?.choices?.[0]?.message?.content?.replace(/```json|```/g, "").trim();
  if (!text) {
    throw new Error("Groq returned an empty response");
  }

  const parsed = normalizeProviderJson(JSON.parse(text) as unknown);
  const result = TaskUnderstandingSchema.parse(parsed);
  return { ...result, engine: "llm" };
}

const JSON_SHAPE = `{
  "taskType": "order_request | quote_request | delivery_inquiry | payment_report | reply_draft | complaint | automation_request | report_request | inventory_inquiry | invoice_request | return_exchange | order_update | data_update | general_request | unknown",
  "title": "short task title in the user's language",
  "summary": "short summary in the user's language",
  "fields": {
    "customerName": "...",
    "itemName": "...",
    "quantity": 0,
    "unit": "...",
    "dueDateText": "...",
    "deliveryAddress": "...",
    "orderNumber": "...",
    "trackingNumber": "...",
    "amount": 0,
    "depositorName": "...",
    "contactName": "...",
    "requestedReplyChannel": "sms | email | kakao | ..."
  },
  "missingFields": ["..."],
  "confidence": 0.0,
  "riskLevel": "low | medium | high | uncertain",
  "recommendedAction": "...",
  "evidence": ["short original words that support classification"],
  "needsHumanReview": true
}`;

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

const GROQ_TASK_UNDERSTANDING_SCHEMA = {
  type: "object",
  properties: {
    taskType: {
      type: "string",
      enum: [
        "order_request",
        "quote_request",
        "delivery_inquiry",
        "payment_report",
        "reply_draft",
        "complaint",
        "automation_request",
        "report_request",
        "inventory_inquiry",
        "invoice_request",
        "return_exchange",
        "order_update",
        "data_update",
        "general_request",
        "unknown",
      ],
    },
    title: { type: "string" },
    summary: { type: "string" },
    fields: {
      type: "object",
      properties: {
        customerName: nullableString,
        itemName: nullableString,
        quantity: nullableNumber,
        unit: nullableString,
        dueDateText: nullableString,
        deliveryAddress: nullableString,
        orderNumber: nullableString,
        trackingNumber: nullableString,
        amount: nullableNumber,
        depositorName: nullableString,
        contactName: nullableString,
        requestedReplyChannel: nullableString,
      },
      required: [
        "customerName",
        "itemName",
        "quantity",
        "unit",
        "dueDateText",
        "deliveryAddress",
        "orderNumber",
        "trackingNumber",
        "amount",
        "depositorName",
        "contactName",
        "requestedReplyChannel",
      ],
      additionalProperties: false,
    },
    missingFields: {
      type: "array",
      items: { type: "string" },
    },
    confidence: { type: "number" },
    riskLevel: {
      type: "string",
      enum: ["low", "medium", "high", "uncertain"],
    },
    recommendedAction: { type: "string" },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
    needsHumanReview: { type: "boolean" },
  },
  required: [
    "taskType",
    "title",
    "summary",
    "fields",
    "missingFields",
    "confidence",
    "riskLevel",
    "recommendedAction",
    "evidence",
    "needsHumanReview",
  ],
  additionalProperties: false,
};

function normalizeProviderJson(value: unknown) {
  const root = asRecord(value);
  const source = asRecord(root.task ?? root.result ?? root.understanding ?? root);
  const fields = asRecord(source.fields);
  const normalizedFields = stripNullish({
    ...fields,
    itemName: fields.itemName ?? fields.item ?? fields.product ?? fields.productName,
    dueDateText: fields.dueDateText ?? fields.deadline ?? fields.dueDate,
    quantity: normalizeNumber(fields.quantity),
    amount: normalizeNumber(fields.amount),
  });

  return {
    ...source,
    taskType: normalizeTaskType(source.taskType),
    fields: normalizedFields,
    missingFields: normalizeStringArray(source.missingFields),
    confidence: normalizeConfidence(source.confidence),
    riskLevel: normalizeRiskLevel(source.riskLevel),
    evidence: normalizeStringArray(source.evidence),
    needsHumanReview: typeof source.needsHumanReview === "boolean" ? source.needsHumanReview : false,
  };
}

function stripNullish(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeTaskType(value: unknown) {
  const text = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["order_request", "order", "purchase_order", "purchase_request"].includes(text)) return "order_request";
  if (["quote_request", "estimate_request", "quotation_request", "quote", "estimate"].includes(text)) return "quote_request";
  if (["delivery_inquiry", "shipping_inquiry", "delivery", "tracking"].includes(text)) return "delivery_inquiry";
  if (["payment_report", "payment", "deposit_report"].includes(text)) return "payment_report";
  if (["reply_draft", "draft_reply", "message_draft", "response_draft"].includes(text)) return "reply_draft";
  if (["complaint", "claim", "customer_complaint", "service_recovery"].includes(text)) return "complaint";
  if (["automation_request", "automation", "reminder", "scheduled_follow_up", "workflow_setup"].includes(text)) return "automation_request";
  if (["report_request", "report", "summary", "prioritization", "daily_summary", "status_report"].includes(text)) return "report_request";
  if (["inventory_inquiry", "stock_check", "stock_inquiry", "inventory_check", "inventory"].includes(text)) return "inventory_inquiry";
  if (["invoice_request", "invoice", "invoice_tax", "tax_invoice", "receipt_request"].includes(text)) return "invoice_request";
  if (["return_exchange", "return_request", "exchange_request", "return", "exchange", "refund_exchange"].includes(text)) return "return_exchange";
  if (["order_update", "order_change", "order_modification", "order_cancel", "order_cancellation"].includes(text)) return "order_update";
  if (["data_update", "master_data_update", "info_update", "customer_update", "price_update"].includes(text)) return "data_update";
  if (["general_request", "general", "task_request"].includes(text)) return "general_request";
  return "unknown";
}

function normalizeRiskLevel(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (["low", "medium", "high", "uncertain"].includes(text)) return text;
  return "uncertain";
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (value && typeof value === "object") return Object.values(value).map((item) => String(item)).filter(Boolean);
  return [];
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : undefined;
  }
  return undefined;
}

function normalizeConfidence(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0.5;
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(Math.max(number > 1 ? number / 100 : number, 0), 1);
}
