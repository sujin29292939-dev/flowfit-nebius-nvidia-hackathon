"use client";

import * as React from "react";
import { Link2, Plus, Trash2 } from "lucide-react";

import { useToast } from "@/components/shared/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AdminSettings, ExceptionInboxLink } from "@/lib/types";
import { cn } from "@/lib/utils";

const exceptionKeywordPresets = [
  "환불",
  "취소",
  "분쟁",
  "불만",
  "결제오류",
  "재발급",
  "변경",
  "지연",
  "미수령",
  "파손",
  "오배송",
  "주소변경",
  "계정문제",
  "긴급",
  "사고",
];

function makeExceptionLinkId() {
  return `exc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AdminSettingsScreen({ settings }: { settings: AdminSettings }) {
  const { toast } = useToast();
  const [warningThreshold, setWarningThreshold] = React.useState(settings.badgeRules.warningThreshold);
  const [criticalThreshold, setCriticalThreshold] = React.useState(settings.badgeRules.criticalThreshold);
  const [template, setTemplate] = React.useState(settings.defaultTestTemplate);
  const [rules, setRules] = React.useState(settings.notificationRules);
  const [exceptionLinks, setExceptionLinks] = React.useState<ExceptionInboxLink[]>(settings.exceptionInboxLinks ?? []);
  const [exceptionKeyword, setExceptionKeyword] = React.useState("");
  const [exceptionUrl, setExceptionUrl] = React.useState("");
  const [exceptionDescription, setExceptionDescription] = React.useState("");

  function addExceptionLink() {
    const keyword = exceptionKeyword.trim();
    const url = exceptionUrl.trim();
    const description = exceptionDescription.trim();

    if (!keyword || !url) {
      toast({
        title: "예외접수함 항목을 추가하지 못했습니다",
        description: "키워드와 URL을 모두 입력해 주세요.",
        tone: "error",
      });
      return;
    }

    setExceptionLinks((current) => [
      ...current,
      {
        id: makeExceptionLinkId(),
        keyword,
        url,
        description,
        enabled: true,
      },
    ]);
    setExceptionKeyword("");
    setExceptionUrl("");
    setExceptionDescription("");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>예외접수함</CardTitle>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                AI가 자동 처리하기 어려운 키워드가 감지되면 고객에게 안내할 외부 접수 링크를 관리합니다.
              </p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
              <Link2 className="h-3.5 w-3.5" />
              {exceptionLinks.filter((item) => item.enabled).length}개 활성
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {exceptionKeywordPresets.map((keyword) => (
              <button
                key={keyword}
                type="button"
                onClick={() => setExceptionKeyword(keyword)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  exceptionKeyword === keyword
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950",
                )}
              >
                {keyword}
              </button>
            ))}
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              value={exceptionKeyword}
              onChange={(event) => setExceptionKeyword(event.target.value)}
              placeholder="키워드"
              className="bg-white"
            />
            <Input
              value={exceptionUrl}
              onChange={(event) => setExceptionUrl(event.target.value)}
              placeholder="https://..."
              className="bg-white"
            />
            <Input
              value={exceptionDescription}
              onChange={(event) => setExceptionDescription(event.target.value)}
              placeholder="설명 선택"
              className="bg-white"
            />
            <Button type="button" onClick={addExceptionLink} disabled={!exceptionKeyword.trim() || !exceptionUrl.trim()}>
              <Plus className="h-4 w-4" />
              추가
            </Button>
          </div>

          <div className="space-y-3">
            {exceptionLinks.length ? (
              exceptionLinks.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition lg:flex-row lg:items-start",
                    !item.enabled && "opacity-45",
                  )}
                >
                  <Checkbox
                    checked={item.enabled}
                    onChange={(event) =>
                      setExceptionLinks((current) =>
                        current.map((link) => (link.id === item.id ? { ...link, enabled: event.target.checked } : link)),
                      )
                    }
                    label={item.keyword}
                    helper={item.description || "설명 없음"}
                  />
                  <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    <p className="truncate font-medium text-slate-700">{item.url}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${item.keyword} 삭제`}
                    title={`${item.keyword} 삭제`}
                    onClick={() => setExceptionLinks((current) => current.filter((link) => link.id !== item.id))}
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                아직 등록된 예외접수함 링크가 없습니다.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>문제 표시 기준</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="field-label">주의로 표시할 기준</label>
              <Input
                type="number"
                value={warningThreshold}
                onChange={(event) => setWarningThreshold(Number(event.target.value))}
              />
            </div>
            <div>
              <label className="field-label">위험으로 표시할 기준</label>
              <Input
                type="number"
                value={criticalThreshold}
                onChange={(event) => setCriticalThreshold(Number(event.target.value))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>테스트 메시지 기본 문구</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={template} onChange={(event) => setTemplate(event.target.value)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 알림 규칙</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.map((rule) => (
            <Checkbox
              key={rule.id}
              checked={rule.enabled}
              onChange={(event) =>
                setRules((current) =>
                  current.map((item) => (item.id === rule.id ? { ...item, enabled: event.target.checked } : item)),
                )
              }
              label={rule.title}
              helper={`${rule.condition} / ${rule.channel}`}
            />
          ))}
        </CardContent>
      </Card>

      <Button
        onClick={() =>
          toast({
            title: "설정이 저장되었습니다",
            description: "문의 접수 자동화 설정에 변경 내용을 반영했습니다.",
            tone: "success",
          })
        }
      >
        설정 저장
      </Button>
    </div>
  );
}
