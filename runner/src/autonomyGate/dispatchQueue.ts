// dispatchQueue.ts
// 실제 전송 엔진(notify.ts) 앞단의 지연·회수 큐.
// flush 기반(워커 루프가 주기 호출). 회수 창 안에서는 recall로 취소 가능.
// 모든 전송은 dispatch.sent 이벤트로 적재된다 (event-first).

export interface DispatchPayload {
  /** 전송체 선택: kakao 알림 답장 vs 직원 확인 채널 */
  transport: "kakao_notify" | "staff_channel";
  /** notify.ts가 이해하는 전송 명세 (채널·수신자·본문 등) */
  channel: string;
  recipient: string;
  body: string;
  /** kakao_notify 경로용 — 온디바이스 검증 힌트 */
  deviceId?: string;
  packageName?: string;
  sourceEventId?: string;
  notificationKeyHash?: string;
  expectedSenderHint?: string;
  expectedBodyHint?: string;
  /** staff_channel 경로용 */
  staffName?: string;
  staffContact?: string;
  question?: string;
  responseOptions?: string[];
  [k: string]: unknown;
}

export interface DispatchJob {
  id: string;
  companyId: string;
  refId: string;
  actionType: string;
  payload: DispatchPayload;
  enqueuedAt: number;
  fireAt: number;
  status: "scheduled" | "sending" | "sent" | "recalled" | "failed";
}

/** 실제 전송 전송체. 운영에서는 notify.ts 어댑터가 구현한다. */
export interface Transport {
  send(job: DispatchJob): Promise<void> | void;
}

/** 감사 이벤트 싱크. 운영에서는 append-only 이벤트 스토어에 연결한다. */
export interface EventSink {
  emit(type: string, payload: Record<string, unknown>): void;
}

export class ConsoleTransport implements Transport {
  sent: DispatchJob[] = [];
  send(job: DispatchJob): void {
    this.sent.push(job);
    // 운영에서는 여기서 notify 큐에 push
  }
}

export class MemoryEventSink implements EventSink {
  events: Array<{ type: string; payload: Record<string, unknown>; at: string }> = [];
  emit(type: string, payload: Record<string, unknown>): void {
    this.events.push({ type, payload, at: new Date().toISOString() });
  }
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `dispatch-${Date.now()}-${seq}`;
}

export class DispatchQueue {
  private jobs = new Map<string, DispatchJob>();
  private paused = false;

  constructor(
    private transport: Transport,
    private events: EventSink,
    private delayMs: number,
  ) {}

  /** 지연 큐에 적재. 반환된 id로 회수 가능 */
  enqueue(input: {
    companyId: string;
    refId: string;
    actionType: string;
    payload: DispatchPayload;
    now?: number;
  }): string {
    const now = input.now ?? Date.now();
    const id = newId();
    const job: DispatchJob = {
      id,
      companyId: input.companyId,
      refId: input.refId,
      actionType: input.actionType,
      payload: input.payload,
      enqueuedAt: now,
      fireAt: now + this.delayMs,
      status: "scheduled",
    };
    this.jobs.set(id, job);
    this.events.emit("dispatch.scheduled", { dispatchId: id, refId: job.refId, fireAt: job.fireAt });
    return id;
  }

  /** 회수 창 안에서 전송 취소 */
  recall(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== "scheduled") return false;
    job.status = "recalled";
    this.events.emit("dispatch.recalled", { dispatchId: id, refId: job.refId });
    return true;
  }

  /** 전역 정지/재개 (킬 스위치) */
  pause(): void {
    this.paused = true;
    this.events.emit("dispatch.paused", {});
  }
  resume(): void {
    this.paused = false;
    this.events.emit("dispatch.resumed", {});
  }

  /** 워커 루프가 주기 호출. fireAt 지난 비회수 작업을 실제 전송 */
  async flush(now: number = Date.now()): Promise<number> {
    if (this.paused) return 0;
    let sent = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "scheduled") continue;
      if (job.fireAt > now) continue;
      job.status = "sending";
      try {
        await this.transport.send(job);
        job.status = "sent";
        this.events.emit("dispatch.sent", {
          dispatchId: job.id,
          refId: job.refId,
          actionType: job.actionType,
          recipient: job.payload.recipient,
        });
        sent += 1;
      } catch (err) {
        job.status = "failed";
        this.events.emit("dispatch.failed", { dispatchId: job.id, error: String(err) });
      }
    }
    return sent;
  }

  pending(): DispatchJob[] {
    return [...this.jobs.values()].filter((j) => j.status === "scheduled");
  }
}
