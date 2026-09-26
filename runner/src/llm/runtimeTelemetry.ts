import { getTaskUnderstandingModel, getTaskUnderstandingProvider } from "./modelConfig.js";

type RuntimeState = {
  provider: string | null;
  model: string | null;
  route: string | null;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  successCount: number;
};

const state: RuntimeState = {
  provider: null,
  model: null,
  route: null,
  latencyMs: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  successCount: 0,
};

export function recordAiRuntimeSuccess(input: {
  provider: string;
  model: string;
  route: string;
  latencyMs: number;
}) {
  state.provider = input.provider;
  state.model = input.model;
  state.route = input.route;
  state.latencyMs = input.latencyMs;
  state.lastSuccessAt = new Date().toISOString();
  state.lastError = null;
  state.successCount += 1;
}

export function recordAiRuntimeFailure(error: unknown) {
  state.lastErrorAt = new Date().toISOString();
  state.lastError = error instanceof Error ? error.message : String(error);
}

export function getAiRuntimeTelemetry() {
  const configuredProvider = getTaskUnderstandingProvider();
  const configuredModel = getTaskUnderstandingModel(configuredProvider);
  const live = Boolean(state.lastSuccessAt);

  return {
    status: live ? "live" : process.env.NEBIUS_API_KEY ? "configured" : "not_configured",
    configuredProvider,
    configuredModel,
    provider: state.provider ?? configuredProvider,
    model: state.model ?? configuredModel,
    route: state.route,
    latencyMs: state.latencyMs,
    lastSuccessAt: state.lastSuccessAt,
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
    successCount: state.successCount,
    prototype: true,
  };
}
