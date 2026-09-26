// intake/types.ts
// Work Intake Engine의 공통 입력 타입.

export type IntakeSourceType =
  | "sms"
  | "email"
  | "site"
  | "messenger"
  | "file"
  | "manual";

export type IntakeStatus =
  | "pending"
  | "pending_classification"
  | "duplicate"
  | "failed";

export interface IntakeAttachmentRef {
  name: string;
  path?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface CreateIntakeInput {
  companyId: string;
  companyName?: string;
  sourceType: IntakeSourceType;
  sourceName?: string;
  rawText?: string;
  attachmentRefs?: IntakeAttachmentRef[];
  metadata?: Record<string, unknown>;
  receivedAt?: Date;
  dedupeKey?: string;
  status?: IntakeStatus;
}

export interface StoredIntake {
  id: string;
  companyId: string;
  sourceType: IntakeSourceType;
  sourceName?: string;
  rawText?: string;
  status: string;
  receivedAt?: string;
  createdAt: string;
  dedupeKey?: string;
  duplicate: boolean;
}
