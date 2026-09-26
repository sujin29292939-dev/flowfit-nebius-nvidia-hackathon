const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const cron = require("node-cron");
const { createWholesaleAutomationRuntime } = require("./flowfit-wholesale-automation");

const HOST = process.env.FLOWFIT_LOCAL_ENGINE_HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.FLOWFIT_LOCAL_ENGINE_PORT || "3001", 10);
const ADMIN_TOKEN = process.env.FLOWFIT_MOBILE_ADMIN_TOKEN || process.env.MOBILE_ADMIN_TOKEN || "dev-mobile-admin-token";
const BROWSER_BRIDGE_TOKEN =
  process.env.FLOWFIT_BROWSER_BRIDGE_TOKEN || process.env.FLOWFIT_AGENT_BRIDGE_TOKEN || "dev-browser-bridge-token";
const APP_DIR = __dirname;
const STORE_DIR = path.join(APP_DIR, ".flowfit");
const STORE_FILE = path.join(STORE_DIR, "local-engine-store.json");
const SQLITE_FILE = path.join(STORE_DIR, "flowfit-local-engine.sqlite");
const AI_JUDGMENT_STORE_FILE = path.join(STORE_DIR, "ai-judgment-store.json");
const SCHEMA_VERSION = "flowfit.local-engine.v1";
const ACCESS_TTL_MS = 1000 * 60 * 60 * 12;
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PAIRING_TTL_HOURS = 24;
let sqliteDb = null;
let wholesaleRuntime = null;

const DEFAULT_POLICY_PACKAGES = [
  {
    package_name: "com.kakao.talk",
    platform_name: "KakaoTalk",
    platform_type: "android_app",
    enabled: true,
    capture_mode: "metadata_only",
    local_disable_allowed: true,
  },
  {
    package_name: "com.google.android.gm",
    platform_name: "Gmail",
    platform_type: "android_app",
    enabled: true,
    capture_mode: "metadata_only",
    local_disable_allowed: true,
  },
  {
    package_name: "com.microsoft.office.outlook",
    platform_name: "Outlook",
    platform_type: "android_app",
    enabled: true,
    capture_mode: "metadata_only",
    local_disable_allowed: true,
  },
  {
    package_name: "com.android.chrome",
    platform_name: "Chrome",
    platform_type: "android_app",
    enabled: true,
    capture_mode: "metadata_only",
    local_disable_allowed: true,
  },
];

const DEFAULT_BROWSER_COMMAND_POLICY = [
  {
    name: "TAB_LIST",
    label: "?대┛ ???뺤씤",
    risk_level: "read_only",
    allowed: true,
    requires_approval: false,
    token_saving_role: "?꾩옱 ?낅Т ?????쭔 怨⑤씪 AI ?낅젰 踰붿쐞瑜?以꾩엯?덈떎.",
    reason: "釉뚮씪?곗? ?곹깭 ?뺤씤???쎄린 ?묒뾽?낅땲??",
  },
  {
    name: "NEW_TAB",
    label: "?????닿린",
    risk_level: "needs_approval",
    allowed: true,
    requires_approval: true,
    token_saving_role: "濡쒓렇?몃맂 ?낅Т ?ъ씠?몃? ?щ엺???뺤씤?????꾩슂???붾㈃留??닿쾶 ?⑸땲??",
    reason: "?ъ슜???몄뀡?먯꽌 ???붾㈃???щ뒗 議곗옉?대?濡??뱀씤 ???ㅽ뻾?⑸땲??",
  },
  {
    name: "NAVIGATE",
    label: "?섏씠吏 ?대룞",
    risk_level: "needs_approval",
    allowed: true,
    requires_approval: true,
    token_saving_role: "AI媛 寃??寃곌낵 ?꾩껜瑜??쎌? ?딄퀬 吏???ъ씠?몄쓽 ?꾩슂???붾㈃留??뺤씤?⑸땲??",
    reason: "濡쒓렇?몃맂 釉뚮씪?곗? ?몄뀡???吏곸씠誘濡????URL ?뺤씤???꾩슂?⑸땲??",
  },
  {
    name: "GET_TEXT",
    label: "?붾㈃ ?띿뒪??異붿텧",
    risk_level: "read_only",
    allowed: true,
    requires_approval: false,
    token_saving_role: "DOM ?띿뒪?몃? 癒쇱? 異붿텧?섍퀬 ?붿빟??紐⑤뜽 ?낅젰 ?좏겙??以꾩엯?덈떎.",
    reason: "?쎄린 ?꾩슜?대ŉ 誘쇨컧?뺣낫 留덉뒪????AI ?먮떒???ъ슜?⑸땲??",
  },
  {
    name: "FIND_ELEMENTS",
    label: "踰꾪듉/?낅젰移?李얘린",
    risk_level: "read_only",
    allowed: true,
    requires_approval: false,
    token_saving_role: "?묎렐??DOM ?꾨낫留??꾨떖???ㅽ겕由곗꺑 湲곕컲 ?먮떒??以꾩엯?덈떎.",
    reason: "議곗옉 ??????꾨낫瑜??뺤씤?섎뒗 ?쎄린 ?묒뾽?낅땲??",
  },
  {
    name: "SCREENSHOT",
    label: "?붾㈃ 誘몃━蹂닿린",
    risk_level: "read_only",
    allowed: true,
    requires_approval: false,
    token_saving_role: "?띿뒪??異붿텧???대젮???붾㈃留?留덉뒪?밸맂 ?대?吏濡?蹂댁“?⑸땲??",
    reason: "湲곕낯? ?묓옒 ?곹깭?대ŉ 誘쇨컧?뺣낫瑜?媛由?誘몃━蹂닿린留??ъ슜?⑸땲??",
  },
  {
    name: "WAIT_FOR",
    label: "Wait for page",
    risk_level: "read_only",
    allowed: true,
    requires_approval: false,
    token_saving_role: "遺덊븘?뷀븳 ?ъ떆?꾩? 以묐났 AI ?몄텧??以꾩엯?덈떎.",
    reason: "濡쒕뱶 ?꾨즺???뱀젙 ?붿냼 ?쒖떆瑜?湲곕떎由щ뒗 ?덉쟾 ?묒뾽?낅땲??",
  },
  {
    name: "CLICK",
    label: "踰꾪듉 ?대┃",
    risk_level: "needs_approval",
    allowed: true,
    requires_approval: true,
    token_saving_role: "?뱀씤???대┃留??ㅽ뻾??AI媛 媛숈? ?붾㈃??諛섎났 ?먮떒?섏? ?딄쾶 ?⑸땲??",
    reason: "?몃? ?쒕퉬???곹깭瑜?諛붽? ???덉뼱 ???愿由ъ옄 ?뱀씤 ???ㅽ뻾?⑸땲??",
  },
  {
    name: "TYPE",
    label: "臾멸뎄 ?낅젰",
    risk_level: "needs_approval",
    allowed: true,
    requires_approval: true,
    token_saving_role: "?뱀씤???듬? 珥덉븞留??낅젰???ъ옉???좏겙??以꾩엯?덈떎.",
    reason: "怨좉컼/嫄곕옒泥섏뿉寃?蹂댁씪 ???덈뒗 臾멸뎄 ?낅젰? ?뱀씤 ??곸엯?덈떎.",
  },
  {
    name: "GET_HTML",
    label: "HTML ?먮Ц ?쎄린",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "?먮Ц HTML ????꾩슂???띿뒪?몄? ?꾨뱶留?異붿텧?⑸땲??",
    reason: "?⑥? 媛믨낵 媛쒖씤?뺣낫媛 ?욎씪 ???덉뼱 湲곕낯 李⑤떒?⑸땲??",
  },
  {
    name: "EVAL",
    label: "?꾩쓽 ?ㅽ겕由쏀듃 ?ㅽ뻾",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "?뺥빐吏?紐낅졊留??ъ슜???덉륫 媛?ν븳 ?묒뾽?쇰줈 ?쒗븳?⑸땲??",
    reason: "?뱁럹?댁??먯꽌 ?꾩쓽 肄붾뱶瑜??ㅽ뻾?섎뒗 湲곕뒫? 蹂댁븞 ?꾪뿕???쎈땲??",
  },
  {
    name: "GET_COOKIES",
    label: "荑좏궎 ?쎄린",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "濡쒓렇???좏겙? ?쎌? ?딄퀬 ?ъ슜??釉뚮씪?곗? ?몄뀡 ?덉뿉?쒕쭔 ?묒뾽?⑸땲??",
    reason: "濡쒓렇???뺣낫媛 ?몃?濡?蹂댁씠吏 ?딆븘???섎?濡?李⑤떒?⑸땲??",
  },
  {
    name: "SET_COOKIE",
    label: "荑좏궎 ?곌린",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "濡쒓렇???묒꽦? ?ъ슜?먭? ?섍퀬 FlowFit? ?몄뀡 媛믪쓣 ??ν븯吏 ?딆뒿?덈떎.",
    reason: "?몄뀡 蹂議?媛?μ꽦???덉뼱 李⑤떒?⑸땲??",
  },
  {
    name: "GET_LOCALSTORAGE",
    label: "釉뚮씪?곗? ??μ냼 ?쎄린",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "??μ냼 ?먮Ц ????붾㈃???쒖떆???낅Т ?곗씠?곕쭔 ?ъ슜?⑸땲??",
    reason: "?좏겙, ?ㅼ젙媛? 媛쒖씤?뺣낫媛 ?ы븿?????덉뼱 李⑤떒?⑸땲??",
  },
  {
    name: "SET_LOCALSTORAGE",
    label: "釉뚮씪?곗? ??μ냼 ?곌린",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "?쒕퉬???대? ?곹깭 蹂寃쎌? 怨듭떇 API???뱀씤???대┃?쇰줈留?泥섎━?⑸땲??",
    reason: "?쒕퉬???곹깭瑜??고쉶 蹂寃쏀븷 ???덉뼱 李⑤떒?⑸땲??",
  },
  {
    name: "NETWORK_LOG",
    label: "?ㅽ듃?뚰겕 湲곕줉",
    risk_level: "blocked",
    allowed: false,
    requires_approval: true,
    token_saving_role: "API payload ????붾㈃ ?붿빟怨?怨듭떇 湲곕줉留??ъ슜?⑸땲??",
    reason: "?ㅻ뜑, 荑좏궎, API ?묐떟???욎씪 ???덉뼱 湲곕낯 李⑤떒?⑸땲??",
  },
];

const DEFAULT_BROWSER_TOKEN_SAVING_PLAN = [
  "釉뚮씪?곗? ?뺤옣 ?꾨줈洹몃옩???붾㈃ ?띿뒪?몄? 踰꾪듉 ?꾨낫瑜?癒쇱? 援ъ“?뷀빀?덈떎.",
  "濡쒖뺄 ?붿쭊???꾪솕踰덊샇, ?대찓?? 二쇰Ц踰덊샇 媛숈? 誘쇨컧?뺣낫瑜?留덉뒪?뱁빀?덈떎.",
  "AI?먮뒗 ?꾩껜 ?붾㈃???꾨땲???묒뾽紐? 異쒖쿂, ?꾩슂???꾨뱶, ?꾨낫 ?≪뀡留??꾨떖?⑸땲??",
  "?대┃, ?낅젰, 諛쒖넚? ?뱀씤 ?먮? 嫄곗퀜 ?ㅽ뻾?섍퀬 寃곌낵 ?붿빟留???ν빀?덈떎.",
];

