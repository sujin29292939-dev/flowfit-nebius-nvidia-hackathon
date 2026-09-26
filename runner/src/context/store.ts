// context/store.ts
// 회사 맥락 데이터 조회 및 tasks.context_json 저장 계층.

import { sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";
import type {
  CompanyContextCatalog,
  CompanyContextResult,
  CustomerContextRecord,
  InventoryContextRecord,
  ItemContextRecord,
  TaskForContext,
} from "./types.js";

export async function getTaskForContext(taskId: string): Promise<TaskForContext | null> {
  const rows = await sql`
    SELECT id, company_id, task_type, status, extracted_fields_json, confidence, risk_level
    FROM tasks
    WHERE id = ${taskId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToTaskForContext(rows[0]);
}

export async function loadCompanyContextCatalog(companyId: string): Promise<CompanyContextCatalog> {
  const [customers, items, inventory] = await Promise.all([
    sql`
      SELECT id, company_id, name, aliases_json, pricing_tier, rules_json
      FROM customers
      WHERE company_id = ${companyId}
      ORDER BY name ASC
      LIMIT 2000
    `,
    sql`
      SELECT id, company_id, name, aliases_json, sku, unit, base_price, rules_json
      FROM items
      WHERE company_id = ${companyId}
      ORDER BY name ASC
      LIMIT 5000
    `,
    sql`
      SELECT item_id, quantity, safety_quantity, updated_at
      FROM inventory
      WHERE company_id = ${companyId}
    `,
  ]);

  return {
    customers: customers.map(rowToCustomer),
    items: items.map(rowToItem),
    inventory: inventory.map(rowToInventory),
  };
}

export async function saveTaskContext(taskId: string, result: CompanyContextResult) {
  const nextStatus = result.status === "matched" ? "pending_policy" : "needs_review";
  const rows = await sql`
    UPDATE tasks
    SET
      context_status = ${result.status},
      context_json = ${JSON.stringify(result)},
      status = ${nextStatus},
      updated_at = NOW()
    WHERE id = ${taskId}
    RETURNING id, company_id, task_type, status, context_status, context_json, updated_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (
      ${result.companyId},
      'ai',
      'task_context_matched',
      'task',
      ${taskId},
      ${JSON.stringify({
        status: result.status,
        contextConfidence: result.contextConfidence,
        missingContext: result.missingContext,
        customerId: result.customer.id,
        itemId: result.item.id,
        inventoryStatus: result.inventory.status,
      })}
    )
  `;

  return rows[0];
}

export async function markTaskContextFailed(taskId: string, error: string) {
  await sql`
    UPDATE tasks
    SET context_status = 'failed', updated_at = NOW()
    WHERE id = ${taskId}
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    SELECT company_id, 'ai', 'task_context_match_failed', 'task', id, ${JSON.stringify({ error })}
    FROM tasks
    WHERE id = ${taskId}
  `;
}

export async function listPendingContextTasks(input: { companyId?: string; limit?: number }) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  return await sql`
    SELECT id, company_id, task_type, status, extracted_fields_json, confidence, risk_level
    FROM tasks
    WHERE company_id = ${companyId}
      AND task_type IN ('order_request', 'quote_request', 'delivery_inquiry', 'payment_report')
      AND (
        context_status = 'not_matched'
        OR context_status = 'failed'
        OR context_json = '{}'::jsonb
      )
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
}

export async function listContextCatalog(input: { companyId?: string }) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  return await loadCompanyContextCatalog(companyId);
}

function rowToTaskForContext(row: Record<string, unknown>): TaskForContext {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    taskType: row.task_type as TaskForContext["taskType"],
    status: String(row.status),
    extractedFields: asRecord(row.extracted_fields_json),
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    riskLevel: row.risk_level ? String(row.risk_level) : undefined,
  };
}

export function taskRowToContextInput(row: Record<string, unknown>): TaskForContext {
  return rowToTaskForContext(row);
}

function rowToCustomer(row: Record<string, unknown>): CustomerContextRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    name: String(row.name),
    aliases: asStringArray(row.aliases_json),
    pricingTier: row.pricing_tier ? String(row.pricing_tier) : undefined,
    rules: asRecord(row.rules_json),
  };
}

function rowToItem(row: Record<string, unknown>): ItemContextRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    name: String(row.name),
    aliases: asStringArray(row.aliases_json),
    sku: row.sku ? String(row.sku) : undefined,
    unit: row.unit ? String(row.unit) : undefined,
    basePrice: typeof row.base_price === "number" ? row.base_price : undefined,
    rules: asRecord(row.rules_json),
  };
}

function rowToInventory(row: Record<string, unknown>): InventoryContextRecord {
  return {
    itemId: String(row.item_id),
    quantity: Number(row.quantity ?? 0),
    safetyQuantity: Number(row.safety_quantity ?? 0),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : undefined,
  };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}
