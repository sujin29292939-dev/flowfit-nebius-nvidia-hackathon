import { AiApprovalInbox } from "@/components/flowfit/AiApprovalInbox";
import { RunnerPipelinePanel } from "@/components/flowfit/RunnerPipelinePanel";

export const dynamic = "force-dynamic";

export default async function AgentRunsPage() {
  return (
    <div className="space-y-6">
      <AiApprovalInbox />
      <RunnerPipelinePanel />
    </div>
  );
}