const DEFAULT_BROWSER_SOURCES = [
  {
    name: "Chrome Extension Native Messaging",
    url: "https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging",
    license: "Chrome documentation / platform API",
    fit: "?ㅼ튂??FlowFit 踰덈뱾怨?Chrome ?뺤옣 ?꾨줈洹몃옩???덉쟾?섍쾶 ?곌껐?섎뒗 ?쒖? 諛⑹떇?낅땲??",
    useFor: "?κ린?곸쑝濡?WebSocket ????깅줉???ㅼ씠?곕툕 ?몄뒪??湲곕컲 濡쒖뺄 釉뚮┸吏???곹빀?⑸땲??",
  },
  {
    name: "Playwright",
    url: "https://playwright.dev/",
    license: "Apache-2.0",
    fit: "?묎렐???ㅻ깄?룰낵 ?덉젙?곸씤 locator瑜??쒖슜???붾㈃ 議곗옉???좏겙 ?⑥쑉?곸쑝濡?留뚮뱾 ???덉뒿?덈떎.",
    useFor: "?뚯뒪?? 釉뚮씪?곗? ?곹깭 異붿텧, ?뺤옣 釉뚮┸吏 寃利??먮룞?붿뿉 ?곹빀?⑸땲??",
  },
  {
    name: "Puppeteer",
    url: "https://pptr.dev/",
    license: "Apache-2.0",
    fit: "Chrome DevTools Protocol 湲곕컲 ?쒖뼱媛 ?⑥닚???뺤옣 釉뚮┸吏? ??留욎뒿?덈떎.",
    useFor: "Chrome ?꾩슜 ?먮룞?붾굹 ?대? QA ?ㅽ겕由쏀듃???곹빀?⑸땲??",
  },
  {
    name: "Crawlee",
    url: "https://crawlee.dev/",
    license: "Apache-2.0",
    fit: "諛섎났?곸씤 ???섏쭛, 紐⑸줉 ?섏씠吏 ?뺣━, 以묐났 ?쒓굅??媛뺥빀?덈떎.",
    useFor: "嫄곕옒泥?二쇰Ц 紐⑸줉 ?섏쭛??AI ?몄텧 ?꾩뿉 濡쒖뺄?먯꽌 ?뺣━?????곹빀?⑸땲??",
  },
  {
    name: "Tesseract.js",
    url: "https://github.com/naptha/tesseract.js",
    license: "Apache-2.0",
    fit: "?대?吏/?곸닔利?諛쒖＜?쒖뿉???띿뒪?몃? 濡쒖뺄 OCR濡?癒쇱? 異붿텧?????덉뒿?덈떎.",
    useFor: "?꾩옣 ?묒닔 ?ъ쭊??怨듭떇 ?뚯궗 ?뺣낫 ?꾨낫濡??뺣━?섍린 ???④퀎???곹빀?⑸땲??",
  },
];

const GATE_SAFE_COMMANDS = new Set([
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
]);

const GATE_CONFIRM_COMMANDS = new Set([
  "SUBMIT",
  "TAB_CLOSE",
  "GET_COOKIES",
  "SET_COOKIE",
  "GET_LOCALSTORAGE",
  "SET_LOCALSTORAGE",
  "GET_NETWORK_LOG",
]);

const GATE_BLOCK_COMMANDS = new Set(["EVAL"]);
const GATE_COMMAND_TTL_MS = 1000 * 60 * 5;

