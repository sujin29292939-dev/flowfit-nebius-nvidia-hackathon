// tools/index.ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import type { DockerSandbox } from "../sandbox/docker.js";
import type { ExecutionBrief } from "../agent/executionBrief.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";
import { claimApprovedGenericAgentResume, createApprovalRequest, findLatestApprovedGenericAgentResume } from "../approvals/store.js";
import { getCompanyDeviceOperationStatus } from "../devices/store.js";
import { ActionGuard } from "./actionGuard.js";
import { applyGenericAgentOfflineDemotion } from "./genericAgentOfflinePolicy.js";
import { buildGenericAgentResumeMetadata } from "./genericAgentResume.js";
import path from "node:path";
import fs from "node:fs/promises";

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "declare_action",
    description: "Declare the business action you are about to perform. Required before any side-effect tool such as bash_exec, write_file, or browser_navigate.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "Business action id, e.g. read_inventory, create_order, send_order_confirm" },
        reason: { type: "string", description: "Short user-facing reason for this action" },
        payload: { description: "Exact planned payload for the next side-effect action when known" },
        contextDependency: {
          type: "string",
          enum: ["none", "run-context", "unknown"],
          description: "Whether this action can resume standalone after approval. Unknown is fail-closed.",
        },
      },
      required: ["action", "reason"],
    },
  },
  {
    name: "bash_exec",
    description: "Execute a shell command in the sandbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        command:    { type: "string", description: "Bash command to run" },
        timeout_ms: { type: "number", description: "Timeout ms (default 30000)" },
        actionToken: { type: "string", description: "Token returned by declare_action" },
      },
      required: ["command", "actionToken"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in /workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        path:    { type: "string" },
        content: { type: "string" },
        actionToken: { type: "string", description: "Token returned by declare_action" },
      },
      required: ["path", "content", "actionToken"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from /workspace.",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List files in /workspace.",
    input_schema: {
      type: "object" as const,
      properties: { pattern: { type: "string", description: "Glob pattern" } },
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate to a URL, return page content as text (auto-offloaded).",
    input_schema: {
      type: "object" as const,
      properties: {
        url:      { type: "string" },
        selector: { type: "string", description: "Optional CSS selector" },
        actionToken: { type: "string", description: "Token returned by declare_action" },
      },
      required: ["url", "actionToken"],
    },
  },
  {
    name: "update_todo",
    description: "Update todo.md task tracker. ALWAYS call at start and on step completion.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Full todo.md with [ ] [x] [>] checkboxes" },
      },
      required: ["content"],
    },
  },
  {
    name: "task_done",
    description: "Signal task completion with result summary.",
    input_schema: {
      type: "object" as const,
      properties: {
        result:       { type: "string" },
        output_files: { type: "array", items: { type: "string" } },
      },
      required: ["result"],
    },
  },
];

const ALWAYS_AVAILABLE_TOOLS = new Set(["declare_action", "update_todo", "task_done"]);

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "bash_exec",
  shell: "bash_exec",
  browser: "browser_navigate",
  browser_bridge: "browser_navigate",
  web: "browser_navigate",
  read: "read_file",
  file_read: "read_file",
  write: "write_file",
  file_write: "write_file",
  list: "list_files",
  todo: "update_todo",
  done: "task_done",
};

export function getToolDefinitionsForBrief(executionBrief?: Pick<ExecutionBrief, "allowedTools">): Tool[] {
  const allowedToolNames = normalizeAllowedToolNames(executionBrief?.allowedTools);
  if (!allowedToolNames.size) return TOOL_DEFINITIONS;

  for (const toolName of ALWAYS_AVAILABLE_TOOLS) {
    allowedToolNames.add(toolName);
  }

  const filtered = TOOL_DEFINITIONS.filter((tool) => allowedToolNames.has(tool.name));
  return filtered.length ? filtered : TOOL_DEFINITIONS.filter((tool) => ALWAYS_AVAILABLE_TOOLS.has(tool.name));
}

function normalizeAllowedToolNames(allowedTools?: string[]) {
  const names = new Set<string>();
  for (const raw of allowedTools ?? []) {
    const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
    if (!normalized) continue;
    names.add(TOOL_NAME_ALIASES[normalized] ?? normalized);
  }
  return names;
}

export interface ToolInput   { [k: string]: unknown }
export interface ToolOutput  { content: string; isError: boolean; offloadedPath?: string }

const OFFLOAD_CHARS = 2000;

export class ToolExecutor {
  private actionGuard: ActionGuard;
  private runId: string;
  private executionBrief?: ExecutionBrief;

