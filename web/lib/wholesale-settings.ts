import "server-only";

import { promises as fs } from "fs";
import path from "path";

import type {
  WholesaleAccountHealthSettings,
  WholesaleAlertChannel,
  WholesaleClaimsAssignMode,
  WholesaleClaimsSettings,
  WholesaleDeliverySettings,
  WholesaleDunningSettings,
  WholesalePricingSettings,
  WholesaleSettings,
  WholesaleSettingsModuleRoute,
} from "@/lib/types";

type WholesaleSettingsStorageKey = keyof Pick<
  WholesaleSettings,
  "dunning" | "delivery" | "accountHealth" | "pricing" | "claims"
>;

const STORE_DIR = path.join(process.cwd(), ".flowfit");
const STORE_FILE = path.join(STORE_DIR, "wholesale-settings.json");
const WHOLESALE_SETTINGS_SCHEMA_VERSION = "flowfit.wholesale-settings.v1";

const alertChannelOptions = ["dashboard", "kakao", "email", "slack"] as const satisfies WholesaleAlertChannel[];
const pricingFileTypes = ["xlsx", "csv", "pdf"] as const;
const claimsAssignModes = ["partner-owner", "round-robin", "manual"] as const satisfies WholesaleClaimsAssignMode[];

export const wholesaleSettingsRouteMeta = {
  dunning: {
    storageKey: "dunning",
    title: "미수금 설정",
    shortTitle: "미수금",
    description: "금액, 연체 일수, 독촉 주기와 초안 알림 기준을 정합니다.",
  },
  delivery: {
    storageKey: "delivery",
    title: "납기 설정",
    shortTitle: "납기",
    description: "D-3, D-1, 지연 위험을 언제 올리고 누구에게 알릴지 정합니다.",
  },
  "account-health": {
    storageKey: "accountHealth",
    title: "거래처 건강 설정",
    shortTitle: "거래처 건강",
    description: "RFM 가중치와 이상 징후 기준을 정해 거래처 변화를 먼저 잡습니다.",
  },
  pricing: {
    storageKey: "pricing",
    title: "단가표 설정",
    shortTitle: "단가표",
    description: "단가 변동 경고율, 영향 거래처 기준, 안내 초안 생성 방식을 정합니다.",
  },
  claims: {
    storageKey: "claims",
    title: "반품·클레임 설정",
    shortTitle: "클레임",
    description: "자동 분류, 우선순위 키워드, 담당자 배정 방식을 정합니다.",
  },
} as const satisfies Record<
  WholesaleSettingsModuleRoute,
  {
    storageKey: WholesaleSettingsStorageKey;
    title: string;
    shortTitle: string;
    description: string;
  }
>;

