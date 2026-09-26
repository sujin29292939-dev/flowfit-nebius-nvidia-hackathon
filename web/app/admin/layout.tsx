import type { ReactNode } from "react";

import { AppShell } from "@/components/shared/app-shell";
import { RoleGate } from "@/components/shared/role-gate";
import { getOpsConnectionMode } from "@/lib/ops-engine";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const dataMode = await getOpsConnectionMode();

  return (
    <RoleGate allowedRole="admin">
      <AppShell role="admin" dataMode={dataMode}>
        {children}
      </AppShell>
    </RoleGate>
  );
}
