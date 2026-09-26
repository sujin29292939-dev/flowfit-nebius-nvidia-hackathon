// intake/emailPoller.ts
// IMAP 메일함을 주기적으로 읽어 intakes에 저장한다.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ParsedMail } from "mailparser";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createIntake } from "./store.js";
import { getDefaultCompanyId } from "./config.js";
import type { IntakeAttachmentRef } from "./types.js";
import { scheduleUnderstanding } from "../understanding/runner.js";

interface EmailPollerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  sourceName: string;
  companyId: string;
  intervalMs: number;
  maxPerPoll: number;
  attachmentDir: string;
}

export function startEmailPoller() {
  const config = loadEmailConfig();
  if (!config) {
    console.log("[Intake:email] disabled. EMAIL_HOST/EMAIL_USER/EMAIL_PASS not set.");
    return;
  }
  const activeConfig = config;

  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const count = await pollEmail(activeConfig);
      if (count > 0) console.log(`[Intake:email] stored ${count} new email intake(s)`);
    } catch (error) {
      console.error(`[Intake:email] poll failed: ${String(error)}`);
    } finally {
      running = false;
    }
  }

  void tick();
  setInterval(tick, activeConfig.intervalMs);
  console.log(`[Intake:email] polling ${activeConfig.host}:${activeConfig.port} every ${activeConfig.intervalMs}ms`);
}

async function pollEmail(config: EmailPollerConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  let stored = 0;
  await client.connect();

  const lock = await client.getMailboxLock("INBOX");
  try {
    const unseen = await client.search({ seen: false });
    if (!unseen) return 0;
    const targets = unseen.slice(0, config.maxPerPoll);

    for (const uid of targets) {
      for await (const message of client.fetch(String(uid), { uid: true, envelope: true, source: true }, { uid: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source as Buffer) as ParsedMail;
        const messageId = parsed.messageId ?? `${config.sourceName}:${message.uid}`;
        const attachmentRefs = await saveAttachments(config.attachmentDir, messageId, parsed.attachments);
        const htmlText = typeof parsed.html === "string"
          ? parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        const text = parsed.text?.trim() || htmlText;

        const result = await createIntake({
          companyId: config.companyId,
          sourceType: "email",
          sourceName: config.sourceName,
          rawText: [
            `제목: ${parsed.subject ?? "(no subject)"}`,
            parsed.from?.text ? `보낸 사람: ${parsed.from.text}` : "",
            "",
            text,
          ].filter(Boolean).join("\n"),
          attachmentRefs,
          receivedAt: parsed.date ?? new Date(),
          dedupeKey: hashStable(`email|${config.companyId}|${messageId}`),
          metadata: {
            externalId: messageId,
            uid: message.uid,
            subject: parsed.subject,
            from: parsed.from?.text,
            to: addressText(parsed.to),
            cc: addressText(parsed.cc),
            attachmentCount: parsed.attachments.length,
          },
        });

        if (!result.duplicate) {
          stored++;
          scheduleUnderstanding(result.id);
        }
      }

      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }

  return stored;
}

async function saveAttachments(
  attachmentDir: string,
  messageId: string,
  attachments: Array<{ filename?: string; contentType?: string; size?: number; content: Buffer }>,
): Promise<IntakeAttachmentRef[]> {
  if (attachments.length === 0) return [];
  await fs.mkdir(attachmentDir, { recursive: true });

  const safeMessageId = sanitizeFilename(messageId).slice(0, 80);
  const refs: IntakeAttachmentRef[] = [];

  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];
    const name = attachment.filename ?? `attachment_${index + 1}`;
    const filename = `${safeMessageId}_${index + 1}_${sanitizeFilename(name)}`;
    const filePath = path.join(attachmentDir, filename);
    await fs.writeFile(filePath, attachment.content);
    refs.push({
      name,
      path: filePath,
      contentType: attachment.contentType,
      sizeBytes: attachment.size ?? attachment.content.length,
    });
  }

  return refs;
}

function loadEmailConfig(): EmailPollerConfig | null {
  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!host || !user || !pass) return null;

  return {
    host,
    port: Number(process.env.EMAIL_PORT ?? 993),
    secure: process.env.EMAIL_SECURE !== "false",
    user,
    pass,
    sourceName: process.env.EMAIL_SOURCE_NAME ?? "imap_inbox",
    companyId: process.env.EMAIL_COMPANY_ID ?? getDefaultCompanyId(),
    intervalMs: Number(process.env.EMAIL_POLL_INTERVAL_MS ?? 60_000),
    maxPerPoll: Number(process.env.EMAIL_MAX_PER_POLL ?? 10),
    attachmentDir: process.env.FLOWFIT_ATTACHMENT_DIR ?? path.join(os.tmpdir(), "flowfit-attachments"),
  };
}

function sanitizeFilename(input: string) {
  return input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_");
}

function hashStable(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function addressText(value: ParsedMail["to"] | ParsedMail["cc"]) {
  if (!value) return undefined;
  return Array.isArray(value) ? value.map((item) => item.text).join(", ") : value.text;
}
