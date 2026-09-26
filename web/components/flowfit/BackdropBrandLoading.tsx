"use client";

import { ShieldCheck, Sparkles } from "lucide-react";

export function BackdropBrandLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-slate-950 shadow-2xl">
          <Sparkles className="h-7 w-7" />
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.28em] text-sky-200">FlowFit</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight">고객 전용 서버 세션을 준비하고 있습니다</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-300">
          이 PC는 실행만 담당하고, 업무 판단과 정책은 FlowFit Runner에서 관리합니다.
          준비가 끝나면 로그인 화면이 열립니다.
        </p>
        <div className="mx-auto mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-slate-200">
          <ShieldCheck className="h-4 w-4" />
          서버 정책, 기기 연결, 안전 게이트 확인 중
        </div>
      </div>
    </div>
  );
}
