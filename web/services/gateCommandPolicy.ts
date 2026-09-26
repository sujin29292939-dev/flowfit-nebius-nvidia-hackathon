import type { GateCommandPolicy, GatePolicyLevel } from "@/lib/types";

const safeCommands = [
  "TAB_LIST",
  "TAB_NEW",
  "TAB_ACTIVATE",
  "TAB_INFO",
  "NAVIGATE",
  "BACK",
  "FORWARD",
  "RELOAD",
  "GET_HTML",
  "GET_TEXT",
  "FIND_ELEMENTS",
  "GET_ATTR",
  "CLICK",
  "TYPE",
  "CLEAR",
  "SELECT",
  "SCROLL",
  "FOCUS",
  "HOVER",
  "KEY_PRESS",
  "SCREENSHOT",
  "SCREENSHOT_ELEMENT",
  "WAIT_FOR",
  "WAIT_MS",
];

const confirmCommands = [
  "SUBMIT",
  "TAB_CLOSE",
  "GET_COOKIES",
  "SET_COOKIE",
  "GET_LOCALSTORAGE",
  "SET_LOCALSTORAGE",
  "GET_NETWORK_LOG",
];

function labelFor(command: string) {
  return command
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reasonFor(command: string, level: GatePolicyLevel) {
  if (level === "BLOCK") {
    return "임의 스크립트 실행은 로그인 세션과 페이지 데이터를 우회 조작할 수 있어 항상 차단합니다.";
  }

  if (level === "CONFIRM") {
    return "외부 서비스 상태, 로그인 정보, 저장소, 폼 제출에 영향을 줄 수 있어 운영자 승인 후에만 실행합니다.";
  }

  return "읽기, 탐색, 제한된 DOM 조작처럼 Gate 정책상 즉시 실행 가능한 명령입니다.";
}

export const gateCommandPolicy: GateCommandPolicy[] = [
  ...safeCommands.map((command) => ({
    command,
    level: "SAFE" as const,
    label: labelFor(command),
    riskReason: reasonFor(command, "SAFE"),
    resultHandling: command.startsWith("SCREENSHOT") ? ("mask_only" as const) : ("mask_and_summarize" as const),
  })),
  ...confirmCommands.map((command) => ({
    command,
    level: "CONFIRM" as const,
    label: labelFor(command),
    riskReason: reasonFor(command, "CONFIRM"),
    resultHandling: "mask_and_summarize" as const,
  })),
  {
    command: "EVAL",
    level: "BLOCK",
    label: "Eval",
    riskReason: reasonFor("EVAL", "BLOCK"),
    resultHandling: "no_ai_result",
  },
];

export function getGateCommandPolicy(command: string) {
  const normalized = command.trim().toUpperCase();
  return (
    gateCommandPolicy.find((item) => item.command === normalized) ?? {
      command: normalized,
      level: "BLOCK" as const,
      label: labelFor(normalized),
      riskReason: "등록되지 않은 브라우저 명령은 Gate에서 차단합니다.",
      resultHandling: "no_ai_result" as const,
    }
  );
}
