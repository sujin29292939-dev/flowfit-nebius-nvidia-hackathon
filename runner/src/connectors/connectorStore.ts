import { randomUUID } from "node:crypto";
import { isDatabaseConfigured, sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME } from "../intake/config.js";
import {
  Capability,
  ConnectionKind,
  HealthState,
  MappingProfileSchema,
  type Capability as CapabilityValue,
  type HealthState as HealthStateValue,
  type MappingProfile,
} from "./connectorTypes.js";
import {
  CompanyConnectorSchema,
  ConnectionSchema,
  ConnectorDefinitionSchema,
  type CompanyConnector,
  type Connection,
  type ConnectorDefinition,
  type ResolverDeps,
} from "./connectorResolver.js";

type JsonRecord = Record<string, unknown>;

export interface UpsertConnectorConnectionInput {
  id?: string;
  companyId?: string;
  connectorKey: string;
  credentialRef: string;
  kind?: string;
  config?: JsonRecord;
  supportsPush?: boolean;
  enabled?: boolean;
  priorityOverride?: number | null;
  capabilitiesEnabled?: string[];
}

const BUILT_IN_DEFINITIONS: ConnectorDefinition[] = [
  {
    key: "email_default",
    label: "기본 이메일 커넥터",
    kind: "email",
    provides: ["inquiry.read", "inquiry.reply", "order.confirm", "quote.create"],
    supportsPush: false,
    defaultPriority: 120,
  },
  {
    key: "staff_message_default",
    label: "직원 확인 요청 커넥터",
    kind: "manual",
    provides: ["staff.confirm"],
    supportsPush: false,
    defaultPriority: 160,
  },
  {
    key: "flowfit_mock",
    label: "FlowFit Mock 실행 커넥터",
    kind: "webhook",
    provides: [
      "order.create",
      "order.confirm",
      "quote.create",
      "shipment.track",
      "inventory.read",
      "payment.check",
      "staff.confirm",
      "inquiry.read",
      "inquiry.reply",
      "complaint.handle",
      "report.create",
      "automation.create",
    ],
    supportsPush: false,
    defaultPriority: 900,
    mappingProfile: {
      baseUrl: "http://127.0.0.1:3001",
      authType: "none",
      endpoint: { method: "POST", path: "/connectors/mock/execute" },
      healthPath: "/status",
      healthMethod: "GET",
      supportsPush: false,
      idempotency: { supported: true, headerName: "Idempotency-Key" },
    },
  },
].map((definition) => ConnectorDefinitionSchema.parse(definition));

const memoryDefinitions = new Map(BUILT_IN_DEFINITIONS.map((item) => [item.key, item]));
const memoryConnections = new Map<string, Connection>();
const memoryCompanyConnectors = new Map<string, CompanyConnector>();

export async function listConnectorDefinitions(): Promise<ConnectorDefinition[]> {
  const builtIns = [...memoryDefinitions.values()];
  if (!isDatabaseConfigured()) return builtIns;

  const rows = await sql`
    SELECT key, label, kind, provides_json, supports_push, default_priority, mapping_profile_json
    FROM connector_definitions
    ORDER BY default_priority ASC, key ASC
  `;

  const dbItems = rows.map(rowToDefinition);
  const merged = new Map<string, ConnectorDefinition>();
  for (const item of builtIns) merged.set(item.key, item);
  for (const item of dbItems) merged.set(item.key, item);
  return [...merged.values()].sort((a, b) => a.defaultPriority - b.defaultPriority || a.key.localeCompare(b.key));
}

export async function upsertConnectorDefinition(input: ConnectorDefinition): Promise<ConnectorDefinition> {
  const definition = ConnectorDefinitionSchema.parse(input);
  memoryDefinitions.set(definition.key, definition);

  if (!isDatabaseConfigured()) return definition;

  await sql`
    INSERT INTO connector_definitions (
      key,
      label,
      kind,
      provides_json,
      supports_push,
      default_priority,
      mapping_profile_json,
      updated_at
    )
    VALUES (
      ${definition.key},
      ${definition.label},
      ${definition.kind},
      ${JSON.stringify(definition.provides)},
      ${definition.supportsPush},
      ${definition.defaultPriority},
      ${definition.mappingProfile ? JSON.stringify(definition.mappingProfile) : null},
      NOW()
    )
    ON CONFLICT (key)
    DO UPDATE SET
      label = EXCLUDED.label,
      kind = EXCLUDED.kind,
      provides_json = EXCLUDED.provides_json,
      supports_push = EXCLUDED.supports_push,
      default_priority = EXCLUDED.default_priority,
      mapping_profile_json = EXCLUDED.mapping_profile_json,
      updated_at = NOW()
  `;
  return definition;
}

