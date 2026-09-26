// devices/resultVerification.ts
// 실행 결과 교차검증 (v1.3 위협모델: 감염 PC 거짓 보고 방지).
//
// 원칙: 고객 PC(에이전트)는 신뢰하지 않는다.
// 에이전트가 "성공했다"고 말해도, 명령의 검증 조건(step.verify)에 대응하는
// 화면 증거가 없으면 성공으로 인정하지 않는다.
//
// 특히 쓰기성 스텝(SUBMIT/SAVE 등, 게이트 CONFIRM 이상)은 증거가 필수다.

import { evaluateCommandGate } from "./commandGate.js";
import type { DeviceCommandStep } from "./types.js";

/** 에이전트가 보고하는 스텝별 실행 증거 */
export interface StepEvidence {
  op: string;
  /** 명령에 있던 검증 조건 (예: "toast_contains:주문 등록 완료") */
  verify?: string;
  /** 이 검증이 실제로 충족됐는가 (에이전트 주장) */
  passed: boolean;
  /** 화면 증거 해시 (스크린샷 or UIA 상태의 sha256) — 위조 어렵게 */
  evidenceHash?: string;
  capturedAt?: string;
}

export interface ReportedEvidence {
  stepResults?: StepEvidence[];
  finalScreenshotHash?: string;
  finalUrl?: string;
}

export type VerificationVerdict =
  | "verified"        // 성공 + 증거 일치
  | "unverified"      // 성공 주장이나 증거 부족 → 성공 불인정
  | "evidence_missing"// 쓰기 스텝에 증거 없음
  | "failed_ok";      // 실패 보고 — 검증 불필요, 그대로 수용

export interface VerificationResult {
  verdict: VerificationVerdict;
  /** 서버가 최종 인정하는 상태 */
  effectiveStatus: "succeeded" | "failed" | "needs_review";
  reasons: string[];
  /** 이 기기를 격리 대상으로 볼지 (거짓 보고 정황) */
  flagDevice: boolean;
}

/** 쓰기성(증거 필수) 스텝인가 — 게이트 CONFIRM 이상 */
function isWriteStep(step: DeviceCommandStep): boolean {
  const gate = evaluateCommandGate([{ op: step.op }]);
  return gate.level === "CONFIRM" || gate.level === "BLOCK";
}

export function verifyReportedResult(input: {
  steps: DeviceCommandStep[];
  reportedStatus: "succeeded" | "failed";
  evidence?: ReportedEvidence;
}): VerificationResult {
  const { steps, reportedStatus, evidence } = input;

  // 실패 보고는 그대로 수용 (거짓 성공만 위험, 거짓 실패는 재시도로 흡수)
  if (reportedStatus === "failed") {
    return { verdict: "failed_ok", effectiveStatus: "failed", reasons: ["에이전트 실패 보고 수용"], flagDevice: false };
  }

  const reasons: string[] = [];
  const stepResults = evidence?.stepResults ?? [];
  const byOpTarget = new Map<string, StepEvidence>();
  for (const ev of stepResults) byOpTarget.set(`${ev.op}:${ev.verify ?? ""}`, ev);

  // 1) 쓰기 스텝은 증거(해시) + passed가 필수
  const writeSteps = steps.filter(isWriteStep);
  for (const w of writeSteps) {
    const ev = byOpTarget.get(`${w.op}:${w.verify ?? ""}`);
    if (!ev) {
      reasons.push(`쓰기 스텝(${w.op}) 증거 없음`);
      return { verdict: "evidence_missing", effectiveStatus: "needs_review", reasons, flagDevice: true };
    }
    if (!ev.evidenceHash) {
      reasons.push(`쓰기 스텝(${w.op}) 화면 증거 해시 없음`);
      return { verdict: "evidence_missing", effectiveStatus: "needs_review", reasons, flagDevice: true };
    }
    if (!ev.passed) {
      reasons.push(`쓰기 스텝(${w.op}) 검증 미충족 — 성공 주장과 모순`);
      return { verdict: "unverified", effectiveStatus: "needs_review", reasons, flagDevice: true };
    }
  }

  // 2) verify 조건이 있는 모든 스텝은 대응 증거의 passed가 참이어야 함
  const verifySteps = steps.filter((s) => s.verify);
  for (const v of verifySteps) {
    const ev = byOpTarget.get(`${v.op}:${v.verify ?? ""}`);
    if (!ev) {
      reasons.push(`검증 조건(${v.verify}) 증거 누락`);
      return { verdict: "unverified", effectiveStatus: "needs_review", reasons, flagDevice: false };
    }
    if (!ev.passed) {
      reasons.push(`검증 조건(${v.verify}) 미충족`);
      return { verdict: "unverified", effectiveStatus: "needs_review", reasons, flagDevice: true };
    }
  }

  // 3) 최종 화면 증거(스크린샷 해시)도 요구 — 쓰기 명령이면 필수
  if (writeSteps.length > 0 && !evidence?.finalScreenshotHash) {
    reasons.push("최종 화면 증거(스크린샷 해시) 없음");
    return { verdict: "evidence_missing", effectiveStatus: "needs_review", reasons, flagDevice: true };
  }

  reasons.push("모든 검증 조건 충족 + 화면 증거 확인");
  return { verdict: "verified", effectiveStatus: "succeeded", reasons, flagDevice: false };
}
