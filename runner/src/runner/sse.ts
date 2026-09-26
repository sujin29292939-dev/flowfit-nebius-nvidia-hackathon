// runner/sse.ts
// SSE(Server-Sent Events) 브로드캐스터
// taskId별 채널을 관리한다.
// 여러 Studio 클라이언트가 동일 run을 구독할 수 있다.

import type { ServerResponse } from "node:http";
import type { AgentEvent } from "../agent/events.js";

// SSE 이벤트 타입: 에이전트 이벤트 + 연결 제어용 메타 이벤트
export type SsePayload =
  | { type: "agent_event"; event: AgentEvent; seq: number }
  | { type: "run_started"; runId: string }
  | { type: "run_done"; runId: string; result: string }
  | { type: "run_error"; runId: string; error: string }
  | { type: "ping" };

class SseChannel {
  private clients: Set<ServerResponse> = new Set();

  addClient(res: ServerResponse): void {
    // SSE 헤더 설정
    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      // CORS: Studio가 다른 포트에서 접근하는 경우
      "Access-Control-Allow-Origin": process.env.STUDIO_ORIGIN ?? "*",
    });
    res.flushHeaders();

    // 연결 유지용 주기적 ping
    const pingTimer = setInterval(() => {
      this.sendToClient(res, { type: "ping" });
    }, 15_000);

    this.clients.add(res);

    res.on("close", () => {
      clearInterval(pingTimer);
      this.clients.delete(res);
    });
  }

  broadcast(payload: SsePayload): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      client.write(data);
    }
  }

  private sendToClient(res: ServerResponse, payload: SsePayload): void {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

// ─────────────────────────────────────────────
// SseBroadcaster: 전역 채널 레지스트리
// ─────────────────────────────────────────────
export class SseBroadcaster {
  private channels = new Map<string, SseChannel>();

  // Studio가 GET /run/:id/stream 으로 연결할 때 호출
  subscribe(runId: string, res: ServerResponse): void {
    if (!this.channels.has(runId)) {
      this.channels.set(runId, new SseChannel());
    }
    this.channels.get(runId)!.addClient(res);
  }

  // AgentLoop에서 이벤트 발생할 때 호출
  emit(runId: string, payload: SsePayload): void {
    this.channels.get(runId)?.broadcast(payload);
  }

  // run 완료 후 채널 정리
  close(runId: string): void {
    this.channels.delete(runId);
  }
}

// 싱글턴: server.ts와 loop.ts가 공유
export const broadcaster = new SseBroadcaster();
