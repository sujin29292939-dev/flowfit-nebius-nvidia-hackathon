import { Badge } from "@/components/ui/badge";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);

  if (confidence >= 0.8) {
    return <Badge variant="success">신뢰도 높음 {percent}%</Badge>;
  }

  if (confidence >= 0.55) {
    return <Badge variant="warning">신뢰도 중간 {percent}%</Badge>;
  }

  return <Badge variant="danger">신뢰도 낮음 {percent}%</Badge>;
}