const defaultWholesaleSettings: WholesaleSettings = {
  schemaVersion: WHOLESALE_SETTINGS_SCHEMA_VERSION,
  updatedAt: "2026-04-26T09:00:00+09:00",
  dunning: {
    p1AmountThreshold: 5_000_000,
    p1OverdueDays: 30,
    reminderDaysBeforeDue: 3,
    followUpCadenceDays: 7,
    dormantAfterDays: 45,
    alertChannels: ["dashboard", "kakao", "email"],
    autoCreateDraftNotice: true,
    pauseOnWeekends: true,
  },
  delivery: {
    enableD3Alerts: true,
    enableD1Alerts: true,
    enableDelayAlerts: true,
    delayThresholdDays: 1,
    perPartnerRulesEnabled: true,
    managerEscalationHours: 6,
    alertChannels: ["dashboard", "kakao"],
    autoCreateDelayNotice: true,
  },
  accountHealth: {
    recencyWeight: 40,
    frequencyWeight: 35,
    monetaryWeight: 25,
    warningScoreCutoff: 70,
    criticalScoreCutoff: 50,
    orderDropThresholdPercent: 30,
    noOrderDaysThreshold: 30,
    alertChannels: ["dashboard", "email"],
  },
  pricing: {
    warningChangeRatePercent: 3,
    criticalChangeRatePercent: 10,
    impactedPartnerThreshold: 5,
    enablePartnerSpecificRules: true,
    autoCreatePriceNotice: true,
    defaultNoticeLeadDays: 2,
    alertChannels: ["dashboard", "email"],
    allowedFileTypes: ["xlsx", "csv", "pdf"],
  },
  claims: {
    autoClassifyEnabled: true,
    enabledCategories: ["품질", "수량", "납기", "단가", "기타"],
    highPriorityKeywords: "파손, 오배송, 전량 반품, 입고 불가",
    mediumPriorityKeywords: "누락, 부분 반품, 지연, 교환 요청",
    autoAssignMode: "partner-owner",
    defaultAssignee: "영업 담당",
    accumulatedCountThreshold: 3,
    alertChannels: ["dashboard", "kakao"],
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number, options?: { min?: number; max?: number }) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (options?.min !== undefined && numeric < options.min) return options.min;
  if (options?.max !== undefined && numeric > options.max) return options.max;
  return numeric;
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function normalizeStringArray(
  value: unknown,
  fallback: string[],
  allowed?: readonly string[],
) {
  if (!Array.isArray(value)) return [...fallback];
  const next = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .filter((item, index, source) => source.indexOf(item) === index);

  if (allowed) {
    return next.filter((item) => allowed.includes(item));
  }

  return next;
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeDunningSettings(
  value: unknown,
  base: WholesaleDunningSettings,
): WholesaleDunningSettings {
  const source = isObject(value) ? value : {};
  return {
    p1AmountThreshold: Math.round(toNumber(source.p1AmountThreshold, base.p1AmountThreshold, { min: 0 })),
    p1OverdueDays: Math.round(toNumber(source.p1OverdueDays, base.p1OverdueDays, { min: 0 })),
    reminderDaysBeforeDue: Math.round(
      toNumber(source.reminderDaysBeforeDue, base.reminderDaysBeforeDue, { min: 0 }),
    ),
    followUpCadenceDays: Math.round(
      toNumber(source.followUpCadenceDays, base.followUpCadenceDays, { min: 1 }),
    ),
    dormantAfterDays: Math.round(toNumber(source.dormantAfterDays, base.dormantAfterDays, { min: 1 })),
    alertChannels: normalizeStringArray(
      source.alertChannels,
      base.alertChannels,
      alertChannelOptions,
    ) as WholesaleAlertChannel[],
    autoCreateDraftNotice: toBoolean(source.autoCreateDraftNotice, base.autoCreateDraftNotice),
    pauseOnWeekends: toBoolean(source.pauseOnWeekends, base.pauseOnWeekends),
  };
}

function normalizeDeliverySettings(
  value: unknown,
  base: WholesaleDeliverySettings,
): WholesaleDeliverySettings {
  const source = isObject(value) ? value : {};
  return {
    enableD3Alerts: toBoolean(source.enableD3Alerts, base.enableD3Alerts),
    enableD1Alerts: toBoolean(source.enableD1Alerts, base.enableD1Alerts),
    enableDelayAlerts: toBoolean(source.enableDelayAlerts, base.enableDelayAlerts),
    delayThresholdDays: Math.round(toNumber(source.delayThresholdDays, base.delayThresholdDays, { min: 0 })),
    perPartnerRulesEnabled: toBoolean(source.perPartnerRulesEnabled, base.perPartnerRulesEnabled),
    managerEscalationHours: Math.round(
      toNumber(source.managerEscalationHours, base.managerEscalationHours, { min: 1 }),
    ),
    alertChannels: normalizeStringArray(
      source.alertChannels,
      base.alertChannels,
      alertChannelOptions,
    ) as WholesaleAlertChannel[],
    autoCreateDelayNotice: toBoolean(source.autoCreateDelayNotice, base.autoCreateDelayNotice),
  };
}

function normalizeAccountHealthSettings(
  value: unknown,
  base: WholesaleAccountHealthSettings,
): WholesaleAccountHealthSettings {
  const source = isObject(value) ? value : {};
  return {
    recencyWeight: Math.round(toNumber(source.recencyWeight, base.recencyWeight, { min: 0, max: 100 })),
    frequencyWeight: Math.round(
      toNumber(source.frequencyWeight, base.frequencyWeight, { min: 0, max: 100 }),
    ),
    monetaryWeight: Math.round(toNumber(source.monetaryWeight, base.monetaryWeight, { min: 0, max: 100 })),
    warningScoreCutoff: Math.round(
      toNumber(source.warningScoreCutoff, base.warningScoreCutoff, { min: 0, max: 100 }),
    ),
    criticalScoreCutoff: Math.round(
      toNumber(source.criticalScoreCutoff, base.criticalScoreCutoff, { min: 0, max: 100 }),
    ),
    orderDropThresholdPercent: Math.round(
      toNumber(source.orderDropThresholdPercent, base.orderDropThresholdPercent, { min: 0, max: 100 }),
    ),
    noOrderDaysThreshold: Math.round(
      toNumber(source.noOrderDaysThreshold, base.noOrderDaysThreshold, { min: 1 }),
    ),
    alertChannels: normalizeStringArray(
      source.alertChannels,
      base.alertChannels,
      alertChannelOptions,
    ) as WholesaleAlertChannel[],
  };
}

function normalizePricingSettings(
  value: unknown,
  base: WholesalePricingSettings,
): WholesalePricingSettings {
  const source = isObject(value) ? value : {};
  return {
    warningChangeRatePercent: Math.round(
      toNumber(source.warningChangeRatePercent, base.warningChangeRatePercent, { min: 0, max: 100 }),
    ),
    criticalChangeRatePercent: Math.round(
      toNumber(source.criticalChangeRatePercent, base.criticalChangeRatePercent, { min: 0, max: 100 }),
    ),
    impactedPartnerThreshold: Math.round(
      toNumber(source.impactedPartnerThreshold, base.impactedPartnerThreshold, { min: 1 }),
    ),
    enablePartnerSpecificRules: toBoolean(source.enablePartnerSpecificRules, base.enablePartnerSpecificRules),
    autoCreatePriceNotice: toBoolean(source.autoCreatePriceNotice, base.autoCreatePriceNotice),
    defaultNoticeLeadDays: Math.round(
      toNumber(source.defaultNoticeLeadDays, base.defaultNoticeLeadDays, { min: 0 }),
    ),
    alertChannels: normalizeStringArray(
      source.alertChannels,
      base.alertChannels,
      alertChannelOptions,
    ) as WholesaleAlertChannel[],
    allowedFileTypes: normalizeStringArray(
      source.allowedFileTypes,
      base.allowedFileTypes,
      pricingFileTypes,
    ),
  };
}

function normalizeClaimsSettings(
  value: unknown,
  base: WholesaleClaimsSettings,
): WholesaleClaimsSettings {
  const source = isObject(value) ? value : {};
  const assignMode = normalizeText(source.autoAssignMode, base.autoAssignMode);
  return {
    autoClassifyEnabled: toBoolean(source.autoClassifyEnabled, base.autoClassifyEnabled),
    enabledCategories: normalizeStringArray(source.enabledCategories, base.enabledCategories),
    highPriorityKeywords: normalizeText(source.highPriorityKeywords, base.highPriorityKeywords),
    mediumPriorityKeywords: normalizeText(source.mediumPriorityKeywords, base.mediumPriorityKeywords),
    autoAssignMode: (claimsAssignModes.includes(assignMode as WholesaleClaimsAssignMode)
      ? assignMode
      : base.autoAssignMode) as WholesaleClaimsAssignMode,
    defaultAssignee: normalizeText(source.defaultAssignee, base.defaultAssignee),
    accumulatedCountThreshold: Math.round(
      toNumber(source.accumulatedCountThreshold, base.accumulatedCountThreshold, { min: 1 }),
    ),
    alertChannels: normalizeStringArray(
      source.alertChannels,
      base.alertChannels,
      alertChannelOptions,
    ) as WholesaleAlertChannel[],
  };
}

function normalizeWholesaleSettings(value: unknown): WholesaleSettings {
  const source = isObject(value) ? value : {};
  const base = defaultWholesaleSettings;

  return {
    schemaVersion: WHOLESALE_SETTINGS_SCHEMA_VERSION,
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt.trim()
        ? source.updatedAt
        : base.updatedAt,
    dunning: normalizeDunningSettings(source.dunning, base.dunning),
    delivery: normalizeDeliverySettings(source.delivery, base.delivery),
    accountHealth: normalizeAccountHealthSettings(source.accountHealth, base.accountHealth),
    pricing: normalizePricingSettings(source.pricing, base.pricing),
    claims: normalizeClaimsSettings(source.claims, base.claims),
  };
}

async function ensureStoreDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function writeWholesaleSettings(settings: WholesaleSettings) {
  await ensureStoreDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(settings, null, 2), "utf8");
}

export async function getWholesaleSettings(): Promise<WholesaleSettings> {
  await ensureStoreDir();

  try {
    const parsed = JSON.parse(await fs.readFile(STORE_FILE, "utf8")) as unknown;
    const normalized = normalizeWholesaleSettings(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeWholesaleSettings(normalized);
    }
    return clone(normalized);
  } catch {
    const seeded = clone(defaultWholesaleSettings);
    await writeWholesaleSettings(seeded);
    return seeded;
  }
}

export async function getWholesaleModuleSettings(route: WholesaleSettingsModuleRoute) {
  const settings = await getWholesaleSettings();
  const meta = wholesaleSettingsRouteMeta[route];
  return clone(settings[meta.storageKey]);
}

export async function updateWholesaleModuleSettings(
  route: WholesaleSettingsModuleRoute,
  value: unknown,
) {
  const current = await getWholesaleSettings();
  const meta = wholesaleSettingsRouteMeta[route];

  const next: WholesaleSettings = {
    ...current,
    updatedAt: new Date().toISOString(),
  };

  switch (meta.storageKey) {
    case "dunning":
      next.dunning = normalizeDunningSettings(value, current.dunning);
      break;
    case "delivery":
      next.delivery = normalizeDeliverySettings(value, current.delivery);
      break;
    case "accountHealth":
      next.accountHealth = normalizeAccountHealthSettings(value, current.accountHealth);
      break;
    case "pricing":
      next.pricing = normalizePricingSettings(value, current.pricing);
      break;
    case "claims":
      next.claims = normalizeClaimsSettings(value, current.claims);
      break;
  }

  await writeWholesaleSettings(next);
  return clone(next[meta.storageKey]);
}
