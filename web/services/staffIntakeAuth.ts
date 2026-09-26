import { timingSafeEqual } from "crypto";

export interface StaffIntakeAccount {
  companyId: string;
  companySlug: string;
  staffId: string;
  staffName: string;
  password: string;
}

const defaultStaffAccounts: StaffIntakeAccount[] = [
  {
    companyId: "flowfit-demo",
    companySlug: "a-company",
    staffId: "kim",
    staffName: "김직원",
    password: "1111",
  },
  {
    companyId: "flowfit-demo",
    companySlug: "a-company",
    staffId: "park",
    staffName: "박직원",
    password: "1111",
  },
  {
    companyId: "flowfit-demo",
    companySlug: "a-company",
    staffId: "lee",
    staffName: "이직원",
    password: "1111",
  },
];

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseStaffAccountsFromEnv() {
  const raw = process.env.FLOWFIT_STAFF_ACCOUNTS_JSON;
  if (!raw) return defaultStaffAccounts;

  try {
    const parsed = JSON.parse(raw) as StaffIntakeAccount[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaultStaffAccounts;
  } catch {
    return defaultStaffAccounts;
  }
}

export function getStaffIntakeAccounts() {
  return parseStaffAccountsFromEnv();
}

export function normalizeCompanySlug(companySlug?: string) {
  return companySlug?.trim() || "a-company";
}

export function companyIdFromSlug(companySlug: string) {
  return companySlug === "a-company" ? "flowfit-demo" : companySlug;
}

export function validateStaffIntakeLogin(input: {
  companySlug?: string;
  staffId?: string;
  password?: string;
}) {
  const companySlug = normalizeCompanySlug(input.companySlug);
  const staffId = input.staffId?.trim() ?? "";
  const password = input.password ?? "";

  const account = getStaffIntakeAccounts().find(
    (item) => item.companySlug === companySlug && safeEqual(item.staffId, staffId),
  );

  if (!account || !safeEqual(account.password, password)) {
    return { ok: false as const, companySlug, companyId: companyIdFromSlug(companySlug) };
  }

  return {
    ok: true as const,
    companySlug,
    companyId: account.companyId,
    staffId: account.staffId,
    staffName: account.staffName,
  };
}

export function findStaffIntakeAccount(companySlug: string, staffId: string) {
  return getStaffIntakeAccounts().find((item) => item.companySlug === companySlug && item.staffId === staffId);
}
