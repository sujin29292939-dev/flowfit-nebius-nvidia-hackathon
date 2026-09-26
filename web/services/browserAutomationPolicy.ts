import type {
  BrowserAutomationCommandName,
  BrowserAutomationCommandPolicy,
  BrowserAutomationSourceCandidate,
} from "@/lib/types";

export const browserAutomationPolicy: BrowserAutomationCommandPolicy[] = [
  {
    name: "TAB_LIST",
    label: "열린 탭 확인",
    riskLevel: "read_only",
    allowed: true,
    requiresApproval: false,
    tokenSavingRole: "현재 업무 대상 탭만 골라 AI 입력 범위를 줄입니다.",
    reason: "브라우저 상태 확인용 읽기 작업입니다.",
  },
  {
    name: "NEW_TAB",
    label: "새 탭 열기",
    riskLevel: "needs_approval",
    allowed: true,
    requiresApproval: true,
    tokenSavingRole: "로그인된 업무 사이트를 사람이 확인한 뒤 필요한 화면만 열게 합니다.",
    reason: "사용자 세션에서 새 화면을 여는 조작이므로 승인 후 실행합니다.",
  },
  {
    name: "NAVIGATE",
    label: "페이지 이동",
    riskLevel: "needs_approval",
    allowed: true,
    requiresApproval: true,
    tokenSavingRole: "AI가 검색 결과 전체를 읽지 않고 지정 사이트의 필요한 화면만 확인합니다.",
    reason: "로그인된 브라우저 세션을 움직이므로 대상 URL 확인이 필요합니다.",
  },
  {
    name: "GET_TEXT",
    label: "화면 텍스트 추출",
    riskLevel: "read_only",
    allowed: true,
    requiresApproval: false,
    tokenSavingRole: "DOM 텍스트를 먼저 추출하고 요약해 모델 입력 토큰을 줄입니다.",
    reason: "읽기 전용이며 민감정보 마스킹 후 AI 판단에 사용합니다.",
  },
  {
    name: "FIND_ELEMENTS",
    label: "버튼/입력칸 찾기",
    riskLevel: "read_only",
    allowed: true,
    requiresApproval: false,
    tokenSavingRole: "접근성/DOM 후보만 전달해 스크린샷 기반 판단을 줄입니다.",
    reason: "조작 전 대상 후보를 확인하는 읽기 작업입니다.",
  },
  {
    name: "SCREENSHOT",
    label: "화면 미리보기",
    riskLevel: "read_only",
    allowed: true,
    requiresApproval: false,
    tokenSavingRole: "텍스트 추출이 어려운 화면만 마스킹된 이미지로 보조합니다.",
    reason: "기본은 접힘 상태이며 민감정보를 가린 미리보기만 사용합니다.",
  },
  {
    name: "WAIT_FOR",
    label: "화면 대기",
    riskLevel: "read_only",
    allowed: true,
    requiresApproval: false,
    tokenSavingRole: "불필요한 재시도와 중복 AI 호출을 줄입니다.",
    reason: "로드 완료나 특정 요소 표시를 기다리는 안전 작업입니다.",
  },
  {
    name: "CLICK",
    label: "버튼 클릭",
    riskLevel: "needs_approval",
    allowed: true,
    requiresApproval: true,
    tokenSavingRole: "승인된 클릭만 실행해 AI가 같은 화면을 반복 판단하지 않게 합니다.",
    reason: "외부 서비스 상태를 바꿀 수 있어 대표/관리자 승인 후 실행합니다.",
  },
  {
    name: "TYPE",
    label: "문구 입력",
    riskLevel: "needs_approval",
    allowed: true,
    requiresApproval: true,
    tokenSavingRole: "승인된 답변 초안만 입력해 재작성 토큰을 줄입니다.",
    reason: "고객/거래처에게 보일 수 있는 문구 입력은 승인 대상입니다.",
  },
  {
    name: "GET_HTML",
    label: "HTML 원문 읽기",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "원문 HTML 대신 필요한 텍스트와 필드만 추출합니다.",
    reason: "숨은 값과 개인정보가 섞일 수 있어 기본 차단합니다.",
  },
  {
    name: "EVAL",
    label: "임의 스크립트 실행",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "정해진 명령만 사용해 예측 가능한 작업으로 제한합니다.",
    reason: "웹페이지에서 임의 코드를 실행하는 기능은 보안 위험이 큽니다.",
  },
  {
    name: "GET_COOKIES",
    label: "쿠키 읽기",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "로그인 토큰은 읽지 않고 사용자 브라우저 세션 안에서만 작업합니다.",
    reason: "로그인 정보가 외부로 보이지 않아야 하므로 차단합니다.",
  },
  {
    name: "SET_COOKIE",
    label: "쿠키 쓰기",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "로그인 작성은 사용자가 하고 FlowFit은 세션 값을 저장하지 않습니다.",
    reason: "세션 변조 가능성이 있어 차단합니다.",
  },
  {
    name: "GET_LOCALSTORAGE",
    label: "브라우저 저장소 읽기",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "저장소 원문 대신 화면에 표시된 업무 데이터만 사용합니다.",
    reason: "토큰, 설정값, 개인정보가 포함될 수 있어 차단합니다.",
  },
  {
    name: "SET_LOCALSTORAGE",
    label: "브라우저 저장소 쓰기",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "서비스 내부 상태 변경은 공식 API나 승인된 클릭으로만 처리합니다.",
    reason: "서비스 상태를 우회 변경할 수 있어 차단합니다.",
  },
  {
    name: "NETWORK_LOG",
    label: "네트워크 기록",
    riskLevel: "blocked",
    allowed: false,
    requiresApproval: true,
    tokenSavingRole: "API payload 대신 화면 요약과 공식 기록만 사용합니다.",
    reason: "헤더, 쿠키, API 응답이 섞일 수 있어 기본 차단합니다.",
  },
];

