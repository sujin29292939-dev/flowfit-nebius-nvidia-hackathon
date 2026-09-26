"use client";

import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RunnerProvisionResponse } from "@/services/runnerClient";
import { BackdropBrandLoading } from "./BackdropBrandLoading";
import { ServerSessionProvisioning } from "./ServerSessionProvisioning";

const STORAGE_KEY = "flowfit:firstRunProvisioned";

type Props = {
  children: React.ReactNode;
};

export function FirstRunTokenGate({ children }: Props) {
  const [checked, setChecked] = React.useState(false);
  const [provisioned, setProvisioned] = React.useState(false);
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<RunnerProvisionResponse | null>(null);
  const gateDisabled = process.env.NEXT_PUBLIC_FLOWFIT_DISABLE_FIRST_RUN_GATE === "1";

  React.useEffect(() => {
    if (gateDisabled) {
      setProvisioned(true);
      setChecked(true);
      return;
    }
    setProvisioned(Boolean(window.localStorage.getItem(STORAGE_KEY)));
    setChecked(true);
  }, [gateDisabled]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/runner/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          deviceLabel: navigator.platform ? `FlowFit UI / ${navigator.platform}` : "FlowFit UI",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as RunnerProvisionResponse & { error?: string };
      if (!response.ok || !body.ready) {
        setError(body.error ?? "토큰을 확인할 수 없습니다.");
        if (Array.isArray(body.steps)) setResult(body);
        return;
      }
      setResult(body);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          provisionedAt: new Date().toISOString(),
          sessionId: body.sessionId,
          companyId: body.companyId,
          plan: body.plan,
        }),
      );
      window.setTimeout(() => setProvisioned(true), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "서버 세션을 준비하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (!checked) {
    return <main className="min-h-screen bg-slate-50" />;
  }

  if (provisioned) {
    return <>{children}</>;
  }

  const isProvisioning = loading || result;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50">
      {isProvisioning ? (
        <BackdropBrandLoading />
      ) : (
        <div className="pointer-events-none select-none blur-sm brightness-75">
          {children}
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45 px-4 py-10">
        {isProvisioning ? (
          <ServerSessionProvisioning result={result} error={error} loading={loading} />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-3xl border border-white/20 bg-white p-6 shadow-2xl"
          >
            <div className="mb-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <KeyRound className="h-5 w-5" />
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">First Run</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950">발급 토큰을 입력하세요</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                FlowFit이 회사 전용 서버 세션과 실행 정책을 준비한 뒤 로그인 화면을 엽니다.
              </p>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-slate-950">회사 발급 토큰</span>
              <Input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="발급받은 토큰을 입력하세요"
                autoComplete="off"
                className="mt-2"
              />
            </label>

            {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

            <Button type="submit" className="mt-5 w-full" disabled={loading || !token.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              서버 세션 준비
            </Button>

            <p className={cn("mt-4 text-xs leading-5 text-slate-500")}>
              토큰은 브라우저 저장소에 남기지 않습니다. 준비 완료 여부와 회사 식별 정보만 이 PC에 저장됩니다.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