export async function upsertConnectorConnection(input: UpsertConnectorConnectionInput): Promise<{
  connection: Connection;
  companyConnector: CompanyConnector;
}> {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const definition = (await listConnectorDefinitions()).find((item) => item.key === input.connectorKey);
  if (!definition) throw new Error(`Unknown connectorKey: ${input.connectorKey}`);
  const credentialRef = normalizeCredentialRef(input.credentialRef);

  const connection = ConnectionSchema.parse({
    id: input.id ?? `conn_${randomUUID()}`,
    companyId,
    connectorKey: input.connectorKey,
    kind: input.kind ?? definition.kind,
    credentialRef,
    config: input.config ?? {},
    supportsPush: input.supportsPush ?? definition.supportsPush,
    health: { state: "unknown", lastOkAt: null, failCount: 0, checkedAt: null },
  });

  const companyConnector = CompanyConnectorSchema.parse({
    companyId,
    connectorKey: input.connectorKey,
    connectionId: connection.id,
    enabled: input.enabled ?? true,
    priorityOverride: input.priorityOverride ?? null,
    capabilitiesEnabled: normalizeCapabilities(input.capabilitiesEnabled),
  });

  memoryConnections.set(connection.id, connection);
  memoryCompanyConnectors.set(companyConnectorKey(companyConnector), companyConnector);

  if (isDatabaseConfigured()) {
    await ensureCompany(companyId, DEFAULT_COMPANY_NAME);

    await sql`
      INSERT INTO connector_connections (
        id,
        company_id,
        connector_key,
        kind,
        credential_ref,
        config_json,
        supports_push,
        health_json,
        updated_at
      )
      VALUES (
        ${connection.id},
        ${connection.companyId},
        ${connection.connectorKey},
        ${connection.kind},
        ${connection.credentialRef},
        ${JSON.stringify(connection.config)},
        ${connection.supportsPush},
        ${JSON.stringify(connection.health)},
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        connector_key = EXCLUDED.connector_key,
        kind = EXCLUDED.kind,
        credential_ref = EXCLUDED.credential_ref,
        config_json = EXCLUDED.config_json,
        supports_push = EXCLUDED.supports_push,
        updated_at = NOW()
    `;

    await sql`
      INSERT INTO company_connectors (
        company_id,
        connector_key,
        connection_id,
        enabled,
        priority_override,
        capabilities_enabled_json,
        updated_at
      )
      VALUES (
        ${companyConnector.companyId},
        ${companyConnector.connectorKey},
        ${companyConnector.connectionId},
        ${companyConnector.enabled},
        ${companyConnector.priorityOverride},
        ${companyConnector.capabilitiesEnabled ? JSON.stringify(companyConnector.capabilitiesEnabled) : null},
        NOW()
      )
      ON CONFLICT (company_id, connector_key, connection_id)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        priority_override = EXCLUDED.priority_override,
        capabilities_enabled_json = EXCLUDED.capabilities_enabled_json,
        updated_at = NOW()
    `;
  }

  return { connection, companyConnector };
}

async function ensureCompany(companyId: string, companyName: string) {
  await sql`
    INSERT INTO companies (id, name)
    VALUES (${companyId}, ${companyName})
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function listCompanyConnectorLinks(companyId = DEFAULT_COMPANY_ID): Promise<CompanyConnector[]> {
  const memory = [...memoryCompanyConnectors.values()].filter((item) => item.companyId === companyId);
  if (!isDatabaseConfigured()) return memory;

  const rows = await sql`
    SELECT company_id, connector_key, connection_id, enabled, priority_override, capabilities_enabled_json
    FROM company_connectors
    WHERE company_id = ${companyId}
    ORDER BY COALESCE(priority_override, 1000) ASC, connector_key ASC
  `;
  return rows.map(rowToCompanyConnector);
}

export async function listConnectorConnections(companyId = DEFAULT_COMPANY_ID): Promise<Connection[]> {
  const memory = [...memoryConnections.values()].filter((item) => item.companyId === companyId);
  if (!isDatabaseConfigured()) return memory;

  const rows = await sql`
    SELECT id, company_id, connector_key, kind, credential_ref, config_json, supports_push, health_json
    FROM connector_connections
    WHERE company_id = ${companyId}
    ORDER BY connector_key ASC, updated_at DESC
  `;
  return rows.map(rowToConnection);
}

export async function getConnectorConnection(id: string): Promise<Connection | null> {
  const memory = memoryConnections.get(id);
  if (memory) return memory;
  if (!isDatabaseConfigured()) return null;

  const rows = await sql`
    SELECT id, company_id, connector_key, kind, credential_ref, config_json, supports_push, health_json
    FROM connector_connections
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows.length ? rowToConnection(rows[0]) : null;
}

