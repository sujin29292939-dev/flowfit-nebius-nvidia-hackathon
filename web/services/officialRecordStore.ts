import type { OfficialCompanyRecord } from "@/types/flowfit";

const OFFICIAL_RECORD_STORAGE_KEY = "flowfit-official-company-records";

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

export const initialOfficialCompanyRecords: OfficialCompanyRecord[] = [];

export function getOfficialCompanyRecords() {
  return readJson(OFFICIAL_RECORD_STORAGE_KEY, initialOfficialCompanyRecords);
}

export function saveOfficialCompanyRecords(records: OfficialCompanyRecord[]) {
  writeJson(OFFICIAL_RECORD_STORAGE_KEY, records);
}

export function getOfficialRecordsForAiContext() {
  return getOfficialCompanyRecords().filter((record) => record.usableForAiPlanning);
}
