"use client";

import * as React from "react";

import messages from "@/components/flowfit/chat/messages.json";

export type FlowFitLocale = keyof typeof messages;
export type FlowFitMessageKey = keyof (typeof messages)["ko"];

const LOCALE_KEY = "flowfit-chat-locale";

export function useFlowFitChatI18n() {
  const [locale, setLocaleState] = React.useState<FlowFitLocale>("ko");

  React.useEffect(() => {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (saved === "ko" || saved === "en") {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = React.useCallback((nextLocale: FlowFitLocale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(LOCALE_KEY, nextLocale);
  }, []);

  const toggleLocale = React.useCallback(() => {
    setLocaleState((current) => {
      const next = current === "ko" ? "en" : "ko";
      window.localStorage.setItem(LOCALE_KEY, next);
      return next;
    });
  }, []);

  const t = React.useCallback(
    (key: FlowFitMessageKey, params?: Record<string, string | number>) => {
      let value = messages[locale][key] ?? messages.ko[key] ?? key;

      if (params) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
          value = value.replaceAll(`{${paramKey}}`, String(paramValue));
        }
      }

      return value;
    },
    [locale],
  );

  return {
    locale,
    setLocale,
    t,
    toggleLocale,
  };
}
