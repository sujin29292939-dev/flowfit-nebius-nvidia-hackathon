import { FieldQuickIntakePage } from "@/components/flowfit/FieldQuickIntakePage";

export const dynamic = "force-dynamic";

export default function CompanyStaffIntakePage({ params }: { params: { companySlug: string } }) {
  return <FieldQuickIntakePage companySlug={params.companySlug} />;
}
