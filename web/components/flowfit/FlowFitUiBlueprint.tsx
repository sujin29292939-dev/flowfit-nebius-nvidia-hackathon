import {
  ArrowRight,
  ArrowUp,
  Bell,
  Bot,
  BriefcaseBusiness,
  CheckSquare,
  Code2,
  FileBox,
  History,
  Menu,
  MessageSquare,
  Mic,
  PackageCheck,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";

import { FlowFitLogoMark } from "@/components/flowfit/FlowFitLogoMark";

const shortcuts = [
  "자동 기준",
  "승인 기준",
  "기록 저장",
  "반복 알림",
  "배송",
  "발주",
  "답장",
  "재고",
  "자동화",
  "클레임",
  "예외접수",
  "보고",
  "미수금",
  "납기",
  "거래처",
  "단가",
  "실행중인 작업",
];

const sidebarItems = [
  { label: "새 채팅", icon: Plus, active: true },
  { label: "검색", icon: Search },
  { label: "채팅", icon: MessageSquare },
  { label: "프로젝트", icon: BriefcaseBusiness },
  { label: "아티팩트", icon: FileBox },
  { label: "코드", icon: Code2, muted: true },
  { label: "사용자 지정", icon: SlidersHorizontal },
];

const settingModules = [
  {
    title: "미수금 설정",
    body: "P1 금액 기준, P1 연체 일수, 재알림 주기를 조정합니다.",
    tone: "border-t-rose-500",
    icon: CheckSquare,
  },
  {
    title: "납기 설정",
    body: "납기 전 선제 알림, 지연 판정일, 담당자 재호출 기준을 조정합니다.",
    tone: "border-t-sky-500",
    icon: PackageCheck,
  },
  {
    title: "거래처 건강판단 설정",
    body: "거래처 R/F/M, 주의 점수, 발주량 감소 기준을 조정합니다.",
    tone: "border-t-emerald-500",
    icon: History,
  },
  {
    title: "단가표 설정",
    body: "주의 변동률, 심각 변동률, 에이전트가 읽을 파일 형식을 조정합니다.",
    tone: "border-t-violet-500",
    icon: FileBox,
  },
  {
    title: "반품·클레임 설정",
    body: "클레임 분류 항목, 기본 배정 방식, 누적 경고 기준을 조정합니다.",
    tone: "border-t-amber-500",
    icon: History,
  },
];

const automationModules = [
  {
    title: "현장 접수 앱 연결",
    body: "외부에서 들어오는 파일 수집 방식을 설정합니다.",
    tone: "border-t-sky-500",
    icon: MessageSquare,
  },
  {
    title: "모바일 감지기 상태",
    body: "모바일 수집기 연결 상태를 확인합니다.",
    tone: "border-t-emerald-500",
    icon: Bot,
  },
  {
    title: "문의 접수 자동화 기준",
    body: "문제 표시 기준과 기본 알림 규칙을 관리합니다.",
    tone: "border-t-violet-500",
    icon: SlidersHorizontal,
  },
  {
    title: "브라우저 자동화 연결",
    body: "자동화할 브라우저와 내부 제한 정책을 설정합니다.",
    tone: "border-t-indigo-500",
    icon: BriefcaseBusiness,
  },
];

function Sidebar() {
  return (
    <aside className="hidden h-[calc(100vh-32px)] w-[clamp(280px,22vw,360px)] shrink-0 flex-col rounded-[28px] border border-slate-200 bg-white/95 p-6 shadow-sm lg:flex">
      <div className="flex items-center justify-between">
        <div className="text-3xl font-black tracking-tight text-slate-950">FLOWFIT</div>
        <button className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 text-slate-700">
          <Bell size={20} />
        </button>
      </div>

      <nav className="mt-12 space-y-2">
        {sidebarItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className={[
                "flex h-12 w-full items-center gap-4 rounded-2xl px-4 text-left text-base font-semibold transition",
                item.active ? "bg-slate-950 text-white" : item.muted ? "text-slate-300" : "text-slate-700 hover:bg-slate-100",
              ].join(" ")}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-sm font-black text-white">FF</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">FlowFit 대표</p>
            <p className="truncate text-xs text-slate-500">대표 계정</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">설정</button>
          <button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">언어</button>
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-20 grid h-[clamp(72px,8vh,80px)] grid-cols-[56px_1fr_56px] items-center border-b border-slate-200 bg-white/85 px-[clamp(16px,3vw,32px)] backdrop-blur">
      <button className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm lg:hidden">
        <Menu size={24} />
      </button>
      <div className="hidden lg:block" />
      <div className="flex justify-center">
        <FlowFitLogoMark className="h-10 w-10 rounded-none bg-transparent" />
      </div>
      <button className="grid h-12 w-12 place-items-center justify-self-end rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm">
        <Bell size={21} />
      </button>
    </header>
  );
}

function ComposerMock() {
  return (
    <div className="mx-auto mt-8 flex h-[clamp(76px,10vh,88px)] w-[min(calc(100vw-32px),980px)] items-center gap-4 rounded-full border-[10px] border-zinc-800 bg-zinc-800 px-6 text-white shadow-xl">
      <Plus className="shrink-0 text-zinc-200" size={24} />
      <div className="min-w-0 flex-1 truncate text-base font-medium text-zinc-400 sm:text-lg">작업을 할당하거나 무엇이든 질문하세요</div>
      <Mic className="hidden shrink-0 text-zinc-100 sm:block" size={22} />
      <button className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-zinc-600 text-zinc-200">
        <ArrowUp size={22} />
      </button>
    </div>
  );
}

function ShortcutCard() {
  return (
    <section className="mx-auto mt-8 w-[min(calc(100vw-32px),1040px)] rounded-[28px] border border-slate-200 bg-white p-[clamp(20px,3vw,32px)] shadow-sm">
      <div className="mb-6 flex items-center justify-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-sky-50 text-sky-600">
          <Sparkles size={22} />
        </span>
        <h2 className="text-xl font-black text-slate-950">자주 쓰는 요청</h2>
      </div>

      <div className="mx-auto grid max-w-4xl grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
        {shortcuts.map((label, index) => {
          const tones = [
            "border-violet-200 bg-violet-50 text-violet-700",
            "border-rose-200 bg-rose-50 text-rose-700",
            "border-sky-200 bg-sky-50 text-sky-700",
            "border-emerald-200 bg-emerald-50 text-emerald-700",
            "border-amber-200 bg-amber-50 text-amber-700",
          ];
          return (
            <button
              key={label}
              className={`aspect-square min-h-[78px] rounded-2xl border px-2 text-sm font-black leading-tight transition hover:-translate-y-0.5 hover:shadow-sm ${tones[index % tones.length]}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-bold text-slate-800 shadow-sm">
          <Plus size={18} />
          키워드 추가
        </button>
        <button className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-200 px-5 text-sm font-bold text-white shadow-sm">
          <Trash2 size={17} />
          키워드 삭제
        </button>
      </div>
    </section>
  );
}

function OperationCards() {
  return (
    <section className="mx-auto mt-8 grid w-[min(calc(100vw-32px),1040px)] gap-5 lg:grid-cols-2">
      <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-black text-slate-950">오늘 운영 현황</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ["오늘 자동 처리", "0", "bg-emerald-50 border-emerald-200"],
            ["승인 필요", "0", "bg-slate-50 border-slate-200"],
            ["진행 중", "0", "bg-sky-50 border-sky-200"],
          ].map(([label, count, tone]) => (
            <div key={label} className={`rounded-2xl border p-5 ${tone}`}>
              <p className="text-sm font-bold text-slate-600">{label}</p>
              <p className="mt-3 text-4xl font-black text-slate-950">{count}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-black text-slate-950">AI가 기록에서 만든 팁</h3>
        <div className="mt-5 space-y-3">
          {[
            "고객 문의를 배송, 주문 변경, 일반 문의로 나누면 승인함 작업을 더 빨리 줄일 수 있습니다.",
            "되돌리기 가능한 내부 분류 작업은 자동 처리 기준에 적합합니다.",
            "반복되는 업무는 자동화 규칙으로 승격할 수 있습니다.",
          ].map((tip) => (
            <div key={tip} className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
              {tip}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function SettingsModuleGrid({ title, items }: { title: string; items: typeof settingModules }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-0 overflow-hidden sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className={`flex min-h-[172px] flex-col border-t-4 border-r border-slate-200 p-5 ${item.tone}`}>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white">
                <Icon size={22} />
              </div>
              <h3 className="mt-4 text-lg font-black text-slate-950">{item.title}</h3>
              <p className="mt-2 line-clamp-3 text-sm font-medium leading-6 text-slate-600">{item.body}</p>
              <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-black text-slate-950">
                <span>설정 변경</span>
                <ArrowRight size={19} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FlowFitUiBlueprint() {
  return (
    <main className="min-h-screen bg-[linear-gradient(#eef3f7_1px,transparent_1px),linear-gradient(90deg,#eef3f7_1px,transparent_1px)] bg-[size:36px_36px] text-slate-950">
      <div className="flex gap-[clamp(12px,1.8vw,24px)] p-[clamp(16px,3vw,32px)]">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <TopBar />

          <section className="pb-12 pt-[clamp(32px,5vh,56px)]">
            <h1 className="text-center text-[clamp(34px,6vw,56px)] font-black leading-tight tracking-tight text-slate-950">
              무엇을 도와드릴까요?
            </h1>
            <ComposerMock />
            <ShortcutCard />
            <OperationCards />
          </section>

          <section className="space-y-5 pb-16">
            <SettingsModuleGrid title="에이전트 판단 기준 설정" items={settingModules} />
            <SettingsModuleGrid title="연동과 자동화 설정" items={automationModules} />
          </section>
        </div>
      </div>
    </main>
  );
}