export const tokenSavingPlan = [
  "브라우저 확장 프로그램이 화면 텍스트와 버튼 후보를 먼저 구조화합니다.",
  "로컬 엔진이 전화번호, 이메일, 주문번호 같은 민감정보를 마스킹합니다.",
  "AI에는 전체 화면이 아니라 작업명, 출처, 필요한 필드, 후보 액션만 전달합니다.",
  "클릭, 입력, 발송은 승인 큐를 거쳐 실행하고 결과 요약만 저장합니다.",
];

export const recommendedBrowserAutomationSources: BrowserAutomationSourceCandidate[] = [
  {
    name: "Chrome Extension Native Messaging",
    url: "https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging",
    license: "Chrome documentation / platform API",
    fit: "설치형 FlowFit 번들과 Chrome 확장 프로그램을 안전하게 연결하는 표준 방식입니다.",
    useFor: "장기적으로 WebSocket 대신 등록된 네이티브 호스트 기반 로컬 브릿지에 적합합니다.",
  },
  {
    name: "Playwright",
    url: "https://playwright.dev/",
    license: "Apache-2.0",
    fit: "접근성 스냅샷과 안정적인 locator를 활용해 화면 조작을 토큰 효율적으로 만들 수 있습니다.",
    useFor: "테스트, 브라우저 상태 추출, 확장 브릿지 검증 자동화에 적합합니다.",
  },
  {
    name: "Puppeteer",
    url: "https://pptr.dev/",
    license: "Apache-2.0",
    fit: "Chrome DevTools Protocol 기반 제어가 단순해 확장 브릿지와 잘 맞습니다.",
    useFor: "Chrome 전용 자동화나 내부 QA 스크립트에 적합합니다.",
  },
  {
    name: "Crawlee",
    url: "https://crawlee.dev/",
    license: "Apache-2.0",
    fit: "반복적인 웹 수집, 목록 페이지 정리, 중복 제거에 강합니다.",
    useFor: "거래처/주문 목록 수집을 AI 호출 전에 로컬에서 정리할 때 적합합니다.",
  },
  {
    name: "Tesseract.js",
    url: "https://github.com/naptha/tesseract.js",
    license: "Apache-2.0",
    fit: "이미지/영수증/발주서에서 텍스트를 로컬 OCR로 먼저 추출할 수 있습니다.",
    useFor: "현장 접수 사진을 공식 회사 정보 후보로 정리하기 전 단계에 적합합니다.",
  },
];

export function getBrowserAutomationPolicy() {
  return browserAutomationPolicy;
}

export function findBrowserAutomationPolicy(command: string) {
  return browserAutomationPolicy.find((item) => item.name === command.toUpperCase());
}

export function isBrowserAutomationCommandAllowed(command: string) {
  return findBrowserAutomationPolicy(command)?.allowed === true;
}

export function requiresBrowserAutomationApproval(command: string) {
  return findBrowserAutomationPolicy(command)?.requiresApproval === true;
}

export function getBrowserAutomationFallbackOverview() {
  return {
    policyVersion: 1,
    extensionTokenConfigured: false,
    sessions: [],
    commandAudit: [],
    policy: browserAutomationPolicy,
    tokenSavingPlan,
    recommendedSources: recommendedBrowserAutomationSources,
  };
}
