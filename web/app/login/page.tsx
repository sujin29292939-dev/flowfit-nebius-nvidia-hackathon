import { Suspense } from "react";

import { AdminLoginPage } from "@/components/flowfit/AdminLoginPage";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <AdminLoginPage />
    </Suspense>
  );
}
