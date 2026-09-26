import type { Metadata } from "next";

import { AiOperationRoom } from "@/components/flowfit/AiOperationRoom";
import { AppShell } from "@/components/shared/app-shell";
import { RoleGate } from "@/components/shared/role-gate";
import { getOpsConnectionMode } from "@/lib/ops-engine";
import SummaryCards from "./components/SummaryCards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FlowFit",
  description: "AI와 운영 대화를 이어가는 FlowFit 화면",
};

type WorkspacePageProps = {
  searchParams?: {
    new?: string | string[];
    view?: string | string[];
  };
};

export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const dataMode = await getOpsConnectionMode();
  const newParam = Array.isArray(searchParams?.new) ? searchParams?.new[0] : searchParams?.new;
  const viewParam = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  const newChatKey = newParam ?? null;

  return (
    <RoleGate allowedRole="admin">
      <AppShell role="admin" dataMode={dataMode}>
        <AiOperationRoom
          newChatKey={newChatKey}
          initialView={viewParam === "ai-running" ? "ai-running" : "start"}
          summarySlot={(
            <SummaryCards />
          )}
        />
      </AppShell>
    </RoleGate>
  );
}
