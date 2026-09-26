// agent/events.ts
// Append-only 이벤트 스트림
// 이벤트가 추가될 때마다 onEmit 콜백이 호출된다.
// → SSE 실시간 전송 + DB 영속화가 이 콜백으로 연결된다.

export type EventType =
  | "user_message"
  | "tool_call"
  | "tool_result"
  | "agent_thought"
  | "task_complete";

export interface BaseEvent {
  id:        string;
  type:      EventType;
  timestamp: number;
  compact?:  boolean;
}

export interface UserMessageEvent  extends BaseEvent { type: "user_message";  content: string }
export interface AgentThoughtEvent extends BaseEvent { type: "agent_thought"; content: string }
export interface TaskCompleteEvent extends BaseEvent { type: "task_complete"; result: string }

export interface ToolCallEvent extends BaseEvent {
  type:      "tool_call";
  toolName:  string;
  toolUseId: string;
  input:     Record<string, unknown>;
}

export interface ToolResultEvent extends BaseEvent {
  type:           "tool_result";
  toolUseId:      string;
  content?:       string;
  offloadedPath?: string;
  isError:        boolean;
}

export type AgentEvent =
  | UserMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | AgentThoughtEvent
  | TaskCompleteEvent;

type AppendInput =
  | Omit<UserMessageEvent,  "id"|"timestamp">
  | Omit<ToolCallEvent,     "id"|"timestamp">
  | Omit<ToolResultEvent,   "id"|"timestamp">
  | Omit<AgentThoughtEvent, "id"|"timestamp">
  | Omit<TaskCompleteEvent, "id"|"timestamp">;

export class EventStream {
  private events:    AgentEvent[] = [];
  private idCounter  = 0;
  private onEmit:    (event: AgentEvent, seq: number) => void;

  constructor(onEmit: (event: AgentEvent, seq: number) => void) {
    this.onEmit = onEmit;
  }

  append(input: AppendInput): AgentEvent {
    const event = {
      ...input,
      id:        `evt_${++this.idCounter}`,
      timestamp: Date.now(),
    } as AgentEvent;

    this.events.push(event);
    const seq = this.events.length - 1;

    // SSE + DB로 동시 전달
    this.onEmit(event, seq);

    return event;
  }

  getAll(): readonly AgentEvent[] {
    return this.events;
  }

  // Compaction: tool_result의 content를 파일 경로로 교체 (가역적 압축)
  // 유일하게 허용된 "수정" 작업
  compactToolResult(eventId: string, offloadedPath: string): void {
    const idx = this.events.findIndex((e) => e.id === eventId);
    if (idx === -1) return;
    const evt = this.events[idx];
    if (evt.type !== "tool_result") return;
    this.events[idx] = { ...evt, content: undefined, offloadedPath, compact: true };
  }

  getTotalTokenEstimate(): number {
    return Math.floor(
      this.events.reduce((acc, e) => acc + JSON.stringify(e).length / 4, 0)
    );
  }
}
