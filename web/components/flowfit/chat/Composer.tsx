"use client";

import { ArrowUp, FileText, Image, Mic, MicOff, Paperclip, Square, Volume2, VolumeX, X } from "lucide-react";
import * as React from "react";

import type { FlowFitLocale, FlowFitMessageKey } from "@/hooks/useFlowFitChatI18n";
import { useFlowFitSpeechRecognition } from "@/hooks/useFlowFitVoice";
import { cn } from "@/lib/utils";
import type { OperationChatAttachment } from "@/services/operationChatFileStore";

const MAX_ATTACHMENTS = 4;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

type Translate = (key: FlowFitMessageKey, params?: Record<string, string | number>) => string;

function makeAttachmentId() {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function fileToAttachment(file: File): Promise<OperationChatAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
  const dataBase64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;

  return {
    id: makeAttachmentId(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    dataBase64,
  };
}

export function Composer({
  disabled,
  isGenerating,
  locale,
  onSend,
  onStop,
  onToggleTts,
  t,
  ttsEnabled,
  ttsSupported,
}: {
  disabled?: boolean;
  isGenerating: boolean;
  locale: FlowFitLocale;
  onSend: (message: string, attachments: OperationChatAttachment[]) => void;
  onStop: () => void;
  onToggleTts: () => void;
  t: Translate;
  ttsEnabled: boolean;
  ttsSupported: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [attachments, setAttachments] = React.useState<OperationChatAttachment[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const isSendDisabled = disabled || isGenerating || (!value.trim() && attachments.length === 0);
  const speech = useFlowFitSpeechRecognition({
    locale,
    onError: (reason) => setError(reason === "unsupported" ? t("sttUnsupported") : t("failedResponse")),
    onTranscript: (text) => setValue((current) => `${current}${current.trim() ? " " : ""}${text}`),
  });

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    setError(null);

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setError(t("attachmentLimit"));
      return;
    }

    const nextAttachments: OperationChatAttachment[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(t("attachmentTooLarge"));
        return;
      }
      nextAttachments.push(await fileToAttachment(file));
    }

    setAttachments((current) => [...current, ...nextAttachments].slice(0, MAX_ATTACHMENTS));
  }

  function submit() {
    if (isSendDisabled) return;
    const trimmed = value.trim() || t("attachmentOnlyPrompt");
    const nextAttachments = attachments;
    setValue("");
    setAttachments([]);
    setError(null);
    onSend(trimmed, nextAttachments);
  }

  return (
    <div
      className="sticky bottom-0 z-30 shrink-0 border-t border-slate-200 bg-white px-4 py-4 sm:px-6"
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        void addFiles(event.dataTransfer.files);
      }}
    >
      <div
        className={cn(
          "relative mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-2 shadow-lg shadow-slate-200/50 transition",
          dragActive && "border-sky-400 bg-sky-50",
        )}
      >
        {dragActive ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-sky-400 bg-sky-50/90 text-sm font-semibold text-sky-700">
            {t("dropHint")}
          </div>
        ) : null}

        {attachments.length ? (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {attachments.map((attachment) => {
              const isImage = attachment.mimeType.startsWith("image/");
              const Icon = isImage ? Image : FileText;

              return (
                <div
                  key={attachment.id}
                  className="flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[12rem] truncate font-semibold">{attachment.name}</span>
                  <span className="shrink-0 text-slate-400">{formatBytes(attachment.size)}</span>
                  <button
                    type="button"
                    aria-label={t("removeAttachment")}
                    title={t("removeAttachment")}
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-950"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          maxLength={32_000}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={t("composerPlaceholder")}
          rows={1}
          className="max-h-[200px] min-h-11 w-full resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
        />

        {error ? <p className="px-2 pb-2 text-xs font-medium text-amber-700">{error}</p> : null}

        <div className="flex items-center gap-2 px-1 pb-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            aria-label={t("addFile")}
            title={t("addFile")}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={speech.isListening ? t("voiceInputStop") : t("voiceInput")}
            title={speech.isListening ? t("voiceInputStop") : t("voiceInput")}
            onClick={() => {
              if (speech.isListening) {
                speech.stopListening();
              } else {
                speech.startListening();
              }
            }}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950",
              speech.isListening && "bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700",
            )}
          >
            {speech.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label={ttsEnabled ? t("voiceOutputOn") : t("voiceOutputOff")}
            title={ttsSupported ? t("voiceOutput") : t("ttsUnsupported")}
            onClick={ttsSupported ? onToggleTts : undefined}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950",
              ttsEnabled && "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
              !ttsSupported && "cursor-not-allowed opacity-50",
            )}
          >
            {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <div className="flex-1" />
          <span className={cn("text-xs text-slate-400", value.length > 30_000 && "text-amber-600")}>
            {value.length.toLocaleString(locale === "ko" ? "ko-KR" : "en-US")} / 32,000
          </span>
          {isGenerating ? (
            <button
              type="button"
              aria-label={t("stop")}
              title={t("stop")}
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("send")}
              title={t("send")}
              disabled={isSendDisabled}
              onClick={submit}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
