// devices/taskDispatch.ts
// 승인된 업무를 device 명령 큐로 내보내는 오케스트레이터.
//
// 흐름: 승인 완료 → 회사의 활성 기기 선택 → 절차 템플릿으로 명령 스텝 생성
//       → 게이트 통과(승인 ID 동반) → 명령 큐 등록 → 에이전트가 폴링·실행.

import { buildDeviceCommand, findProcedureTemplate } from "./commandBuilder.js";
import { enqueueCommand, listDevices } from "./store.js";
import type { DeviceAutonomyStage } from "./types.js";

export interface DispatchInput {
  companyId: string;
  capability: string;
  fields: Record<string, unknown>;
  taskId?: string;
  approvalId?: string;
  /** 특정 기기 지정(없으면 회사의 첫 활성 기기) */
  deviceId?: string;
}

export type DispatchResult =
  | { ok: true; commandId: string; deviceId: string; stepCount: number }
  | { ok: false; error: string; missingFields?: string[] };

/** 자동 단계별 실행 허용 여부: 승인이 필요한 명령은 approvalId가 있어야 한다. */
function stageAllowsDispatch(stage: DeviceAutonomyStage, hasApproval: boolean): boolean {
  if (stage === "SHADOW") return false;      // 관찰만 — 실제 명령 금지
  if (stage === "ASSIST") return hasApproval; // 승인된 것만
  return true;                                // AUTO — 정책 범위 내 자동
}

export async function dispatchTaskToDevice(input: DispatchInput): Promise<DispatchResult> {
  const template = findProcedureTemplate(input.capability);
  if (!template) {
    return { ok: false, error: `no_procedure_template_for:${input.capability}` };
  }

  // 대상 기기 선택
  const devices = await listDevices(input.companyId);
  const active = devices.filter((d) => d.status === "active");
  const device = input.deviceId
    ? active.find((d) => d.id === input.deviceId)
    : active.find((d) => d.capabilityScope.includes(input.capability)) ?? active[0];

  if (!device) {
    return { ok: false, error: "no_active_device" };
  }
  if (device.capabilityScope.length > 0 && !device.capabilityScope.includes(input.capability)) {
    return { ok: false, error: `device_scope_excludes:${input.capability}` };
  }
  if (!stageAllowsDispatch(device.autonomyStage, Boolean(input.approvalId))) {
    return { ok: false, error: `stage_blocks_dispatch:${device.autonomyStage}` };
  }

  // 절차 → 스텝
  const built = buildDeviceCommand({ template, fields: input.fields });
  if (!built.ok) {
    return { ok: false, error: built.error, missingFields: built.missingFields };
  }

  // 명령 큐 등록(게이트가 승인 ID로 CONFIRM 허용, BLOCK은 여전히 차단)
  const enq = await enqueueCommand({
    deviceId: device.id,
    companyId: input.companyId,
    capability: input.capability,
    steps: built.steps,
    taskId: input.taskId,
    approvalId: input.approvalId,
    idempotencyKey: input.taskId ? `${input.capability}:${input.taskId}` : undefined,
  });

  if ("error" in enq) {
    return { ok: false, error: enq.error };
  }
  return { ok: true, commandId: enq.commandId, deviceId: device.id, stepCount: built.steps.length };
}
