export type UserRole = "admin";

export type HealthStatus = "healthy" | "warning" | "error";

export type PortalStatus =
  | "not-connected"
  | "connecting"
  | "needs-test"
  | "active"
  | "error";

export type OnboardingStage =
  | "basic-info"
  | "privacy-consent"
  | "kakao-connected"
  | "test-run"
  | "active";

export type IntegrationType = "kakao" | "email" | "webhook" | "crm";

export type IntegrationStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "reauth-required"
  | "connecting";

export type ConsentState = "not-submitted" | "active" | "needs-renewal";

export type TestRunType = "message" | "connection-check" | "webhook-check";

export type TestRunStatus = "queued" | "running" | "success" | "failed";

export type ErrorReason =
  | "token-expired"
  | "missing-required-value"
  | "insufficient-permission"
  | "connection-failed"
  | "authentication-failed"
  | "timeout";

export type OrderStatus =
  | "received"
  | "reviewing"
  | "integration-prep"
  | "testing"
  | "activated"
  | "revision-requested";

export type EventSeverity = "info" | "success" | "warning" | "critical";

export type EventStatus = "success" | "warning" | "error" | "info";

export type TicketStatus = "open" | "in-progress" | "resolved" | "on-hold";

export type TicketPriority = "low" | "medium" | "high" | "critical";

export type DataMode = "live" | "mock";

export type ApprovalDecisionStatus = "approval-pending" | "approved" | "rejected";

export type AgentRunLifecycleStatus =
  | "draft"
  | "running"
  | "completed"
  | "approved"
  | "rejected"
  | "needs-feedback"
  | "feedback-logged";

export type AiWorkStatus =
  | "queued"
  | "collecting"
  | "analyzing"
  | "drafting"
  | "checking"
  | "waiting_approval"
  | "revision_needed"
  | "assigned_to_staff"
  | "completed"
  | "auto_completed"
  | "failed"
  | "cancelled";

export type AgentRunFeedbackType = "edit" | "approve" | "reject" | "request_change";

export type ContextNodeKind =
  | "person"
  | "department"
  | "role"
  | "situation"
  | "rule"
  | "exception"
  | "document"
  | "output"
  | "source";

export type KnowledgeChangeType =
  | "new_rule"
  | "update_rule"
  | "new_exception"
  | "update_priority";

export type KnowledgeChangeStatus = "draft" | "pending" | "approved" | "rejected";

export type KakaoValidationScenario =
  | "success"
  | "token-expired"
  | "insufficient-permission"
  | "missing-required-value"
  | "connection-failed";

export interface CustomerContact {
  name: string;
  email: string;
  phone: string;
}

export interface Customer {
  id: string;
  name: string;
  industry: string;
  segment: string;
  contact: CustomerContact;
  currentStage: OnboardingStage;
  portalStatus: PortalStatus;
  healthStatus: HealthStatus;
  onboardingPercent: number;
  kakaoStatus: IntegrationStatus;
  lastTestAt?: string;
  recentErrorCount: number;
  openTicketCount: number;
  sourceFormId: string;
  sourceFormLabel: string;
  sourceFormUrl: string;
  recommendedAction: string;
}

export interface Integration {
  id: string;
  customerId: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  description: string;
  capabilities: string[];
  channelName?: string;
  channelId?: string;
  senderProfile?: string;
  accessTokenMasked?: string;
  callbackUrl?: string;
  lastValidatedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  nextAction?: string;
}

export interface ConsentItem {
  id: string;
  label: string;
  required: boolean;
  fields: string[];
  purpose: string;
  retentionPeriod: string;
  checked: boolean;
}

export interface ConsentRecord {
  id: string;
  customerId: string;
  version: string;
  state: ConsentState;
  agreedAt?: string;
  agreedBy?: string;
  note?: string;
  items: ConsentItem[];
}

export interface TestRun {
  id: string;
  customerId: string;
  type: TestRunType;
  status: TestRunStatus;
  recipient: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
  responseTimeMs?: number;
  logLines: string[];
  failureReason?: ErrorReason;
  retryable: boolean;
  integrationType?: IntegrationType;
}

export interface Order {
  id: string;
  customerId: string;
  orderNumber: string;
  sourceFormLabel: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  requestedItems: string[];
  requiredFixes?: string[];
  currentStepNote: string;
}

