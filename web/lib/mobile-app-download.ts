import "server-only";
import { homedir, networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { MobileAppDownloadInfo } from "@/lib/types";

const DEFAULT_WORKBENCH_BASE_URL = "http://127.0.0.1:3007";
const DEFAULT_APP_NAME = "FlowFit 모바일 감지기";
const DEFAULT_PACKAGE_NAME = "com.flowfit.collector";
const DEFAULT_VERSION_NAME = "0.1.10";
const DOWNLOAD_PATH = "/api/mobile-app/download";
const SAFE_DOWNLOAD_FILE_PREFIX = "FlowFit-Mobile-Collector";

const workbenchBaseUrl = normalizeBaseUrl(
  process.env.FLOWFIT_WORKBENCH_BASE_URL ?? DEFAULT_WORKBENCH_BASE_URL
);

const publicWorkbenchBaseUrl = resolvePublicWorkbenchBaseUrl(workbenchBaseUrl);

function uniquePaths(values: string[]) {
  return [...new Set(values.map((value) => path.normalize(value)))];
}

function resolveMobileCollectorRoot() {
  const homeDir = homedir();
  const explicitRoot = process.env.FLOWFIT_MOBILE_APP_ROOT;
  const candidates = uniquePaths(
    [
      explicitRoot,
      path.resolve(process.cwd(), "flowfit-mobile-notification-collector"),
      path.resolve(process.cwd(), "..", "flowfit-mobile-notification-collector"),
      path.resolve(process.cwd(), "..", "OneDrive", "문서", "New project", "flowfit-mobile-notification-collector"),
      path.resolve(process.cwd(), "..", "OneDrive", "Documents", "New project", "flowfit-mobile-notification-collector"),
      path.resolve(homeDir, "flowfit-mobile-notification-collector"),
      path.resolve(homeDir, "OneDrive", "문서", "New project", "flowfit-mobile-notification-collector"),
      path.resolve(homeDir, "OneDrive", "Documents", "New project", "flowfit-mobile-notification-collector"),
    ].filter((value): value is string => Boolean(value))
  );

  for (const candidate of candidates) {
    const gradleFile = path.join(candidate, "app", "build.gradle.kts");
    const manifestFile = path.join(candidate, "app", "src", "main", "AndroidManifest.xml");
    if (existsSync(gradleFile) || existsSync(manifestFile)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "..", "flowfit-mobile-notification-collector");
}

const mobileCollectorRoot = resolveMobileCollectorRoot();

const mobileApkPath = path.join(
  mobileCollectorRoot,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk"
);

const mobileGradlePath = path.join(mobileCollectorRoot, "app", "build.gradle.kts");
const mobileStringsPath = path.join(
  mobileCollectorRoot,
  "app",
  "src",
  "main",
  "res",
  "values",
  "strings.xml"
);

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function getIpv4Priority(ipAddress: string) {
  if (ipAddress.startsWith("192.168.")) {
    return 4;
  }

  if (ipAddress.startsWith("10.")) {
    return 3;
  }

  const octets = ipAddress.split(".");
  const secondOctet = Number(octets[1] ?? "0");

  if (octets[0] === "172" && secondOctet >= 16 && secondOctet <= 31) {
    return 2;
  }

  return 1;
}

function getLanIpv4Candidates() {
  const interfaces = networkInterfaces();
  const candidates: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      if (address.address.startsWith("169.254.")) {
        continue;
      }

      candidates.push(address.address);
    }
  }

  return candidates.sort((left, right) => getIpv4Priority(right) - getIpv4Priority(left));
}

function resolvePublicWorkbenchBaseUrl(baseUrl: string) {
  const explicitPublicUrl =
    process.env.FLOWFIT_WORKBENCH_PUBLIC_URL ?? process.env.FLOWFIT_PUBLIC_APP_URL;

  if (explicitPublicUrl) {
    return normalizeBaseUrl(explicitPublicUrl);
  }

  try {
    const url = new URL(baseUrl);

    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return normalizeBaseUrl(url.toString());
    }

    const [preferredLanIp] = getLanIpv4Candidates();
    if (!preferredLanIp) {
      return normalizeBaseUrl(url.toString());
    }

    url.hostname = preferredLanIp;
    return normalizeBaseUrl(url.toString());
  } catch {
    return normalizeBaseUrl(baseUrl);
  }
}

async function readTextIfExists(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readVersionName() {
  const gradleText = await readTextIfExists(mobileGradlePath);
  const versionMatch = gradleText?.match(/versionName\s*=\s*"([^"]+)"/);
  return versionMatch?.[1] ?? DEFAULT_VERSION_NAME;
}

async function readPackageName() {
  const gradleText = await readTextIfExists(mobileGradlePath);
  const packageMatch = gradleText?.match(/applicationId\s*=\s*"([^"]+)"/);
  return packageMatch?.[1] ?? DEFAULT_PACKAGE_NAME;
}

async function readAppName() {
  const stringsText = await readTextIfExists(mobileStringsPath);
  const appNameMatch = stringsText?.match(/<string name="app_name">([^<]+)<\/string>/);
  return appNameMatch?.[1] ?? DEFAULT_APP_NAME;
}

function buildSafeApkFileName(versionName: string) {
  const safeVersion = versionName.replace(/[^0-9A-Za-z._-]/g, "-") || DEFAULT_VERSION_NAME;
  return `${SAFE_DOWNLOAD_FILE_PREFIX}-${safeVersion}.apk`;
}

export async function getMobileAppDownloadInfo(): Promise<MobileAppDownloadInfo> {
  try {
    const [apkStat, versionName, packageName, appName] = await Promise.all([
      stat(mobileApkPath),
      readVersionName(),
      readPackageName(),
      readAppName(),
    ]);

    return {
      available: true,
      appName,
      packageName,
      versionName,
      fileName: buildSafeApkFileName(versionName),
      sizeBytes: apkStat.size,
      updatedAt: apkStat.mtime.toISOString(),
      downloadPath: DOWNLOAD_PATH,
      publicDownloadUrl: `${publicWorkbenchBaseUrl}${DOWNLOAD_PATH}`,
    };
  } catch {
    return {
      available: false,
      appName: DEFAULT_APP_NAME,
      packageName: DEFAULT_PACKAGE_NAME,
      versionName: DEFAULT_VERSION_NAME,
      fileName: buildSafeApkFileName(DEFAULT_VERSION_NAME),
      sizeBytes: 0,
      updatedAt: null,
      downloadPath: DOWNLOAD_PATH,
      publicDownloadUrl: `${publicWorkbenchBaseUrl}${DOWNLOAD_PATH}`,
    };
  }
}

export async function readMobileAppBinary() {
  const [downloadInfo, binary] = await Promise.all([
    getMobileAppDownloadInfo(),
    readFile(mobileApkPath),
  ]);

  return {
    downloadInfo,
    binary,
  };
}
