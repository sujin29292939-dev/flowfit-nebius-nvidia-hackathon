// runner/queue.ts
// 작업 큐: 동시 실행 수 제한 + FIFO + 우선순위
//
// 설계 원칙:
// - MAX_CONCURRENT: 동시에 실행 중인 runAgent() 수 상한
// - 상한 초과 시 대기열(pending)에 쌓임
// - 실행 완료 시 다음 대기 작업 자동 시작
// - 각 작업의 상태(pending/running/done/error)를 추적
// - SSE로 큐 상태 변경 실시간 전파

import { runAgent }    from "../agent/loop.js";
import { broadcaster } from "./sse.js";
import type { ExecutionBrief } from "../agent/executionBrief.js";

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_RUNS ?? 3);
const MAX_QUEUE_SIZE = Number(process.env.MAX_QUEUE_SIZE ?? 50);

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────
export type QueueStatus = "pending" | "running" | "done" | "error";
export type Priority    = "high" | "normal" | "low";

export interface QueueEntry {
  runId:      string;
  task:       string;
  executionBrief?: ExecutionBrief;
  priority:   Priority;
  status:     QueueStatus;
  queuedAt:   number;
  startedAt?: number;
  doneAt?:    number;
  result?:    string;
  error?:     string;
  position?:  number;   // 대기열 내 현재 위치 (1-based, running이면 0)
}

// 우선순위 수치 (낮을수록 먼저)
const PRIORITY_WEIGHT: Record<Priority, number> = {
  high:   0,
  normal: 1,
  low:    2,
};

// ─────────────────────────────────────────────
// RunQueue
// ─────────────────────────────────────────────
class RunQueue {
  private pending:  QueueEntry[] = [];   // 대기 중 (우선순위 정렬)
  private running:  Map<string, QueueEntry> = new Map();
  private history:  Map<string, QueueEntry> = new Map();  // done/error 보관

  // ── 작업 등록 ────────────────────────────────
  enqueue(runId: string, task: string, priority: Priority = "normal", executionBrief?: ExecutionBrief): QueueEntry | null {
    // 큐 초과
    if (this.pending.length >= MAX_QUEUE_SIZE) return null;
    // 중복 등록 방지
    if (this.running.has(runId) || this.history.has(runId)) return null;
    if (this.pending.some((e) => e.runId === runId))        return null;

    const entry: QueueEntry = {
      runId, task, priority, executionBrief,
      status:    "pending",
      queuedAt:  Date.now(),
    };

    this.pending.push(entry);
    this.sortPending();
    this.updatePositions();
    this.broadcastQueueState(runId, "queued");
    this.drain();   // 슬롯이 있으면 즉시 실행
    return entry;
  }

  // ── 상태 조회 ────────────────────────────────
  getEntry(runId: string): QueueEntry | undefined {
    return (
      this.running.get(runId) ??
      this.pending.find((e) => e.runId === runId) ??
      this.history.get(runId)
    );
  }

  getStats() {
    return {
      running:     this.running.size,
      pending:     this.pending.length,
      maxConcurrent: MAX_CONCURRENT,
      slotsAvailable: Math.max(0, MAX_CONCURRENT - this.running.size),
    };
  }

  // ── 내부: 우선순위 정렬 ──────────────────────
  private sortPending() {
    this.pending.sort((a, b) => {
      const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pw !== 0) return pw;
      return a.queuedAt - b.queuedAt;   // 같은 우선순위면 FIFO
    });
  }

  private updatePositions() {
    this.pending.forEach((e, i) => { e.position = i + 1; });
    this.running.forEach((e)    => { e.position = 0; });
  }

  // ── 내부: 슬롯이 생기면 다음 작업 시작 ─────────
  private drain() {
    while (this.running.size < MAX_CONCURRENT && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      entry.status    = "running";
      entry.startedAt = Date.now();
      entry.position  = 0;
      this.running.set(entry.runId, entry);
      this.updatePositions();
      this.broadcastQueueState(entry.runId, "started");

      console.log(
        `[Queue] Starting ${entry.runId.slice(0,8)} ` +
        `(priority=${entry.priority}, waited=${Date.now() - entry.queuedAt}ms)`
      );

      // 실행 (비동기, 완료 시 onDone 콜백)
      runAgent({ runId: entry.runId, task: entry.task, executionBrief: entry.executionBrief })
        .then((result) => this.onDone(entry.runId, result))
        .catch((err)   => this.onError(entry.runId, String(err)));
    }
  }

  private onDone(runId: string, result: string) {
    const entry = this.running.get(runId);
    if (!entry) return;
    entry.status = "done";
    entry.result = result;
    entry.doneAt = Date.now();
    this.running.delete(runId);
    this.history.set(runId, entry);
    this.broadcastQueueState(runId, "done");
    console.log(
      `[Queue] Done ${runId.slice(0,8)} ` +
      `(took=${Date.now() - (entry.startedAt ?? 0)}ms, queue=${this.pending.length} waiting)`
    );
    this.drain();  // 슬롯 확보 → 다음 작업 시작
  }

  private onError(runId: string, error: string) {
    const entry = this.running.get(runId);
    if (!entry) return;
    entry.status = "error";
    entry.error  = error;
    entry.doneAt = Date.now();
    this.running.delete(runId);
    this.history.set(runId, entry);
    this.broadcastQueueState(runId, "error");
    console.error(`[Queue] Error ${runId.slice(0,8)}: ${error.slice(0, 120)}`);
    this.drain();
  }

  // ── SSE: 큐 상태 변경을 해당 run 구독자에게 전파 ──
  private broadcastQueueState(
    runId: string,
    event: "queued" | "started" | "done" | "error"
  ) {
    const entry = this.getEntry(runId);
    broadcaster.emit(runId, {
      type:  "agent_event",
      event: {
        id:        `queue_${event}_${Date.now()}`,
        type:      "agent_thought",
        timestamp: Date.now(),
        content:   this.formatQueueMessage(event, entry),
      },
      seq: -1,  // 큐 메타 이벤트는 seq -1로 구분
    });
  }

  private formatQueueMessage(
    event: string,
    entry: QueueEntry | undefined
  ): string {
    if (!entry) return `[Queue] ${event}`;
    switch (event) {
      case "queued":
        return `[Queue] 대기 중 — 위치: ${entry.position}번째 / 현재 실행: ${this.running.size}개`;
      case "started":
        return `[Queue] 실행 시작 — 대기 시간: ${Date.now() - entry.queuedAt}ms`;
      case "done":
        return `[Queue] 완료 — 실행 시간: ${(entry.doneAt! - entry.startedAt!)}ms`;
      case "error":
        return `[Queue] 오류 — ${entry.error?.slice(0, 100)}`;
      default:
        return `[Queue] ${event}`;
    }
  }
}

// 싱글턴: server.ts가 사용
export const queue = new RunQueue();
