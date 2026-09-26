import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

type HighlightCard = {
  label: string;
  value: string;
  note: string;
};

type DetailItem = {
  label: string;
  value: string;
  note?: string;
};

type DetailSection = {
  title: string;
  description: string;
  items: DetailItem[];
};

export function IntegrationModuleSettingsScreen({
  title,
  description,
  caption = "연동 운영 기준",
  updatedAt,
  highlights,
  sections,
}: {
  title: string;
  description: string;
  caption?: string;
  updatedAt?: string | null;
  highlights: HighlightCard[];
  sections: DetailSection[];
}) {
  return (
    <div className="space-y-6">
      <div className="sticky top-[5.25rem] z-30 -mb-3 -mt-2 flex w-fit justify-start rounded-full border border-slate-200 bg-white p-1 shadow-sm xl:top-4">
        <Link
          href="/admin/settings"
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          관리 설정으로 돌아가기
        </Link>
      </div>
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div>
              <p className="muted-caption">{caption}</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">마지막 변경</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{formatDateTime(updatedAt ?? new Date().toISOString())}</p>
            <p className="mt-1 text-xs text-slate-500">현재 연결 상태와 자동화 기준을 카드로 확인합니다.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {highlights.map((item) => (
          <Card key={item.label} className="border-slate-200 bg-white/90">
            <CardHeader className="pb-3">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-2xl">{item.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-slate-500">{item.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title} className="border-slate-200 bg-white/90">
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {section.items.length ? (
                section.items.map((item) => (
                  <div key={`${section.title}-${item.label}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-950">{item.label}</p>
                        {item.note ? <p className="mt-1 text-sm leading-6 text-slate-500">{item.note}</p> : null}
                      </div>
                      <p className="break-all text-left text-sm font-semibold text-slate-900 sm:max-w-[55%] sm:text-right">{item.value}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  표시할 항목이 없습니다.
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