  constructor(
    private sandbox: DockerSandbox,
    opts?: { runId?: string; executionBrief?: ExecutionBrief },
  ) {
    this.runId = opts?.runId ?? sandbox.sessionId;
    this.executionBrief = opts?.executionBrief;
    this.actionGuard = new ActionGuard(this.runId, opts?.executionBrief);
  }

  async execute(name: string, input: ToolInput): Promise<ToolOutput> {
    try {
      if (name !== "declare_action" && this.actionGuard.isSideEffectTool(name)) {
        const result = this.actionGuard.consumeToken(name, input.actionToken);
        if (!result.ok) return { content: result.reason, isError: true };
      }

      switch (name) {
        case "declare_action":    return await this.declareAction(input);
        case "bash_exec":        return await this.bashExec(input);
        case "write_file":       return await this.writeFile(input);
        case "read_file":        return await this.readFile(input);
        case "list_files":       return await this.listFiles(input);
        case "browser_navigate": return await this.browserNavigate(input);
        case "update_todo":      return await this.updateTodo(input);
        case "task_done":        return { content: `TASK_DONE: ${input.result}`, isError: false };
        default:                 return { content: `Unknown tool: ${name}`, isError: true };
      }
    } catch (err) {
      return { content: `Tool error: ${String(err)}`, isError: true };
    }
  }

  private async declareAction(input: ToolInput): Promise<ToolOutput> {
    const action = String(input.action ?? "");
    const reason = String(input.reason ?? "");
    const decision = this.actionGuard.checkAction(action, reason);
    const resumeMetadata = buildGenericAgentResumeMetadata({
      actionName: action,
      payload: input.payload,
      hasPayload: Object.prototype.hasOwnProperty.call(input, "payload"),
      contextDependency: input.contextDependency,
    });

    if (decision.decision === "blocked") {
      return { content: `BLOCKED: ${decision.reason}`, isError: true };
    }
    if (decision.decision === "approval_required") {
      const approvedResume = await this.issueTokenFromApprovedResume(action, decision.reason, resumeMetadata);
      if (approvedResume) return approvedResume;
      const previousApproval = await this.findPreviousPayloadChange(action, resumeMetadata);
      const approval = await createApprovalRequest({
        companyId: this.executionBrief?.companyId ?? DEFAULT_COMPANY_ID,
        taskId: this.executionBrief?.taskId,
        runId: this.runId,
        action,
        reason: decision.reason,
        title: buildApprovalTitle(action),
        description: decision.reason,
        source: "action_guard",
        metadata: {
          taskType: this.executionBrief?.taskType,
          riskLevel: this.executionBrief?.riskLevel,
          objective: this.executionBrief?.objective,
          requiredApprovalActions: this.executionBrief?.requiredApprovalActions ?? [],
          sourceSummary: this.executionBrief?.intakeId ?? this.runId,
          executionPath: "generic_agent",
          genericAgentResume: resumeMetadata,
          previousGenericAgentApproval: previousApproval,
        },
      });
      return {
        content: [
          `APPROVAL_REQUIRED: ${decision.reason}`,
          `approvalId: ${approval.id}`,
          `Studio 승인함에서 이 작업을 검토한 뒤 다시 실행하세요.`,
        ].join("\n"),
        isError: true,
      };
    }

    const companyId = this.executionBrief?.companyId ?? DEFAULT_COMPANY_ID;
    const deviceStatus = await getCompanyDeviceOperationStatus({ companyId }).catch(() => null);
    const offline = applyGenericAgentOfflineDemotion({
      policyTier: "AUTO",
      action,
      deviceMode: deviceStatus?.mode ?? "OFFLINE",
    });
    if (offline.tier === "ASSIST") {
      const approvedResume = await this.issueTokenFromApprovedResume(action, decision.reason, resumeMetadata);
      if (approvedResume) return approvedResume;
      const previousApproval = await this.findPreviousPayloadChange(action, resumeMetadata);
      const reasonText = [
        decision.reason,
        `실행 PC 상태가 ${deviceStatus?.mode ?? "OFFLINE"}이어서 Generic Agent의 ${offline.capability} action을 승인 검토로 전환했습니다.`,
      ].join("\n");
      const approval = await createApprovalRequest({
        companyId,
        taskId: this.executionBrief?.taskId,
        runId: this.runId,
        action,
        reason: reasonText,
        title: buildApprovalTitle(action),
        description: reasonText,
        source: "generic_agent_action_guard",
        metadata: {
          taskType: this.executionBrief?.taskType,
          riskLevel: this.executionBrief?.riskLevel,
          objective: this.executionBrief?.objective,
          sourceSummary: this.executionBrief?.intakeId ?? this.runId,
          executionPath: "generic_agent",
          deviceMode: deviceStatus?.mode ?? "OFFLINE",
          actionCapability: offline.capability,
          offlineDemotion: "AUTO_TO_ASSIST",
          genericAgentResume: resumeMetadata,
          previousGenericAgentApproval: previousApproval,
        },
      });
      return {
        content: [
          `APPROVAL_REQUIRED: ${reasonText}`,
          `approvalId: ${approval.id}`,
          `Generic Agent offline demotion blocked actionToken issuance.`,
        ].join("\n"),
        isError: true,
      };
    }

    const token = this.actionGuard.issueToken(action, decision.reason, decision.allowedTools);
    return {
      content: [
        `ACTION_ALLOWED: ${action}`,
        `actionToken: ${token.token}`,
        `allowedTools: ${token.allowedTools.join(", ")}`,
        `expiresInMs: 30000`,
        `Use this token exactly once with the next side-effect tool call.`,
      ].join("\n"),
      isError: false,
    };
  }

