/**
 * connectorDiscoveryLive.ts
 * ------------------------------------------------------------------
 * 발견 루프의 세 포트 실제 구현.
 *   AnthropicDocFinder   : web_search로 API 문서 수집      (api.anthropic.com)
 *   AnthropicSynthesizer : 문서+피드백 → MappingProfile JSON (api.anthropic.com)
 *   HttpValidator        : profile.healthPath로 실제 test call
 *
 * fetch는 주입 가능(테스트용). 기본은 전역 fetch(Node 18+/22).
 * 자격증명·API키는 로그에 남기지 않는다.
 * ------------------------------------------------------------------
 */
import type { DocBundle, SynthesizeInput, ValidationResult } from "./connectorDiscovery.js";
import type { MappingProfile } from "./connectorTypes.js";
import { buildHttpCall } from "./connectorExecutor.js";

type FetchFn = typeof fetch;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** ```json 펜스 제거 + 본문에서 첫 JSON 오브젝트 추출 */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error("JSON 추출 실패: " + stripped.slice(0, 120));
  }
}

/** content 블록들에서 text만 모은다 (web_search의 tool_use/result 블록은 건너뜀) */
function joinTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } =>
      typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text",
    )
    .map((b) => b.text)
    .join("\n");
}

interface AnthropicOpts {
  apiKey?: string; // 미지정 시 process.env.ANTHROPIC_API_KEY
  model?: string;
  fetchFn?: FetchFn;
}

async function callAnthropic(
  body: Record<string, unknown>,
  opts: AnthropicOpts,
): Promise<{ content: unknown }> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 미설정");
  const fetchFn = opts.fetchFn ?? fetch;

  const res = await fetchFn(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as { content: unknown };
}

/* ==================================================================
 * 1. DocFinder — web_search로 문서 수집
 * ================================================================== */

const DOC_SYSTEM = [
  "You find official REST API documentation for a named service.",
  "Use web search to locate the developer/API docs.",
  "Then output ONLY a JSON object (no prose, no markdown fences):",
  '{ "found": boolean, "serviceLabel": string, "excerpts": string[], "sourceUrls": string[] }',
  "excerpts: short snippets covering authentication method and the relevant endpoints.",
  'If no public API exists, return {"found": false, ...}.',
].join("\n");

export class AnthropicDocFinder {
  constructor(private readonly opts: AnthropicOpts = {}) {}

  async findDocs(serviceName: string): Promise<DocBundle> {
    const data = await callAnthropic(
      {
        model: this.opts.model ?? "claude-sonnet-4-6",
        max_tokens: 2048,
        system: DOC_SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          { role: "user", content: `Service: ${serviceName}\nFind its REST API documentation.` },
        ],
      },
      this.opts,
    );

    const text = joinTextBlocks(data.content);
    try {
      const parsed = extractJson(text) as Partial<DocBundle>;
      return {
        found: parsed.found ?? false,
        serviceLabel: parsed.serviceLabel ?? serviceName,
        excerpts: parsed.excerpts ?? [],
        sourceUrls: parsed.sourceUrls ?? [],
      };
    } catch {
      return { found: false, serviceLabel: serviceName, excerpts: [], sourceUrls: [] };
    }
  }
}

/* ==================================================================
 * 2. Synthesizer — 문서+피드백 → MappingProfile JSON (도구 없음)
 * ================================================================== */

const SYN_SYSTEM = [
  "You are an API integration specialist.",
  "Given API documentation excerpts and a required capability,",
  "output ONLY a JSON object describing how to call that capability.",
  "No prose, no markdown fences. Use this exact shape:",
  "{",
  '  "baseUrl": string (https URL),',
  '  "authType": "bearer" | "api_key_header" | "api_key_query" | "oauth" | "none",',
  '  "authParam"?: string (header/query key name),',
  '  "endpoint": { "method": "GET"|"POST"|"PUT"|"PATCH", "path": string },',
  '  "itemsPath"?: string, "idField"?: string, "timeField"?: string,',
  '  "healthPath": string (a cheap GET endpoint to verify connectivity),',
  '  "healthMethod": "GET"|"POST"|"PUT"|"PATCH",',
  '  "supportsPush": boolean, "pushEndpoint"?: string',
  "}",
  "If a previous attempt failed, fix strictly according to the feedback.",
].join("\n");

export class AnthropicSynthesizer {
  constructor(private readonly opts: AnthropicOpts = {}) {}

  async synthesize(input: SynthesizeInput): Promise<unknown> {
    const userContent = [
      `Service: ${input.serviceName}`,
      `Capability needed: ${input.capability}`,
      `Documentation excerpts:\n${input.docs.excerpts.join("\n---\n")}`,
      input.feedback ? `\nPREVIOUS ATTEMPT FAILED. Fix this: ${input.feedback}` : "",
    ].join("\n");

    const data = await callAnthropic(
      {
        model: this.opts.model ?? "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYN_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      },
      this.opts,
    );

    return extractJson(joinTextBlocks(data.content));
  }
}

/* ==================================================================
 * 3. Validator — profile.healthPath로 실제 test call
 *    절대 규칙: 이게 통과해야만 발견 루프가 프로파일을 고정한다.
 * ================================================================== */

export class HttpValidator {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async validate(profile: MappingProfile, credential: string): Promise<ValidationResult> {
    const call = buildHttpCall(profile, credential, {
      method: profile.healthMethod,
      path: profile.healthPath,
    });
    try {
      const res = await this.fetchFn(call.url, { method: call.method, headers: call.headers });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, diagnostics: `${res.status} OK @ ${profile.healthPath}` };
      }
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        diagnostics: `${res.status} @ ${profile.healthPath} :: ${body.slice(0, 160)}`,
      };
    } catch (e) {
      return { ok: false, diagnostics: `network error @ ${call.url}: ${(e as Error).message}` };
    }
  }
}
