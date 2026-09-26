export type FlowFitAiProvider = "anthropic" | "groq" | "gemini" | "nebius";

function normalizeProvider(value: string | undefined, fallback: FlowFitAiProvider): FlowFitAiProvider {
  const normalized = value?.toLowerCase();
  if (normalized === "anthropic" || normalized === "groq" || normalized === "gemini" || normalized === "nebius") return normalized;
  return fallback;
}

function defaultModel(provider: FlowFitAiProvider): string {
  if (provider === "groq") return "openai/gpt-oss-120b";
  if (provider === "gemini") return process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  if (provider === "nebius") return process.env.NEBIUS_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
  return "claude-sonnet-4-5";
}

export function getFlowFitAiProvider(): FlowFitAiProvider {
  return normalizeProvider(
    process.env.FLOWFIT_AI_PROVIDER ?? process.env.TASK_UNDERSTANDING_PROVIDER,
    "anthropic",
  );
}

export function getFlowFitAiModel(provider: FlowFitAiProvider = getFlowFitAiProvider()): string {
  return (
    (provider === "gemini" ? process.env.GEMINI_MODEL : provider === "nebius" ? process.env.NEBIUS_MODEL : undefined) ??
    process.env.FLOWFIT_AI_MODEL ??
    process.env.TASK_UNDERSTANDING_MODEL ??
    defaultModel(provider)
  );
}

export function getTaskUnderstandingProvider(): FlowFitAiProvider {
  return normalizeProvider(
    process.env.TASK_UNDERSTANDING_PROVIDER ?? process.env.FLOWFIT_AI_PROVIDER,
    getFlowFitAiProvider(),
  );
}

export function getTaskUnderstandingModel(provider: FlowFitAiProvider = getTaskUnderstandingProvider()): string {
  return (
    (provider === "gemini" ? process.env.GEMINI_MODEL : provider === "nebius" ? process.env.NEBIUS_MODEL : undefined) ??
    process.env.TASK_UNDERSTANDING_MODEL ??
    process.env.FLOWFIT_AI_MODEL ??
    defaultModel(provider)
  );
}

export function getGeneralChatModel(): string {
  const provider = getFlowFitAiProvider();
  return (
    (provider === "gemini" ? process.env.GEMINI_MODEL : provider === "nebius" ? process.env.NEBIUS_MODEL : undefined) ??
    process.env.FLOWFIT_AI_MODEL ??
    process.env.GROQ_CHAT_MODEL ??
    defaultModel(provider)
  );
}
