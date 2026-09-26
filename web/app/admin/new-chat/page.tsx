import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function NewChatPage() {
  redirect(`/workspace?new=${Date.now()}`);
}
