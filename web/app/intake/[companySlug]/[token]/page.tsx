import { FieldQuickIntakePage } from "@/components/flowfit/FieldQuickIntakePage";

export const dynamic = "force-dynamic";

export default function TokenIntakePage({ params }: { params: { companySlug: string; token: string } }) {
  return <FieldQuickIntakePage companySlug={params.companySlug} token={params.token} />;
}
