import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type OperationChatRole = "user" | "assistant";

export type OperationChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
};

export type OperationChatMessage = {
  id: string;
  role: OperationChatRole;
  content: string;
  createdAt: string;
  attachments?: OperationChatAttachment[];
};

export type OperationChatSession = {
  id: string;
  title: string;
  messages: OperationChatMessage[];
  createdAt: string;
  updatedAt: string;
};

const DATA_DIR = path.join(process.cwd(), ".flowfit");
const DATA_FILE = path.join(DATA_DIR, "operation-chat-history.json");

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeTitle(message: string) {
  const title = message.trim().replace(/\s+/g, " ").slice(0, 32);
  return title || "새 운영 대화";
}

function buildAssistantReply(message: string) {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("배송") || lower.includes("지연")) {
    return [
      "배송 관련 요청으로 이해했습니다.",
      "",
      "제가 먼저 확인할 내용은 고객 문의, 배송 상태, 담당자 확인 필요 여부입니다. 고객에게 바로 발송되는 문구는 승인함에 올려 대표님이 확인한 뒤 실행하는 흐름으로 정리하겠습니다.",
    ].join("\n");
  }

  if (lower.includes("발주") || lower.includes("주문")) {
    return [
      "발주 또는 주문 확인 업무로 정리하겠습니다.",
      "",
      "거래처, 품목, 수량, 납기, 누락 가능성을 기준으로 확인하고, 직원 확인이 필요한 항목은 짧은 확인 요청 형태로 분리하겠습니다.",
    ].join("\n");
  }

  if (lower.includes("재고")) {
    return [
      "재고 관련 운영 요청으로 확인했습니다.",
      "",
      "부족 품목, 기준치 이하 항목, 발주 판단에 필요한 근거를 먼저 정리하고, 결정이 필요한 내용은 승인 카드로 넘기는 방식이 적절합니다.",
    ].join("\n");
  }

  if (lower.includes("클레임") || lower.includes("불만")) {
    return [
      "고객 불만 가능성이 있는 요청으로 보입니다.",
      "",
      "위험도를 먼저 낮게 단정하지 않고, 사과 문구, 현재 조치, 재안내 시간, 내부 확인 필요 항목을 나누어 검토 가능한 답변 초안으로 만들겠습니다.",
    ].join("\n");
  }

  return [
    "요청을 확인했습니다.",
    "",
    `제가 이해한 내용: ${normalized}`,
    "",
    "다음 단계로 필요한 자료를 확인하고, 반복 처리 가능한 부분과 대표님 승인이 필요한 부분을 나누어 정리하겠습니다.",
  ].join("\n");
}

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf8");
  } catch {
    await writeFile(DATA_FILE, "[]", "utf8");
  }
}

export async function readOperationChatSessions() {
  await ensureDataFile();

  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as OperationChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOperationChatSessions(sessions: OperationChatSession[]) {
  await ensureDataFile();
  await writeFile(DATA_FILE, JSON.stringify(sessions, null, 2), "utf8");
}

export async function renameOperationChatSession(sessionId: string, title: string) {
  const sessions = await readOperationChatSessions();
  const nextTitle = title.trim().replace(/\s+/g, " ").slice(0, 80);

  if (!nextTitle) {
    return null;
  }

  const now = new Date().toISOString();
  const nextSessions = sessions.map((session) =>
    session.id === sessionId ? { ...session, title: nextTitle, updatedAt: now } : session,
  );
  const updated = nextSessions.find((session) => session.id === sessionId) ?? null;

  if (updated) {
    await saveOperationChatSessions(nextSessions);
  }

  return updated;
}

export async function deleteOperationChatSession(sessionId: string) {
  const sessions = await readOperationChatSessions();
  const nextSessions = sessions.filter((session) => session.id !== sessionId);

  if (nextSessions.length === sessions.length) {
    return false;
  }

  await saveOperationChatSessions(nextSessions);
  return true;
}

export async function appendOperationChatMessage({
  sessionId,
  message,
  assistantContent,
  attachments = [],
}: {
  sessionId?: string;
  message: string;
  assistantContent?: string;
  attachments?: OperationChatAttachment[];
}) {
  const sessions = await readOperationChatSessions();
  const now = new Date().toISOString();
  const trimmed = message.trim();
  const userMessage: OperationChatMessage = {
    id: createId("user"),
    role: "user",
    content: trimmed,
    createdAt: now,
    attachments: attachments.length ? attachments : undefined,
  };
  const assistantMessage: OperationChatMessage = {
    id: createId("assistant"),
    role: "assistant",
    content: assistantContent ?? buildAssistantReply(trimmed),
    createdAt: new Date().toISOString(),
  };

  const existingIndex = sessionId ? sessions.findIndex((session) => session.id === sessionId) : -1;
  const nextSession: OperationChatSession =
    existingIndex >= 0
      ? {
          ...sessions[existingIndex],
          messages: [...sessions[existingIndex].messages, userMessage, assistantMessage],
          updatedAt: assistantMessage.createdAt,
        }
      : {
          id: createId("chat"),
          title: makeTitle(trimmed),
          messages: [userMessage, assistantMessage],
          createdAt: now,
          updatedAt: assistantMessage.createdAt,
        };

  const nextSessions =
    existingIndex >= 0
      ? sessions.map((session, index) => (index === existingIndex ? nextSession : session))
      : [nextSession, ...sessions];

  await saveOperationChatSessions(nextSessions);
  return nextSession;
}

export async function replaceLastAssistantMessage({
  sessionId,
  assistantContent,
}: {
  sessionId: string;
  assistantContent: string;
}) {
  const sessions = await readOperationChatSessions();
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId);

  if (sessionIndex < 0) {
    return null;
  }

  const session = sessions[sessionIndex];
  const messages = [...session.messages];

  if (messages.at(-1)?.role === "assistant") {
    messages.pop();
  }

  const lastUser = [...messages].reverse().find((message) => message.role === "user");

  if (!lastUser) {
    return null;
  }

  const assistantMessage: OperationChatMessage = {
    id: createId("assistant"),
    role: "assistant",
    content: assistantContent,
    createdAt: new Date().toISOString(),
  };

  const nextSession: OperationChatSession = {
    ...session,
    messages: [...messages, assistantMessage],
    updatedAt: assistantMessage.createdAt,
  };
  const nextSessions = sessions.map((item, index) => (index === sessionIndex ? nextSession : item));

  await saveOperationChatSessions(nextSessions);
  return nextSession;
}

export async function appendOperationChatAssistantMessage({
  sessionId,
  assistantContent,
}: {
  sessionId: string;
  assistantContent: string;
}) {
  const sessions = await readOperationChatSessions();
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId);

  if (sessionIndex < 0) {
    return null;
  }

  const assistantMessage: OperationChatMessage = {
    id: createId("assistant"),
    role: "assistant",
    content: assistantContent,
    createdAt: new Date().toISOString(),
  };
  const nextSession: OperationChatSession = {
    ...sessions[sessionIndex],
    messages: [...sessions[sessionIndex].messages, assistantMessage],
    updatedAt: assistantMessage.createdAt,
  };
  const nextSessions = sessions.map((session, index) => (index === sessionIndex ? nextSession : session));

  await saveOperationChatSessions(nextSessions);
  return nextSession;
}
