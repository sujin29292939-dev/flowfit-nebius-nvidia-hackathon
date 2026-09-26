import type { Metadata } from "next";

import { FlowFitUiBlueprint } from "@/components/flowfit/FlowFitUiBlueprint";

export const metadata: Metadata = {
  title: "FlowFit UI Blueprint",
  description: "FlowFit responsive UI layout blueprint",
};

export default function UiBlueprintPage() {
  return <FlowFitUiBlueprint />;
}