  private async issueTokenFromApprovedResume(
    action: string,
    reason: string,
    resumeMetadata: ReturnType<typeof buildGenericAgentResumeMetadata>,
  ): Promise<ToolOutput | null> {
    const taskId = this.executionBrief?.taskId;
    if (!taskId || !resumeMetadata.payloadHash) return null;

    const approval = await claimApprovedGenericAgentResume({
      companyId: this.executionBrief?.companyId ?? DEFAULT_COMPANY_ID,
      taskId,
      action,
      payloadHash: resumeMetadata.payloadHash,
      consumedByRunId: this.runId,
    }).catch(() => null);

    if (!approval) return null;

    const allowedTools = this.actionGuard.getAllowedToolsForAction(action);
    if (!allowedTools.length) {
      return {
        content: `APPROVAL_CONSUMED_BUT_BLOCKED: ${action} 행동에 사용할 수 있는 허용 도구가 없습니다.`,
        isError: true,
      };
    }

    const token = this.actionGuard.issueToken(
      action,
      `${reason}\n승인 증거 ${approval.id}를 1회 실행 권한으로 사용합니다.`,
      allowedTools,
    );
    return {
      content: [
        `ACTION_ALLOWED_BY_APPROVAL: ${action}`,
        `originCardId: ${approval.id}`,
        `payloadHash: ${resumeMetadata.payloadHash}`,
        `actionToken: ${token.token}`,
        `allowedTools: ${token.allowedTools.join(", ")}`,
        `expiresInMs: 30000`,
        `Use this token exactly once with the next side-effect tool call.`,
      ].join("\n"),
      isError: false,
    };
  }

  private async findPreviousPayloadChange(
    action: string,
    resumeMetadata: ReturnType<typeof buildGenericAgentResumeMetadata>,
  ) {
    const taskId = this.executionBrief?.taskId;
    if (!taskId || !resumeMetadata.payloadHash) return undefined;
    const previous = await findLatestApprovedGenericAgentResume({
      companyId: this.executionBrief?.companyId ?? DEFAULT_COMPANY_ID,
      taskId,
      action,
    }).catch(() => null);
    if (!previous) return undefined;

    const previousResume = asRecord(asRecord(previous.options.metadata).genericAgentResume);
    const previousHash = typeof previousResume.payloadHash === "string" ? previousResume.payloadHash : undefined;
    if (!previousHash || previousHash === resumeMetadata.payloadHash) return undefined;

    return {
      originCardId: previous.id,
      approvedPayloadHash: previousHash,
      currentPayloadHash: resumeMetadata.payloadHash,
      reason: "approved_payload_changed",
    };
  }

  private async bashExec(input: ToolInput): Promise<ToolOutput> {
    const command = String(input.command ?? "");
    const blocked = scanBashCommand(command);
    if (blocked) return { content: blocked, isError: true };

    const r = await this.sandbox.exec(command, (input.timeout_ms as number) ?? 30_000);
    const content = r.stdout + (r.stderr ? `\nSTDERR: ${r.stderr}` : "");
    if (content.length > OFFLOAD_CHARS && r.exitCode === 0) {
      const fname = `bash_${Date.now()}.txt`;
      await fs.writeFile(path.join(this.sandbox.workspacePath, fname), content, "utf-8");
      return { content: `Output saved → /workspace/${fname} (${content.length} chars)`, isError: false, offloadedPath: `/workspace/${fname}` };
    }
    return { content: content.trim() || "(no output)", isError: r.exitCode !== 0 };
  }

