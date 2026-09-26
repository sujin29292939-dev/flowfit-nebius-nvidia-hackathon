"use client";

import * as React from "react";
import { ArrowLeft, CheckCircle2, Clock3, Save } from "lucide-react";
import Link from "next/link";

import { useToast } from "@/components/shared/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WholesaleSettingsModuleRoute } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type SettingsOption = {
  label: string;
  value: string;
  helper?: string;
};

type SettingsField = {
  key: string;
  label: string;
  helper?: string;
  type: "number" | "text" | "textarea" | "checkbox" | "select" | "checkbox-group";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  unitIcon?: "clock";
  placeholder?: string;
  options?: SettingsOption[];
};

export type WholesaleSettingsFieldSection = {
  title: string;
  description: string;
  fields: SettingsField[];
};

type HighlightCard = {
  label: string;
  value: string;
  note: string;
};

function toRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function WholesaleModuleSettingsScreen({
  module,
  title,
  description,
  highlights,
  sections,
  initialValues,
  updatedAt,
}: {
  module: WholesaleSettingsModuleRoute;
  title: string;
  description: string;
  highlights: HighlightCard[];
  sections: WholesaleSettingsFieldSection[];
  initialValues: object;
  updatedAt: string;
}) {
  const { toast } = useToast();
  const [values, setValues] = React.useState<object>(initialValues);
  const [isSaving, startTransition] = React.useTransition();

  function setFieldValue(key: string, nextValue: unknown) {
    setValues((current) => ({
      ...toRecord(current),
      [key]: nextValue,
    }));
  }

  function toggleCheckboxGroupValue(key: string, optionValue: string, checked: boolean) {
    const currentValue = toRecord(values)[key];
    const currentArray = Array.isArray(currentValue)
      ? currentValue.filter((item): item is string => typeof item === "string")
      : [];

    const next = checked
      ? Array.from(new Set([...currentArray, optionValue]))
      : currentArray.filter((item) => item !== optionValue);

    setFieldValue(key, next);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/settings/${module}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(values),
        });

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; message?: string; settings?: Record<string, unknown> }
          | null;

        if (!response.ok || !payload?.ok || !payload.settings) {
          throw new Error(payload?.message ?? "설정을 저장하지 못했습니다.");
        }

        setValues(payload.settings);
        toast({
          title: `${title} 저장 완료`,
          description: "경고: 저장 후 앱을 재시작해야 새 기준이 실행됩니다.",
          tone: "success",
        });
      } catch (error) {
        toast({
          title: `${title} 저장 실패`,
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
          tone: "error",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-[5.25rem] z-30 -mb-3 -mt-2 flex justify-start bg-gradient-to-b from-white/95 via-white/90 to-transparent pb-3 pt-2 backdrop-blur xl:top-4">
        <Link
          href="/admin/settings"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          관리 설정으로 돌아가기
        </Link>
      </div>
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div>
              <p className="muted-caption">도매 운영 기준</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">{title}</h1>
              {description ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">최근 저장된 시간</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{formatDateTime(updatedAt)}</p>
            <p className="mt-1 text-xs text-amber-700">경고: 저장 후 앱을 재시작해야 새 기준이 실행됩니다.</p>
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
            <CardContent className="space-y-5">
              {section.fields.map((field) => {
                const record = toRecord(values);
                const fieldValue = record[field.key];

                if (field.type === "checkbox") {
                  return (
                    <Checkbox
                      key={field.key}
                      checked={Boolean(fieldValue)}
                      onChange={(event) => setFieldValue(field.key, event.target.checked)}
                      label={field.label}
                      helper={field.helper}
                    />
                  );
                }

                if (field.type === "checkbox-group") {
                  const current = Array.isArray(fieldValue)
                    ? fieldValue.filter((item): item is string => typeof item === "string")
                    : [];

                  return (
                    <div key={field.key} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{field.label}</p>
                        {field.helper ? (
                          <p className="mt-1 text-sm leading-6 text-slate-500">{field.helper}</p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        {(field.options ?? []).map((option) => (
                          <Checkbox
                            key={option.value}
                            checked={current.includes(option.value)}
                            onChange={(event) =>
                              toggleCheckboxGroupValue(field.key, option.value, event.target.checked)
                            }
                            label={option.label}
                            helper={option.helper}
                          />
                        ))}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={field.key}>
                    <label className="field-label">{field.label}</label>
                    {field.helper ? (
                      <p className="mb-2 text-sm leading-6 text-slate-500">{field.helper}</p>
                    ) : null}

                    {field.type === "number" ? (
                      <div className="relative">
                        <Input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step ?? 1}
                          value={typeof fieldValue === "number" ? fieldValue : Number(fieldValue ?? 0)}
                          onChange={(event) => setFieldValue(field.key, Number(event.target.value))}
                          className={field.unit ? "pr-20" : undefined}
                        />
                        {field.unit ? (
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-sm font-medium text-slate-500">
                            {field.unitIcon === "clock" ? <Clock3 className="h-4 w-4" /> : null}
                            {field.unit}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {field.type === "text" ? (
                      <Input
                        type="text"
                        value={typeof fieldValue === "string" ? fieldValue : ""}
                        placeholder={field.placeholder}
                        onChange={(event) => setFieldValue(field.key, event.target.value)}
                      />
                    ) : null}

                    {field.type === "textarea" ? (
                      <Textarea
                        value={typeof fieldValue === "string" ? fieldValue : ""}
                        placeholder={field.placeholder}
                        onChange={(event) => setFieldValue(field.key, event.target.value)}
                      />
                    ) : null}

                    {field.type === "select" ? (
                      <Select
                        value={typeof fieldValue === "string" ? fieldValue : ""}
                        onChange={(event) => setFieldValue(field.key, event.target.value)}
                      >
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="sticky bottom-4 z-20 flex justify-end">
        <div className="ml-auto flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-panel backdrop-blur">
          <div className="hidden items-center gap-2 text-sm text-slate-500 md:flex">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            변경 기준은 사용자의 로컬 설정 파일에 저장됩니다.
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4" />
            {isSaving ? "저장 중..." : "설정 저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