export async function updateConnectorHealth(connection: Connection): Promise<Connection> {
  const parsed = ConnectionSchema.parse(connection);
  memoryConnections.set(parsed.id, parsed);

  if (isDatabaseConfigured()) {
    await sql`
      UPDATE connector_connections
      SET health_json = ${JSON.stringify(parsed.health)}, updated_at = NOW()
      WHERE id = ${parsed.id}
    `;
  }
  return parsed;
}

export async function getMappingProfile(connectorKey: string): Promise<MappingProfile | undefined> {
  const definition = (await listConnectorDefinitions()).find((item) => item.key === connectorKey);
  return definition?.mappingProfile;
}

export async function createConnectorResolverDeps(): Promise<ResolverDeps> {
  const definitions = await listConnectorDefinitions();
  const catalogMap = new Map(definitions.map((item) => [item.key, item]));
  return {
    catalog: {
      get(key: string) {
        return catalogMap.get(key);
      },
      all() {
        return [...catalogMap.values()];
      },
    },
    registry: {
      listByCompany(companyId: string) {
        return listCompanyConnectorLinks(companyId);
      },
    },
    connections: {
      get(id: string) {
        return getConnectorConnection(id);
      },
    },
    resolveCredential: async (ref: string) => {
      const key = ref.startsWith("env:") ? ref.slice(4) : ref;
      if (key === "none" || key === "manual") return "";
      if (!/^[A-Z0-9_]+$/.test(key)) {
        throw new Error("Invalid credential reference");
      }
      const value = process.env[key];
      if (!value) throw new Error(`Missing credential env: ${key}`);
      return value;
    },
  };
}

function rowToDefinition(row: Record<string, unknown>): ConnectorDefinition {
  return ConnectorDefinitionSchema.parse({
    key: String(row.key),
    label: String(row.label),
    kind: ConnectionKind.parse(row.kind),
    provides: normalizeCapabilities(asArray(row.provides_json)),
    supportsPush: Boolean(row.supports_push),
    defaultPriority: Number(row.default_priority ?? 100),
    mappingProfile: row.mapping_profile_json ? MappingProfileSchema.parse(asRecord(row.mapping_profile_json)) : undefined,
  });
}

function rowToConnection(row: Record<string, unknown>): Connection {
  const health = asRecord(row.health_json);
  return ConnectionSchema.parse({
    id: String(row.id),
    companyId: String(row.company_id),
    connectorKey: String(row.connector_key),
    kind: ConnectionKind.parse(row.kind),
    credentialRef: String(row.credential_ref),
    config: asRecord(row.config_json),
    supportsPush: Boolean(row.supports_push),
    health: {
      state: HealthState.parse(health.state ?? "unknown") as HealthStateValue,
      lastOkAt: typeof health.lastOkAt === "string" ? health.lastOkAt : null,
      failCount: Number(health.failCount ?? 0),
      checkedAt: typeof health.checkedAt === "string" ? health.checkedAt : null,
    },
  });
}

function rowToCompanyConnector(row: Record<string, unknown>): CompanyConnector {
  return CompanyConnectorSchema.parse({
    companyId: String(row.company_id),
    connectorKey: String(row.connector_key),
    connectionId: String(row.connection_id),
    enabled: Boolean(row.enabled),
    priorityOverride: row.priority_override == null ? null : Number(row.priority_override),
    capabilitiesEnabled: normalizeCapabilities(asArray(row.capabilities_enabled_json)),
  });
}

function normalizeCapabilities(value: unknown): CapabilityValue[] | undefined {
  const items = asArray(value).filter((item): item is string => typeof item === "string");
  if (items.length === 0) return undefined;
  return items.map((item) => Capability.parse(item));
}

function normalizeCredentialRef(value: string): string {
  const ref = value.trim();
  if (ref === "none" || ref === "manual") return ref;
  if (/^env:[A-Z0-9_]+$/.test(ref)) return ref;
  throw new Error("credentialRef must be 'none', 'manual', or an environment reference like env:SLACK_BOT_TOKEN. Raw tokens are not stored.");
}

function companyConnectorKey(value: CompanyConnector) {
  return `${value.companyId}:${value.connectorKey}:${value.connectionId}`;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
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
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}
