// context/types.ts
// Task Understanding 결과를 회사 데이터(거래처/품목/재고)와 연결한 결과 구조.

import type { BusinessTaskType, ExtractedBusinessFields } from "../understanding/types.js";

export type ContextMatchStatus =
  | "matched"
  | "needs_review"
  | "not_applicable";

export type EntityMatchKind =
  | "exact"
  | "alias"
  | "fuzzy"
  | "not_found"
  | "not_needed";

export type InventoryStatus =
  | "enough"
  | "low_stock"
  | "shortage"
  | "unknown"
  | "not_applicable";

export interface ContextCandidate {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface EntityContextMatch {
  kind: EntityMatchKind;
  id?: string;
  name?: string;
  score: number;
  reason: string;
  candidates: ContextCandidate[];
}

export interface InventoryContextMatch {
  status: InventoryStatus;
  itemId?: string;
  itemName?: string;
  requestedQuantity?: number;
  quantity?: number;
  safetyQuantity?: number;
  availableToPromise?: number;
  shortageQuantity?: number;
  reason: string;
}

export interface CustomerContextRecord {
  id: string;
  companyId: string;
  name: string;
  aliases: string[];
  pricingTier?: string;
  rules?: Record<string, unknown>;
}

export interface ItemContextRecord {
  id: string;
  companyId: string;
  name: string;
  aliases: string[];
  sku?: string;
  unit?: string;
  basePrice?: number;
  rules?: Record<string, unknown>;
}

export interface InventoryContextRecord {
  itemId: string;
  quantity: number;
  safetyQuantity: number;
  updatedAt?: string;
}

export interface CompanyContextCatalog {
  customers: CustomerContextRecord[];
  items: ItemContextRecord[];
  inventory: InventoryContextRecord[];
}

export interface TaskForContext {
  id: string;
  companyId: string;
  taskType: BusinessTaskType;
  status: string;
  extractedFields: ExtractedBusinessFields & Record<string, unknown>;
  riskLevel?: string;
  confidence?: number;
}

export interface ContextEngineInput {
  task: TaskForContext;
  catalog: CompanyContextCatalog;
}

export interface CompanyContextResult {
  taskId: string;
  companyId: string;
  taskType: BusinessTaskType;
  status: ContextMatchStatus;
  contextConfidence: number;
  customer: EntityContextMatch;
  item: EntityContextMatch;
  inventory: InventoryContextMatch;
  missingContext: string[];
  decisionHints: string[];
  recommendedAction: string;
  matchedAt: string;
}
