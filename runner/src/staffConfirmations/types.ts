export type StaffRequestStatus =
  | "draft"
  | "waiting_approval"
  | "sent"
  | "responded"
  | "expired"
  | "cancelled";

export type StaffRequestChannel =
  | "sms"
  | "email"
  | "slack"
  | "teams"
  | "kakao_work"
  | "telegram"
  | "manual";

export interface StaffConfirmationRequestRecord {
  id: string;
  companyId: string;
  aiWorkId: string;
  requestedByUserId: string;
  requestedByName: string;
  staffId?: string;
  staffName: string;
  staffContact?: string;
  channel: StaffRequestChannel;
  status: StaffRequestStatus;
  title: string;
  question: string;
  responseOptions: string[];
  messagePreview: string;
  internalReason: string;
  sentAt?: string;
  respondedAt?: string;
  response?: string;
  responseMemo?: string;
  externalMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffConfirmationRequestInput {
  id?: string;
  companyId?: string;
  aiWorkId?: string;
  requestedByUserId?: string;
  requestedByName?: string;
  staffId?: string;
  staffName: string;
  staffContact?: string;
  channel?: StaffRequestChannel;
  status?: StaffRequestStatus;
  title: string;
  question: string;
  responseOptions?: string[];
  messagePreview?: string;
  internalReason: string;
}
