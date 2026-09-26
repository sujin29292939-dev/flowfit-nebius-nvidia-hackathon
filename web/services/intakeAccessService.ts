import { makeFlowFitId } from "@/services/fieldIntakeStore";
import type { FieldIntakeAccess } from "@/types/flowfit";

const INTAKE_ACCESS_STORAGE_KEY = "flowfit-field-intake-access";

function nowIso() {
  return new Date().toISOString();
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function tokenHash(token: string) {
  return `mock-hash:${token}`;
}

export const initialFieldIntakeAccess: FieldIntakeAccess[] = [
  {
    id: "intake-access-demo-kim",
    companyId: "flowfit-demo",
    staffId: "staff-kim",
    staffName: "김직원",
    tokenHash: tokenHash("abc123"),
    accessType: "public_token",
    canUploadPhoto: true,
    canUploadVoice: true,
    canUploadFile: true,
    canWriteMemo: true,
    canViewOwnSubmittedOnly: true,
    canViewCompanyData: false,
    expiresAt: "2026-12-31T23:59:59+09:00",
    createdAt: "2026-04-29T08:00:00+09:00",
    updatedAt: "2026-04-29T08:00:00+09:00",
  },
];

export function getFieldIntakeAccessList() {
  return readJson(INTAKE_ACCESS_STORAGE_KEY, initialFieldIntakeAccess);
}

export function saveFieldIntakeAccessList(accessList: FieldIntakeAccess[]) {
  writeJson(INTAKE_ACCESS_STORAGE_KEY, accessList);
}

export function createFieldIntakeToken(staffName: string, companyId = "flowfit-demo") {
  const now = nowIso();
  const token = Math.random().toString(36).slice(2, 8);
  const access: FieldIntakeAccess = {
    id: makeFlowFitId("intake-access"),
    companyId,
    staffName,
    tokenHash: tokenHash(token),
    accessType: "public_token",
    canUploadPhoto: true,
    canUploadVoice: true,
    canUploadFile: true,
    canWriteMemo: true,
    canViewOwnSubmittedOnly: true,
    canViewCompanyData: false,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
  saveFieldIntakeAccessList([access, ...getFieldIntakeAccessList()]);
  return { token, access };
}

export function validateIntakeAccess(companySlug: string, token?: string) {
  const companyId = companySlug === "a-company" ? "flowfit-demo" : companySlug;

  if (!token) {
    return {
      ok: true,
      companyId,
      staffName: undefined,
      access: undefined,
    };
  }

  const access = getFieldIntakeAccessList().find(
    (item) => item.companyId === companyId && item.tokenHash === tokenHash(token),
  );
  const expired = access?.expiresAt ? new Date(access.expiresAt).getTime() < Date.now() : false;

  return {
    ok: Boolean(access && !access.revokedAt && !expired),
    companyId,
    staffName: access?.staffName,
    access,
  };
}

export function revokeFieldIntakeAccess(accessId: string) {
  const now = nowIso();
  const nextAccess = getFieldIntakeAccessList().map((access) =>
    access.id === accessId ? { ...access, revokedAt: now, updatedAt: now } : access,
  );
  saveFieldIntakeAccessList(nextAccess);
  return nextAccess;
}
