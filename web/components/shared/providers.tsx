"use client";

import * as React from "react";

import { AuthProvider } from "@/components/shared/auth-provider";
import { ToastProvider } from "@/components/shared/toast-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AuthProvider>
  );
}
