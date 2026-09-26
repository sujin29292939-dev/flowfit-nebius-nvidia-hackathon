/**
 * connectorDiscovery.ts
 * ------------------------------------------------------------------
 * 자기수정 Connector 발견 루프
 *   문서 발견 → 프로파일 생성 → test call 검증 → 실패 시 재생성 → 성공 시 고정
 *
 * 절대 규칙:
 *   test call 검증을 통과하기 전에는 그 프로파일로 어떤 실제 행동도 하지 않는다.
 *   환각된 엔드포인트로 실제 업무(주문 등록 등)가 실행되는 것을 막는 게 이 루프의 존재 이유다.
 *
 * 컨벤션(autonomy-gate):
 *   - 모든 외부 형태는 Zod 검증.
 *   - 모든 단계는 append-only 이벤트로 남긴다(감사 가능성).
 *   - 망(web_search/fetch), LLM, HTTP는 전부 포트(interface)로 주입 → 결정론적 테스트 가능.
 * ------------------------------------------------------------------
 */
import { z } from "zod";
import {
  Capability,
  ConnectionKind,
  MappingProfileSchema,
  isWriteCapability,
  type MappingProfile,
} from "./connectorTypes.js";

/* ==================================================================
 * 1. 쓰기/읽기 능력 구분 — 위험 게이트 기준
 *    (MappingProfile/HttpMethod는 connectorTypes.ts에 단일 정의)
 * ================================================================== */

/* ==================================================================
 * 2. 쓰기/읽기 능력 구분 — 위험 게이트 기준
 * ================================================================== */

/* ==================================================================
 * 3. 주입 포트 — 망/LLM/HTTP 비의존
 * ================================================================== */

export interface DocBundle {
  found: boolean; // API 문서를 찾았는가
  serviceLabel: string;
  /** 문서 본문 발췌 (synthesizer 입력). 실제 구현은 web_search+web_fetch 결과. */
  excerpts: string[];
  sourceUrls: string[];
}

export interface SynthesizeInput {
  serviceName: string;
  capability: Capability;
  docs: DocBundle;
  /** 직전 실패 진단 — 자기수정의 핵심 입력 */
  feedback: string | null;
}

export interface ValidationResult {
  ok: boolean;
  /** 실패 시 synthesizer에 되먹임할 진단 (상태코드, 파싱 실패 위치 등) */
  diagnostics: string;
}

export interface DiscoveryPorts {
  /** web_search + web_fetch로 API 문서 수집 */
  docFinder: { findDocs(serviceName: string): Promise<DocBundle> };
  /** Claude API로 프로파일 초안 생성 (JSON only 응답) */
  synthesizer: { synthesize(input: SynthesizeInput): Promise<unknown> };
  /** 실제 test call — 읽기성 엔드포인트 우선, 자격증명 사용 */
  validator: {
    validate(profile: MappingProfile, credential: string): Promise<ValidationResult>;
  };
  /** 검증 통과한 프로파일 고정 저장 */
  store: {
    freeze(args: {
      companyId: string;
      connectorKey: string;
      capability: Capability;
      kind: ConnectionKind;
      profile: MappingProfile;
      active: boolean; // 쓰기성은 SHADOW 승인 전까지 false
    }): Promise<void>;
  };
  events: { emit(e: DiscoveryEvent): Promise<void> };
  clock?: () => Date;
}

/* ==================================================================
 * 4. Append-only 이벤트
 * ================================================================== */

export const DiscoveryEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DiscoveryStarted"), at: z.string(), serviceName: z.string(), capability: Capability }),
  z.object({ type: z.literal("DocsNotFound"), at: z.string(), serviceName: z.string() }),
  z.object({ type: z.literal("ProfileSynthesized"), at: z.string(), attempt: z.number().int() }),
  z.object({ type: z.literal("SchemaRejected"), at: z.string(), attempt: z.number().int(), error: z.string() }),
  z.object({ type: z.literal("ValidationAttempted"), at: z.string(), attempt: z.number().int(), ok: z.boolean(), diagnostics: z.string() }),
  z.object({ type: z.literal("ProfileFrozen"), at: z.string(), connectorKey: z.string(), active: z.boolean() }),
  z.object({ type: z.literal("AwaitingShadowApproval"), at: z.string(), connectorKey: z.string() }),
  z.object({ type: z.literal("DiscoveryExhausted"), at: z.string(), attempts: z.number().int() }),
]);
export type DiscoveryEvent = z.infer<typeof DiscoveryEventSchema>;

/* ==================================================================
 * 5. 요청 / 결과
 * ================================================================== */

export const DiscoveryRequestSchema = z.object({
  companyId: z.string(),
  serviceName: z.string(),
  connectorKey: z.string(),
  capability: Capability,
  kind: ConnectionKind.default("api_key"),
  credential: z.string(), // 이미 인증 핸드오프(사람 1탭)로 확보한 토큰
  maxAttempts: z.number().int().min(1).max(8).default(4),
});
export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;

