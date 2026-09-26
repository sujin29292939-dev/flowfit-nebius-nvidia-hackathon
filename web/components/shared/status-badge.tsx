import { Badge } from "@/components/ui/badge";

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "danger" | "info" }
> = {
  "not-connected": { label: "미연결", variant: "default" },
  connecting: { label: "연결 중", variant: "info" },
  "needs-test": { label: "테스트 필요", variant: "warning" },
  active: { label: "활성", variant: "success" },
  error: { label: "오류", variant: "danger" },
  healthy: { label: "정상", variant: "success" },
  warning: { label: "주의", variant: "warning" },
  disconnected: { label: "연결 해제", variant: "default" },
  connected: { label: "연결됨", variant: "success" },
  "reauth-required": { label: "재인증 필요", variant: "warning" },
  "not-submitted": { label: "미제출", variant: "default" },
  "needs-renewal": { label: "갱신 필요", variant: "warning" },
  queued: { label: "대기 중", variant: "info" },
  running: { label: "실행 중", variant: "info" },
  success: { label: "성공", variant: "success" },
  failed: { label: "실패", variant: "danger" },
  received: { label: "접수됨", variant: "info" },
  reviewing: { label: "검토 중", variant: "warning" },
  "integration-prep": { label: "연동 준비", variant: "info" },
  testing: { label: "테스트 중", variant: "warning" },
  activated: { label: "활성 완료", variant: "success" },
  "revision-requested": { label: "수정 요청", variant: "danger" },
  open: { label: "열림", variant: "warning" },
  "in-progress": { label: "처리 중", variant: "info" },
  resolved: { label: "해결됨", variant: "success" },
  "on-hold": { label: "보류", variant: "default" },
  critical: { label: "긴급", variant: "danger" },
  info: { label: "정보", variant: "info" },
  "approval-pending": { label: "승인 대기", variant: "warning" },
  approved: { label: "승인", variant: "success" },
  rejected: { label: "반려", variant: "danger" },
  draft: { label: "초안", variant: "default" },
  completed: { label: "완료", variant: "success" },
  "needs-feedback": { label: "피드백 필요", variant: "warning" },
  "feedback-logged": { label: "피드백 기록", variant: "info" },
  pending: { label: "대기", variant: "warning" },
  edit: { label: "수정", variant: "info" },
  approve: { label: "승인", variant: "success" },
  reject: { label: "반려", variant: "danger" },
  request_change: { label: "수정 요청", variant: "warning" },
  "견적요청 감지됨": { label: "견적요청 감지", variant: "info" },
  "전송 완료": { label: "전송 완료", variant: "success" },
  "위험도 낮음": { label: "위험도 낮음", variant: "success" },
  "위험도 보통": { label: "위험도 보통", variant: "warning" },
  "위험도 높음": { label: "위험도 높음", variant: "danger" },
  source: { label: "출처", variant: "info" },
  department: { label: "부서", variant: "default" },
  role: { label: "역할", variant: "info" },
  situation: { label: "상황", variant: "warning" },
  output: { label: "출력", variant: "success" },
  rule: { label: "규칙", variant: "info" },
  exception: { label: "예외", variant: "danger" },
  person: { label: "담당자", variant: "default" },
};

export function StatusBadge({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const config = statusConfig[value] ?? {
    label: value,
    variant: "default" as const,
  };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
