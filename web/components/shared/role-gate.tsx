"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { ReactNode } from "react";

import { useAuthRole } from "@/components/shared/auth-provider";
import { roleDefaultRoute } from "@/lib/navigation";
import type { UserRole } from "@/lib/types";

export function RoleGate({
  allowedRole,
  children,
}: {
  allowedRole: UserRole;
  children: ReactNode;
}) {
  const router = useRouter();
  const { role, hydrated, switchRole } = useAuthRole();

  React.useEffect(() => {
    if (!hydrated || role === allowedRole) {
      return;
    }

    switchRole(allowedRole);
    router.replace(roleDefaultRoute[allowedRole]);
  }, [allowedRole, hydrated, role, router, switchRole]);

  if (!hydrated || role !== allowedRole) {
    return <div className="surface-grid min-h-screen" />;
  }

  return <>{children}</>;
}
