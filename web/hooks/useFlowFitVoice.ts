"use client";

import * as React from "react";

import type { FlowFitLocale } from "@/hooks/useFlowFitChatI18n";

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly [index: number]: {
    readonly transcript: string;
  };
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function getRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function getSpeechLang(locale: FlowFitLocale) {
  return locale === "ko" ? "ko-KR" : "en-US";
}

export function useFlowFitSpeechRecognition({
  locale,
  onTranscript,
  onError,
}: {
  locale: FlowFitLocale;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [isListening, setIsListening] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);

  const isSupported = typeof window !== "undefined" && Boolean(getRecognitionConstructor());

  const stopListening = React.useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const startListening = React.useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      onError("unsupported");
      return;
    }

    stopListening();

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = getSpeechLang(locale);
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) {
          transcript += result[0]?.transcript ?? "";
        }
      }
      if (transcript.trim()) {
        onTranscript(transcript.trim());
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
      onError("failed");
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [locale, onError, onTranscript, stopListening]);

  React.useEffect(() => stopListening, [stopListening]);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
  };
}

export function useFlowFitSpeechSynthesis(locale: FlowFitLocale) {
  const [enabled, setEnabled] = React.useState(false);
  const isSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const speak = React.useCallback(
    (text: string) => {
      if (!enabled || !isSupported || !text.trim()) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = getSpeechLang(locale);
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    },
    [enabled, isSupported, locale],
  );

  const cancel = React.useCallback(() => {
    if (isSupported) {
      window.speechSynthesis.cancel();
    }
  }, [isSupported]);

  React.useEffect(() => cancel, [cancel]);

  return {
    cancel,
    enabled,
    isSupported,
    speak,
    toggle: () => setEnabled((current) => !current),
  };
}
