"use client";

import * as React from "react";

import type { OperationChatSession } from "@/services/operationChatFileStore";

const ACTIVE_SESSION_KEY = "flowfit-active-operation-chat";

function sortSessions(sessions: OperationChatSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function useFlowFitConversations(newChatKey?: string | null) {
  const [sessions, setSessions] = React.useState<OperationChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const blankConversationRef = React.useRef(Boolean(newChatKey));

  const currentSession = React.useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  );

  const newConversation = React.useCallback(() => {
    blankConversationRef.current = true;
    setCurrentSessionId(null);
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  }, []);

  const loadSessions = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/operation-chat", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sessions?: OperationChatSession[] };
      const nextSessions = sortSessions(payload.sessions ?? []);
      setSessions(nextSessions);

      if (blankConversationRef.current || newChatKey) {
        setCurrentSessionId(null);
        return;
      }

      const savedId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      const nextId =
        savedId && nextSessions.some((session) => session.id === savedId)
          ? savedId
          : nextSessions[0]?.id ?? null;

      if (!newChatKey) {
        setCurrentSessionId((current) =>
          current && nextSessions.some((session) => session.id === current) ? current : nextId,
        );
      }
    } finally {
      setLoading(false);
    }
  }, [newChatKey]);

  React.useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  React.useEffect(() => {
    if (newChatKey) {
      newConversation();
    }
  }, [newChatKey, newConversation]);

  const selectSession = React.useCallback((sessionId: string) => {
    blankConversationRef.current = false;
    setCurrentSessionId(sessionId);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  }, []);

  const upsertSession = React.useCallback((session: OperationChatSession) => {
    blankConversationRef.current = false;
    setSessions((current) => {
      const exists = current.some((item) => item.id === session.id);
      const next = exists ? current.map((item) => (item.id === session.id ? session : item)) : [session, ...current];
      return sortSessions(next);
    });
    setCurrentSessionId(session.id);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
  }, []);

  const renameSession = React.useCallback(
    async (sessionId: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return false;

      const response = await fetch(`/api/operation-chat/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });

      if (!response.ok) return false;
      const payload = (await response.json()) as { session?: OperationChatSession };
      if (!payload.session) return false;
      upsertSession(payload.session);
      return true;
    },
    [upsertSession],
  );

  const deleteSession = React.useCallback(
    async (sessionId: string) => {
      const response = await fetch(`/api/operation-chat/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });

      if (!response.ok) return;

      setSessions((current) => current.filter((session) => session.id !== sessionId));
      if (currentSessionId === sessionId) {
        blankConversationRef.current = true;
        setCurrentSessionId(null);
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    },
    [currentSessionId],
  );

  return {
    currentSession,
    currentSessionId,
    deleteSession,
    loading,
    newConversation,
    refreshSessions: loadSessions,
    renameSession,
    selectSession,
    sessions,
    upsertSession,
  };
}
