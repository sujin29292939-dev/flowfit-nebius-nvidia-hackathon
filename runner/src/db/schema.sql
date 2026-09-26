-- db/schema.sql
-- FlowFit Runner: Neon PostgreSQL 스키마

CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,          -- taskId (Studio에서 전달)
  task        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | error
  result      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 이벤트 스트림 영속화: append-only, 절대 UPDATE 없음
CREATE TABLE IF NOT EXISTS agent_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id),
  event_type  TEXT NOT NULL,   -- user_message | tool_call | tool_result | agent_thought | task_complete
  seq         INT  NOT NULL,   -- 이벤트 순서 (0-based)
  payload     JSONB NOT NULL,
  is_error    BOOLEAN NOT NULL DEFAULT FALSE,
  offloaded_path TEXT,         -- 오프로딩된 경우 파일 경로
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_run_id ON agent_events(run_id, seq);

-- 에이전트가 생성한 파일 추적
CREATE TABLE IF NOT EXISTS agent_files (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id),
  path        TEXT NOT NULL,   -- /workspace 기준 상대 경로
  size_bytes  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  industry   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

CREATE TABLE IF NOT EXISTS employees (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  role_name       TEXT,
  contact_channel TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_tier TEXT,
  rules_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_id, name);

CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sku          TEXT,
  unit         TEXT,
  base_price   INTEGER,
  rules_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_company_id ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_items_company_sku ON items(company_id, sku);

CREATE TABLE IF NOT EXISTS inventory (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL DEFAULT 0,
  safety_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_company_id ON inventory(company_id);

CREATE TABLE IF NOT EXISTS intakes (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_type          TEXT NOT NULL,
  source_name          TEXT,
  raw_text             TEXT,
  attachment_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending',
  received_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dedupe_key           TEXT
);
CREATE INDEX IF NOT EXISTS idx_intakes_company_status ON intakes(company_id, status);
CREATE INDEX IF NOT EXISTS idx_intakes_received_at ON intakes(received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intakes_company_dedupe
  ON intakes(company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tasks (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  intake_id             TEXT REFERENCES intakes(id) ON DELETE SET NULL,
  task_type             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  extracted_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_status        TEXT NOT NULL DEFAULT 'not_matched',
  confidence            REAL,
  risk_level            TEXT NOT NULL DEFAULT 'medium',
  assigned_to           TEXT,
  due_at                TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_intake_id ON tasks(intake_id);
CREATE INDEX IF NOT EXISTS idx_tasks_company_context_status ON tasks(company_id, context_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_intake
  ON tasks(intake_id)
  WHERE intake_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  task_type   TEXT NOT NULL,
  recipe_json JSONB NOT NULL,
  policy_json JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflows_company_task_type ON workflows(company_id, task_type);

CREATE TABLE IF NOT EXISTS tool_runs (
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
);
CREATE INDEX IF NOT EXISTS idx_tool_runs_task_id ON tool_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_tool_runs_company_started ON tool_runs(company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
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
  expires_at      TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_company_status ON approval_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_pending_expiry
  ON approval_requests(company_id, status, expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS rule_memory (
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
);
CREATE INDEX IF NOT EXISTS idx_rule_memory_company_scope ON rule_memory(company_id, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_rule_memory_status ON rule_memory(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  metadata_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

CREATE TABLE IF NOT EXISTS site_sessions (
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
);
CREATE INDEX IF NOT EXISTS idx_site_sessions_company_status ON site_sessions(company_id, status);

CREATE TABLE IF NOT EXISTS autonomy_daily_usage (
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_key TEXT NOT NULL,
  usage_date    DATE NOT NULL,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, recipient_key, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_autonomy_daily_usage_date
  ON autonomy_daily_usage(usage_date DESC);

CREATE TABLE IF NOT EXISTS device_pairing_codes (
  code        TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label       TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  use_count   INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label                 TEXT,
  platform              TEXT,
  agent_version         TEXT,
  capability_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  autonomy_stage        TEXT NOT NULL DEFAULT 'SHADOW',
  status                TEXT NOT NULL DEFAULT 'active',
  operation_mode        TEXT NOT NULL DEFAULT 'ONLINE',
  poll_miss_count       INTEGER NOT NULL DEFAULT 0,
  last_seen_at          TIMESTAMPTZ,
  last_poll_at          TIMESTAMPTZ,
  snapshot_verified_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_company_status ON devices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_operation_mode ON devices(company_id, operation_mode, status);

CREATE TABLE IF NOT EXISTS device_tokens (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active',
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id, status);

CREATE TABLE IF NOT EXISTS device_commands (
  id              TEXT PRIMARY KEY,
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id         TEXT,
  approval_id     TEXT,
  capability      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  body_hash       TEXT NOT NULL,
  signature       TEXT NOT NULL,
  steps_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'queued',
  expires_at      TIMESTAMPTZ NOT NULL,
  dispatched_at   TIMESTAMPTZ,
  result_status   TEXT,
  result_json     JSONB,
  reported_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_commands_idempotency
  ON device_commands(company_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_device_commands_queue
  ON device_commands(device_id, status, created_at);

CREATE TABLE IF NOT EXISTS device_command_nonces (
  nonce     TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
