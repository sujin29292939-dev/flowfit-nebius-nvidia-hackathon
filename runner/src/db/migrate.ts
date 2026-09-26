// db/migrate.ts
// 실행: tsx src/db/migrate.ts  /  npm run db:migrate
//
// 설계 원칙:
// - schema_migrations 테이블로 버전 관리
// - 각 마이그레이션은 고유 ID + SQL 배열 + 설명
// - 이미 적용된 마이그레이션은 건너뜀 (멱등성)
// - 실패 시 해당 마이그레이션에서 중단

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { neon } from "@neondatabase/serverless";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] ERROR: DATABASE_URL 환경변수가 없습니다.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// @neondatabase/serverless 0.10.x exposes raw SQL execution through sql(query).
// Newer versions also expose sql.unsafe(query), so support both shapes.
const unsafe = (query: string) => {
  const maybeUnsafe = (sql as unknown as { unsafe?: (q: string) => Promise<unknown> }).unsafe;
  return maybeUnsafe ? maybeUnsafe(query) : sql(query);
};

interface Migration {
  id:          string;
  description: string;
  statements:  string[];
}

// ─────────────────────────────────────────────
// 마이그레이션 목록
// ▸ 새 마이그레이션은 배열 끝에만 추가
// ▸ 기존 항목 수정 금지 (이미 적용된 SQL은 불변)
// ─────────────────────────────────────────────
const MIGRATIONS: Migration[] = [
  {
    id:          "001",
    description: "schema_migrations 테이블 생성",
    statements: [`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `],
  },
  {
    id:          "002",
    description: "agent_runs 테이블 생성",
    statements: [`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id           TEXT PRIMARY KEY,
        task         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        result       TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `],
  },
  {
    id:          "003",
    description: "agent_events 테이블 생성 (append-only 이벤트 스트림)",
    statements: [
      `CREATE TABLE IF NOT EXISTS agent_events (
        id             BIGSERIAL PRIMARY KEY,
        run_id         TEXT NOT NULL REFERENCES agent_runs(id),
        event_type     TEXT NOT NULL,
        seq            INT  NOT NULL,
        payload        JSONB NOT NULL,
        is_error       BOOLEAN NOT NULL DEFAULT FALSE,
        offloaded_path TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_events_run_id
         ON agent_events(run_id, seq)`,
    ],
  },
  {
    id:          "004",
    description: "agent_files 테이블 생성",
    statements: [`
      CREATE TABLE IF NOT EXISTS agent_files (
        id         BIGSERIAL PRIMARY KEY,
        run_id     TEXT NOT NULL REFERENCES agent_runs(id),
        path       TEXT NOT NULL,
        size_bytes INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `],
  },

  {
    id: "005",
    description: "companies 테이블 생성",
    statements: [`
      CREATE TABLE IF NOT EXISTS companies (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        industry   TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `],
  },
  {
    id: "006",
    description: "users 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        role       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)`,
    ],
  },
  {
    id: "007",
    description: "employees 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS employees (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        role_name       TEXT,
        contact_channel TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id)`,
    ],
  },
  {
    id: "008",
    description: "customers 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS customers (
        id           TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        contact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        pricing_tier TEXT,
        rules_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_customers_company_id ON customers(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_id, name)`,
    ],
  },
  {
    id: "009",
    description: "items 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS items (
        id           TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        sku          TEXT,
        unit         TEXT,
        base_price   INTEGER,
        rules_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_items_company_id ON items(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_items_company_sku ON items(company_id, sku)`,
    ],
  },
  {
    id: "010",
    description: "inventory 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS inventory (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        quantity        INTEGER NOT NULL DEFAULT 0,
        safety_quantity INTEGER NOT NULL DEFAULT 0,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, item_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_company_id ON inventory(company_id)`,
    ],
  },
  {
    id: "011",
    description: "intakes 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS intakes (
        id                   TEXT PRIMARY KEY,
        company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        source_type          TEXT NOT NULL,
        source_name          TEXT,
        raw_text             TEXT,
        attachment_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
        status               TEXT NOT NULL DEFAULT 'pending',
        received_at          TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_intakes_company_status ON intakes(company_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_intakes_received_at ON intakes(received_at DESC)`,
    ],
  },
  {
    id: "012",
    description: "tasks 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS tasks (
        id                    TEXT PRIMARY KEY,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        intake_id             TEXT REFERENCES intakes(id) ON DELETE SET NULL,
        task_type             TEXT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'pending',
        extracted_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        confidence            REAL,
        risk_level            TEXT NOT NULL DEFAULT 'medium',
        assigned_to           TEXT,
        due_at                TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_intake_id ON tasks(intake_id)`,
    ],
  },
  {
    id: "013",
    description: "workflows 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS workflows (
        id          TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        task_type   TEXT NOT NULL,
        recipe_json JSONB NOT NULL,
        policy_json JSONB NOT NULL,
        status      TEXT NOT NULL DEFAULT 'draft',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_workflows_company_task_type ON workflows(company_id, task_type)`,
    ],
  },
  {
    id: "014",
    description: "tool_runs 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS tool_runs (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        workflow_id     TEXT REFERENCES workflows(id) ON DELETE SET NULL,
        tool_name       TEXT NOT NULL,
        status          TEXT NOT NULL,
        input_json      JSONB,
        output_json     JSONB,
        error_json      JSONB,
        screenshot_path TEXT,
        started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at     TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tool_runs_task_id ON tool_runs(task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_runs_company_started ON tool_runs(company_id, started_at DESC)`,
    ],
  },
  {
    id: "015",
    description: "approval_requests 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS approval_requests (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        options_json    JSONB NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        selected_option TEXT,
        resolved_by     TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS idx_approval_requests_company_status ON approval_requests(company_id, status)`,
    ],
  },
  {
    id: "016",
    description: "rule_memory 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS rule_memory (
        id          TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        scope_type  TEXT NOT NULL,
        scope_id    TEXT,
        rule_text   TEXT NOT NULL,
        rule_json   JSONB,
        confidence  REAL NOT NULL DEFAULT 1.0,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rule_memory_company_scope ON rule_memory(company_id, scope_type, scope_id)`,
      `CREATE INDEX IF NOT EXISTS idx_rule_memory_status ON rule_memory(status)`,
    ],
  },
  {
    id: "017",
    description: "audit_logs 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id            BIGSERIAL PRIMARY KEY,
        company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        actor_type    TEXT NOT NULL,
        actor_id      TEXT,
        action        TEXT NOT NULL,
        target_type   TEXT,
        target_id     TEXT,
        metadata_json JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON audit_logs(company_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id)`,
    ],
  },
  {
    id: "018",
    description: "intakes dedupe_key 추가",
    statements: [
      `ALTER TABLE intakes ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_intakes_company_dedupe
         ON intakes(company_id, dedupe_key)
         WHERE dedupe_key IS NOT NULL`,
    ],
  },
  {
    id: "019",
    description: "site_sessions 암호화 세션 저장소 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS site_sessions (
        id                TEXT PRIMARY KEY,
        company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        site_origin       TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        key_id            TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'active',
        expires_at        TIMESTAMPTZ,
        last_used_at      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, site_origin)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_site_sessions_company_status ON site_sessions(company_id, status)`,
    ],
  },
  {
    id: "020",
    description: "tasks intake_id 중복 변환 방지 인덱스 추가",
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_intake
         ON tasks(intake_id)
         WHERE intake_id IS NOT NULL`,
    ],
  },
  {
    id: "021",
    description: "tasks 회사 맥락 매칭 결과 컬럼 추가",
    statements: [
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS context_json JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS context_status TEXT NOT NULL DEFAULT 'not_matched'`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_company_context_status
         ON tasks(company_id, context_status)`,
    ],
  },
  {
    id: "022",
    description: "connector resolver 저장소 테이블 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS connector_definitions (
        key                  TEXT PRIMARY KEY,
        label                TEXT NOT NULL,
        kind                 TEXT NOT NULL,
        provides_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
        supports_push        BOOLEAN NOT NULL DEFAULT FALSE,
        default_priority     INTEGER NOT NULL DEFAULT 100,
        mapping_profile_json JSONB,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS connector_connections (
        id             TEXT PRIMARY KEY,
        company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        connector_key  TEXT NOT NULL,
        kind           TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        config_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
        supports_push  BOOLEAN NOT NULL DEFAULT FALSE,
        health_json    JSONB NOT NULL DEFAULT '{"state":"unknown","lastOkAt":null,"failCount":0,"checkedAt":null}'::jsonb,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_connector_connections_company
         ON connector_connections(company_id, connector_key)`,
      `CREATE TABLE IF NOT EXISTS company_connectors (
        company_id                TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        connector_key             TEXT NOT NULL,
        connection_id             TEXT NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
        enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
        priority_override         INTEGER,
        capabilities_enabled_json JSONB,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (company_id, connector_key, connection_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_company_connectors_company
         ON company_connectors(company_id, enabled)`,
    ],
  },
  {
    id: "023",
    description: "autonomy gate 일일 자동 발송 한도 저장소 생성",
    statements: [
      `CREATE TABLE IF NOT EXISTS autonomy_daily_usage (
        company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        recipient_key TEXT NOT NULL,
        usage_date    DATE NOT NULL,
        sent_count    INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (company_id, recipient_key, usage_date)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_autonomy_daily_usage_date
         ON autonomy_daily_usage(usage_date DESC)`,
    ],
  },
  {
    id: "024",
    description: "staff_confirmation_requests table",
    statements: [
      `CREATE TABLE IF NOT EXISTS staff_confirmation_requests (
        id                    TEXT PRIMARY KEY,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        ai_work_id            TEXT,
        requested_by_user_id  TEXT,
        requested_by_name     TEXT,
        staff_id              TEXT,
        staff_name            TEXT NOT NULL,
        staff_contact         TEXT,
        channel               TEXT NOT NULL DEFAULT 'manual',
        status                TEXT NOT NULL DEFAULT 'waiting_approval',
        title                 TEXT NOT NULL,
        question              TEXT NOT NULL,
        response_options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        message_preview       TEXT NOT NULL,
        internal_reason       TEXT NOT NULL,
        sent_at               TIMESTAMPTZ,
        responded_at          TIMESTAMPTZ,
        response              TEXT,
        response_memo         TEXT,
        external_message_id   TEXT,
        metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_staff_confirmations_company_status
         ON staff_confirmation_requests(company_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_staff_confirmations_ai_work
         ON staff_confirmation_requests(ai_work_id)`,
      `CREATE INDEX IF NOT EXISTS idx_staff_confirmations_updated
         ON staff_confirmation_requests(updated_at DESC)`,
    ],
  },
  {
    id: "025",
    description: "원격 실행 에이전트: 기기 레지스트리, 기기 토큰, 명령 큐, 페어링 코드",
    statements: [
      // 회사 토큰: 최초 실행 시 입력하는 회사·플랜 귀속 토큰 (해시만 저장)
      `CREATE TABLE IF NOT EXISTS company_tokens (
        id          TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        plan        TEXT NOT NULL DEFAULT 'basic',
        label       TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      // 기기 페어링 코드: 회사 토큰 검증 후 기기 등록용 일회용 코드
      `CREATE TABLE IF NOT EXISTS device_pairing_codes (
        code        TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        label       TEXT,
        max_uses    INTEGER NOT NULL DEFAULT 1,
        use_count   INTEGER NOT NULL DEFAULT 0,
        expires_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at     TIMESTAMPTZ
      )`,
      // 기기 레지스트리: 페어링된 실행 에이전트
      `CREATE TABLE IF NOT EXISTS devices (
        id                 TEXT PRIMARY KEY,
        company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        label              TEXT,
        platform           TEXT,
        agent_version      TEXT,
        capability_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        autonomy_stage     TEXT NOT NULL DEFAULT 'SHADOW',
        status             TEXT NOT NULL DEFAULT 'active',
        operation_mode     TEXT NOT NULL DEFAULT 'ONLINE',
        poll_miss_count    INTEGER NOT NULL DEFAULT 0,
        last_seen_at       TIMESTAMPTZ,
        last_poll_at       TIMESTAMPTZ,
        snapshot_verified_at TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_devices_company_status
         ON devices(company_id, status)`,
      // 기기 토큰: 단기 갱신형, 해시만 저장, 즉시 회수 가능
      `CREATE TABLE IF NOT EXISTS device_tokens (
        id          TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        status      TEXT NOT NULL DEFAULT 'active',
        expires_at  TIMESTAMPTZ NOT NULL,
        revoked_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_device_tokens_device
         ON device_tokens(device_id, status)`,
      // 명령 큐: 승인된 실행 명령. 서명·nonce·TTL·해시 포함
      `CREATE TABLE IF NOT EXISTS device_commands (
        id                 TEXT PRIMARY KEY,
        device_id          TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        task_id            TEXT,
        approval_id        TEXT,
        capability         TEXT NOT NULL,
        idempotency_key    TEXT NOT NULL,
        nonce              TEXT NOT NULL,
        body_hash          TEXT NOT NULL,
        signature          TEXT NOT NULL,
        steps_json         JSONB NOT NULL DEFAULT '[]'::jsonb,
        status             TEXT NOT NULL DEFAULT 'queued',
        expires_at         TIMESTAMPTZ NOT NULL,
        dispatched_at      TIMESTAMPTZ,
        result_status      TEXT,
        result_json        JSONB,
        reported_at        TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_device_commands_idempotency
         ON device_commands(company_id, idempotency_key)`,
      `CREATE INDEX IF NOT EXISTS idx_device_commands_queue
         ON device_commands(device_id, status, created_at)`,
      // 사용된 nonce 기록: 재전송 공격 방지
      `CREATE TABLE IF NOT EXISTS device_command_nonces (
        nonce       TEXT PRIMARY KEY,
        device_id   TEXT NOT NULL,
        used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    ],
  },
  {
    id: "026",
    description: "SHADOW 절차 관찰 수집: 관찰 배치, 절차 후보(사람 승격)",
    statements: [
      // 관찰 배치: SHADOW 단계에서 에이전트가 보낸 사용자 조작 시퀀스(값은 마스킹된 형태만)
      `CREATE TABLE IF NOT EXISTS procedure_observations (
        id           TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        device_id    TEXT NOT NULL,
        capability   TEXT,
        actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        signature    TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_procedure_observations_company
         ON procedure_observations(company_id, capability, created_at DESC)`,
      // 절차 후보: 반복 관찰에서 만들어진 절차. status=candidate는 비활성(사람 승격 필요)
      `CREATE TABLE IF NOT EXISTS procedure_candidates (
        id             TEXT PRIMARY KEY,
        company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        capability     TEXT NOT NULL,
        erp_key        TEXT,
        signature      TEXT NOT NULL,
        steps_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
        observed_count INTEGER NOT NULL DEFAULT 1,
        status         TEXT NOT NULL DEFAULT 'candidate',
        promoted_by    TEXT,
        promoted_at    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_procedure_candidates_sig
         ON procedure_candidates(company_id, capability, signature)`,
    ],
  },
  {
    id: "027",
    description: "approval_requests expires_at TTL",
    statements: [
      `ALTER TABLE approval_requests
         ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS idx_approval_requests_pending_expiry
         ON approval_requests(company_id, status, expires_at)
         WHERE status = 'pending'`,
    ],
  },
  {
    id: "028",
    description: "device operation mode tracking",
    statements: [
      `ALTER TABLE devices
         ADD COLUMN IF NOT EXISTS operation_mode TEXT NOT NULL DEFAULT 'ONLINE'`,
      `ALTER TABLE devices
         ADD COLUMN IF NOT EXISTS poll_miss_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE devices
         ADD COLUMN IF NOT EXISTS last_poll_at TIMESTAMPTZ`,
      `ALTER TABLE devices
         ADD COLUMN IF NOT EXISTS snapshot_verified_at TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS idx_devices_operation_mode
         ON devices(company_id, operation_mode, status)`,
    ],
  },
];

// ─────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────
async function migrate() {
  console.log("[migrate] FlowFit Runner DB 마이그레이션 시작\n");

  // 부트스트랩: schema_migrations 테이블 자체는 직접 생성
  // (이 테이블 없이는 "적용 여부" 조회가 불가)
  await unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  [boot] schema_migrations OK\n");

  // 이미 적용된 ID 조회
  const rows       = await sql`SELECT id FROM schema_migrations ORDER BY id ASC`;
  const appliedIds = new Set(rows.map((r) => r.id as string));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const m of MIGRATIONS) {
    if (appliedIds.has(m.id)) {
      console.log(`  [skip] ${m.id}: ${m.description}`);
      skippedCount++;
      continue;
    }

    console.log(`  [run ] ${m.id}: ${m.description}`);
    try {
      // DDL statements 순차 실행
      for (const stmt of m.statements) {
        await unsafe(stmt);
      }

      // 적용 기록 (파라미터 바인딩으로 안전하게)
      await sql`
        INSERT INTO schema_migrations (id, description)
        VALUES (${m.id}, ${m.description})
      `;

      console.log(`  [done] ${m.id} ✓`);
      appliedCount++;
    } catch (err) {
      console.error(`\n  [FAIL] ${m.id} — 에러:`);
      console.error(`  ${err}\n`);
      process.exit(1);
    }
  }

  console.log(
    `\n[migrate] 완료 — 적용: ${appliedCount}개, 건너뜀: ${skippedCount}개`
  );

  await printStatus();
}

async function printStatus() {
  const rows = await sql`
    SELECT id, description, applied_at
    FROM schema_migrations
    ORDER BY id ASC
  `;
  console.log("\n── 현재 schema_migrations ─────────────────────────────────");
  for (const r of rows) {
    const ts  = new Date(r.applied_at as string).toLocaleString("ko-KR");
    const desc = String(r.description).padEnd(42);
    console.log(`  ${r.id}  ${desc}  ${ts}`);
  }
  console.log("────────────────────────────────────────────────────────────\n");
}

migrate().catch((err) => {
  console.error("[migrate] 예상치 못한 에러:", err);
  process.exit(1);
});