export type DiscoveryOutcome =
  | { ok: true; frozen: true; profile: MappingProfile } // 읽기성: 즉시 고정·활성
  | { ok: true; frozen: false; needsApproval: true; profile: MappingProfile } // 쓰기성: SHADOW 승인 대기
  | { ok: false; reason: "no_api"; fallback: "email_or_browser" }
  | { ok: false; reason: "validation_failed"; attempts: number; fallback: "manual_or_browser" };

/* ==================================================================
 * 6. 자기수정 발견 루프
 * ================================================================== */

export async function discoverConnector(
  raw: DiscoveryRequest,
  ports: DiscoveryPorts,
): Promise<DiscoveryOutcome> {
  const req = DiscoveryRequestSchema.parse(raw);
  const now = () => (ports.clock?.() ?? new Date()).toISOString();

  await ports.events.emit({
    type: "DiscoveryStarted",
    at: now(),
    serviceName: req.serviceName,
    capability: req.capability,
  });

  // (1) 문서 발견
  const docs = await ports.docFinder.findDocs(req.serviceName);
  if (!docs.found) {
    await ports.events.emit({ type: "DocsNotFound", at: now(), serviceName: req.serviceName });
    return { ok: false, reason: "no_api", fallback: "email_or_browser" };
  }

  // (2~4) 생성 → 검증 → 자기수정 루프
  let feedback: string | null = null;

  for (let attempt = 1; attempt <= req.maxAttempts; attempt++) {
    const draft = await ports.synthesizer.synthesize({
      serviceName: req.serviceName,
      capability: req.capability,
      docs,
      feedback,
    });
    await ports.events.emit({ type: "ProfileSynthesized", at: now(), attempt });

    // 스키마 자기수정: 형태가 틀리면 그 오류를 피드백으로 재생성
    const parsed = MappingProfileSchema.safeParse(draft);
    if (!parsed.success) {
      const error = JSON.stringify(parsed.error.issues);
      await ports.events.emit({ type: "SchemaRejected", at: now(), attempt, error });
      feedback = `스키마 검증 실패. 아래 이슈를 고쳐 다시 생성: ${error}`;
      continue;
    }

    // 런타임 검증: 실제 test call (절대 규칙 — 통과 전엔 실행 금지)
    const result = await ports.validator.validate(parsed.data, req.credential);
    await ports.events.emit({
      type: "ValidationAttempted",
      at: now(),
      attempt,
      ok: result.ok,
      diagnostics: result.diagnostics,
    });

    if (!result.ok) {
      feedback = `test call 실패. 진단: ${result.diagnostics}`;
      continue;
    }

    // (5) 검증 통과 → 위험 게이트
    const profile = parsed.data;
    if (isWriteCapability(req.capability)) {
      // 쓰기성: 비활성으로 고정하고 SHADOW 승인 대기
      await ports.store.freeze({
        companyId: req.companyId,
        connectorKey: req.connectorKey,
        capability: req.capability,
        kind: req.kind,
        profile,
        active: false,
      });
      await ports.events.emit({ type: "AwaitingShadowApproval", at: now(), connectorKey: req.connectorKey });
      return { ok: true, frozen: false, needsApproval: true, profile };
    }

    // 읽기성: 즉시 고정·활성 (사람 개입 없음)
    await ports.store.freeze({
      companyId: req.companyId,
      connectorKey: req.connectorKey,
      capability: req.capability,
      kind: req.kind,
      profile,
      active: true,
    });
    await ports.events.emit({ type: "ProfileFrozen", at: now(), connectorKey: req.connectorKey, active: true });
    return { ok: true, frozen: true, profile };
  }

  // 재시도 소진 → fallback
  await ports.events.emit({ type: "DiscoveryExhausted", at: now(), attempts: req.maxAttempts });
  return { ok: false, reason: "validation_failed", attempts: req.maxAttempts, fallback: "manual_or_browser" };
}

/* ==================================================================
 * 7. 재발견 트리거 — health가 프로파일 깨짐을 잡으면 호출
 *    (한 번 고정이지만 영구 고정은 아니다. 깨질 때만 AI가 다시 생성)
 * ================================================================== */

export async function rediscoverOnBreak(
  req: DiscoveryRequest,
  ports: DiscoveryPorts,
): Promise<DiscoveryOutcome> {
  // 깨진 커넥터는 새로 발견 루프를 다시 태운다. 검증 통과 전까지 기존 활성은 유지하지 않도록
  // store.freeze(active:false)로 갈아끼우는 정책은 호출부(autopilot)에서 결정.
  return discoverConnector(req, ports);
}