export interface EventLog {
  id: string;
  customerId?: string;
  customerName?: string;
  occurredAt: string;
  integrationType?: IntegrationType;
  eventName: string;
  severity: EventSeverity;
  status: EventStatus;
  summary: string;
  cause?: string;
  errorCode?: string;
  actor: string;
  retryable: boolean;
  requestPayload?: string;
  responsePayload?: string;
}

export interface SupportTicket {
  id: string;
  customerId: string;
  customerName: string;
  status: TicketStatus;
  priority: TicketPriority;
  title: string;
  description: string;
  assignedTo?: string;
  createdAt: string;
  lastUpdatedAt: string;
  category: string;
  updates: string[];
}

export interface ApprovalQueueItem {
  quoteId: string;
  inquiryId?: string;
  correlationId?: string;
  customerId: string;
  customerName: string;
  totalAmount?: number;
  dueDate?: string;
  currentState: string;
  currentRevisionNo?: number;
  items?: string[];
  lastActorRole?: string;
  lastReasonCode?: string;
  lastEventAt?: string;
  createdAt: string;
  updatedAt: string;
  hoursInState?: number;
  decisionStatus: ApprovalDecisionStatus;
}

export interface AgentRunRecord {
  id: string;
  sourceType: string;
  sourceId: string;
  actorId?: string | null;
  actorLabel?: string | null;
  department?: string | null;
  role?: string | null;
  situationTag?: string | null;
  promptInput: string;
  referencedSources: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  intermediateReasoningSummary?: string | null;
  outputDraft?: string | null;
  finalOutput?: string | null;
  status: AgentRunLifecycleStatus | string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunFeedbackRecord {
  id: string;
  agentRunId: string;
  feedbackType: AgentRunFeedbackType | string;
  feedbackText: string;
  editedBefore?: string | null;
  editedAfter?: string | null;
  reviewer: string;
  createdAt: string;
}

export interface ContextGraphNodeRecord {
  id: string;
  nodeType: ContextNodeKind | string;
  nodeKey: string;
  nodeValue: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContextGraphEdgeRecord {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
  confidence: number;
  sourceRunId?: string | null;
  createdAt: string;
}

export interface KnowledgeChangeRequestRecord {
  id: string;
  title: string;
  summary: string;
  changeType: KnowledgeChangeType | string;
  diffBefore: Record<string, unknown>;
  diffAfter: Record<string, unknown>;
  reason: string;
  sourceRunId?: string | null;
  status: KnowledgeChangeStatus | string;
  reviewer?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunDetailRecord extends AgentRunRecord {
  feedbackLogs: AgentRunFeedbackRecord[];
  knowledgeChangeRequests: KnowledgeChangeRequestRecord[];
}

export interface ContextGraphSummaryRecord {
  mode: DataMode;
  nodeCount: number;
  edgeCount: number;
  recentRules: ContextGraphNodeRecord[];
  recentExceptions: ContextGraphNodeRecord[];
  recentChangeRequests: KnowledgeChangeRequestRecord[];
  nodes: ContextGraphNodeRecord[];
  edges: ContextGraphEdgeRecord[];
}

export interface HelpArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  relatedStatuses: Array<IntegrationStatus | PortalStatus | ErrorReason>;
  steps: string[];
}

export interface ExceptionInboxLink {
  id: string;
  keyword: string;
  url: string;
  description: string;
  enabled: boolean;
}

export interface AdminSettings {
  badgeRules: {
    warningThreshold: number;
    criticalThreshold: number;
  };
  exceptionInboxLinks: ExceptionInboxLink[];
  notificationRules: Array<{
    id: string;
    title: string;
    condition: string;
    channel: string;
    enabled: boolean;
  }>;
  defaultTestTemplate: string;
  consentVersions: Array<{
    version: string;
    releasedAt: string;
    active: boolean;
  }>;
  roleNotes: string[];
}

export type WholesaleSettingsModuleRoute =
  | "dunning"
  | "delivery"
  | "account-health"
  | "pricing"
  | "claims";

export type WholesaleAlertChannel = "dashboard" | "kakao" | "email" | "slack";

export interface WholesaleDunningSettings {
  p1AmountThreshold: number;
  p1OverdueDays: number;
  reminderDaysBeforeDue: number;
  followUpCadenceDays: number;
  dormantAfterDays: number;
  alertChannels: WholesaleAlertChannel[];
  autoCreateDraftNotice: boolean;
  pauseOnWeekends: boolean;
}

export interface WholesaleDeliverySettings {
  enableD3Alerts: boolean;
  enableD1Alerts: boolean;
  enableDelayAlerts: boolean;
  delayThresholdDays: number;
  perPartnerRulesEnabled: boolean;
  managerEscalationHours: number;
  alertChannels: WholesaleAlertChannel[];
  autoCreateDelayNotice: boolean;
}

export interface WholesaleAccountHealthSettings {
  recencyWeight: number;
  frequencyWeight: number;
  monetaryWeight: number;
  warningScoreCutoff: number;
  criticalScoreCutoff: number;
  orderDropThresholdPercent: number;
  noOrderDaysThreshold: number;
  alertChannels: WholesaleAlertChannel[];
}

export interface WholesalePricingSettings {
  warningChangeRatePercent: number;
  criticalChangeRatePercent: number;
  impactedPartnerThreshold: number;
  enablePartnerSpecificRules: boolean;
  autoCreatePriceNotice: boolean;
  defaultNoticeLeadDays: number;
  alertChannels: WholesaleAlertChannel[];
  allowedFileTypes: string[];
}

export type WholesaleClaimsAssignMode = "partner-owner" | "round-robin" | "manual";

export interface WholesaleClaimsSettings {
  autoClassifyEnabled: boolean;
  enabledCategories: string[];
  highPriorityKeywords: string;
  mediumPriorityKeywords: string;
  autoAssignMode: WholesaleClaimsAssignMode;
  defaultAssignee: string;
  accumulatedCountThreshold: number;
  alertChannels: WholesaleAlertChannel[];
}

export interface WholesaleSettings {
  schemaVersion: string;
  updatedAt: string;
  dunning: WholesaleDunningSettings;
  delivery: WholesaleDeliverySettings;
  accountHealth: WholesaleAccountHealthSettings;
  pricing: WholesalePricingSettings;
  claims: WholesaleClaimsSettings;
}

export interface MobileDetectorFleetManufacturer {
  manufacturer: string;
  total_devices: number;
  stale_devices_30m: number;
  permission_off_devices: number;
}

export interface MobileDetectorFleetSummary {
  policy_version: number;
  default_action: string;
  total_devices: number;
  active_devices_30m: number;
  stale_devices_30m: number;
  disabled_devices?: number;
  permission_off_devices: number;
  queue_depth_sum: number;
  pending_engine_inputs: number;
  uploaded_batches_24h: number;
  duplicate_rate_24h: number;
  manufacturers: MobileDetectorFleetManufacturer[];
}

export interface MobileDetectorDevice {
  device_id: string;
  installation_id: string;
  device_label?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  os_api_level?: number | null;
  app_version?: string | null;
  collection_enabled?: boolean;
  notification_access_granted?: boolean | null;
  listener_connected?: boolean | null;
  queue_depth: number;
  last_reported_policy_version?: number | null;
  last_heartbeat_at?: string | null;
  last_upload_success_at?: string | null;
  last_posted_collected_at?: string | null;
  last_removed_collected_at?: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  stale_30m: boolean;
}

export interface MobileDetectorOverview {
  connected: boolean;
  checkedAt: string;
  engineBaseUrl: string;
  publicEngineBaseUrl: string;
  error?: string | null;
  summary: MobileDetectorFleetSummary | null;
  devices: MobileDetectorDevice[];
}

export interface MobilePairingCodeRecord {
  pairing_code: string;
  label: string;
  status: string;
  expires_at?: string | null;
  max_uses?: number | null;
  use_count: number;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  active: boolean;
  expired: boolean;
  exhausted: boolean;
  remaining_uses?: number | null;
}

export interface MobileReplyCommand {
  command_id: string;
  type: "send_notification_reply" | "visual_send_reply" | string;
  device_id: string;
  source_event_id?: string | null;
  package_name?: string | null;
  notification_key_hash?: string | null;
  notification_tap_region?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  } | null;
  expected_sender_hint?: string | null;
  expected_body_hint?: string | null;
  reply_text: string;
  execution_plan: Array<"remote_input" | "visual_executor" | string>;
  remote_input?: {
    enabled: boolean;
    require_notification_action: boolean;
  };
  visual_executor?: {
    enabled: boolean;
    requires_screen_validation: boolean;
    allowed_actions: string[];
    stop_conditions: string[];
  };
  safety?: {
    requires_pre_send_validation: boolean;
    min_confidence: number;
    require_expected_app: boolean;
    require_recent_message_match: boolean;
  };
  status: "queued" | "delivered" | "succeeded" | "failed" | "expired" | string;
  attempts: number;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  result?: {
    ok: boolean;
    status: string;
    method?: string | null;
    reason?: string | null;
    confidence?: number | null;
    validation?: unknown;
    screenshot_ref?: string | null;
    reported_at?: string | null;
  } | null;
}

export interface MobileAppDownloadInfo {
  available: boolean;
  appName: string;
  packageName: string;
  versionName: string;
  fileName: string;
  sizeBytes: number;
  updatedAt?: string | null;
  downloadPath: string;
  publicDownloadUrl: string;
}

export interface StageStep {
  key: OnboardingStage;
  label: string;
  description: string;
}

export interface IntegrationSummary {
  type: IntegrationType;
  label: string;
  connectedCount: number;
  errorCount: number;
  reauthCount: number;
  description: string;
}

export type BrowserAutomationCommandName =
  | "TAB_LIST"
  | "NEW_TAB"
  | "NAVIGATE"
  | "GET_TEXT"
  | "FIND_ELEMENTS"
  | "SCREENSHOT"
  | "WAIT_FOR"
  | "CLICK"
  | "TYPE"
  | "GET_HTML"
  | "EVAL"
  | "GET_COOKIES"
  | "SET_COOKIE"
  | "GET_LOCALSTORAGE"
  | "SET_LOCALSTORAGE"
  | "NETWORK_LOG";

export type BrowserAutomationRiskLevel = "read_only" | "needs_approval" | "blocked";

export interface BrowserAutomationCommandPolicy {
  name: BrowserAutomationCommandName;
  label: string;
  riskLevel: BrowserAutomationRiskLevel;
  allowed: boolean;
  requiresApproval: boolean;
  tokenSavingRole: string;
  reason: string;
}

export interface BrowserAutomationBridgeSession {
  session_id: string;
  extension_name?: string | null;
  browser?: string | null;
  version?: string | null;
  active_tab_title?: string | null;
  active_tab_url?: string | null;
  status: "online" | "stale" | "offline" | string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface BrowserAutomationAuditEntry {
  command_id: string;
  command: BrowserAutomationCommandName | string;
  label: string;
  requested_by: string;
  status:
    | "waiting_approval"
    | "queued"
    | "delivered"
    | "succeeded"
    | "failed"
    | "blocked"
    | "cancelled"
    | "expired"
    | string;
  risk_level: BrowserAutomationRiskLevel;
  target_url?: string | null;
  result_summary?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface BrowserAutomationSourceCandidate {
  name: string;
  url: string;
  license: string;
  fit: string;
  useFor: string;
}

export interface BrowserAutomationOverview {
  connected: boolean;
  checkedAt: string;
  engineBaseUrl: string;
  error?: string | null;
  policyVersion: number;
  extensionTokenConfigured: boolean;
  sessions: BrowserAutomationBridgeSession[];
  commandAudit: BrowserAutomationAuditEntry[];
  policy: BrowserAutomationCommandPolicy[];
  tokenSavingPlan: string[];
  recommendedSources: BrowserAutomationSourceCandidate[];
}

export type GatePolicyLevel = "SAFE" | "CONFIRM" | "BLOCK";

export interface GateCommandPolicy {
  command: string;
  level: GatePolicyLevel;
  label: string;
  riskReason: string;
  resultHandling: "mask_and_summarize" | "mask_only" | "no_ai_result";
}

export interface GateApprovalRecord {
  approval_id: string;
  command_id: string;
  session_id: string;
  command: string;
  params_hash: string;
  risk_reason: string;
  status: "pending" | "approved" | "rejected" | "expired" | string;
  reviewed_by?: string | null;
  review_note?: string | null;
  created_at: string;
  expires_at: string;
  updated_at: string;
}

export interface GateCommandRecord {
  command_id: string;
  session_id: string;
  command: string;
  params?: Record<string, unknown>;
  status:
    | "approved"
    | "pending_approval"
    | "processing"
    | "done"
    | "error"
    | "blocked"
    | "rejected"
    | "expired"
    | string;
  level: GatePolicyLevel;
  result?: unknown;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}
