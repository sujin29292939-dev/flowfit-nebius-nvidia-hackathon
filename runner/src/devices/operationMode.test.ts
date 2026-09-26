import { deriveDeviceOperationMode } from "./store.js";

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

const now = Date.parse("2026-07-05T00:00:00.000Z");
const offlineAfterMs = 45_000;
const recoveringAfterMs = 180_000;

check(
  "Device operation mode: missing last_seen_at is OFFLINE",
  deriveDeviceOperationMode(undefined, now, offlineAfterMs, recoveringAfterMs) === "OFFLINE",
);

check(
  "Device operation mode: recent last_seen_at is ONLINE",
  deriveDeviceOperationMode(new Date(now - 10_000).toISOString(), now, offlineAfterMs, recoveringAfterMs) === "ONLINE",
);

check(
  "Device operation mode: stale but recoverable last_seen_at is RECOVERING",
  deriveDeviceOperationMode(new Date(now - 90_000).toISOString(), now, offlineAfterMs, recoveringAfterMs) === "RECOVERING",
);

check(
  "Device operation mode: old last_seen_at is OFFLINE",
  deriveDeviceOperationMode(new Date(now - 240_000).toISOString(), now, offlineAfterMs, recoveringAfterMs) === "OFFLINE",
);

check(
  "Device operation mode: invalid last_seen_at is OFFLINE",
  deriveDeviceOperationMode("not-a-date", now, offlineAfterMs, recoveringAfterMs) === "OFFLINE",
);