  private async writeFile(input: ToolInput): Promise<ToolOutput> {
    const fp = this.resolveWorkspacePath(input.path);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, input.content as string, "utf-8");
    return { content: `Written: ${input.path}`, isError: false };
  }

  private async readFile(input: ToolInput): Promise<ToolOutput> {
    const content = await fs.readFile(
      this.resolveWorkspacePath(input.path), "utf-8"
    );
    if (content.length > OFFLOAD_CHARS) {
      return {
        content: `${input.path} (${content.length} chars). First 400:\n${content.slice(0, 400)}…`,
        isError: false,
        offloadedPath: input.path as string,
      };
    }
    return { content, isError: false };
  }

  private async listFiles(input: ToolInput): Promise<ToolOutput> {
    const pattern = typeof input.pattern === "string" ? input.pattern : "*";
    const files = await listWorkspaceFiles(this.sandbox.workspacePath, pattern, 50);
    return { content: files.length ? files.join("\n") : "(empty)", isError: false };
  }

  private async browserNavigate(input: ToolInput): Promise<ToolOutput> {
    const url = new URL(String(input.url ?? ""));
    if (!["http:", "https:"].includes(url.protocol)) {
      return { content: `Blocked URL protocol: ${url.protocol}`, isError: true };
    }

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page    = await browser.newPage();
    await page.goto(input.url as string, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const content = input.selector
      ? await page.$eval(input.selector as string, (el) => el.textContent ?? "")
      : await page.evaluate(() => document.body.innerText);
    await browser.close();
    const fname = `browser_${Date.now()}.txt`;
    await fs.writeFile(path.join(this.sandbox.workspacePath, fname), content, "utf-8");
    return { content: `Saved → /workspace/${fname} (${content.length} chars)`, isError: false, offloadedPath: `/workspace/${fname}` };
  }

  private async updateTodo(input: ToolInput): Promise<ToolOutput> {
    const fp = this.resolveWorkspacePath("todo.md");
    await fs.writeFile(fp, input.content as string, "utf-8");
    const current = (input.content as string).split("\n").find((l) => l.includes("[>]"));
    return { content: `todo.md updated. Current: ${current ?? "(see todo.md)"}`, isError: false };
  }

  private resolveWorkspacePath(inputPath: unknown): string {
    const relative = String(inputPath ?? "").replace(/^\/+/, "");
    const root = path.resolve(this.sandbox.workspacePath);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes workspace: ${inputPath}`);
    }
    return target;
  }
}

function buildApprovalTitle(action: string) {
  const normalized = action.trim().toLowerCase();
  return {
    store_session_cookie: "사이트 세션 저장 승인",
    use_saved_session: "저장된 세션 사용 승인",
    send_order_confirm: "거래처 답장 발송 승인",
    create_order: "주문 등록 승인",
    create_shipping_task: "출고 지시 승인",
    update_spreadsheet: "업무 파일 수정 승인",
  }[normalized] ?? "AI 실행 승인 필요";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scanBashCommand(command: string): string | null {
  const dangerous: Array<[RegExp, string]> = [
    [/\brm\s+-rf\s+(\/|\*)/i, "rm -rf against root or wildcard is blocked."],
    [/\bdd\s+if=/i, "raw disk copy commands are blocked."],
    [/\bmkfs(\.|_|\s|$)/i, "filesystem formatting commands are blocked."],
    [/\bshutdown\b|\breboot\b|\bpoweroff\b/i, "shutdown commands are blocked."],
    [/\bsudo\b/i, "sudo is blocked inside FlowFit Runner."],
    [/\bdocker\b/i, "nested docker commands are blocked."],
    [/\b(chmod|chown)\s+-R\s+.*\//i, "recursive permission changes against absolute paths are blocked."],
    [/(curl|wget)[^|;&]*\|\s*(sh|bash)/i, "piping downloaded scripts directly to shell is blocked."],
    [/\b(cat|less|more)\s+\/etc\/shadow\b/i, "reading sensitive system files is blocked."],
  ];

  for (const [pattern, message] of dangerous) {
    if (pattern.test(command)) return `Blocked bash command: ${message}`;
  }
  return null;
}

async function listWorkspaceFiles(root: string, pattern: string, limit: number): Promise<string[]> {
  const rootPath = path.resolve(root);
  const matcher = makeSimpleMatcher(pattern);
  const result: string[] = [];

  async function walk(dir: string) {
    if (result.length >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= limit) return;
      const full = path.join(dir, entry.name);
      const relative = path.relative(rootPath, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(full);
      } else if (matcher(relative)) {
        result.push(`./${relative}`);
      }
    }
  }

  await walk(rootPath);
  return result.sort();
}

function makeSimpleMatcher(pattern: string) {
  const cleaned = pattern.trim() || "*";
  if (cleaned === "*" || cleaned === "**/*") return () => true;
  const escaped = cleaned
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__FLOWFIT_GLOBSTAR__")
    .replace(/\*/g, "[^/]*");
  const regex = new RegExp(`^${escaped.replace(/__FLOWFIT_GLOBSTAR__/g, ".*")}$`);
  return (value: string) => regex.test(value) || regex.test(path.basename(value));
}
