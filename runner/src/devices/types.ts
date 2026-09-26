// devices/types.ts
// 원격 실행 에이전트 교신 도메인 타입.

/** 기기 자율 단계. Autonomy Gate와 동일한 3단계. */
export type DeviceAutonomyStage = "SHADOW" | "ASSIST" | "AUTO";

export type DeviceStatus = "active" | "revoked";

export interface DeviceRecord {
  id: string;
  companyId: string;
  label?: string;
  platform?: string;
  agentVersion?: string;
  capabilityScope: string[];
  autonomyStage: DeviceAutonomyStage;
  status: DeviceStatus;
  operationMode?: "ONLINE" | "OFFLINE" | "RECOVERING";
  pollMissCount?: number;
  lastSeenAt?: string;
  lastPollAt?: string;
  snapshotVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type DeviceCommandStatus =
  | "queued"      // 큐에 등록됨, 아직 미전달
  | "dispatched"  // 에이전트가 가져감
  | "succeeded"   // 실행 성공 보고됨
  | "failed"      // 실행 실패 보고됨
  | "expired";    // TTL 만료

export interface DeviceCommandStep {
  /** 조작 종류: navigate, click, type, read, save 등 (에이전트가 해석) */
  op: string;
  /** 대상 지시자: URL, 셀렉터, UIA 경로, 필드명 등 */
  target?: string;
  /** 입력 값 */
  value?: string;
  /** 성공 검증 방법 */
  verify?: string;
}

export interface DeviceCommandRecord {
  id: string;
  deviceId: string;
  companyId: string;
  taskId?: string;
  approvalId?: string;
  capability: string;
  idempotencyKey: string;
  nonce: string;
  bodyHash: string;
  signature: string;
  steps: DeviceCommandStep[];
  status: DeviceCommandStatus;
  expiresAt: string;
  dispatchedAt?: string;
  resultStatus?: string;
  result?: unknown;
  reportedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 에이전트가 명령을 가져갈 때 받는 서명된 봉투 */
export interface SignedCommandEnvelope {
  commandId: string;
  deviceId: string;
  companyId: string;
  capability: string;
  idempotencyKey: string;
  nonce: string;
  bodyHash: string;
  signature: string;
  expiresAt: string;
  steps: DeviceCommandStep[];
}
