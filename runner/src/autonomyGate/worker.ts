// worker.ts
// 기존 알림 워커에 게이트 + Dispatch 훅을 끼우는 조립 예시.
// 운영에서는 MemoryNotifyEngine/MemoryStaffSender/MemoryEventSink를
// 실제 flowfit-local-engine / StaffConfirmationRequest 발송 / 이벤트 스토어로 교체한다.

import { AutonomyGate } from "./autonomyGate.js";
import { CriteriaRegistry } from "./criteriaRegistry.js";
import { DispatchQueue, MemoryEventSink } from "./dispatchQueue.js";
import { ShadowLog } from "./shadowLog.js";
import { DEFAULT_CONFIG, type GateConfig, type GateInput, type GateResult } from "./types.js";
import { buildDispatchPayload } from "./dispatchPayload.js";
import {
  NotifyTransport,
  MemoryNotifyEngine,
  MemoryStaffSender,
} from "./notifyTransport.js";

export interface BuiltGate {
  gate: AutonomyGate;
  queue: DispatchQueue;
  registry: CriteriaRegistry;
  events: MemoryEventSink;
  engine: MemoryNotifyEngine;
  staff: MemoryStaffSender;
  config: GateConfig;
}

/** 부팅 시 1회 조립 */
export function buildGate(configOverride: Partial<GateConfig> = {}): BuiltGate {
  const config: GateConfig = { ...DEFAULT_CONFIG, ...configOverride };
  const events = new MemoryEventSink();
  const engine = new MemoryNotifyEngine();
  const staff = new MemoryStaffSender();
  const transport = new NotifyTransport(config, engine, staff, events);
  const queue = new DispatchQueue(transport, events, config.dispatchDelayMs);
  const registry = new CriteriaRegistry();
  const gate = new AutonomyGate({ config, registry, queue, shadow: new ShadowLog(), buildDispatchPayload });
  return { gate, queue, registry, events, engine, staff, config };
}

/**
 * Runner 승인요청 생성 직전 호출.
 * effectiveOutcome === "AUTO_SEND"이면 pending을 만들지 말고 자동 처리.
 */
export async function gateBeforeApproval(
  gate: AutonomyGate,
  input: GateInput,
  now?: number,
): Promise<GateResult> {
  return gate.run(input, now);
}

/** 알림 워커 루프 — 회수 창 지난 작업을 주기적으로 실제 전송 */
export function startDispatchLoop(queue: DispatchQueue, intervalMs = 5_000): () => void {
  const timer = setInterval(() => {
    void queue.flush();
  }, intervalMs);
  return () => clearInterval(timer);
}
