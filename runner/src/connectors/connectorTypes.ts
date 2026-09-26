/**
 * connectorTypes.ts
 * ------------------------------------------------------------------
 * 단일 출처(single source of truth) 공용 타입.
 * resolver와 discovery가 "같은 규격표"를 보게 하기 위해 여기로 모은다.
 * (순환 import 방지: resolver/discovery는 이 파일만 바라본다)
 * ------------------------------------------------------------------
 */
import { z } from "zod";

/* 능력 */
export const Capability = z.enum([
  "order.create",
  "order.confirm",
  "quote.create",
  "shipment.track",
  "inventory.read",
  "payment.check",
  "staff.confirm",
  "inquiry.read",
  "inquiry.reply",
  "complaint.handle",
  "report.create",
  "automation.create",
]);
export type Capability = z.infer<typeof Capability>;

export const CAPABILITY_KIND: Record<Capability, "read" | "write"> = {
  "order.create": "write",
  "order.confirm": "write",
  "quote.create": "write",
  "shipment.track": "read",
  "inventory.read": "read",
  "payment.check": "read",
  "staff.confirm": "write",
  "inquiry.read": "read",
  "inquiry.reply": "write",
  "complaint.handle": "write",
  "report.create": "write",
  "automation.create": "write",
};

export function isWriteCapability(capability: Capability): boolean {
  return CAPABILITY_KIND[capability] === "write";
}

export function isReadCapability(capability: Capability): boolean {
  return CAPABILITY_KIND[capability] === "read";
}

export function assertCapabilityClassification(): void {
  const missing: string[] = [];
  const invalid: string[] = [];
  const ghost = Object.keys(CAPABILITY_KIND).filter(
    (key) => !(Capability.options as readonly string[]).includes(key),
  );

  for (const capability of Capability.options) {
    const kind = (CAPABILITY_KIND as Record<string, unknown>)[capability];
    if (kind === undefined) {
      missing.push(capability);
    } else if (kind !== "read" && kind !== "write") {
      invalid.push(`${capability}=${String(kind)}`);
    }
  }

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing classification: ${missing.join(", ")}`);
  if (invalid.length > 0) problems.push(`invalid classification: ${invalid.join(", ")}`);
  if (ghost.length > 0) problems.push(`unknown capability key: ${ghost.join(", ")}`);
  if (problems.length > 0) {
    throw new Error(`[CAPABILITY_KIND] ${problems.join(" / ")}`);
  }
}

/* 연결 방식 */
export const ConnectionKind = z.enum([
  "oauth",
  "api_key",
  "webhook",
  "email",
  "manual",
]);
export type ConnectionKind = z.infer<typeof ConnectionKind>;

/* health 상태 */
export const HealthState = z.enum([
  "healthy",
  "degraded",
  "down",
  "unauthed",
  "unknown",
]);
export type HealthState = z.infer<typeof HealthState>;

/* HTTP 메서드 */
export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

export const IdempotencyProfileSchema = z.object({
  supported: z.boolean().default(false),
  headerName: z.string().optional(),
  bodyField: z.string().optional(),
});
export type IdempotencyProfile = z.infer<typeof IdempotencyProfileSchema>;

/**
 * MappingProfile — AI 발견 루프가 "생성"하고 시스템이 "고정"하는 산출물.
 * 발견 → 카탈로그 저장 → resolve → 실제 호출까지 이 한 타입으로 흐른다.
 */
export const MappingProfileSchema = z.object({
  baseUrl: z.string().url(),
  authType: z.enum(["bearer", "api_key_header", "api_key_query", "oauth", "none"]),
  authParam: z.string().optional(), // 헤더/쿼리 키 이름 (예: "X-API-KEY")
  endpoint: z.object({
    method: HttpMethod,
    path: z.string(), // baseUrl 기준 상대 경로
  }),
  itemsPath: z.string().optional(), // 목록 배열 JSON 경로 (감지/읽기용)
  idField: z.string().optional(),
  timeField: z.string().optional(),
  healthPath: z.string(), // kind별 일반 probe가 이 한 줄만 읽음
  healthMethod: HttpMethod.default("GET"),
  supportsPush: z.boolean().default(false),
  pushEndpoint: z.string().optional(),
  idempotency: IdempotencyProfileSchema.default({ supported: false }),
});
export type MappingProfile = z.infer<typeof MappingProfileSchema>;
