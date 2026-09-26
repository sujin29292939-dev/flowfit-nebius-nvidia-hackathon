import {
  ClipboardCheck,
  ClipboardList,
  History,
  MessageSquare,
  Settings2,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const adminNavigation: NavigationItem[] = [
  { href: "/admin/agent-runs", label: "AI 작업 승인함", icon: ClipboardCheck },
  { href: "/admin/chat-history", label: "전체 채팅기록", icon: MessageSquare },
  { href: "/admin/exceptions", label: "예외 접수함", icon: ClipboardList },
  { href: "/admin/staff-confirmations", label: "직원 확인 요청", icon: UserRoundCheck },
  { href: "/admin/auto-logs", label: "자동 처리 기록", icon: History },
  { href: "/admin/settings", label: "설정", icon: Settings2 },
];

export const roleDefaultRoute = {
  admin: "/workspace",
} as const;
