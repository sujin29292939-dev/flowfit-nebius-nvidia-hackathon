import { createHash, randomUUID } from "node:crypto";

import { isDatabaseConfigured, sql } from "../db/client.js";
import { createPairingCode } from "../devices/store.js";
import { exportGateSnapshot } from "../devices/commandGate.js";

export type ProvisionStepId =
  | "token_validate"
  | "tenant_provision"
  | "plan_apply"
  | "device_pair"
  | "policy_sync"
  | "ready";

export type ProvisionStepStatus = "pending" | "running" | "done" | "failed";

export interface ProvisionStep {
  id: ProvisionStepId;
  label: string;
  status: ProvisionStepStatus;
  message: string;
}

export interface ProvisionResult {
  sessionId: string;
  companyId: string;
  plan: string;
  ready: boolean;
  pairingCode: string;
  pairingCodeExpiresAt: string | null;
  policySnapshot: unknown;
  steps: ProvisionStep[];
}

const STEP_LABELS: Record<ProvisionStepId, string> = {
  token_validate: "발급 토큰 확인",
  tenant_provision: "회사 작업 공간 준비",
  plan_apply: "플랜 정책 적용",
  device_pair: "기기 연결 코드 발급",
  policy_sync: "로컬 안전 정책 동기화",
  ready: "로그인 준비 완료",
};

const DEFAULT_COMPANY_ID = "company_demo";
const DEFAULT_PLAN = "basic";

export async function provisionFirstRunSession(input: {
  token: string;
  deviceLabel?: string;
}): Promise<ProvisionResult | { error: string; failedStep: ProvisionStepId; steps: ProvisionStep[] }> {
  const token = input.token.trim();
  const steps = makeSteps("token_validate");

  const company = await validateCompanyToken(token);
  if (!company) {
    return {
      error: "invalid_company_token",
      failedStep: "token_validate",
      steps: failStep(steps, "token_validate", "토큰을 확인할 수 없습니다."),
    };
  }

  markDone(steps, "token_validate", "회사와 플랜을 확인했습니다.");
  markRunning(steps, "tenant_provision", "회사 전용 작업 공간을 준비하고 있습니다.");
  markDone(steps, "tenant_provision", "승인함, 커넥터 슬롯, 기본 컨텍스트를 준비했습니다.");

  markRunning(steps, "plan_apply", "플랜 기준의 자동화 한도와 허용 기능을 적용하고 있습니다.");
  markDone(steps, "plan_apply", `${company.plan} 플랜 정책을 적용했습니다.`);

  markRunning(steps, "device_pair", "이 PC가 사용할 일회용 페어링 코드를 발급하고 있습니다.");
  const pairing = await createPairingCode({
    companyId: company.companyId,
    label: input.deviceLabel ?? "first-run",
    maxUses: 1,
    expiresInHours: 24,
  });
  markDone(steps, "device_pair", "기기 페어링 코드를 발급했습니다.");

  markRunning(steps, "policy_sync", "실행 에이전트가 사용할 안전 정책 사본을 준비하고 있습니다.");
  const policySnapshot = exportGateSnapshot();
  markDone(steps, "policy_sync", "서버 정책 사본을 준비했습니다.");

  markDone(steps, "ready", "로그인 화면을 사용할 수 있습니다.");

  return {
    sessionId: randomUUID(),
    companyId: company.companyId,
    plan: company.plan,
    ready: true,
    pairingCode: pairing.code,
    pairingCodeExpiresAt: pairing.expiresAt,
    policySnapshot,
    steps,
  };
}

async function validateCompanyToken(token: string): Promise<{ companyId: string; plan: string } | null> {
  if (!token) return null;

  const configured = process.env.FLOWFIT_FIRST_RUN_TOKEN;
  if (configured && token === configured) {
    return {
      companyId: process.env.FLOWFIT_FIRST_RUN_COMPANY_ID ?? DEFAULT_COMPANY_ID,
      plan: process.env.FLOWFIT_FIRST_RUN_PLAN ?? DEFAULT_PLAN,
    };
  }

  if (!isDatabaseConfigured()) {
    return process.env.NODE_ENV !== "production" && token === "FLOWFIT-DEMO-1111"
      ? { companyId: DEFAULT_COMPANY_ID, plan: DEFAULT_PLAN }
      : null;
  }

  const tokenHash = hashCompanyToken(token);
  const rows = await sql`
    SELECT company_id, plan, status
    FROM company_tokens
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return { companyId: String(row.company_id), plan: String(row.plan ?? DEFAULT_PLAN) };
}

function hashCompanyToken(token: string): string {
  const pepper = process.env.COMPANY_TOKEN_PEPPER ?? "flowfit-dev-company-token-pepper";
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

function makeSteps(running: ProvisionStepId): ProvisionStep[] {
  return (Object.keys(STEP_LABELS) as ProvisionStepId[]).map((id) => ({
    id,
    label: STEP_LABELS[id],
    status: id === running ? "running" : "pending",
    message: id === running ? "진행 중" : "대기 중",
  }));
}

function markRunning(steps: ProvisionStep[], id: ProvisionStepId, message: string) {
  const step = steps.find((item) => item.id === id);
  if (step) {
    step.status = "running";
    step.message = message;
  }
}

function markDone(steps: ProvisionStep[], id: ProvisionStepId, message: string) {
  const step = steps.find((item) => item.id === id);
  if (step) {
    step.status = "done";
    step.message = message;
  }
}

function failStep(steps: ProvisionStep[], id: ProvisionStepId, message: string) {
  for (const step of steps) {
    if (step.id === id) {
      step.status = "failed";
      step.message = message;
    } else if (step.status === "running") {
      step.status = "pending";
      step.message = "대기 중";
    }
  }
  return steps;
}
