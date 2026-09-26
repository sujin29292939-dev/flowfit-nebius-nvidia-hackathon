import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>페이지를 찾을 수 없습니다</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">
            요청한 운영 경로가 존재하지 않거나 mock 데이터에 없는 고객사 ID입니다.
          </p>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
            운영 진입으로 돌아가기
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
