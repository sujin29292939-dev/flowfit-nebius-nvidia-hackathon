// intake/sitePoller.ts
// 거래처 포털/쇼핑몰/택배 조회 화면 같은 웹 화면을 주기적으로 읽어 intakes에 저장한다.

import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { createIntake } from "./store.js";
import { getDefaultCompanyId } from "./config.js";
import { scheduleUnderstanding } from "../understanding/runner.js";

interface SitePollTarget {
  companyId?: string;
  sourceName?: string;
  url: string;
  selector?: string;
  intervalMs?: number;
}

export function startSitePollers() {
  const targets = loadTargets();
  if (targets.length === 0) {
    console.log("[Intake:site] disabled. SITE_POLL_TARGETS_JSON not set.");
    return;
  }

  for (const target of targets) {
    startSinglePoller(target);
  }
}

function startSinglePoller(target: SitePollTarget) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await pollSite(target);
      if (result && !result.duplicate) {
        scheduleUnderstanding(result.id);
        console.log(`[Intake:site] stored site intake ${result.id} from ${target.url}`);
      }
    } catch (error) {
      console.error(`[Intake:site] poll failed (${target.url}): ${String(error)}`);
    } finally {
      running = false;
    }
  }

  void tick();
  setInterval(tick, target.intervalMs ?? 120_000);
  console.log(`[Intake:site] polling ${target.url} every ${target.intervalMs ?? 120_000}ms`);
}

async function pollSite(target: SitePollTarget) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const title = await page.title().catch(() => "");
    const text = target.selector
      ? await page.$eval(target.selector, (el) => (el.textContent ?? "").trim())
      : await page.evaluate(() => document.body.innerText.trim());

    if (!text) return null;

    const companyId = target.companyId ?? getDefaultCompanyId();
    const contentHash = createHash("sha256").update(`${target.url}|${target.selector ?? ""}|${text}`).digest("hex");

    return await createIntake({
      companyId,
      sourceType: "site",
      sourceName: target.sourceName ?? new URL(target.url).host,
      rawText: [`화면: ${title}`, `URL: ${target.url}`, "", text].join("\n"),
      receivedAt: new Date(),
      dedupeKey: contentHash,
      metadata: {
        externalId: contentHash,
        url: target.url,
        selector: target.selector,
        title,
        contentLength: text.length,
      },
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

function loadTargets(): SitePollTarget[] {
  const raw = process.env.SITE_POLL_TARGETS_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SitePollTarget[];
    return Array.isArray(parsed)
      ? parsed.filter((target) => typeof target.url === "string" && target.url.startsWith("http"))
      : [];
  } catch (error) {
    console.error(`[Intake:site] invalid SITE_POLL_TARGETS_JSON: ${String(error)}`);
    return [];
  }
}
