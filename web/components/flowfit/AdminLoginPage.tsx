"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FirstRunTokenGate } from "./FirstRunTokenGate";

type LoginResponse = {
  ok?: boolean;
  bridge?: {
    serverUrl: string;
    authToken: string;
    sessionId?: string;
    pollIntervalMs?: number;
  };
};

function getSafeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/workspace";
  return next;
}

export function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userId, setUserId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as LoginResponse;

      if (!response.ok) {
        setError("아이디 또는 비밀번호가 올바르지 않습니다.");
        return;
      }

      if (payload.bridge) {
        window.postMessage(
          {
            type: "FLOWFIT_CONFIG",
            serverUrl: payload.bridge.serverUrl,
            authToken: payload.bridge.authToken,
            sessionId: payload.bridge.sessionId,
            pollIntervalMs: payload.bridge.pollIntervalMs ?? 1500,
          },
          window.location.origin,
        );
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      router.replace(getSafeNext(searchParams.get("next")));
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FirstRunTokenGate>
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
            <img
              src="/flowfit-symbol.png"
              alt="FlowFit"
              className="block h-12 w-12 object-contain"
              style={{ width: 48, height: 48, maxWidth: 48, maxHeight: 48 }}
            />
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-slate-950">FlowFit 보안 로그인</h1>
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">방화벽 적용</Badge>
              <Badge>HTTP-only 세션</Badge>
              <Badge variant="info">Gate 설정 자동 주입</Badge>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-950">관리자 ID</span>
                <Input
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  autoComplete="username"
                  className="mt-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-950">비밀번호</span>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="mt-2"
                />
              </label>

              {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

              <Button type="submit" className="w-full" disabled={submitting || !userId.trim() || !password}>
                <ShieldCheck className="h-4 w-4" />
                로그인
              </Button>
            </form>

            <p className="text-xs leading-5 text-slate-500">
              아이디와 비밀번호는 URL, 화면 문구, localStorage에 저장하지 않습니다. 로그인 성공 후 확장 프로그램에는 서버 주소와
              Gate 토큰만 전달합니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
    </FirstRunTokenGate>
  );
}
