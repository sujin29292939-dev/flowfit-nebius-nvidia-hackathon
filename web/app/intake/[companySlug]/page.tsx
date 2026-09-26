import { FieldQuickIntakePage } from "@/components/flowfit/FieldQuickIntakePage";

export const dynamic = "force-dynamic";

export default function IntakePage({ params }: { params: { companySlug: string } }) {
  return <FieldQuickIntakePage companySlug={params.companySlug} />;
}