const PII_PATTERNS = [
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[MASKED_CARD]" },
  { pattern: /\b\d{6}[- ]?[1-4]\d{6}\b/g, replacement: "[MASKED_RRN]" },
  { pattern: /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, replacement: "010-****-****" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[MASKED_EMAIL]" },
  { pattern: /\b\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,8}[-\s]?\d{2,8}\b/g, replacement: "[MASKED_ACCOUNT]" },
  { pattern: /("?(?:password|passwd|pwd)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,}]+)/gi, replacement: "$1[MASKED_PASSWORD]" },
  { pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "Authorization: Bearer [MASKED]" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[MASKED_AWS_KEY]" },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: "[MASKED_JWT]" },
];

function nowIso() {
  return new Date().toISOString();
}

function msToIso(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return null;
  }

  return new Date(value).toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function seedState() {
  const createdAt = nowIso();
  return {
    schema_version: SCHEMA_VERSION,
    created_at: createdAt,
    updated_at: createdAt,
    collector: {
      ingested_count: 0,
      last_ingest_at: null,
      recent_events: [],
    },
    mobile: {
      policy_version: 1,
      default_action: "allow",
      packages: DEFAULT_POLICY_PACKAGES,
      pairing_codes: [],
      devices: [],
      access_tokens: [],
      refresh_tokens: [],
      uploads: [],
      ingested_events: [],
      commands: [],
      command_results: [],
    },
    browser_bridge: {
      policy_version: 1,
      sessions: [],
      commands: [],
      command_results: [],
    },
  };
}

function normalizeState(raw) {
  const base = seedState();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  return {
    ...base,
    ...raw,
    collector: {
      ...base.collector,
      ...(raw.collector || {}),
      recent_events: Array.isArray(raw.collector?.recent_events) ? raw.collector.recent_events : [],
    },
    mobile: {
      ...base.mobile,
      ...(raw.mobile || {}),
      packages: Array.isArray(raw.mobile?.packages) ? raw.mobile.packages : base.mobile.packages,
      pairing_codes: Array.isArray(raw.mobile?.pairing_codes) ? raw.mobile.pairing_codes : [],
      devices: Array.isArray(raw.mobile?.devices) ? raw.mobile.devices : [],
      access_tokens: Array.isArray(raw.mobile?.access_tokens) ? raw.mobile.access_tokens : [],
      refresh_tokens: Array.isArray(raw.mobile?.refresh_tokens) ? raw.mobile.refresh_tokens : [],
      uploads: Array.isArray(raw.mobile?.uploads) ? raw.mobile.uploads : [],
      ingested_events: Array.isArray(raw.mobile?.ingested_events) ? raw.mobile.ingested_events : [],
      commands: Array.isArray(raw.mobile?.commands) ? raw.mobile.commands : [],
      command_results: Array.isArray(raw.mobile?.command_results) ? raw.mobile.command_results : [],
    },
    browser_bridge: {
      ...base.browser_bridge,
      ...(raw.browser_bridge || {}),
      sessions: Array.isArray(raw.browser_bridge?.sessions) ? raw.browser_bridge.sessions : [],
      commands: Array.isArray(raw.browser_bridge?.commands) ? raw.browser_bridge.commands : [],
      command_results: Array.isArray(raw.browser_bridge?.command_results) ? raw.browser_bridge.command_results : [],
    },
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return seedState();
  }
}

function saveState() {
  state.updated_at = nowIso();
  ensureDirectory(STORE_FILE);
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function createStatsDatabase() {
  ensureDirectory(SQLITE_FILE);
  const db = new Database(SQLITE_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      installation_id TEXT,
      device_label TEXT,
      manufacturer TEXT,
      model TEXT,
      app_version TEXT,
      notification_access_granted INTEGER,
      listener_connected INTEGER,
      queue_depth INTEGER DEFAULT 0,
      collection_enabled INTEGER DEFAULT 1,
      last_heartbeat_at TEXT,
      last_seen_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mobile_events (
      event_id TEXT PRIMARY KEY,
      device_id TEXT,
      package_name TEXT,
      platform TEXT,
      app_label TEXT,
      sender TEXT,
      title TEXT,
      body TEXT,
      event_type TEXT,
      notification_key_hash TEXT,
      collected_at TEXT,
      status TEXT DEFAULT 'received',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_mobile_events_collected_at
      ON mobile_events(collected_at);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_platform
      ON mobile_events(platform);

    CREATE TABLE IF NOT EXISTS commands (
      command_id TEXT PRIMARY KEY,
      device_id TEXT,
      source_event_id TEXT,
      package_name TEXT,
      reply_text TEXT,
      status TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      delivered_at TEXT,
      completed_at TEXT,
      result_method TEXT,
      result_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_commands_created_at
      ON commands(created_at);
    CREATE INDEX IF NOT EXISTS idx_commands_status
      ON commands(status);

    CREATE TABLE IF NOT EXISTS command_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id TEXT,
      device_id TEXT,
      status TEXT,
      method TEXT,
      reason TEXT,
      reported_at TEXT,
      UNIQUE(command_id, reported_at)
    );

    CREATE TABLE IF NOT EXISTS agent_commands (
      command_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT 'default',
      command TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      level TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      result_size INTEGER DEFAULT 0,
      pii_masked INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT,
      completed_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_commands_poll
      ON agent_commands(session_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_commands_status
      ON agent_commands(status, updated_at);

    CREATE TABLE IF NOT EXISTS agent_approvals (
      approval_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      command TEXT NOT NULL,
      params_hash TEXT NOT NULL,
      risk_reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_approvals_pending
      ON agent_approvals(status, created_at);

    CREATE TABLE IF NOT EXISTS agent_audit_log (
      audit_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      command TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      params_hash TEXT,
      result_size INTEGER DEFAULT 0,
      pii_masked INTEGER DEFAULT 0,
      approved_by TEXT,
      outcome TEXT NOT NULL,
      duration_ms INTEGER,
      error_msg TEXT,
      tab_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_audit_session
      ON agent_audit_log(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_audit_command
      ON agent_audit_log(command, created_at);
  `);
  return db;
}

function boolToInt(value) {
  if (typeof value !== "boolean") {
    return value == null ? null : Number(Boolean(value));
  }
  return value ? 1 : 0;
}

function normalizeEventPlatform(event) {
  const sourceApp = event.source_app && typeof event.source_app === "object" ? event.source_app : null;
  const sourceAppName = typeof event.source_app === "string" ? event.source_app : null;
  return (
    event.platform_name ||
    event.platform ||
    sourceApp?.display_name ||
    sourceApp?.app_user_model_id ||
    sourceApp?.package_family_name ||
    sourceAppName ||
    event.package_name ||
    "unknown"
  );
}

function normalizeEventSender(event) {
  return event.raw_sender_hint || event.conversation_title || event.title || null;
}

function upsertSqliteDevice(device) {
  if (!device?.device_id) {
    return;
  }

  sqliteDb
    .prepare(`
      INSERT INTO devices (
        device_id, installation_id, device_label, manufacturer, model, app_version,
        notification_access_granted, listener_connected, queue_depth, collection_enabled,
        last_heartbeat_at, last_seen_at, updated_at
      )
      VALUES (
        @device_id, @installation_id, @device_label, @manufacturer, @model, @app_version,
        @notification_access_granted, @listener_connected, @queue_depth, @collection_enabled,
        @last_heartbeat_at, @last_seen_at, @updated_at
      )
      ON CONFLICT(device_id) DO UPDATE SET
        installation_id = excluded.installation_id,
        device_label = COALESCE(excluded.device_label, devices.device_label),
        manufacturer = COALESCE(excluded.manufacturer, devices.manufacturer),
        model = COALESCE(excluded.model, devices.model),
        app_version = COALESCE(excluded.app_version, devices.app_version),
        notification_access_granted = COALESCE(excluded.notification_access_granted, devices.notification_access_granted),
        listener_connected = COALESCE(excluded.listener_connected, devices.listener_connected),
        queue_depth = excluded.queue_depth,
        collection_enabled = excluded.collection_enabled,
        last_heartbeat_at = COALESCE(excluded.last_heartbeat_at, devices.last_heartbeat_at),
        last_seen_at = COALESCE(excluded.last_seen_at, devices.last_seen_at),
        updated_at = excluded.updated_at
    `)
    .run({
      device_id: device.device_id,
      installation_id: device.installation_id || null,
      device_label: device.device_label || null,
      manufacturer: device.manufacturer || null,
      model: device.model || null,
      app_version: device.app_version || null,
      notification_access_granted: boolToInt(device.notification_access_granted),
      listener_connected: boolToInt(device.listener_connected),
      queue_depth: Number(device.queue_depth || 0),
      collection_enabled: device.collection_enabled === false ? 0 : 1,
      last_heartbeat_at: device.last_heartbeat_at || null,
      last_seen_at: device.last_seen_at || null,
      updated_at: device.updated_at || nowIso(),
    });
}

function insertSqliteMobileEvent(deviceId, event, status = "received") {
  if (!event?.event_id) {
    return false;
  }

  const sourceApp = event.source_app && typeof event.source_app === "object" ? event.source_app : null;
  const result = sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO mobile_events (
        event_id, device_id, package_name, platform, app_label, sender, title, body,
        event_type, notification_key_hash, collected_at, status, created_at
      )
      VALUES (
        @event_id, @device_id, @package_name, @platform, @app_label, @sender, @title, @body,
        @event_type, @notification_key_hash, @collected_at, @status, @created_at
      )
    `)
    .run({
      event_id: event.event_id,
      device_id: deviceId || event.device_id || null,
      package_name: event.package_name || sourceApp?.app_user_model_id || sourceApp?.package_family_name || null,
      platform: normalizeEventPlatform(event),
      app_label: event.app_label || sourceApp?.display_name || null,
      sender: normalizeEventSender(event),
      title: event.title || null,
      body: event.body_preview || event.body || null,
      event_type: event.event_type || "posted",
      notification_key_hash: event.notification_key_hash || null,
      collected_at: msToIso(event.collected_at_ms_utc) || event.collected_at || nowIso(),
      status,
      created_at: nowIso(),
    });

  return result.changes > 0;
}

function upsertSqliteCommand(command) {
  if (!command?.command_id) {
    return;
  }

  sqliteDb
    .prepare(`
      INSERT INTO commands (
        command_id, device_id, source_event_id, package_name, reply_text, status, attempts,
        created_at, updated_at, delivered_at, completed_at, result_method, result_reason
      )
      VALUES (
        @command_id, @device_id, @source_event_id, @package_name, @reply_text, @status, @attempts,
        @created_at, @updated_at, @delivered_at, @completed_at, @result_method, @result_reason
      )
      ON CONFLICT(command_id) DO UPDATE SET
        status = excluded.status,
        attempts = excluded.attempts,
        updated_at = excluded.updated_at,
        delivered_at = excluded.delivered_at,
        completed_at = excluded.completed_at,
        result_method = excluded.result_method,
        result_reason = excluded.result_reason
    `)
    .run({
      command_id: command.command_id,
      device_id: command.device_id || null,
      source_event_id: command.source_event_id || null,
      package_name: command.package_name || null,
      reply_text: command.reply_text || "",
      status: command.status || "queued",
      attempts: Number(command.attempts || 0),
      created_at: command.created_at || nowIso(),
      updated_at: command.updated_at || nowIso(),
      delivered_at: command.delivered_at || null,
      completed_at: command.completed_at || null,
      result_method: command.result?.method || null,
      result_reason: command.result?.reason || null,
    });
}

function insertSqliteCommandResult(result) {
  if (!result?.command_id) {
    return;
  }

  sqliteDb
    .prepare(`
      INSERT OR IGNORE INTO command_results (
        command_id, device_id, status, method, reason, reported_at
      )
      VALUES (
        @command_id, @device_id, @status, @method, @reason, @reported_at
      )
    `)
    .run({
      command_id: result.command_id,
      device_id: result.device_id || null,
      status: result.status || null,
      method: result.method || null,
      reason: result.reason || null,
      reported_at: result.reported_at || nowIso(),
    });
}

function migrateJsonStateToSqlite() {
  const migrate = sqliteDb.transaction(() => {
    for (const device of state.mobile.devices) {
      upsertSqliteDevice(device);
    }

    for (const event of state.mobile.ingested_events) {
      insertSqliteMobileEvent(event.device_id, event, "received");
    }

    for (const event of state.collector.recent_events) {
      insertSqliteMobileEvent("desktop-collector", event, "received");
    }

    for (const command of state.mobile.commands) {
      upsertSqliteCommand(command);
      if (command.result) {
        insertSqliteCommandResult({
          command_id: command.command_id,
          device_id: command.device_id,
          status: command.status,
          method: command.result.method,
          reason: command.result.reason,
          reported_at: command.result.reported_at || command.completed_at || command.updated_at,
        });
      }
    }

    for (const result of state.mobile.command_results) {
      insertSqliteCommandResult(result);
    }
  });

  migrate();
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function minutesAgoLabel(value) {
  if (!value) {
    return null;
  }

  const diffMs = Math.max(Date.now() - Date.parse(value), 0);
  const minutes = Math.max(Math.round(diffMs / 60000), 1);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.round(minutes / 60)}h ago`;
}

function buildTodayStats() {
  const { startIso, endIso } = getTodayRange();
  const eventCount =
    sqliteDb
      .prepare("SELECT COUNT(*) AS count FROM mobile_events WHERE collected_at >= ? AND collected_at < ?")
      .get(startIso, endIso)?.count || 0;
  const succeeded =
    sqliteDb
      .prepare("SELECT COUNT(*) AS count FROM commands WHERE status = 'succeeded' AND completed_at >= ? AND completed_at < ?")
      .get(startIso, endIso)?.count || 0;
  const needsReview =
    sqliteDb
      .prepare("SELECT COUNT(*) AS count FROM commands WHERE status IN ('queued', 'delivered')")
      .get()?.count || 0;
  const errors =
    sqliteDb
      .prepare("SELECT COUNT(*) AS count FROM commands WHERE status = 'failed' AND updated_at >= ? AND updated_at < ?")
      .get(startIso, endIso)?.count || 0;
  const byPlatformRows = sqliteDb
    .prepare(`
      SELECT COALESCE(platform, package_name, 'unknown') AS platform, COUNT(*) AS count
      FROM mobile_events
      WHERE collected_at >= ? AND collected_at < ?
      GROUP BY COALESCE(platform, package_name, 'unknown')
      ORDER BY count DESC
    `)
    .all(startIso, endIso);

  const byPlatform = Object.fromEntries(byPlatformRows.map((row) => [row.platform, row.count]));
  const latestEvent = sqliteDb
    .prepare("SELECT platform, package_name, title, collected_at FROM mobile_events ORDER BY collected_at DESC LIMIT 1")
    .get();
  const latestCommand = sqliteDb
    .prepare("SELECT status, package_name, completed_at, updated_at, result_reason FROM commands ORDER BY updated_at DESC LIMIT 1")
    .get();
  const processed = succeeded > 0 ? succeeded : eventCount;

  return {
    source: "sqlite",
    window: {
      start: startIso,
      end: endIso,
    },
    processed,
    received_events: eventCount,
    succeeded_replies: succeeded,
    needs_review: needsReview,
    errors,
    by_platform: byPlatform,
    latest_event: latestEvent || null,
    latest_command: latestCommand || null,
  };
}

function buildRecentAction() {
  const latestCommand = sqliteDb
    .prepare("SELECT status, package_name, updated_at, completed_at, result_reason FROM commands ORDER BY updated_at DESC LIMIT 1")
    .get();
  const latestEvent = sqliteDb
    .prepare("SELECT platform, package_name, collected_at FROM mobile_events ORDER BY collected_at DESC LIMIT 1")
    .get();

  const commandAt = latestCommand ? latestCommand.completed_at || latestCommand.updated_at : null;
  const eventAt = latestEvent?.collected_at || null;
  const shouldShowCommand = commandAt && (!eventAt || Date.parse(commandAt) >= Date.parse(eventAt));

  if (latestCommand && shouldShowCommand) {
    const at = commandAt;
    const prefix = minutesAgoLabel(at) || "just now";
    const appName = latestCommand.package_name || "mobile app";

    if (latestCommand.status === "succeeded") {
      return { message: `${prefix}, completed 1 ${appName} action`, kind: "command_succeeded", at };
    }
    if (latestCommand.status === "failed") {
      return { message: `${prefix}, 1 ${appName} action needs review`, kind: "command_failed", at };
    }
    if (latestCommand.status === "expired") {
      return { message: `${prefix}, 1 ${appName} command expired`, kind: "command_expired", at };
    }

    return { message: `${prefix}, 1 ${appName} command is waiting`, kind: "command_pending", at };
  }

  if (latestEvent) {
    const prefix = minutesAgoLabel(latestEvent.collected_at) || "just now";
    const appName = latestEvent.platform || latestEvent.package_name || "mobile app";
    return { message: `${prefix}, received 1 ${appName} event`, kind: "event_received", at: latestEvent.collected_at };
  }

  return { message: "No mobile events collected today yet.", kind: "empty", at: null };
}

function updateAiJudgmentFromCommand(command) {
  if (!command?.source_event_id) {
    return;
  }

  try {
    if (!fs.existsSync(AI_JUDGMENT_STORE_FILE)) {
      return;
    }

    const raw = JSON.parse(fs.readFileSync(AI_JUDGMENT_STORE_FILE, "utf8"));
    if (!raw || !Array.isArray(raw.judgments)) {
      return;
    }

    const target = raw.judgments.find((entry) => entry?.id === command.source_event_id);
    if (!target) {
      return;
    }

    const processedAt = nowIso();
    const nextStatus = command.status === "succeeded" ? "sent" : "failed";
    const previousStatus = target.status || null;

    target.status = nextStatus;
    target.processed_at = processedAt;
    target.sent_at = nextStatus === "sent" ? command.completed_at || processedAt : null;
    target.sendResult = {
      channel: "kakao",
      message: command.reply_text || target.replyDraft || "",
      commandId: command.command_id,
      deviceId: command.device_id,
      status: command.status,
      executionPlan: Array.isArray(command.execution_plan) ? command.execution_plan : [],
      method: command.result?.method || null,
      reason: command.result?.reason || null,
    };

    if (Array.isArray(raw.transition_log)) {
      raw.transition_log.unshift({
        id: makeId("transition"),
        schema_version: "flowfit.ai-judgment.v1",
        received_at: command.result?.reported_at || processedAt,
        processed_at: processedAt,
        entity_type: "ai_judgment",
        entity_id: target.id,
        event: nextStatus === "sent" ? "ai_judgment_sent" : "ai_judgment_failed",
        from_state: previousStatus,
        to_state: nextStatus,
        accepted: true,
        actor: "mobile_app",
        reason:
          command.result?.reason ||
          (nextStatus === "sent" ? "紐⑤컮???깆뿉???꾩넚 ?꾨즺瑜?蹂닿퀬?덉뒿?덈떎." : "紐⑤컮???깆뿉???꾩넚 ?ㅽ뙣瑜?蹂닿퀬?덉뒿?덈떎."),
      });
      raw.transition_log = raw.transition_log.slice(0, 200);
    }

    raw.processed_at = processedAt;
    ensureDirectory(AI_JUDGMENT_STORE_FILE);
    fs.writeFileSync(AI_JUDGMENT_STORE_FILE, JSON.stringify(raw, null, 2), "utf8");
  } catch {
    // Keep the engine response resilient even if the AI judgment store is unavailable.
  }
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

function unauthorized(res) {
  json(res, 401, { error: "unauthorized" });
}

function badRequest(res, error) {
  json(res, 400, { error });
}

function normalizePairingCodeInput(value) {
  const compact = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!compact) {
    return "";
  }

  if (/^FF[A-Z0-9]{6}$/.test(compact)) {
    return `FF-${compact.slice(2)}`;
  }

  if (/^[A-Z0-9]{6}$/.test(compact)) {
    return `FF-${compact}`;
  }

  return String(value || "").trim().toUpperCase();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024 * 2) {
        reject(new Error("request_too_large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
  });
}

function readRawBody(req, limit = 1024 * 1024 * 12) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("request_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readMultipartBody(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error("multipart_boundary_missing");
  }

  const boundary = `--${boundaryMatch[1]}`;
  const bodyBuffer = await readRawBody(req);
  const bodyText = bodyBuffer.toString("binary");
  const rawParts = bodyText.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (const rawPart of rawParts) {
    const trimmed = rawPart.replace(/^\r\n/, "").replace(/\r\n$/, "");
    if (!trimmed) continue;

    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = trimmed.slice(0, headerEnd);
    const bodyBinary = trimmed.slice(headerEnd + 4);
    const disposition = headerText.match(/name="([^"]+)"/i);
    if (!disposition) continue;
    const fieldName = disposition[1];
    const fileNameMatch = headerText.match(/filename="([^"]*)"/i);
    const mimeTypeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    const partBuffer = Buffer.from(bodyBinary, "binary");

    if (fileNameMatch && fileNameMatch[1]) {
      files.push({
        fieldName,
        fileName: fileNameMatch[1],
        mimeType: mimeTypeMatch ? mimeTypeMatch[1].trim() : "application/octet-stream",
        buffer: partBuffer,
      });
    } else {
      fields[fieldName] = partBuffer.toString("utf8").trim();
    }
  }

  return { fields, files };
}

function parseUrl(req) {
  return new URL(req.url || "/", `http://${HOST}:${PORT}`);
}

function getBearerToken(req) {
  const raw = req.headers.authorization || "";
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return raw.slice(7).trim();
}

function requireAdmin(req, res) {
  if (getBearerToken(req) !== ADMIN_TOKEN) {
    unauthorized(res);
    return false;
  }

  return true;
}

function pruneExpiredTokens() {
  const now = Date.now();
  state.mobile.access_tokens = state.mobile.access_tokens.filter((entry) => Date.parse(entry.expires_at) > now);
  state.mobile.refresh_tokens = state.mobile.refresh_tokens.filter((entry) => Date.parse(entry.expires_at) > now);
}

function findAccessSession(token) {
  pruneExpiredTokens();
  return state.mobile.access_tokens.find((entry) => entry.token === token) || null;
}

function requireDeviceAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return null;
  }

  const session = findAccessSession(token);
  if (!session) {
    unauthorized(res);
    return null;
  }

  return session;
}

function upsertDevice(input) {
  const existing = state.mobile.devices.find((device) => device.device_id === input.device_id);
  if (existing) {
    Object.assign(existing, input, { updated_at: nowIso() });
    if (sqliteDb) {
      upsertSqliteDevice(existing);
    }
    return existing;
  }

  const next = {
    device_id: input.device_id,
    installation_id: input.installation_id || makeId("installation"),
    device_label: input.device_label || null,
    manufacturer: input.manufacturer || null,
    model: input.model || null,
    os_api_level: input.os_api_level ?? null,
    app_version: input.app_version ?? null,
    collection_enabled: input.collection_enabled ?? true,
    notification_access_granted: input.notification_access_granted ?? null,
    listener_connected: input.listener_connected ?? null,
    queue_depth: input.queue_depth ?? 0,
    last_reported_policy_version: input.last_reported_policy_version ?? state.mobile.policy_version,
    last_heartbeat_at: input.last_heartbeat_at ?? null,
    last_upload_success_at: input.last_upload_success_at ?? null,
    last_posted_collected_at: input.last_posted_collected_at ?? null,
    last_removed_collected_at: input.last_removed_collected_at ?? null,
    last_seen_at: input.last_seen_at || nowIso(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  state.mobile.devices.unshift(next);
  if (sqliteDb) {
    upsertSqliteDevice(next);
  }
  return next;
}

function issueSession(device) {
  const accessToken = makeId("flowfit_access");
  const refreshToken = makeId("flowfit_refresh");
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

  state.mobile.access_tokens = state.mobile.access_tokens.filter((entry) => entry.device_id !== device.device_id);
  state.mobile.refresh_tokens = state.mobile.refresh_tokens.filter((entry) => entry.device_id !== device.device_id);

  state.mobile.access_tokens.push({
    token: accessToken,
    device_id: device.device_id,
    installation_id: device.installation_id,
    expires_at: accessExpiresAt,
  });

  state.mobile.refresh_tokens.push({
    token: refreshToken,
    device_id: device.device_id,
    installation_id: device.installation_id,
    expires_at: refreshExpiresAt,
  });

  return {
    device_id: device.device_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    policy_version: state.mobile.policy_version,
  };
}

function createPairingCode(body = {}) {
  const now = Date.now();
  const code = {
    pairing_code: `FF-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    label: String(body.label || "FlowFit mobile link"),
    status: "active",
    expires_at: new Date(now + 1000 * 60 * 60 * Number(body.expires_in_hours || PAIRING_TTL_HOURS)).toISOString(),
    max_uses: Number(body.max_uses || 1),
    use_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
    last_used_at: null,
    active: true,
    expired: false,
    exhausted: false,
    remaining_uses: Number(body.max_uses || 1),
  };

  state.mobile.pairing_codes.unshift(code);
  saveState();
  return code;
}

function refreshPairingCodeState(code) {
  const now = Date.now();
  const expired = code.expires_at ? Date.parse(code.expires_at) <= now : false;
  const exhausted = typeof code.max_uses === "number" && code.max_uses > 0 ? code.use_count >= code.max_uses : false;
  code.expired = expired;
  code.exhausted = exhausted;
  code.active = !expired && !exhausted;
  code.status = code.active ? "active" : expired ? "expired" : "used";
  code.remaining_uses =
    typeof code.max_uses === "number" && code.max_uses > 0
      ? Math.max(code.max_uses - code.use_count, 0)
      : null;
  return code;
}

function listPairingCodes(limit) {
  return state.mobile.pairing_codes
    .map((entry) => refreshPairingCodeState(entry))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
}

function buildFleetSummary() {
  const now = Date.now();
  const dayAgo = now - 1000 * 60 * 60 * 24;
  const halfHourAgo = now - 1000 * 60 * 30;
  const devices = state.mobile.devices.map((device) => {
    const enabled = device.collection_enabled !== false;
    const stale = enabled && device.last_heartbeat_at ? Date.parse(device.last_heartbeat_at) < halfHourAgo : enabled;
    return {
      ...device,
      collection_enabled: enabled,
      stale_30m: stale,
    };
  });

  const uploads24h = state.mobile.uploads.filter((entry) => Date.parse(entry.at) >= dayAgo);
  const pendingCommands = state.mobile.commands.filter((command) => command.status === "queued" || command.status === "delivered");
  const totalDuplicates = uploads24h.reduce((sum, entry) => sum + (entry.duplicate_count || 0), 0);
  const totalEvents = uploads24h.reduce((sum, entry) => sum + (entry.event_count || 0), 0);
  const manufacturersMap = new Map();

  for (const device of devices) {
    const key = device.manufacturer || "Unknown";
    const current = manufacturersMap.get(key) || {
      manufacturer: key,
      total_devices: 0,
      stale_devices_30m: 0,
      permission_off_devices: 0,
      disabled_devices: 0,
    };
    current.total_devices += 1;
    if (!device.collection_enabled) current.disabled_devices += 1;
    if (device.collection_enabled && device.stale_30m) current.stale_devices_30m += 1;
    if (device.collection_enabled && device.notification_access_granted === false) current.permission_off_devices += 1;
    manufacturersMap.set(key, current);
  }

  return {
    policy_version: state.mobile.policy_version,
    default_action: state.mobile.default_action,
    total_devices: devices.length,
    active_devices_30m: devices.filter((device) => device.collection_enabled && !device.stale_30m).length,
    stale_devices_30m: devices.filter((device) => device.collection_enabled && device.stale_30m).length,
    disabled_devices: devices.filter((device) => !device.collection_enabled).length,
    permission_off_devices: devices.filter((device) => device.collection_enabled && device.notification_access_granted === false).length,
    queue_depth_sum: devices.reduce((sum, device) => sum + (device.queue_depth || 0), 0),
    pending_engine_inputs: pendingCommands.length,
    uploaded_batches_24h: uploads24h.length,
    duplicate_rate_24h: totalEvents > 0 ? totalDuplicates / totalEvents : 0,
    manufacturers: Array.from(manufacturersMap.values()).sort((left, right) => right.total_devices - left.total_devices),
  };
}

function normalizeCommandStatus(command) {
  if ((command.status === "queued" || command.status === "delivered") && command.expires_at && Date.parse(command.expires_at) <= Date.now()) {
    command.status = "expired";
    command.updated_at = nowIso();
  }

  return command;
}

function buildCommand(body, deviceId) {
  const now = Date.now();
  const replyText = String(body.reply_text || body.replyText || "").trim();
  if (!replyText) {
    return null;
  }

  return {
    command_id: makeId("cmd"),
    type: body.type || "send_notification_reply",
    device_id: deviceId,
    source_event_id: body.source_event_id || body.sourceEventId || null,
    package_name: body.package_name || body.packageName || null,
    notification_key_hash: body.notification_key_hash || body.notificationKeyHash || null,
    notification_tap_region: body.notification_tap_region || body.notificationTapRegion || null,
    expected_sender_hint: body.expected_sender_hint || body.expectedSenderHint || null,
    expected_body_hint: body.expected_body_hint || body.expectedBodyHint || null,
    reply_text: replyText,
    execution_plan: Array.isArray(body.execution_plan)
      ? body.execution_plan
      : ["remote_input", "visual_executor"],
    remote_input: {
      enabled: body.remote_input?.enabled !== false,
      require_notification_action: body.remote_input?.require_notification_action !== false,
    },
    visual_executor: {
      enabled: body.visual_executor?.enabled !== false,
      requires_screen_validation: body.visual_executor?.requires_screen_validation !== false,
      allowed_actions: Array.isArray(body.visual_executor?.allowed_actions)
        ? body.visual_executor.allowed_actions
        : ["open_notification", "focus_input", "type_reply", "send_reply"],
      stop_conditions: Array.isArray(body.visual_executor?.stop_conditions)
        ? body.visual_executor.stop_conditions
        : ["package_mismatch", "conversation_mismatch", "recent_message_mismatch", "permission_dialog", "low_confidence"],
    },
    safety: {
      requires_pre_send_validation: body.safety?.requires_pre_send_validation !== false,
      min_confidence: typeof body.safety?.min_confidence === "number" ? body.safety.min_confidence : 0.82,
      require_expected_app: body.safety?.require_expected_app !== false,
      require_recent_message_match: body.safety?.require_recent_message_match !== false,
    },
    status: "queued",
    attempts: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
    expires_at: body.expires_at || new Date(now + 1000 * 60 * 5).toISOString(),
    delivered_at: null,
    completed_at: null,
    result: null,
  };
}

function createMobileCommand(deviceId, body) {
  const device = state.mobile.devices.find((entry) => entry.device_id === deviceId);
  if (!device) {
    return null;
  }

  const command = buildCommand(body, deviceId);
  if (!command) {
    return { error: "reply_text_required" };
  }

  state.mobile.commands.unshift(command);
  state.mobile.commands = state.mobile.commands.slice(0, 1000);
  upsertSqliteCommand(command);
  saveState();
  return command;
}

function listAdminCommands(limit, deviceId) {
  return state.mobile.commands
    .map((entry) => normalizeCommandStatus(entry))
    .filter((entry) => !deviceId || entry.device_id === deviceId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
}

function claimDeviceCommands(deviceId, limit) {
  const commands = state.mobile.commands
    .map((entry) => normalizeCommandStatus(entry))
    .filter((entry) => entry.device_id === deviceId && entry.status === "queued")
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .slice(0, limit);

  for (const command of commands) {
    command.status = "delivered";
    command.attempts = (command.attempts || 0) + 1;
    command.delivered_at = nowIso();
    command.updated_at = nowIso();
    upsertSqliteCommand(command);
  }

  if (commands.length > 0) {
    saveState();
  }

  return commands;
}

function completeDeviceCommand(deviceId, commandId, body) {
  const command = state.mobile.commands.find((entry) => entry.device_id === deviceId && entry.command_id === commandId);
  if (!command) {
    return null;
  }

  const requestedStatus = String(body.status || "").toLowerCase();
  const success = body.ok === true || requestedStatus === "succeeded" || requestedStatus === "success";
  command.status = success ? "succeeded" : "failed";
  command.completed_at = nowIso();
  command.updated_at = nowIso();
  command.result = {
    ok: success,
    status: command.status,
    method: body.method || body.executor || null,
    reason: body.reason || body.error || null,
    confidence: typeof body.confidence === "number" ? body.confidence : null,
    validation: body.validation || null,
    screenshot_ref: body.screenshot_ref || null,
    reported_at: nowIso(),
  };

  state.mobile.command_results.unshift({
    command_id: command.command_id,
    device_id: deviceId,
    status: command.status,
    method: command.result.method,
    reason: command.result.reason,
    reported_at: command.result.reported_at,
  });
  state.mobile.command_results = state.mobile.command_results.slice(0, 1000);
  upsertSqliteCommand(command);
  insertSqliteCommandResult(state.mobile.command_results[0]);
  updateAiJudgmentFromCommand(command);
  saveState();
  return command;
}

function buildDevices(limit, offset) {
  const halfHourAgo = Date.now() - 1000 * 60 * 30;
  return state.mobile.devices
    .map((device) => {
      const enabled = device.collection_enabled !== false;
      return {
        ...device,
        collection_enabled: enabled,
        stale_30m: enabled && device.last_heartbeat_at ? Date.parse(device.last_heartbeat_at) < halfHourAgo : enabled,
      };
    })
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
    .slice(offset, offset + limit);
}

function setMobileDeviceEnabled(deviceId, enabled) {
  const device = state.mobile.devices.find((entry) => entry.device_id === deviceId);
  if (!device) {
    return null;
  }

  device.collection_enabled = Boolean(enabled);
  device.updated_at = nowIso();
  state.mobile.policy_version += 1;
  upsertSqliteDevice(device);
  saveState();

  const halfHourAgo = Date.now() - 1000 * 60 * 30;
  return {
    ...device,
    stale_30m: device.collection_enabled && device.last_heartbeat_at
      ? Date.parse(device.last_heartbeat_at) < halfHourAgo
      : device.collection_enabled,
  };
}

async function handleCollectorIngest(req, res) {
  const body = await readJsonBody(req);
  const events = Array.isArray(body.events) ? body.events : [];
  const accepted = [];

  for (const event of events) {
    if (!event || !event.event_id) {
      continue;
    }
    accepted.push(event.event_id);
    insertSqliteMobileEvent(event.device_id || "desktop-collector", event, "received");
    state.collector.recent_events.unshift({
      event_id: event.event_id,
      source_app: event.source_app || null,
      collected_at: event.collected_at_ms_utc ? msToIso(event.collected_at_ms_utc) : nowIso(),
    });
  }

  state.collector.ingested_count += accepted.length;
  state.collector.last_ingest_at = nowIso();
  state.collector.recent_events = state.collector.recent_events.slice(0, 100);
  saveState();

  json(res, 200, {
    accepted_event_ids: accepted,
    rejected_event_ids: [],
  });
}

async function handleMobilePair(req, res) {
  const body = await readJsonBody(req);
  const pairingCode = normalizePairingCodeInput(body.pairing_code);
  if (!pairingCode) {
    badRequest(res, "pairing_code_required");
    return;
  }

  const pairing = state.mobile.pairing_codes.find((entry) => entry.pairing_code === pairingCode);
  if (!pairing || !refreshPairingCodeState(pairing).active) {
    const activeCode = listPairingCodes(1).find((entry) => entry.active);
    json(res, 400, {
      error: "pairing_code_invalid",
      message: "pairing code is expired, used, or not found",
      received_pairing_code: pairingCode,
      active_pairing_code: activeCode?.pairing_code ?? null,
    });
    return;
  }

  pairing.use_count += 1;
  pairing.last_used_at = nowIso();
  pairing.updated_at = nowIso();
  refreshPairingCodeState(pairing);

  const device = upsertDevice({
    device_id: body.device_id || makeId("device"),
    installation_id: body.installation_id || makeId("installation"),
    device_label: body.device_label || body.label || "FlowFit mobile",
    manufacturer: body.manufacturer || null,
    model: body.model || null,
    os_api_level: body.os_api_level ?? null,
    app_version: body.app_version || null,
    last_seen_at: nowIso(),
  });

  const session = issueSession(device);
  saveState();
  json(res, 201, session);
}

async function handleMobileRefresh(req, res) {
  const body = await readJsonBody(req);
  const refreshToken = String(body.refresh_token || "").trim();
  const existing = state.mobile.refresh_tokens.find((entry) => entry.token === refreshToken);

  if (!existing || Date.parse(existing.expires_at) <= Date.now()) {
    unauthorized(res);
    return;
  }

  const device = state.mobile.devices.find((entry) => entry.device_id === existing.device_id);
  if (!device) {
    unauthorized(res);
    return;
  }

  const session = issueSession(device);
  saveState();
  json(res, 200, {
    device_id: session.device_id,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    access_token_expires_at: session.access_token_expires_at,
    refresh_token_expires_at: session.refresh_token_expires_at,
    policy_version: session.policy_version,
  });
}

async function handleMobileAuthVerify(req, res) {
  const session = requireDeviceAuth(req, res);
  if (!session) return;

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const requestedDeviceId = String(body.device_id || "").trim();
  if (requestedDeviceId && requestedDeviceId !== session.device_id) {
    unauthorized(res);
    return;
  }

  const device = state.mobile.devices.find((entry) => entry.device_id === session.device_id);
  if (!device) {
    unauthorized(res);
    return;
  }

  device.last_seen_at = nowIso();
  device.updated_at = nowIso();
  saveState();

  json(res, 200, {
    valid: true,
    device_id: session.device_id,
    installation_id: session.installation_id,
    token_type: "Bearer",
    access_token_expires_at: session.expires_at,
    policy_version: state.mobile.policy_version,
    server_time_ms_utc: Date.now(),
  });
}

function handleMobilePolicy(req, res, deviceId, query) {
  const session = requireDeviceAuth(req, res);
  if (!session) return;
  if (session.device_id !== deviceId) {
    unauthorized(res);
    return;
  }

  const requestedVersion = Number.parseInt(query.searchParams.get("policy_version") || "0", 10);
  const existingDevice = state.mobile.devices.find((entry) => entry.device_id === deviceId);
  if (existingDevice?.collection_enabled === false) {
    json(res, 200, {
      policy_version: state.mobile.policy_version,
      default_action: "drop",
      packages: state.mobile.packages.map((entry) => ({
        ...entry,
        enabled: false,
      })),
      disabled: true,
    });
    return;
  }

  const statusCode = requestedVersion === state.mobile.policy_version ? 200 : 200;
  json(res, statusCode, {
    policy_version: state.mobile.policy_version,
    default_action: state.mobile.default_action,
    packages: state.mobile.packages,
  });
}

async function handleMobileHeartbeat(req, res, deviceId) {
  const session = requireDeviceAuth(req, res);
  if (!session) return;
  if (session.device_id !== deviceId) {
    unauthorized(res);
    return;
  }

  const body = await readJsonBody(req);
  const device = upsertDevice({
    device_id: deviceId,
    installation_id: session.installation_id,
    manufacturer: body.manufacturer || null,
    model: body.model || null,
    os_api_level: body.os_api_level ?? null,
    app_version: body.app_version || null,
    notification_access_granted: body.notification_access_granted ?? null,
    listener_connected: body.listener_connected ?? null,
    queue_depth: body.queue_depth ?? 0,
    last_reported_policy_version: body.policy_version ?? state.mobile.policy_version,
    last_heartbeat_at: body.sent_at_ms_utc ? msToIso(body.sent_at_ms_utc) : nowIso(),
    last_upload_success_at: msToIso(body.last_upload_success_at_ms_utc),
    last_posted_collected_at: msToIso(body.last_posted_collected_at_ms_utc),
    last_removed_collected_at: msToIso(body.last_removed_collected_at_ms_utc),
    last_seen_at: nowIso(),
  });

  device.updated_at = nowIso();
  saveState();

  json(res, 200, {
    server_time_ms_utc: Date.now(),
  });
}

async function handleMobileBatch(req, res) {
  const session = requireDeviceAuth(req, res);
  if (!session) return;

  const body = await readJsonBody(req);
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId || session.device_id !== deviceId) {
    unauthorized(res);
    return;
  }

  const events = Array.isArray(body.events) ? body.events : [];
  const existingDevice = state.mobile.devices.find((entry) => entry.device_id === deviceId);
  if (existingDevice?.collection_enabled === false) {
    json(res, 200, {
      acked_event_ids: events.map((event) => event?.event_id).filter(Boolean),
      duplicate_event_ids: [],
      retryable_failed_ids: [],
      policy_version: state.mobile.policy_version,
      disabled: true,
    });
    return;
  }

  const acked = [];
  const duplicates = [];
  const retryable = [];

  for (const event of events) {
    if (!event || !event.event_id) {
      continue;
    }

    const duplicate = state.mobile.ingested_events.some((entry) => entry.event_id === event.event_id);
    const sqliteDuplicate = sqliteDb
      .prepare("SELECT 1 AS exists_flag FROM mobile_events WHERE event_id = ?")
      .get(event.event_id);
    if (duplicate || sqliteDuplicate) {
      duplicates.push(event.event_id);
      continue;
    }

    acked.push(event.event_id);
    insertSqliteMobileEvent(deviceId, event, "received");
    state.mobile.ingested_events.unshift({
      event_id: event.event_id,
      device_id: deviceId,
      collected_at: msToIso(event.collected_at_ms_utc) || nowIso(),
      package_name: event.package_name || "unknown",
      title: event.title || null,
    });
  }

  state.mobile.ingested_events = state.mobile.ingested_events.slice(0, 2000);
  state.mobile.uploads.unshift({
    at: nowIso(),
    device_id: deviceId,
    event_count: events.length,
    duplicate_count: duplicates.length,
  });
  state.mobile.uploads = state.mobile.uploads.slice(0, 1000);

  const device = upsertDevice({
    device_id: deviceId,
    installation_id: String(body.installationId || session.installation_id || ""),
    queue_depth: 0,
    last_upload_success_at: nowIso(),
    last_seen_at: nowIso(),
  });
  device.updated_at = nowIso();
  saveState();

  json(res, 200, {
    acked_event_ids: acked,
    duplicate_event_ids: duplicates,
    retryable_failed_ids: retryable,
    policy_version: state.mobile.policy_version,
  });
}

function findBrowserCommandPolicy(commandName) {
  const normalized = String(commandName || "").trim().toUpperCase();
  return DEFAULT_BROWSER_COMMAND_POLICY.find((item) => item.name === normalized) || null;
}

function requireBrowserBridgeExtension(req, res) {
  if (getBearerToken(req) !== BROWSER_BRIDGE_TOKEN) {
    unauthorized(res);
    return false;
  }

  return true;
}

function normalizeBrowserSessionStatus(session) {
  const lastSeenAt = session.last_seen_at || session.updated_at || session.created_at;
  const stale = lastSeenAt ? Date.parse(lastSeenAt) < Date.now() - 1000 * 60 : true;
  return {
    ...session,
    status: stale ? "stale" : "online",
  };
}

function upsertBrowserBridgeSession(body = {}) {
  const sessionId = String(body.session_id || body.sessionId || "").trim() || makeId("browser_session");
  const existing = state.browser_bridge.sessions.find((entry) => entry.session_id === sessionId);
  const next = {
    session_id: sessionId,
    extension_name: body.extension_name || body.extensionName || "FlowFit Browser Bridge",
    browser: body.browser || "Chrome",
    version: body.version || null,
    active_tab_title: body.active_tab_title || body.activeTabTitle || null,
    active_tab_url: body.active_tab_url || body.activeTabUrl || null,
    last_seen_at: nowIso(),
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso(),
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    state.browser_bridge.sessions.unshift(next);
  }

  state.browser_bridge.sessions = state.browser_bridge.sessions.slice(0, 20);
  saveState();
  return normalizeBrowserSessionStatus(next);
}

function buildBrowserBridgeCommand(body = {}) {
  const commandName = String(body.command || body.type || "").trim().toUpperCase();
  const policy = findBrowserCommandPolicy(commandName);
  const riskLevel = policy?.risk_level || "blocked";
  const allowed = policy?.allowed === true;
  const requiresApproval = policy?.requires_approval === true;

  return {
    command_id: makeId("browser_cmd"),
    command: commandName || "UNKNOWN",
    label: String(body.label || policy?.label || commandName || "釉뚮씪?곗? ?묒뾽").trim(),
    params: body.params && typeof body.params === "object" ? body.params : {},
    target_url: body.target_url || body.targetUrl || null,
    requested_by: body.requested_by || body.requestedBy || "owner",
    risk_level: riskLevel,
    status: allowed ? (requiresApproval ? "waiting_approval" : "queued") : "blocked",
    policy_reason: policy?.reason || "?깅줉?섏? ?딆븯嫄곕굹 ?덉슜?섏? ?딆? 釉뚮씪?곗? 紐낅졊?낅땲??",
    result_summary: allowed ? null : policy?.reason || "?뺤콉???섑빐 李⑤떒?섏뿀?듬땲??",
    created_at: nowIso(),
    updated_at: nowIso(),
    delivered_at: null,
    completed_at: allowed ? null : nowIso(),
    result: null,
  };
}

function createBrowserBridgeCommand(body = {}) {
  const command = buildBrowserBridgeCommand(body);
  state.browser_bridge.commands.unshift(command);
  state.browser_bridge.commands = state.browser_bridge.commands.slice(0, 500);
  saveState();
  return command;
}

function approveBrowserBridgeCommand(commandId) {
  const command = state.browser_bridge.commands.find((entry) => entry.command_id === commandId);
  if (!command) {
    return null;
  }

  if (command.status === "waiting_approval") {
    command.status = "queued";
    command.updated_at = nowIso();
    saveState();
  }

  return command;
}

function listBrowserBridgeCommands(limit) {
  return state.browser_bridge.commands
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
}

function claimBrowserBridgeCommands(sessionId, limit) {
  const commands = state.browser_bridge.commands
    .filter((entry) => entry.status === "queued")
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .slice(0, limit);

  for (const command of commands) {
    command.session_id = sessionId;
    command.status = "delivered";
    command.delivered_at = nowIso();
    command.updated_at = nowIso();
  }

  if (commands.length > 0) {
    saveState();
  }

  return commands;
}

function completeBrowserBridgeCommand(sessionId, commandId, body = {}) {
  const command = state.browser_bridge.commands.find(
    (entry) => entry.command_id === commandId && (!entry.session_id || entry.session_id === sessionId)
  );

  if (!command) {
    return null;
  }

  const requestedStatus = String(body.status || "").toLowerCase();
  const success = body.ok === true || requestedStatus === "succeeded" || requestedStatus === "success";
  command.status = success ? "succeeded" : "failed";
  command.result_summary =
    body.result_summary ||
    body.summary ||
    (success ? "釉뚮씪?곗? ?뺤옣 ?꾨줈洹몃옩???묒뾽 ?꾨즺瑜?蹂닿퀬?덉뒿?덈떎." : body.error || "?묒뾽 ?ㅽ뙣");
  command.completed_at = nowIso();
  command.updated_at = nowIso();
  command.result = {
    ok: success,
    status: command.status,
    safe_action_summary: Array.isArray(body.safe_action_summary) ? body.safe_action_summary : [],
    masked_preview_ref: body.masked_preview_ref || null,
    error: body.error || null,
    reported_at: nowIso(),
  };

  state.browser_bridge.command_results.unshift({
    command_id: command.command_id,
    session_id: sessionId,
    status: command.status,
    result_summary: command.result_summary,
    reported_at: command.result.reported_at,
  });
  state.browser_bridge.command_results = state.browser_bridge.command_results.slice(0, 500);
  saveState();
  return command;
}

function buildBrowserBridgeOverview() {
  const sessions = state.browser_bridge.sessions.map((session) => normalizeBrowserSessionStatus(session));
  const onlineSessions = sessions.filter((session) => session.status === "online");

  return {
    connected: onlineSessions.length > 0,
    checked_at: nowIso(),
    policy_version: state.browser_bridge.policy_version || 1,
    extension_token_configured: BROWSER_BRIDGE_TOKEN !== "dev-browser-bridge-token",
    sessions,
    command_audit: listBrowserBridgeCommands(20),
    policy: buildBrowserOverviewPolicy(),
    token_saving_plan: DEFAULT_BROWSER_TOKEN_SAVING_PLAN,
    recommended_sources: DEFAULT_BROWSER_SOURCES,
  };
}

function normalizeGateCommandName(command) {
  return String(command || "").trim().toUpperCase();
}

function getGatePolicy(command) {
  const name = normalizeGateCommandName(command);
  if (GATE_BLOCK_COMMANDS.has(name)) {
    return {
      command: name,
      level: "BLOCK",
      risk_reason: "?꾩쓽 ?ㅽ겕由쏀듃 ?ㅽ뻾? 濡쒓렇???몄뀡怨??섏씠吏 ?곗씠?곕? ?고쉶 議곗옉?????덉뼱 ??긽 李⑤떒?⑸땲??",
    };
  }
  if (GATE_CONFIRM_COMMANDS.has(name)) {
    return {
      command: name,
      level: "CONFIRM",
      risk_reason: "?몃? ?쒕퉬???곹깭, 濡쒓렇???뺣낫, ??μ냼, ???쒖텧???곹뼢??以????덉뼱 ?댁쁺???뱀씤 ?꾩뿉留??ㅽ뻾?⑸땲??",
    };
  }
  if (GATE_SAFE_COMMANDS.has(name)) {
    return {
      command: name,
      level: "SAFE",
      risk_reason: "Gate ?뺤콉??利됱떆 ?ㅽ뻾 媛?ν븳 紐낅졊?낅땲??",
    };
  }
  return {
    command: name || "UNKNOWN",
    level: "BLOCK",
    risk_reason: "?깅줉?섏? ?딆? 釉뚮씪?곗? 紐낅졊? Gate?먯꽌 李⑤떒?⑸땲??",
  };
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function htmlToGateSummary(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

function maskGateText(value) {
  let maskedCount = 0;
  let text = String(value || "");

  for (const { pattern, replacement } of PII_PATTERNS) {
    text = text.replace(pattern, () => {
      maskedCount += 1;
      return replacement;
    });
  }

  return { text, maskedCount };
}

function sanitizeGateResultPayload(result) {
  const serialized = typeof result === "string" ? result : JSON.stringify(result ?? null);

  if (serialized.length > 200000 && /data:image\/[a-z]+;base64,/i.test(serialized)) {
    return {
      masked: {
        screenshot: "[MASKED_SCREENSHOT_OVER_200KB]",
        hint: "?ㅽ겕由곗꺑??而ㅼ꽌 AI?먮뒗 ?대?吏 ?먮Ц ????덉쟾???뚰듃留??꾨떖?⑸땲??",
      },
      maskedCount: 1,
      resultSize: serialized.length,
    };
  }

  const normalized = /<[^>]+>/.test(serialized)
    ? htmlToGateSummary(serialized)
    : serialized.slice(0, Math.min(serialized.length, 20000));
  const { text, maskedCount } = maskGateText(normalized);
  const masked = typeof result === "string" ? text : parseJsonSafe(text, text);

  return {
    masked,
    maskedCount,
    resultSize: serialized.length,
  };
}

function cleanupGateRecords() {
  const now = nowIso();
  sqliteDb
    .prepare("UPDATE agent_approvals SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at <= ?")
    .run(now, now);
  sqliteDb
    .prepare("UPDATE agent_commands SET status = 'expired', updated_at = ? WHERE status = 'pending_approval' AND expires_at <= ?")
    .run(now, now);

  const ninetyDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();
  sqliteDb.prepare("DELETE FROM agent_audit_log WHERE created_at < ?").run(ninetyDaysAgo);
  sqliteDb.prepare("DELETE FROM agent_commands WHERE status IN ('done','error','blocked','rejected','expired') AND updated_at < ?").run(sevenDaysAgo);
}

function insertGateAudit(input) {
  sqliteDb
    .prepare(`
      INSERT INTO agent_audit_log (
        audit_id, session_id, command, risk_level, params_hash, result_size, pii_masked,
        approved_by, outcome, duration_ms, error_msg, tab_url, created_at
      )
      VALUES (
        @audit_id, @session_id, @command, @risk_level, @params_hash, @result_size, @pii_masked,
        @approved_by, @outcome, @duration_ms, @error_msg, @tab_url, @created_at
      )
    `)
    .run({
      audit_id: makeId("audit"),
      session_id: input.session_id || "default",
      command: input.command || "UNKNOWN",
      risk_level: input.risk_level || "SAFE",
      params_hash: input.params_hash || null,
      result_size: Number(input.result_size || 0),
      pii_masked: Number(input.pii_masked || 0),
      approved_by: input.approved_by || null,
      outcome: input.outcome || "received",
      duration_ms: input.duration_ms ?? null,
      error_msg: input.error_msg || null,
      tab_url: input.tab_url || null,
      created_at: nowIso(),
    });
}

function normalizeGateCommandRow(row, includeParams = false) {
  if (!row) return null;
  const record = {
    command_id: row.command_id,
    session_id: row.session_id,
    command: row.command,
    status: row.status,
    level: row.level,
    result: row.result ? parseJsonSafe(row.result, row.result) : null,
    error: row.error || null,
    result_size: row.result_size || 0,
    pii_masked: row.pii_masked || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    delivered_at: row.delivered_at || null,
    completed_at: row.completed_at || null,
    expires_at: row.expires_at || null,
  };
  if (includeParams) {
    record.params = parseJsonSafe(row.params, {});
  }
  return record;
}

function createGateCommand(body = {}, headers = {}) {
  cleanupGateRecords();
  const commandName = normalizeGateCommandName(body.command || body.type);
  const sessionId = String(body.sessionId || body.session_id || headers["x-session-id"] || "default").trim() || "default";
  const params = body.params && typeof body.params === "object" ? body.params : {};
  const paramsText = JSON.stringify(params);
  const paramsHash = sha256Text(paramsText);
  const policy = getGatePolicy(commandName);
  const commandId = makeId("gate_cmd");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + GATE_COMMAND_TTL_MS).toISOString();

  if (policy.level === "BLOCK") {
    insertGateAudit({
      session_id: sessionId,
      command: policy.command,
      risk_level: policy.level,
      params_hash: paramsHash,
      outcome: "blocked",
      error_msg: policy.risk_reason,
    });
    return {
      ok: false,
      blocked: true,
      status: "blocked",
      commandId,
      command: policy.command,
      reason: policy.risk_reason,
    };
  }

  sqliteDb
    .prepare(`
      INSERT INTO agent_commands (
        command_id, session_id, command, params, level, status, created_at, updated_at, expires_at
      )
      VALUES (@command_id, @session_id, @command, @params, @level, @status, @created_at, @updated_at, @expires_at)
    `)
    .run({
      command_id: commandId,
      session_id: sessionId,
      command: policy.command,
      params: paramsText,
      level: policy.level,
      status: policy.level === "CONFIRM" ? "pending_approval" : "approved",
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
    });

  if (policy.level === "CONFIRM") {
    const approvalId = makeId("approval");
    sqliteDb
      .prepare(`
        INSERT INTO agent_approvals (
          approval_id, command_id, session_id, command, params_hash, risk_reason,
          status, created_at, expires_at, updated_at
        )
        VALUES (
          @approval_id, @command_id, @session_id, @command, @params_hash, @risk_reason,
          'pending', @created_at, @expires_at, @updated_at
        )
      `)
      .run({
        approval_id: approvalId,
        command_id: commandId,
        session_id: sessionId,
        command: policy.command,
        params_hash: paramsHash,
        risk_reason: policy.risk_reason,
        created_at: now,
        expires_at: expiresAt,
        updated_at: now,
      });
    insertGateAudit({
      session_id: sessionId,
      command: policy.command,
      risk_level: policy.level,
      params_hash: paramsHash,
      outcome: "pending_approval",
    });
    return {
      ok: true,
      status: "pending_approval",
      commandId,
      approvalId,
      command: policy.command,
      reason: policy.risk_reason,
      expiresAt,
    };
  }

  insertGateAudit({
    session_id: sessionId,
    command: policy.command,
    risk_level: policy.level,
    params_hash: paramsHash,
    outcome: "approved",
  });
  return {
    ok: true,
    status: "approved",
    commandId,
    command: policy.command,
  };
}

function pollGateCommand(sessionId) {
  cleanupGateRecords();
  const normalizedSessionId = String(sessionId || "default").trim() || "default";
  const row =
    sqliteDb
      .prepare(
        `
        SELECT * FROM agent_commands
        WHERE status = 'approved' AND (session_id = ? OR session_id = 'default')
        ORDER BY CASE WHEN session_id = ? THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1
      `
      )
      .get(normalizedSessionId, normalizedSessionId) || null;

  if (!row) {
    return { commandId: null };
  }

  sqliteDb
    .prepare("UPDATE agent_commands SET status = 'processing', delivered_at = ?, updated_at = ? WHERE command_id = ?")
    .run(nowIso(), nowIso(), row.command_id);

  return {
    commandId: row.command_id,
    command: row.command,
    params: parseJsonSafe(row.params, {}),
  };
}

function completeGateCommand(body = {}) {
  const commandId = String(body.commandId || body.command_id || "").trim();
  if (!commandId) {
    return { error: "commandId_required" };
  }

  const row = sqliteDb.prepare("SELECT * FROM agent_commands WHERE command_id = ?").get(commandId);
  if (!row) {
    return null;
  }

  const startedAt = row.delivered_at ? Date.parse(row.delivered_at) : Date.parse(row.created_at);
  const durationMs = Number.isFinite(startedAt) ? Math.max(Date.now() - startedAt, 0) : null;
  const rawResult = body.result ?? null;
  const error = body.error || null;
  const sanitized = error ? { masked: { error }, maskedCount: 0, resultSize: String(error).length } : sanitizeGateResultPayload(rawResult);
  const status = error ? "error" : "done";
  const completedAt = nowIso();

  sqliteDb
    .prepare(
      `
      UPDATE agent_commands
      SET status = @status, result = @result, error = @error, result_size = @result_size,
          pii_masked = @pii_masked, completed_at = @completed_at, updated_at = @updated_at
      WHERE command_id = @command_id
    `
    )
    .run({
      command_id: commandId,
      status,
      result: JSON.stringify(sanitized.masked),
      error,
      result_size: sanitized.resultSize,
      pii_masked: sanitized.maskedCount,
      completed_at: completedAt,
      updated_at: completedAt,
    });

  insertGateAudit({
    session_id: row.session_id,
    command: row.command,
    risk_level: row.level,
    params_hash: sha256Text(row.params),
    result_size: sanitized.resultSize,
    pii_masked: sanitized.maskedCount,
    outcome: status,
    duration_ms: durationMs,
    error_msg: error,
    tab_url: body.tabUrl || body.tab_url || null,
  });

  return {
    ok: !error,
    commandId,
    status,
    result: sanitized.masked,
    piiMasked: sanitized.maskedCount,
  };
}

function listGateApprovals() {
  cleanupGateRecords();
  return sqliteDb
    .prepare("SELECT * FROM agent_approvals WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100")
    .all();
}

function reviewGateApproval(approvalId, approved, body = {}) {
  cleanupGateRecords();
  const approval = sqliteDb.prepare("SELECT * FROM agent_approvals WHERE approval_id = ?").get(approvalId);
  if (!approval) {
    return null;
  }
  if (approval.status !== "pending") {
    return { ok: false, approval, error: "approval_not_pending" };
  }

  const nextStatus = approved ? "approved" : "rejected";
  const nextCommandStatus = approved ? "approved" : "rejected";
  const reviewedBy = body.reviewedBy || body.reviewed_by || "operator";
  const note = body.note || body.reviewNote || body.review_note || null;
  const now = nowIso();

  sqliteDb
    .prepare(
      "UPDATE agent_approvals SET status = ?, reviewed_by = ?, review_note = ?, updated_at = ? WHERE approval_id = ?"
    )
    .run(nextStatus, reviewedBy, note, now, approvalId);
  sqliteDb
    .prepare("UPDATE agent_commands SET status = ?, updated_at = ? WHERE command_id = ?")
    .run(nextCommandStatus, now, approval.command_id);

  insertGateAudit({
    session_id: approval.session_id,
    command: approval.command,
    risk_level: "CONFIRM",
    params_hash: approval.params_hash,
    approved_by: reviewedBy,
    outcome: approved ? "approved" : "rejected",
  });

  return {
    ok: true,
    approvalId,
    commandId: approval.command_id,
    status: nextStatus,
  };
}

function recordGateEvent(body = {}, headers = {}) {
  const sessionId = String(headers["x-session-id"] || body.sessionId || body.session_id || "default");
  const event = body.event && typeof body.event === "object" ? body.event : {};
  insertGateAudit({
    session_id: sessionId,
    command: "PAGE_EVENT",
    risk_level: "SAFE",
    params_hash: sha256Text(JSON.stringify(event)),
    outcome: "event",
    tab_url: event.url || null,
  });
  return { ok: true };
}

function buildBrowserOverviewPolicy() {
  const toPolicy = (command, level) => ({
    name: command,
    label: command
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    risk_level: level === "SAFE" ? "read_only" : level === "CONFIRM" ? "needs_approval" : "blocked",
    allowed: level !== "BLOCK",
    requires_approval: level === "CONFIRM",
    token_saving_role:
      level === "SAFE"
        ? "Gate媛 ?뱀씤???덉쟾 紐낅졊留??뺤옣 ?꾨줈洹몃옩???대쭅???ㅽ뻾?⑸땲??"
        : level === "CONFIRM"
          ? "?댁쁺???뱀씤 ?꾩뿉???뺤옣 ?꾨줈洹몃옩???꾨떖?섏? ?딆뒿?덈떎."
          : "紐낅졊 肄붾뱶 ?먯껜媛 ?뺤옣 ?ㅽ뻾 寃쎈줈濡??대젮媛吏 ?딆뒿?덈떎.",
    reason: getGatePolicy(command).risk_reason,
  });

  return [
    ...Array.from(GATE_SAFE_COMMANDS).map((command) => toPolicy(command, "SAFE")),
    ...Array.from(GATE_CONFIRM_COMMANDS).map((command) => toPolicy(command, "CONFIRM")),
    ...Array.from(GATE_BLOCK_COMMANDS).map((command) => toPolicy(command, "BLOCK")),
  ];
}

function maybeEnsureBrowserExtensionInstalled() {
  const legacyOptIn = process.env.FLOWFIT_AUTO_INSTALL_EXTENSION === "1";
  const explicitOptIn = process.env.FLOWFIT_EXTENSION_AUTO_INSTALL === "1";

  if (!legacyOptIn && !explicitOptIn) {
    return;
  }

  try {
    require("./flowfit-extension-installer").ensureExtension({ optIn: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[FlowFit Extension] auto install skipped: ${message}\n`);
  }
}

function countSql(sql, params = []) {
  try {
    return Number(sqliteDb.prepare(sql).get(...params)?.count || 0);
  } catch {
    return 0;
  }
}

function getTodayStartIso() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

function buildOperationSummary() {
  const todayStart = getTodayStartIso();
  const autoProcessedToday = countSql(
    `
      SELECT COUNT(*) AS count
      FROM automation_log
      WHERE created_at >= ?
        AND result = 'success'
        AND trigger_type IN ('auto_morning_scan', 'cron')
    `,
    [todayStart],
  );
  const pendingGateApprovals = countSql("SELECT COUNT(*) AS count FROM agent_approvals WHERE status = 'pending'");
  const pendingActionTasks = countSql(
    `
      SELECT COUNT(*) AS count
      FROM action_task
      WHERE status IN ('open', 'pending_confirmation', 'snoozed')
    `,
  );
  const inProgress = countSql("SELECT COUNT(*) AS count FROM agent_commands WHERE status IN ('approved', 'processing')");
  const lastAutomation =
    sqliteDb
      .prepare("SELECT summary, created_at FROM automation_log ORDER BY created_at DESC LIMIT 1")
      .get() || null;

  return {
    ok: true,
    autoProcessedToday,
    pendingApproval: pendingGateApprovals + pendingActionTasks,
    inProgress,
    gatePendingApproval: pendingGateApprovals,
    actionTaskOpen: pendingActionTasks,
    lastAutomation,
    lastUpdated: nowIso(),
  };
}

function runMorningAutoScan(triggerType = "auto_morning_scan") {
  if (!wholesaleRuntime) {
    return { ok: false, error: "automation_runtime_not_ready" };
  }

  const beforeCount = countSql(
    `
      SELECT COUNT(*) AS count
      FROM action_task
      WHERE status IN ('open', 'pending_confirmation', 'snoozed')
    `,
  );
  const startedAt = nowIso();

  try {
    wholesaleRuntime.runAllCronJobsOnce(triggerType);
    const afterCount = countSql(
      `
        SELECT COUNT(*) AS count
        FROM action_task
        WHERE status IN ('open', 'pending_confirmation', 'snoozed')
      `,
    );
    const createdTasks = Math.max(afterCount - beforeCount, 0);
    const summary = `AI ?꾩묠 ?먮룞 ?먭? ?꾨즺: 寃?좏븷 ?댁쁺 ?낅Т ${createdTasks}嫄??뺣━`;

    sqliteDb
      .prepare(
        `
        INSERT INTO automation_log (
          engine_name, trigger_type, input_ref, action, result, summary, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run("auto_morning_scan", triggerType, "daily:08:00", "scan", "success", summary, null, nowIso());

    process.stdout.write(`[AutoScan] ${summary}\n`);
    return { ok: true, startedAt, completedAt: nowIso(), createdTasks };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sqliteDb
      .prepare(
        `
        INSERT INTO automation_log (
          engine_name, trigger_type, input_ref, action, result, summary, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run("auto_morning_scan", triggerType, "daily:08:00", "scan", "error", "AI ?꾩묠 ?먮룞 ?먭? ?ㅽ뙣", message, nowIso());
    process.stderr.write(`[AutoScan] error: ${message}\n`);
    return { ok: false, startedAt, completedAt: nowIso(), error: message };
  }
}

function scheduleMorningAutoScan() {
  cron.schedule(
    "0 8 * * *",
    () => {
      runMorningAutoScan("auto_morning_scan");
    },
    { timezone: "Asia/Seoul" },
  );
}

maybeEnsureBrowserExtensionInstalled();
let state = loadState();
sqliteDb = createStatsDatabase();
migrateJsonStateToSqlite();
wholesaleRuntime = createWholesaleAutomationRuntime({
  sqliteDb,
  storeDir: STORE_DIR,
  nowIso,
  log(message) {
    process.stdout.write(`${message}\n`);
  },
});
scheduleMorningAutoScan();

const server = http.createServer(async (req, res) => {
  try {
    const url = parseUrl(req);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/") {
      json(res, 200, {
        status: "ok",
        component: "flowfit-local-engine",
        schema_version: state.schema_version,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/collector/health") {
      json(res, 200, {
        status: "ok",
        component: "collector-ingest",
        ingested_count: state.collector.ingested_count,
      });
      return;
    }

    if (req.method === "GET" && (pathname === "/api/summary" || pathname === "/v1/summary")) {
      json(res, 200, buildOperationSummary());
      return;
    }

    if (req.method === "POST" && pathname === "/v1/automation/morning-scan") {
      if (!requireAdmin(req, res)) {
        return;
      }
      json(res, 200, runMorningAutoScan("manual_morning_scan"));
      return;
    }

    if (req.method === "POST" && pathname === "/collector/v1/notifications:ingest") {
      await handleCollectorIngest(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/stats/today") {
      json(res, 200, buildTodayStats());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/stats/recent-action") {
      json(res, 200, buildRecentAction());
      return;
    }

    if (req.method === "POST" && pathname === "/v1/events/ingest") {
      const body = await readJsonBody(req);
      const result = await wholesaleRuntime.handleEventsIngest(body);
      json(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/files/upload") {
      const form = await readMultipartBody(req);
      const file = form.files[0];
      if (!file) {
        badRequest(res, "file_required");
        return;
      }

      const result = await wholesaleRuntime.handleFileUpload({
        purpose: form.fields.purpose || "unknown",
        fileName: file.fileName,
        mimeType: file.mimeType,
        buffer: file.buffer,
        createdBy: form.fields.created_by || "user",
      });
      json(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/orders/ingest") {
      const body = await readJsonBody(req);
      const result = await wholesaleRuntime.handleOrdersIngest(body);
      json(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/pricelist/upload") {
      const form = await readMultipartBody(req);
      const file = form.files[0];
      if (!file) {
        badRequest(res, "file_required");
        return;
      }

      const result = await wholesaleRuntime.handlePriceListUpload({
        fileName: file.fileName,
        mimeType: file.mimeType,
        buffer: file.buffer,
        createdBy: form.fields.created_by || "user",
      });
      json(res, 200, result);
      return;
    }

    const actionTaskMatch = pathname.match(/^\/v1\/action-tasks\/(\d+)\/execute$/);
    if (req.method === "POST" && actionTaskMatch) {
      const body = await readJsonBody(req);
      const result = await wholesaleRuntime.executeActionTask(Number(actionTaskMatch[1]), body);
      json(res, result.statusCode || 200, result.statusCode ? { ok: false, error: result.error } : result);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/dashboard/today") {
      json(res, 200, wholesaleRuntime.getDashboardToday());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/wholesale/orders") {
      json(res, 200, wholesaleRuntime.getOrders());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/wholesale/receivables") {
      json(res, 200, wholesaleRuntime.getReceivables());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/wholesale/price-history") {
      json(res, 200, wholesaleRuntime.getPriceHistory());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/wholesale/claims") {
      json(res, 200, wholesaleRuntime.getClaims());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/wholesale/pipeline") {
      json(res, 200, wholesaleRuntime.getPipelineBoard());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/wholesale/quote-builder") {
      json(res, 200, wholesaleRuntime.getQuoteBuilderData());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/automation/cron-jobs") {
      json(res, 200, {
        ok: true,
        jobs: wholesaleRuntime.listCronJobs(),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/automation/run-all") {
      wholesaleRuntime.runAllCronJobsOnce();
      json(res, 200, { ok: true, message: "紐⑤뱺 ?먮룞???붿쭊????踰??ㅽ뻾?덉뒿?덈떎." });
      return;
    }

    if (pathname.startsWith("/v1/gate/")) {
      if (req.method === "POST" && pathname === "/v1/gate/command") {
        if (!requireAdmin(req, res)) {
          return;
        }
        const body = await readJsonBody(req);
        const result = createGateCommand(body, req.headers);
        json(res, result.blocked ? 403 : 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/gate/poll") {
        if (!requireBrowserBridgeExtension(req, res)) {
          return;
        }
        const sessionId = url.searchParams.get("sessionId") || url.searchParams.get("session_id") || "default";
        json(res, 200, pollGateCommand(sessionId));
        return;
      }

      if (req.method === "POST" && pathname === "/v1/gate/result") {
        if (!requireBrowserBridgeExtension(req, res)) {
          return;
        }
        const body = await readJsonBody(req);
        const result = completeGateCommand(body);
        if (!result) {
          notFound(res);
          return;
        }
        if (result.error) {
          badRequest(res, result.error);
          return;
        }
        json(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/v1/gate/event") {
        if (!requireBrowserBridgeExtension(req, res)) {
          return;
        }
        const body = await readJsonBody(req);
        json(res, 200, recordGateEvent(body, req.headers));
        return;
      }

      if (req.method === "GET" && pathname === "/v1/gate/approvals") {
        if (!requireAdmin(req, res)) {
          return;
        }
        json(res, 200, { approvals: listGateApprovals() });
        return;
      }

      const gateApproveMatch = pathname.match(/^\/v1\/gate\/approvals\/([^/]+)\/approve$/);
      if (req.method === "POST" && gateApproveMatch) {
        if (!requireAdmin(req, res)) {
          return;
        }
        const body = await readJsonBody(req);
        const result = reviewGateApproval(decodeURIComponent(gateApproveMatch[1]), true, body);
        if (!result) {
          notFound(res);
          return;
        }
        json(res, result.ok === false ? 409 : 200, result);
        return;
      }

      const gateRejectMatch = pathname.match(/^\/v1\/gate\/approvals\/([^/]+)\/reject$/);
      if (req.method === "POST" && gateRejectMatch) {
        if (!requireAdmin(req, res)) {
          return;
        }
        const body = await readJsonBody(req);
        const result = reviewGateApproval(decodeURIComponent(gateRejectMatch[1]), false, body);
        if (!result) {
          notFound(res);
          return;
        }
        json(res, result.ok === false ? 409 : 200, result);
        return;
      }
    }

    if (pathname.startsWith("/v1/browser-bridge/admin/")) {
      if (!requireAdmin(req, res)) {
        return;
      }

      if (req.method === "GET" && pathname === "/v1/browser-bridge/admin/overview") {
        json(res, 200, buildBrowserBridgeOverview());
        return;
      }

      if (req.method === "GET" && pathname === "/v1/browser-bridge/admin/commands") {
        const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "20", 10), 100));
        json(res, 200, { commands: listBrowserBridgeCommands(limit) });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/browser-bridge/admin/commands") {
        const body = await readJsonBody(req);
        const command = createBrowserBridgeCommand(body);
        json(res, 201, { ok: command.status !== "blocked", command });
        return;
      }

      const browserApproveMatch = pathname.match(/^\/v1\/browser-bridge\/admin\/commands\/([^/]+)\/approve$/);
      if (req.method === "POST" && browserApproveMatch) {
        const command = approveBrowserBridgeCommand(decodeURIComponent(browserApproveMatch[1]));
        if (!command) {
          notFound(res);
          return;
        }
        json(res, 200, { ok: true, command });
        return;
      }
    }

    if (pathname.startsWith("/v1/browser-bridge/extension/")) {
      if (!requireBrowserBridgeExtension(req, res)) {
        return;
      }

      if (req.method === "POST" && pathname === "/v1/browser-bridge/extension/heartbeat") {
        const body = await readJsonBody(req);
        const session = upsertBrowserBridgeSession(body);
        json(res, 200, {
          ok: true,
          session,
          policy_version: state.browser_bridge.policy_version || 1,
          server_time_ms_utc: Date.now(),
        });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/browser-bridge/extension/commands") {
        const sessionId = String(url.searchParams.get("session_id") || "").trim();
        if (!sessionId) {
          badRequest(res, "session_id_required");
          return;
        }
        const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "5", 10), 20));
        json(res, 200, {
          server_time_ms_utc: Date.now(),
          commands: claimBrowserBridgeCommands(sessionId, limit),
        });
        return;
      }

      const browserResultMatch = pathname.match(/^\/v1\/browser-bridge\/extension\/commands\/([^/]+)\/result$/);
      if (req.method === "POST" && browserResultMatch) {
        const body = await readJsonBody(req);
        const sessionId = String(body.session_id || body.sessionId || "").trim();
        if (!sessionId) {
          badRequest(res, "session_id_required");
          return;
        }

        const command = completeBrowserBridgeCommand(sessionId, decodeURIComponent(browserResultMatch[1]), body);
        if (!command) {
          notFound(res);
          return;
        }
        json(res, 200, { ok: true, command });
        return;
      }
    }

    if (pathname.startsWith("/v1/mobile/admin/")) {
      if (!requireAdmin(req, res)) {
        return;
      }

      if (req.method === "GET" && pathname === "/v1/mobile/admin/fleet-summary") {
        json(res, 200, buildFleetSummary());
        return;
      }

      if (req.method === "GET" && pathname === "/v1/mobile/admin/devices") {
        const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "8", 10), 50));
        const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10));
        json(res, 200, { devices: buildDevices(limit, offset) });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/mobile/admin/commands") {
        const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "20", 10), 100));
        const deviceId = url.searchParams.get("device_id") || "";
        json(res, 200, { commands: listAdminCommands(limit, deviceId) });
        return;
      }

      const deviceControlMatch = pathname.match(/^\/v1\/mobile\/admin\/devices\/([^/]+)\/control$/);
      if (req.method === "POST" && deviceControlMatch) {
        const body = await readJsonBody(req);
        const enabled =
          typeof body.enabled === "boolean"
            ? body.enabled
            : String(body.action || "").toLowerCase() !== "disable";
        const device = setMobileDeviceEnabled(decodeURIComponent(deviceControlMatch[1]), enabled);

        if (!device) {
          notFound(res);
          return;
        }

        json(res, 200, {
          ok: true,
          device,
          policy_version: state.mobile.policy_version,
        });
        return;
      }

      const deviceCommandMatch = pathname.match(/^\/v1\/mobile\/admin\/devices\/([^/]+)\/commands$/);
      if (req.method === "POST" && deviceCommandMatch) {
        const body = await readJsonBody(req);
        const command = createMobileCommand(decodeURIComponent(deviceCommandMatch[1]), body);
        if (!command) {
          notFound(res);
          return;
        }
        if (command.error) {
          badRequest(res, command.error);
          return;
        }

        json(res, 201, { ok: true, command });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/mobile/admin/pairing-codes") {
        const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "8", 10), 20));
        json(res, 200, { pairing_codes: listPairingCodes(limit) });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/mobile/admin/pairing-codes") {
        const body = await readJsonBody(req);
        json(res, 201, createPairingCode(body));
        return;
      }
    }

    if (req.method === "POST" && pathname === "/v1/mobile/devices/pair") {
      await handleMobilePair(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/mobile/auth/refresh") {
      await handleMobileRefresh(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/mobile/auth/verify") {
      await handleMobileAuthVerify(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/mobile/notifications:batch") {
      await handleMobileBatch(req, res);
      return;
    }

    const policyMatch = pathname.match(/^\/v1\/mobile\/devices\/([^/]+)\/policy$/);
    if (req.method === "GET" && policyMatch) {
      handleMobilePolicy(req, res, policyMatch[1], url);
      return;
    }

    const heartbeatMatch = pathname.match(/^\/v1\/mobile\/devices\/([^/]+)\/heartbeat$/);
    if (req.method === "POST" && heartbeatMatch) {
      await handleMobileHeartbeat(req, res, heartbeatMatch[1]);
      return;
    }

    const commandsMatch = pathname.match(/^\/v1\/mobile\/devices\/([^/]+)\/commands$/);
    if (req.method === "GET" && commandsMatch) {
      const session = requireDeviceAuth(req, res);
      if (!session) return;
      const deviceId = decodeURIComponent(commandsMatch[1]);
      if (session.device_id !== deviceId) {
        unauthorized(res);
        return;
      }

      const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "5", 10), 20));
      json(res, 200, {
        server_time_ms_utc: Date.now(),
        commands: claimDeviceCommands(deviceId, limit),
      });
      return;
    }

    const commandResultMatch = pathname.match(/^\/v1\/mobile\/devices\/([^/]+)\/commands\/([^/]+)\/result$/);
    if (req.method === "POST" && commandResultMatch) {
      const session = requireDeviceAuth(req, res);
      if (!session) return;
      const deviceId = decodeURIComponent(commandResultMatch[1]);
      if (session.device_id !== deviceId) {
        unauthorized(res);
        return;
      }

      const body = await readJsonBody(req);
      const command = completeDeviceCommand(deviceId, decodeURIComponent(commandResultMatch[2]), body);
      if (!command) {
        notFound(res);
        return;
      }

      json(res, 200, { ok: true, command });
      return;
    }

    notFound(res);
  } catch (error) {
    json(res, 500, {
      error: error instanceof Error ? error.message : "internal_error",
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`FlowFit local engine listening on http://${HOST}:${PORT}\n`);
});


