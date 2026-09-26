const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cron = require("node-cron");

const CONFIDENCE_AUTO = 0.9;
const CONFIDENCE_CONFIRM = 0.6;
const CONFIDENCE_HOLD = 0.59;

const SEVERITY_SCORE = {
  P1: 100,
  P2: 60,
  P3: 20,
};

const DEFAULT_PARTNERS = [
  {
    name: "A유통",
    aliases: ["A상사", "에이상사"],
    default_payment_terms_days: 30,
    manager_name: "김유진",
    manager_contact: "010-2222-3333",
    importance: "key",
    memo: "도매 핵심 거래처",
  },
  {
    name: "B거래처",
    aliases: ["B상사", "비거래처"],
    default_payment_terms_days: 45,
    manager_name: "박민서",
    manager_contact: "010-3333-4444",
    importance: "normal",
    memo: "월간 발주 추적 대상",
  },
  {
    name: "한빛상사",
    aliases: ["한빛", "한빛거래처"],
    default_payment_terms_days: 30,
    manager_name: "김유진",
    manager_contact: "010-5555-1111",
    importance: "normal",
    memo: "납기 지연 모니터링",
  },
  {
    name: "미래종합",
    aliases: ["미래종합상사", "미래상사"],
    default_payment_terms_days: 30,
    manager_name: "박민서",
    manager_contact: "010-7777-1212",
    importance: "risky",
    memo: "고액 미수금 주의",
  },
];

const DEFAULT_ITEMS = [
  {
    name: "A제품",
    aliases: ["A품", "에이제품"],
    unit: "개",
    current_price: 10800,
    category: "일반",
  },
  {
    name: "키친타월 24입",
    aliases: ["키친타월", "타월24입"],
    unit: "박스",
    current_price: 19900,
    category: "생활",
  },
  {
    name: "택배 포장재 대형",
    aliases: ["포장재", "대형 포장재"],
    unit: "묶음",
    current_price: 7200,
    category: "포장",
  },
];

function createWholesaleAutomationRuntime({
  sqliteDb,
  storeDir,
  nowIso,
  log,
}) {
  const uploadDir = path.join(storeDir, "uploads");
  const scheduledJobs = [];

  ensureSchema();
  seedReferenceData();
  startCronJobs();

  return {
    constants: {
      CONFIDENCE_AUTO,
      CONFIDENCE_CONFIRM,
      CONFIDENCE_HOLD,
    },
    listCronJobs() {
      return scheduledJobs.map((job) => ({ name: job.name, expression: job.expression }));
    },
    async handleEventsIngest(body) {
      const source = String(body.source || "manual_paste").trim() || "manual_paste";
      const rawEvent = storeRawEvent({
        source,
        sourceDetail: body.source_detail || null,
        rawText: body.raw_text || "",
        createdBy: body.created_by || "user",
        status: "new",
      });

      const parsed = normalizeAndPersistEvent(rawEvent, {
        hintType: body.hint_type || null,
        purpose: body.purpose || null,
      });
      const decision = judgeParsedEvent(parsed);
      const actionTaskIds = routeParsedEvent(parsed, decision);

      logAutomation("capture_engine", source, `raw_event:${rawEvent.id}`, "ingest", "success", "raw_event stored");
      return {
        ok: true,
        raw_event_id: rawEvent.id,
        parsed_event_id: parsed.id,
        action_task_ids: actionTaskIds,
        message: "이벤트가 처리되었습니다.",
      };
    },
    async handleFileUpload({ purpose, fileName, mimeType, buffer, createdBy = "user" }) {
      ensureDir(uploadDir);
      const safeName = `${Date.now()}-${sanitizeFileName(fileName || "upload.bin")}`;
      const filePath = path.join(uploadDir, safeName);
      fs.writeFileSync(filePath, buffer);

      const rawEvent = storeRawEvent({
        source: "file_upload",
        sourceDetail: purpose || "unknown",
        rawText: buffer.toString("utf8"),
        filePath,
        fileName: fileName || safeName,
        mimeType: mimeType || "application/octet-stream",
        createdBy,
        status: "new",
      });

      const parsed = normalizeAndPersistEvent(rawEvent, {
        purpose: purpose || "unknown",
        hintType: purpose === "pricelist" ? "pricelist" : null,
      });
      const decision = judgeParsedEvent(parsed);
      const actionTaskIds = routeParsedEvent(parsed, decision);

      return {
        ok: true,
        raw_event_id: rawEvent.id,
        detected_type: parsed.event_type,
        action_task_ids: actionTaskIds,
      };
    },
    async handleOrdersIngest(body) {
      const partner = findPartnerByName(body.partner_name || "");
      const normalizedItems = Array.isArray(body.items) ? body.items : [];
      const createdOrderIds = [];

      for (const item of normalizedItems) {
        const matchedItem = findItemByName(item.name || "");
        const orderId = insertOrder({
          partnerId: partner?.id || null,
          itemId: matchedItem?.id || null,
          itemNameSnapshot: matchedItem?.name || item.name || "미확인 품목",
          quantity: Number(item.quantity || 0),
          unit: item.unit || matchedItem?.unit || "개",
          amount: Number(item.amount || matchedItem?.current_price || 0) * Number(item.quantity || 0),
          dueDate: body.due_date || null,
          orderDate: currentDateText(),
          status: "registered",
          sourceEventId: body.source_event_id || null,
          confidence: 0.95,
          memo: "직접 발주 등록",
        });
        createdOrderIds.push(orderId);
      }

      const taskId = createActionTask({
        sourceEngine: "order_engine",
        severity: "P2",
        title: `${body.partner_name || "거래처"} 발주 ${createdOrderIds.length}건이 등록되었습니다.`,
        summary: `${normalizedItems.length}개 품목이 발주 목록에 추가되었습니다.`,
        recommendedAction: "납기와 출고 일정을 이어서 확인하세요.",
        buttons: [
          { label: "출고 대기 보기", action: "mark_done", style: "primary" },
          { label: "납기 변경", action: "change_due_date", style: "secondary" },
        ],
        relatedType: "order",
        relatedId: createdOrderIds[0] || null,
        status: "open",
      });

      logAutomation("order_engine", "manual", `orders:${createdOrderIds.join(",")}`, "register", "success", "orders registered");
      return {
        ok: true,
        order_ids: createdOrderIds,
        status: "registered",
        action_task_ids: [taskId],
      };
    },
    async handlePriceListUpload({ fileName, mimeType, buffer, createdBy = "user" }) {
      const response = await this.handleFileUpload({
        purpose: "pricelist",
        fileName,
        mimeType,
        buffer,
        createdBy,
      });

      const changedItems = sqliteDb
        .prepare("SELECT COUNT(*) AS count FROM price_history WHERE source_event_id = ?")
        .get(response.raw_event_id)?.count || 0;
      const highImpactItems = sqliteDb
        .prepare("SELECT COUNT(*) AS count FROM action_task WHERE related_type = 'item' AND status = 'open'")
        .get()?.count || 0;

      return {
        ok: true,
        changed_items: changedItems,
        high_impact_items: highImpactItems,
        action_task_ids: response.action_task_ids,
      };
    },
    async executeActionTask(taskId, body) {
      const task = sqliteDb.prepare("SELECT * FROM action_task WHERE id = ?").get(taskId);
      if (!task) {
        return { ok: false, statusCode: 404, error: "task_not_found" };
      }

      const action = String(body.action || "").trim();
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const result = runTaskAction(task, action, payload);

      return {
        ok: true,
        task_id: taskId,
        new_status: result.status,
        message: result.message,
        payload: result.payload || null,
      };
    },
    getDashboardToday() {
      runDueSoonReceivableScan("manual_dashboard");
      runDeadlineScan("manual_dashboard");

      const topTasks = selectTopActionTasks();
      const summaryRow =
        sqliteDb
          .prepare(`
            SELECT
              SUM(CASE WHEN severity = 'P1' AND status IN ('open', 'pending_confirmation', 'snoozed') THEN 1 ELSE 0 END) AS p1_count,
              SUM(CASE WHEN severity = 'P2' AND status IN ('open', 'pending_confirmation', 'snoozed') THEN 1 ELSE 0 END) AS p2_count,
              SUM(CASE WHEN severity = 'P3' AND status IN ('open', 'pending_confirmation', 'snoozed') THEN 1 ELSE 0 END) AS p3_count,
              SUM(CASE WHEN status IN ('open', 'pending_confirmation', 'snoozed') THEN 1 ELSE 0 END) AS open_tasks
            FROM action_task
          `)
          .get() || {};
      const todayOrders =
        sqliteDb
          .prepare("SELECT COUNT(*) AS count FROM orders WHERE order_date = ?")
          .get(currentDateText())?.count || 0;
      const overdueReceivables =
        sqliteDb
          .prepare("SELECT COUNT(*) AS count FROM receivables WHERE status = 'overdue'")
          .get()?.count || 0;
      const overdueReceivableAmount =
        sqliteDb
          .prepare("SELECT COALESCE(SUM(amount), 0) AS total_amount FROM receivables WHERE status = 'overdue'")
          .get()?.total_amount || 0;
      const deadlineRisks =
        sqliteDb
          .prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'delayed'")
          .get()?.count || 0;
      const pendingPriceChanges =
        sqliteDb
          .prepare("SELECT COUNT(*) AS count FROM action_task WHERE source_engine = 'pricelist_engine' AND status IN ('open', 'pending_confirmation', 'snoozed')")
          .get()?.count || 0;
      const riskyPartners =
        sqliteDb
          .prepare("SELECT COUNT(*) AS count FROM anomaly_log WHERE source_engine = 'partner_health_engine' AND status = 'open'")
          .get()?.count || 0;
      const recentLogs = sqliteDb
        .prepare("SELECT engine_name, trigger_type, action, result, summary, created_at FROM automation_log ORDER BY created_at DESC LIMIT 5")
        .all();
      const lastAutomation = recentLogs[0]?.summary || "아직 자동화 실행 기록이 없습니다.";

      return {
        ok: true,
        summary: {
          p1_count: Number(summaryRow.p1_count || 0),
          p2_count: Number(summaryRow.p2_count || 0),
          p3_count: Number(summaryRow.p3_count || 0),
          open_tasks: Number(summaryRow.open_tasks || 0),
          today_orders: todayOrders,
          overdue_receivables: overdueReceivables,
          deadline_risks: deadlineRisks,
          last_automation: lastAutomation,
        },
        top_tasks: topTasks,
        recent_automation_logs: recentLogs,
        module_summary: {
          orders: {
            today_count: todayOrders,
            delayed_count: deadlineRisks,
          },
          receivables: {
            overdue_count: overdueReceivables,
            total_overdue_amount: overdueReceivableAmount,
          },
          deadlines: {
            d3_count:
              sqliteDb
                .prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'waiting_shipment'")
                .get()?.count || 0,
            overdue_count: deadlineRisks,
          },
          pricelist: {
            pending_changes: pendingPriceChanges,
          },
          partner_health: {
            risky_partners: riskyPartners,
          },
        },
      };
    },
    getOrders() {
      return {
        ok: true,
        rows: listOrdersForUi(),
      };
    },
    getReceivables() {
      return {
        ok: true,
        summary: buildReceivableSummaryForUi(),
        rows: listReceivablesForUi(),
      };
    },
    getPriceHistory() {
      return {
        ok: true,
        rows: listPriceHistoryForUi(),
      };
    },
    getClaims() {
      return {
        ok: true,
        rows: [],
      };
    },
    getPipelineBoard() {
      return {
        ok: true,
        columns: ["견적 요청", "발주 확인", "분납 진행 중", "결제 대기", "정산 완료"],
        cards: listPipelineCardsForUi(),
      };
    },
    getQuoteBuilderData() {
      return {
        ok: true,
        partners: listQuoteBuilderPartnersForUi(),
        products: listQuoteBuilderProductsForUi(),
      };
    },
    runAllCronJobsOnce(triggerType = "manual") {
      runDueSoonReceivableScan(triggerType);
      runDeadlineScan(triggerType);
      runPartnerHealthScan(triggerType);
      runNotificationWorker();
    },
  };

  function ensureSchema() {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS raw_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_detail TEXT,
        raw_text TEXT,
        file_path TEXT,
        file_name TEXT,
        mime_type TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        hash TEXT,
        status TEXT DEFAULT 'new'
      );

      CREATE TABLE IF NOT EXISTS parsed_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_event_id INTEGER,
        event_type TEXT NOT NULL,
        partner_id INTEGER,
        partner_name_guess TEXT,
        confidence REAL DEFAULT 0,
        parsed_json TEXT NOT NULL,
        missing_fields TEXT,
        recommended_route TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'parsed'
      );

      CREATE TABLE IF NOT EXISTS partners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        aliases TEXT,
        default_payment_terms_days INTEGER DEFAULT 30,
        manager_name TEXT,
        manager_contact TEXT,
        importance TEXT DEFAULT 'normal',
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        aliases TEXT,
        unit TEXT DEFAULT '개',
        current_price INTEGER,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id INTEGER,
        item_id INTEGER,
        item_name_snapshot TEXT,
        quantity REAL,
        unit TEXT,
        amount INTEGER,
        due_date DATE,
        order_date DATE DEFAULT CURRENT_DATE,
        status TEXT DEFAULT 'registered',
        source_event_id INTEGER,
        confidence REAL DEFAULT 0,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS receivables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_id INTEGER,
        order_id INTEGER,
        amount INTEGER NOT NULL,
        issue_date DATE,
        due_date DATE,
        paid_date DATE,
        status TEXT DEFAULT 'expected',
        days_overdue INTEGER DEFAULT 0,
        risk_score INTEGER DEFAULT 0,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER,
        old_price INTEGER,
        new_price INTEGER,
        change_rate REAL,
        source_event_id INTEGER,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        applied_by TEXT,
        memo TEXT
      );

      CREATE TABLE IF NOT EXISTS anomaly_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_engine TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        reason TEXT,
        related_partner_id INTEGER,
        related_order_id INTEGER,
        related_receivable_id INTEGER,
        related_item_id INTEGER,
        recommended_action TEXT,
        status TEXT DEFAULT 'open',
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS action_task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_engine TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        recommended_action TEXT,
        buttons_json TEXT NOT NULL,
        related_type TEXT,
        related_id INTEGER,
        status TEXT DEFAULT 'open',
        due_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        recipient TEXT,
        title TEXT,
        message TEXT NOT NULL,
        payload_json TEXT,
        status TEXT DEFAULT 'queued',
        scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS automation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        engine_name TEXT NOT NULL,
        trigger_type TEXT,
        input_ref TEXT,
        action TEXT,
        result TEXT,
        summary TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS learning_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_type TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        context_json TEXT,
        confidence_boost REAL DEFAULT 0.05,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_raw_event_hash ON raw_event(hash);
      CREATE INDEX IF NOT EXISTS idx_action_task_status ON action_task(status, severity, due_at);
      CREATE INDEX IF NOT EXISTS idx_receivables_due_date ON receivables(due_date, status);
      CREATE INDEX IF NOT EXISTS idx_orders_due_date ON orders(due_date, status);
      CREATE INDEX IF NOT EXISTS idx_automation_log_created_at ON automation_log(created_at);
    `);
  }

  function seedReferenceData() {
    return;

    const partnerCount = sqliteDb.prepare("SELECT COUNT(*) AS count FROM partners").get().count;
    if (partnerCount === 0) {
      const insertPartner = sqliteDb.prepare(`
        INSERT INTO partners (
          name, aliases, default_payment_terms_days, manager_name, manager_contact, importance, memo, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const partner of DEFAULT_PARTNERS) {
        insertPartner.run(
          partner.name,
          JSON.stringify(partner.aliases),
          partner.default_payment_terms_days,
          partner.manager_name,
          partner.manager_contact,
          partner.importance,
          partner.memo,
          nowIso(),
        );
      }
    }

    const itemCount = sqliteDb.prepare("SELECT COUNT(*) AS count FROM items").get().count;
    if (itemCount === 0) {
      const insertItem = sqliteDb.prepare(`
        INSERT INTO items (
          name, aliases, unit, current_price, category, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of DEFAULT_ITEMS) {
        insertItem.run(
          item.name,
          JSON.stringify(item.aliases),
          item.unit,
          item.current_price,
          item.category,
          nowIso(),
        );
      }
    }
  }

  function startCronJobs() {
    scheduleJob("receivable_engine_daily", "0 9 * * *", () => runDueSoonReceivableScan("cron"));
    scheduleJob("deadline_engine_daily", "0 8 * * *", () => runDeadlineScan("cron"));
    scheduleJob("partner_health_weekly", "0 8 * * 1", () => runPartnerHealthScan("cron"));
    scheduleJob("notification_worker", "*/1 * * * *", () => runNotificationWorker());
    scheduleJob("automation_log_cleanup", "0 3 * * 0", () => cleanupAutomationLogs());
  }

  function scheduleJob(name, expression, handler) {
    const job = cron.schedule(expression, () => {
      try {
        handler();
      } catch (error) {
        logAutomation(name, "cron", name, "run", "failed", "cron failed", error);
      }
    });
    scheduledJobs.push({ name, expression, job });
  }

  function storeRawEvent({
    source,
    sourceDetail,
    rawText,
    filePath = null,
    fileName = null,
    mimeType = null,
    createdBy = "system",
    status = "new",
  }) {
    const normalizedText = String(rawText || "");
    const hash = crypto
      .createHash("sha1")
      .update([source, sourceDetail || "", normalizedText, fileName || ""].join("|"))
      .digest("hex");

    const duplicate = sqliteDb.prepare("SELECT id FROM raw_event WHERE hash = ? ORDER BY id DESC LIMIT 1").get(hash);
    if (duplicate) {
      sqliteDb.prepare("UPDATE raw_event SET received_at = CURRENT_TIMESTAMP WHERE id = ?").run(duplicate.id);
      return sqliteDb.prepare("SELECT * FROM raw_event WHERE id = ?").get(duplicate.id);
    }

    const info = sqliteDb
      .prepare(`
        INSERT INTO raw_event (
          source, source_detail, raw_text, file_path, file_name, mime_type, created_by, hash, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(source, sourceDetail, normalizedText, filePath, fileName, mimeType, createdBy, hash, status);
    return sqliteDb.prepare("SELECT * FROM raw_event WHERE id = ?").get(info.lastInsertRowid);
  }

  function normalizeAndPersistEvent(rawEvent, options = {}) {
    const normalized = normalizeRawEvent(rawEvent, options);
    const info = sqliteDb
      .prepare(`
        INSERT INTO parsed_event (
          raw_event_id, event_type, partner_id, partner_name_guess, confidence, parsed_json, missing_fields, recommended_route, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        rawEvent.id,
        normalized.event_type,
        normalized.partner?.matched_partner_id || null,
        normalized.partner?.name_guess || null,
        normalized.overall_confidence,
        JSON.stringify(normalized),
        JSON.stringify(normalized.missing_fields || []),
        normalized.recommended_route,
        "parsed",
      );

    return sqliteDb.prepare("SELECT * FROM parsed_event WHERE id = ?").get(info.lastInsertRowid);
  }

  function normalizeRawEvent(rawEvent, options = {}) {
    const text = String(rawEvent.raw_text || "").trim();
    const lower = text.toLowerCase();
    const explicitType = options.hintType || inferEventType(text, rawEvent.source_detail || options.purpose || "");
    const partner = findPartnerMatch(text);
    const guessedPartnerName = guessPartnerName(text);
    const item = findItemMatch(text);
    const quantity = parseQuantity(text);
    const unit = parseUnit(text) || item?.unit || "개";
    const dueDate = parseDueDate(text);
    const amount = parseAmount(text);
    const paymentTermsDays = parsePaymentTermsDays(text) || partner?.default_payment_terms_days || null;
    const missingFields = [];

    if ((explicitType === "order" || explicitType === "purchase_order") && !quantity) {
      missingFields.push("quantity");
    }
    if ((explicitType === "order" || explicitType === "purchase_order") && !dueDate) {
      missingFields.push("due_date");
    }
    if ((explicitType === "receivable" || explicitType === "pricelist") && amount == null && explicitType === "receivable") {
      missingFields.push("amount");
    }

    const partnerConfidence = partner ? partner.confidence : 0.42;
    const itemConfidence = item ? item.confidence : 0.42;
    const structureConfidence = quantity ? 0.95 : dueDate ? 0.75 : 0.58;
    const overallConfidence = Number(
      ((partnerConfidence + itemConfidence + structureConfidence) / 3).toFixed(2),
    );

    let recommendedRoute = "hold_engine";
    if (explicitType === "order" || explicitType === "purchase_order") recommendedRoute = "order_engine";
    if (explicitType === "receivable") recommendedRoute = "receivable_engine";
    if (explicitType === "deadline") recommendedRoute = "deadline_engine";
    if (explicitType === "pricelist") recommendedRoute = "pricelist_engine";
    if (explicitType === "partner_health") recommendedRoute = "partner_health_engine";

    return {
      source: rawEvent.source,
      event_type: explicitType,
      partner: {
        name_guess: guessedPartnerName || partner?.name || "미확인 거래처",
        matched_partner_id: partner?.id || null,
        confidence: partnerConfidence,
      },
      items: item
        ? [
            {
              name_guess: item.name,
              matched_item_id: item.id,
              quantity,
              unit,
              confidence: itemConfidence,
            },
          ]
        : [],
      amount,
      due_date: dueDate,
      payment_terms_days: paymentTermsDays,
      missing_fields: missingFields,
      raw_text: text,
      overall_confidence: overallConfidence,
      recommended_route: recommendedRoute,
      ingest_quality: lower.includes("첨부") ? "attachment_hint" : "text_only",
    };
  }

  function judgeParsedEvent(parsedRow) {
    const parsed = JSON.parse(parsedRow.parsed_json);
    let decision = "hold_for_review";
    if (parsed.overall_confidence >= CONFIDENCE_AUTO) decision = "auto_process";
    if (parsed.overall_confidence >= CONFIDENCE_CONFIRM && parsed.overall_confidence < CONFIDENCE_AUTO) {
      decision = "needs_confirmation";
    }

    let severity = "P3";
    if (parsed.event_type === "order") severity = decision === "auto_process" ? "P2" : "P2";
    if (parsed.event_type === "receivable") severity = "P1";
    if (parsed.event_type === "deadline") severity = "P2";
    if (parsed.event_type === "pricelist") severity = "P2";
    if (parsed.event_type === "partner_health") severity = "P2";

    return {
      decision,
      event_type: parsed.event_type,
      route: parsed.recommended_route,
      confidence: parsed.overall_confidence,
      missing_fields: parsed.missing_fields || [],
      recommended_action: buildRecommendedAction(parsed.event_type, decision),
      severity,
      parsed,
    };
  }

  function routeParsedEvent(parsedRow, decision) {
    switch (decision.route) {
      case "order_engine":
        return handleOrderParsed(parsedRow, decision);
      case "receivable_engine":
        return handleReceivableParsed(parsedRow, decision);
      case "deadline_engine":
        return handleDeadlineParsed(parsedRow, decision);
      case "pricelist_engine":
        return handlePriceListParsed(parsedRow, decision);
      case "partner_health_engine":
        return handlePartnerHealthParsed(parsedRow, decision);
      default:
        return [createHoldTask(parsedRow, decision)];
    }
  }

  function handleOrderParsed(parsedRow, decision) {
    const parsed = decision.parsed;
    const primaryItem = parsed.items[0] || null;
    let orderId = null;

    if (decision.decision === "auto_process") {
      orderId = insertOrder({
        partnerId: parsed.partner.matched_partner_id,
        itemId: primaryItem?.matched_item_id || null,
        itemNameSnapshot: primaryItem?.name_guess || "미확인 품목",
        quantity: primaryItem?.quantity || 0,
        unit: primaryItem?.unit || "개",
        amount: parsed.amount || inferAmountFromItem(primaryItem?.matched_item_id, primaryItem?.quantity || 0),
        dueDate: parsed.due_date,
        orderDate: currentDateText(),
        status: "registered",
        sourceEventId: parsedRow.id,
        confidence: decision.confidence,
        memo: "AI 자동 등록",
      });
    } else if (decision.decision === "needs_confirmation") {
      orderId = insertOrder({
        partnerId: parsed.partner.matched_partner_id,
        itemId: primaryItem?.matched_item_id || null,
        itemNameSnapshot: primaryItem?.name_guess || "미확인 품목",
        quantity: primaryItem?.quantity || 0,
        unit: primaryItem?.unit || "개",
        amount: parsed.amount || inferAmountFromItem(primaryItem?.matched_item_id, primaryItem?.quantity || 0),
        dueDate: parsed.due_date,
        orderDate: currentDateText(),
        status: "draft",
        sourceEventId: parsedRow.id,
        confidence: decision.confidence,
        memo: "확인 후 등록 필요",
      });
    }

    const titlePartner = parsed.partner.name_guess || "거래처";
    const buttons =
      decision.decision === "auto_process"
        ? [
            { label: "처리 완료", action: "mark_done", style: "primary" },
            { label: "납기 변경", action: "change_due_date", style: "secondary" },
          ]
        : decision.decision === "needs_confirmation"
          ? [
              { label: "등록", action: "confirm_register", style: "primary" },
              { label: "수정", action: "edit_before_register", style: "secondary" },
              { label: "무시", action: "ignore", style: "secondary" },
            ]
          : [
              { label: "수정 후 등록", action: "edit_before_register", style: "primary" },
              { label: "무시", action: "ignore", style: "secondary" },
            ];

    const taskId = createActionTask({
      sourceEngine: "order_engine",
      severity: decision.severity,
      title:
        decision.decision === "auto_process"
          ? `${titlePartner} 발주 1건이 자동 등록되었습니다.`
          : `${titlePartner} 발주 1건이 감지되었습니다.`,
      summary: `${primaryItem?.name_guess || "품목"} ${primaryItem?.quantity || 0}${primaryItem?.unit || "개"}, 납기 ${parsed.due_date || "미확인"}로 추정됩니다.`,
      recommendedAction: decision.recommended_action,
      buttons,
      relatedType: decision.decision === "hold_for_review" ? "parsed_event" : "order",
      relatedId: decision.decision === "hold_for_review" ? parsedRow.id : orderId,
      status: decision.decision === "auto_process" ? "open" : decision.decision === "needs_confirmation" ? "pending_confirmation" : "open",
      dueAt: parsed.due_date ? `${parsed.due_date}T09:00:00.000Z` : null,
    });

    logAutomation("order_engine", "parsed_event", `parsed_event:${parsedRow.id}`, "route_order", "success", `발주 확인 카드 ${taskId} 생성`);
    return [taskId];
  }

  function handleReceivableParsed(parsedRow, decision) {
    const parsed = decision.parsed;
    const partnerId = parsed.partner.matched_partner_id;
    const dueDate = parsed.due_date || currentDateText();
    const amount = parsed.amount || 3200000;
    const receivableId = insertReceivable({
      partnerId,
      orderId: null,
      amount,
      issueDate: currentDateText(),
      dueDate,
      status: "expected",
      memo: "수집 이벤트에서 생성",
    });
    const taskId = createReceivableTask(receivableId, {
      titleOverride: `${parsed.partner.name_guess || "거래처"} 미수금 ${formatMoneyLabel(amount)} 지연`,
    });
    logAutomation("receivable_engine", "parsed_event", `parsed_event:${parsedRow.id}`, "route_receivable", "success", `미수금 확인 카드 ${taskId} 생성`);
    return [taskId];
  }

  function handleDeadlineParsed(parsedRow, decision) {
    const parsed = decision.parsed;
    const taskId = createActionTask({
      sourceEngine: "deadline_engine",
      severity: "P2",
      title: `내일 납기 주문 1건이 아직 출고완료가 아닙니다.`,
      summary: `${parsed.partner.name_guess || "거래처"} 주문이 ${parsed.due_date || "미확인"} 납기입니다.`,
      recommendedAction: "담당자에게 출고 상태를 확인하세요.",
      buttons: [
        { label: "담당자 확인", action: "notify_manager", style: "primary" },
        { label: "출고완료 처리", action: "mark_shipped", style: "secondary" },
        { label: "납기 변경", action: "change_due_date", style: "secondary" },
      ],
      relatedType: "parsed_event",
      relatedId: parsedRow.id,
      status: "open",
      dueAt: parsed.due_date ? `${parsed.due_date}T09:00:00.000Z` : null,
    });
    logAutomation("deadline_engine", "parsed_event", `parsed_event:${parsedRow.id}`, "route_deadline", "success", `납기 확인 카드 ${taskId} 생성`);
    return [taskId];
  }

  function handlePriceListParsed(parsedRow, decision) {
    const parsed = decision.parsed;
    const rawEvent = sqliteDb.prepare("SELECT * FROM raw_event WHERE id = ?").get(parsedRow.raw_event_id);
    const rows = parsePriceListRows(rawEvent.raw_text || "");
    const taskIds = [];

    for (const row of rows) {
      const item = findItemByName(row.name);
      if (!item) {
        continue;
      }
      const baselineOldPrice = row.oldPrice || item.current_price || 0;
      const changeRate = baselineOldPrice
        ? Number((((row.newPrice - baselineOldPrice) / baselineOldPrice) * 100).toFixed(0))
        : 0;
      const info = sqliteDb
        .prepare(`
          INSERT INTO price_history (
            item_id, old_price, new_price, change_rate, source_event_id, applied_by, memo
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(item.id, baselineOldPrice, row.newPrice, changeRate, rawEvent.id, "system", "단가표 업로드 감지");

      const severity = changeRate >= 10 ? "P1" : "P2";
      const taskId = createActionTask({
        sourceEngine: "pricelist_engine",
        severity,
        title: `${item.name} 단가가 ${changeRate}% ${changeRate >= 0 ? "상승" : "하락"}했습니다.`,
        summary: `기존 ${formatCurrency(baselineOldPrice)}에서 ${formatCurrency(row.newPrice)}으로 변경되었습니다.`,
        recommendedAction: "적용 여부를 확인하고 거래처 안내문을 생성하세요.",
        buttons: [
          { label: "단가 적용", action: "apply_price_change", style: "primary" },
          { label: "보류", action: "hold_price_change", style: "secondary" },
          { label: "영향 거래처 보기", action: "view_impacted_partners", style: "secondary" },
          { label: "안내문 생성", action: "generate_price_notice", style: "secondary" },
        ],
        relatedType: "item",
        relatedId: item.id,
        status: "open",
      });
      taskIds.push(taskId);
      logAutomation("pricelist_engine", "parsed_event", `price_history:${info.lastInsertRowid}`, "route_pricelist", "success", `단가 변경 카드 ${taskId} 생성`);
    }

    if (taskIds.length === 0) {
      taskIds.push(createHoldTask(parsedRow, decision));
    }
    return taskIds;
  }

  function handlePartnerHealthParsed(parsedRow, decision) {
    const taskId = createActionTask({
      sourceEngine: "partner_health_engine",
      severity: "P2",
      title: `거래처 건강도 판단이 필요합니다.`,
      summary: `발주 감소 또는 미수금 증가 추세를 확인해 주세요.`,
      recommendedAction: "담당자가 거래처 상태를 확인하는 것이 좋습니다.",
      buttons: [
        { label: "담당자 확인", action: "notify_manager", style: "primary" },
        { label: "연락 문구 생성", action: "generate_followup_message", style: "secondary" },
        { label: "주의 거래처 지정", action: "mark_partner_risky", style: "secondary" },
      ],
      relatedType: "parsed_event",
      relatedId: parsedRow.id,
      status: "open",
    });
    logAutomation("partner_health_engine", "parsed_event", `parsed_event:${parsedRow.id}`, "route_partner_health", "success", `거래처 건강 카드 ${taskId} 생성`);
    return [taskId];
  }

  function createHoldTask(parsedRow, decision) {
    const taskId = createActionTask({
      sourceEngine: "hold_engine",
      severity: "P3",
      title: "분류가 필요한 자료가 들어왔습니다.",
      summary: decision.parsed.raw_text || "원본 자료를 확인해 주세요.",
      recommendedAction: "자료 유형과 핵심 정보를 한 번 더 확인하세요.",
      buttons: [
        { label: "수정 후 등록", action: "edit_before_register", style: "primary" },
        { label: "무시", action: "ignore", style: "secondary" },
      ],
      relatedType: "parsed_event",
      relatedId: parsedRow.id,
      status: "open",
    });
    logAutomation("hold_engine", "parsed_event", `parsed_event:${parsedRow.id}`, "route_hold", "skipped", `분류 보류 카드 ${taskId} 생성`);
    return taskId;
  }

  function createActionTask({
    sourceEngine,
    severity,
    title,
    summary,
    recommendedAction,
    buttons,
    relatedType,
    relatedId,
    status,
    dueAt = null,
  }) {
    const info = sqliteDb
      .prepare(`
        INSERT INTO action_task (
          source_engine, severity, title, summary, recommended_action, buttons_json, related_type, related_id, status, due_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        sourceEngine,
        severity,
        title,
        summary,
        recommendedAction,
        JSON.stringify(buttons),
        relatedType || null,
        relatedId || null,
        status || "open",
        dueAt,
        nowIso(),
      );
    return Number(info.lastInsertRowid);
  }

  function insertOrder({
    partnerId,
    itemId,
    itemNameSnapshot,
    quantity,
    unit,
    amount,
    dueDate,
    orderDate,
    status,
    sourceEventId,
    confidence,
    memo,
  }) {
    const info = sqliteDb
      .prepare(`
        INSERT INTO orders (
          partner_id, item_id, item_name_snapshot, quantity, unit, amount, due_date, order_date, status, source_event_id, confidence, memo, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        partnerId,
        itemId,
        itemNameSnapshot,
        quantity,
        unit,
        amount,
        dueDate,
        orderDate,
        status,
        sourceEventId,
        confidence,
        memo,
        nowIso(),
      );
    return Number(info.lastInsertRowid);
  }

  function insertReceivable({
    partnerId,
    orderId,
    amount,
    issueDate,
    dueDate,
    status,
    memo,
  }) {
    const info = sqliteDb
      .prepare(`
        INSERT INTO receivables (
          partner_id, order_id, amount, issue_date, due_date, status, memo, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(partnerId, orderId, amount, issueDate, dueDate, status, memo, nowIso());
    return Number(info.lastInsertRowid);
  }

  function createReceivableTask(receivableId, options = {}) {
    const receivable = sqliteDb.prepare("SELECT * FROM receivables WHERE id = ?").get(receivableId);
    const partner = receivable?.partner_id ? sqliteDb.prepare("SELECT * FROM partners WHERE id = ?").get(receivable.partner_id) : null;
    if (!receivable) {
      return null;
    }

    const evaluation = evaluateReceivable(receivable, partner);
    sqliteDb
      .prepare("UPDATE receivables SET days_overdue = ?, risk_score = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(evaluation.daysOverdue, evaluation.priorityScore, evaluation.status, nowIso(), receivableId);

    createAnomaly({
      sourceEngine: "receivable_engine",
      severity: evaluation.severity,
      title: options.titleOverride || `${partner?.name || "거래처"} 미수금 ${formatMoneyLabel(receivable.amount)} 지연`,
      summary: `${partner?.default_payment_terms_days || 30}일 결제조건보다 ${evaluation.daysOverdue}일 늦었습니다.`,
      reason: "고액 미수금 또는 지연 일수 기준 충족",
      relatedPartnerId: partner?.id || null,
      relatedReceivableId: receivableId,
      recommendedAction: "담당자에게 먼저 확인 요청하세요.",
    });

    return createActionTask({
      sourceEngine: "receivable_engine",
      severity: evaluation.severity,
      title: options.titleOverride || `${partner?.name || "거래처"} 미수금 ${formatMoneyLabel(receivable.amount)} 지연`,
      summary: `결제조건보다 ${evaluation.daysOverdue}일 늦었습니다.`,
      recommendedAction: "담당자에게 먼저 확인 요청하세요.",
      buttons: [
        { label: "담당자에게 알림", action: "notify_manager", style: "primary" },
        { label: "거래처 안내문 생성", action: "generate_partner_message", style: "secondary" },
        { label: "입금 완료 처리", action: "mark_paid", style: "secondary" },
        { label: "3일 뒤 다시 보기", action: "snooze_3_days", style: "secondary" },
      ],
      relatedType: "receivable",
      relatedId: receivableId,
      status: "open",
      dueAt: nowIso(),
    });
  }

  function createAnomaly({
    sourceEngine,
    severity,
    title,
    summary,
    reason,
    relatedPartnerId = null,
    relatedOrderId = null,
    relatedReceivableId = null,
    relatedItemId = null,
    recommendedAction = null,
  }) {
    sqliteDb
      .prepare(`
        INSERT INTO anomaly_log (
          source_engine, severity, title, summary, reason,
          related_partner_id, related_order_id, related_receivable_id, related_item_id,
          recommended_action, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
      `)
      .run(
        sourceEngine,
        severity,
        title,
        summary,
        reason,
        relatedPartnerId,
        relatedOrderId,
        relatedReceivableId,
        relatedItemId,
        recommendedAction,
      );
  }

  function runDueSoonReceivableScan(triggerType) {
    const rows = sqliteDb.prepare("SELECT * FROM receivables WHERE status != 'paid'").all();
    for (const row of rows) {
      const partner = row.partner_id ? sqliteDb.prepare("SELECT * FROM partners WHERE id = ?").get(row.partner_id) : null;
      const evaluation = evaluateReceivable(row, partner);
      sqliteDb
        .prepare("UPDATE receivables SET days_overdue = ?, risk_score = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(evaluation.daysOverdue, evaluation.priorityScore, evaluation.status, nowIso(), row.id);

      if (evaluation.severity === "P1" || evaluation.severity === "P2") {
        const duplicate = sqliteDb
          .prepare("SELECT id FROM action_task WHERE source_engine = 'receivable_engine' AND related_type = 'receivable' AND related_id = ? AND status IN ('open', 'pending_confirmation', 'snoozed') ORDER BY id DESC LIMIT 1")
          .get(row.id);
        if (!duplicate) {
          createReceivableTask(row.id);
        }
      }
    }
    logAutomation("receivable_engine", triggerType, "receivables", "scan", "success", "미수금 위험 점검 완료");
  }

  function runDeadlineScan(triggerType) {
    const rows = sqliteDb.prepare("SELECT * FROM orders WHERE status != 'completed' AND status != 'cancelled'").all();
    for (const row of rows) {
      if (!row.due_date) continue;
      const delta = diffDaysFromToday(row.due_date);
      let nextStatus = row.status;
      let severity = null;
      let title = null;

      if (delta >= 1 && row.status !== "shipped" && row.status !== "completed") {
        nextStatus = "delayed";
        severity = "P1";
        title = `${row.item_name_snapshot} 주문이 납기 초과 상태입니다.`;
      } else if (delta === -1 && row.status !== "shipped" && row.status !== "completed") {
        nextStatus = "waiting_shipment";
        severity = "P2";
        title = `내일 납기 주문 1건이 아직 출고완료가 아닙니다.`;
      } else if (delta === 0 && row.status !== "shipped" && row.status !== "completed") {
        nextStatus = "waiting_shipment";
        severity = "P1";
        title = `오늘 납기 주문 1건이 아직 출고완료가 아닙니다.`;
      } else if (delta === -3 && row.status === "registered") {
        nextStatus = "waiting_shipment";
        severity = "P2";
        title = `납기 3일 전 주문이 있습니다.`;
      }

      sqliteDb.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(nextStatus, nowIso(), row.id);

      if (severity && title) {
        const duplicate = sqliteDb
          .prepare("SELECT id FROM action_task WHERE source_engine = 'deadline_engine' AND related_type = 'order' AND related_id = ? AND status IN ('open', 'pending_confirmation', 'snoozed') ORDER BY id DESC LIMIT 1")
          .get(row.id);
        if (!duplicate) {
          const partner = row.partner_id ? sqliteDb.prepare("SELECT * FROM partners WHERE id = ?").get(row.partner_id) : null;
          createAnomaly({
            sourceEngine: "deadline_engine",
            severity,
            title,
            summary: `${partner?.name || "거래처"} ${row.item_name_snapshot} 주문이 ${row.due_date} 납기입니다.`,
            reason: "납기 기준 경고",
            relatedPartnerId: partner?.id || null,
            relatedOrderId: row.id,
            recommendedAction: "담당자에게 출고 상태를 확인하세요.",
          });
          createActionTask({
            sourceEngine: "deadline_engine",
            severity,
            title,
            summary: `${partner?.name || "거래처"} ${row.item_name_snapshot} 주문이 ${row.due_date} 납기입니다.`,
            recommendedAction: "담당자에게 출고 상태를 확인하세요.",
            buttons: [
              { label: "담당자 확인", action: "notify_manager", style: "primary" },
              { label: "출고완료 처리", action: "mark_shipped", style: "secondary" },
              { label: "납기 변경", action: "change_due_date", style: "secondary" },
            ],
            relatedType: "order",
            relatedId: row.id,
            status: "open",
            dueAt: `${row.due_date}T09:00:00.000Z`,
          });
        }
      }
    }
    logAutomation("deadline_engine", triggerType, "orders", "scan", "success", "납기 위험 점검 완료");
  }

  function runPartnerHealthScan(triggerType) {
    const partners = sqliteDb.prepare("SELECT * FROM partners").all();
    for (const partner of partners) {
      const currentMonthOrders = sqliteDb
        .prepare("SELECT COALESCE(SUM(amount), 0) AS total_amount FROM orders WHERE partner_id = ? AND substr(order_date, 1, 7) = ?")
        .get(partner.id, currentMonthText())?.total_amount || 0;
      const previousMonthOrders = sqliteDb
        .prepare("SELECT COALESCE(SUM(amount), 0) AS total_amount FROM orders WHERE partner_id = ? AND substr(order_date, 1, 7) = ?")
        .get(partner.id, previousMonthText())?.total_amount || 0;
      const delayedReceivables = sqliteDb
        .prepare("SELECT COUNT(*) AS count FROM receivables WHERE partner_id = ? AND days_overdue >= 1")
        .get(partner.id)?.count || 0;

      let healthScore = 100;
      let dropRate = 0;
      if (previousMonthOrders > 0) {
        dropRate = Number((((previousMonthOrders - currentMonthOrders) / previousMonthOrders) * 100).toFixed(0));
      }
      if (dropRate >= 50) healthScore -= 40;
      else if (dropRate >= 30) healthScore -= 25;
      if (delayedReceivables >= 2) healthScore -= 20;
      if (partner.importance === "key") healthScore -= 20;

      if (healthScore <= 70 && dropRate >= 30) {
        const severity = healthScore <= 50 ? "P1" : "P2";
        const duplicate = sqliteDb
          .prepare("SELECT id FROM action_task WHERE source_engine = 'partner_health_engine' AND related_type = 'partner' AND related_id = ? AND status IN ('open', 'pending_confirmation', 'snoozed') ORDER BY id DESC LIMIT 1")
          .get(partner.id);
        if (!duplicate) {
          createAnomaly({
            sourceEngine: "partner_health_engine",
            severity,
            title: `${partner.name} 발주가 전월 대비 ${dropRate}% 감소했습니다.`,
            summary: `최근 발주액이 ${formatCurrency(previousMonthOrders)}에서 ${formatCurrency(currentMonthOrders)}로 줄었습니다.`,
            reason: "발주 감소율 및 거래처 건강도 기준",
            relatedPartnerId: partner.id,
            recommendedAction: "담당자가 거래처 상황을 확인하는 것이 좋습니다.",
          });
          createActionTask({
            sourceEngine: "partner_health_engine",
            severity,
            title: `${partner.name} 발주가 전월 대비 ${dropRate}% 감소했습니다.`,
            summary: `최근 30일 발주액이 ${formatCurrency(previousMonthOrders)}에서 ${formatCurrency(currentMonthOrders)}로 줄었습니다.`,
            recommendedAction: "담당자가 거래처 상황을 확인하는 것이 좋습니다.",
            buttons: [
              { label: "담당자 확인", action: "notify_manager", style: "primary" },
              { label: "연락 문구 생성", action: "generate_followup_message", style: "secondary" },
              { label: "주의 거래처 지정", action: "mark_partner_risky", style: "secondary" },
              { label: "무시", action: "ignore", style: "secondary" },
            ],
            relatedType: "partner",
            relatedId: partner.id,
            status: "open",
          });
        }
      }
    }
    logAutomation("partner_health_engine", triggerType, "partners", "scan", "success", "거래처 건강 점검 완료");
  }

  function runNotificationWorker() {
    const notifications = sqliteDb
      .prepare("SELECT * FROM notifications WHERE status = 'queued' AND scheduled_at <= CURRENT_TIMESTAMP ORDER BY id ASC LIMIT 20")
      .all();

    for (const notification of notifications) {
      let resultStatus = "sent";
      let errorMessage = null;

      try {
        if (notification.channel === "telegram") {
          resultStatus = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? "sent" : "sent";
        }
      } catch (error) {
        resultStatus = "failed";
        errorMessage = error instanceof Error ? error.message : "notification_send_failed";
      }

      sqliteDb
        .prepare("UPDATE notifications SET status = ?, sent_at = ?, payload_json = COALESCE(payload_json, ?) WHERE id = ?")
        .run(resultStatus, nowIso(), JSON.stringify({ mode: "mock" }), notification.id);

      logAutomation(
        "notification_worker",
        notification.channel,
        `notification:${notification.id}`,
        "send",
        resultStatus === "sent" ? "success" : "failed",
        notification.title || notification.message,
        errorMessage,
      );
    }
  }

  function cleanupAutomationLogs() {
    sqliteDb
      .prepare("DELETE FROM automation_log WHERE created_at < datetime('now', '-90 days')")
      .run();
    logAutomation("logging_engine", "cron", "automation_log", "cleanup", "success", "오래된 자동화 로그 정리 완료");
  }

  function runTaskAction(task, action, payload) {
    switch (action) {
      case "confirm_register":
        return confirmRegisterTask(task);
      case "edit_before_register":
        updateTaskStatus(task.id, "pending_confirmation");
        return { status: "pending_confirmation", message: "수정 화면으로 보낼 준비가 되었습니다." };
      case "ignore":
        updateTaskStatus(task.id, "ignored");
        insertLearningMemory("ignored_rule", task.title, action, { task_id: task.id, source_engine: task.source_engine });
        return { status: "ignored", message: "이 카드는 무시 처리되었습니다." };
      case "notify_manager":
        queueNotification("dashboard", resolveTaskRecipient(task), task.title, `${task.summary}\n권장 조치: ${task.recommended_action}`, {
          task_id: task.id,
          action,
        });
        updateTaskStatus(task.id, "done");
        return { status: "done", message: "담당자 알림이 생성되었습니다." };
      case "generate_partner_message":
        updateTaskStatus(task.id, "done");
        return {
          status: "done",
          message: "거래처 안내문 초안을 만들었습니다.",
          payload: {
            draft_message: buildPartnerMessage(task),
          },
        };
      case "mark_paid":
        if (task.related_type === "receivable") {
          sqliteDb
            .prepare("UPDATE receivables SET status = 'paid', paid_date = ?, updated_at = ? WHERE id = ?")
            .run(currentDateText(), nowIso(), task.related_id);
        }
        updateTaskStatus(task.id, "done");
        return { status: "done", message: "입금 완료 처리되었습니다." };
      case "mark_shipped":
        if (task.related_type === "order") {
          sqliteDb.prepare("UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ?").run(nowIso(), task.related_id);
        }
        updateTaskStatus(task.id, "done");
        return { status: "done", message: "출고완료 처리되었습니다." };
      case "change_due_date":
        if (task.related_type === "order" && payload.due_date) {
          sqliteDb.prepare("UPDATE orders SET due_date = ?, updated_at = ? WHERE id = ?").run(payload.due_date, nowIso(), task.related_id);
          insertLearningMemory("payment_term_override", "due_date", payload.due_date, { task_id: task.id, related_id: task.related_id });
          updateTaskStatus(task.id, "done");
          return { status: "done", message: "납기 변경이 반영되었습니다." };
        }
        updateTaskStatus(task.id, "pending_confirmation");
        return { status: "pending_confirmation", message: "납기 변경 정보 입력이 필요합니다." };
      case "snooze_3_days":
        sqliteDb.prepare("UPDATE action_task SET status = 'snoozed', due_at = datetime('now', '+3 days'), updated_at = ? WHERE id = ?").run(nowIso(), task.id);
        return { status: "snoozed", message: "3일 뒤 다시 보도록 미뤘습니다." };
      case "apply_price_change":
        if (task.related_type === "item") {
          const latestChange = sqliteDb
            .prepare("SELECT * FROM price_history WHERE item_id = ? ORDER BY id DESC LIMIT 1")
            .get(task.related_id);
          if (latestChange) {
            sqliteDb.prepare("UPDATE items SET current_price = ?, updated_at = ? WHERE id = ?").run(latestChange.new_price, nowIso(), task.related_id);
          }
        }
        updateTaskStatus(task.id, "done");
        return { status: "done", message: "단가 변경이 적용되었습니다." };
      case "hold_price_change":
        sqliteDb.prepare("UPDATE action_task SET status = 'snoozed', due_at = datetime('now', '+3 days'), updated_at = ? WHERE id = ?").run(nowIso(), task.id);
        return { status: "snoozed", message: "단가 변경을 보류했습니다." };
      case "view_impacted_partners":
        return {
          status: task.status,
          message: "영향 거래처 목록을 반환합니다.",
          payload: {
            impacted_partners: sqliteDb.prepare("SELECT name FROM partners ORDER BY name ASC LIMIT 12").all(),
          },
        };
      case "generate_price_notice":
        return {
          status: task.status,
          message: "단가 안내문 초안을 만들었습니다.",
          payload: {
            draft_message: `${task.title}\n${task.summary}\n적용 일정과 거래처 안내 여부를 확인해 주세요.`,
          },
        };
      case "mark_partner_risky":
        if (task.related_type === "partner") {
          sqliteDb.prepare("UPDATE partners SET importance = 'risky', updated_at = ? WHERE id = ?").run(nowIso(), task.related_id);
        }
        updateTaskStatus(task.id, "done");
        return { status: "done", message: "주의 거래처로 표시했습니다." };
      case "generate_followup_message":
        return {
          status: task.status,
          message: "거래처 연락 문구 초안을 만들었습니다.",
          payload: {
            draft_message: `안녕하세요. 최근 발주 흐름과 결제 일정을 함께 점검드리고 싶습니다. 편한 시간 알려주시면 바로 맞추겠습니다.`,
          },
        };
      case "mark_done":
        updateTaskStatus(task.id, "done");
        return { status: "done", message: "처리 완료로 표시했습니다." };
      default:
        updateTaskStatus(task.id, "failed");
        return { status: "failed", message: "지원하지 않는 액션입니다." };
    }
  }

  function confirmRegisterTask(task) {
    if (task.related_type === "order") {
      sqliteDb.prepare("UPDATE orders SET status = 'registered', updated_at = ? WHERE id = ?").run(nowIso(), task.related_id);
      updateTaskStatus(task.id, "done");
      return { status: "done", message: "발주가 등록되었습니다." };
    }

    if (task.related_type === "parsed_event") {
      const parsedRow = sqliteDb.prepare("SELECT * FROM parsed_event WHERE id = ?").get(task.related_id);
      if (!parsedRow) {
        updateTaskStatus(task.id, "failed");
        return { status: "failed", message: "원본 후보를 찾을 수 없습니다." };
      }
      const parsed = JSON.parse(parsedRow.parsed_json);
      const primaryItem = parsed.items[0] || null;
      const orderId = insertOrder({
        partnerId: parsed.partner.matched_partner_id,
        itemId: primaryItem?.matched_item_id || null,
        itemNameSnapshot: primaryItem?.name_guess || "미확인 품목",
        quantity: primaryItem?.quantity || 0,
        unit: primaryItem?.unit || "개",
        amount: parsed.amount || inferAmountFromItem(primaryItem?.matched_item_id, primaryItem?.quantity || 0),
        dueDate: parsed.due_date,
        orderDate: currentDateText(),
        status: "registered",
        sourceEventId: parsedRow.id,
        confidence: parsed.overall_confidence || 0.8,
        memo: "확인 후 등록",
      });
      sqliteDb.prepare("UPDATE action_task SET related_type = 'order', related_id = ?, updated_at = ? WHERE id = ?").run(orderId, nowIso(), task.id);
      updateTaskStatus(task.id, "done");
      return { status: "done", message: "후보 발주가 실제 발주로 등록되었습니다." };
    }

    updateTaskStatus(task.id, "failed");
    return { status: "failed", message: "등록할 대상이 없습니다." };
  }

  function selectTopActionTasks() {
    const tasks = sqliteDb
      .prepare("SELECT * FROM action_task WHERE status IN ('open', 'pending_confirmation', 'snoozed') ORDER BY created_at DESC LIMIT 50")
      .all()
      .map((task) => {
        const relatedAmount = resolveRelatedAmount(task);
        const relatedPartner = resolveRelatedPartner(task);
        const confidence = resolveRelatedConfidence(task);
        const priorityScore = computePriorityScore({
          severity: task.severity,
          amount: relatedAmount,
          dueAt: task.due_at,
          partnerImportance: relatedPartner?.importance || "normal",
          confidence,
        });
        return {
          id: task.id,
          severity: task.severity,
          title: task.title,
          summary: task.summary,
          recommended_action: task.recommended_action,
          reason: buildPriorityReason(task, relatedAmount, relatedPartner),
          buttons: JSON.parse(task.buttons_json || "[]"),
          created_at: task.created_at,
          status: task.status,
          priority_score: priorityScore,
        };
      })
      .sort((left, right) => right.priority_score - left.priority_score);

    return tasks.slice(0, 3);
  }

  function listOrdersForUi() {
    return sqliteDb
      .prepare(`
        SELECT
          orders.id,
          orders.partner_id,
          COALESCE(partners.name, '미확인 거래처') AS partner_name,
          orders.item_name_snapshot,
          orders.quantity,
          orders.unit,
          orders.amount,
          orders.order_date,
          orders.due_date,
          orders.status,
          COALESCE(raw_event.source, 'manual_paste') AS source
        FROM orders
        LEFT JOIN partners ON partners.id = orders.partner_id
        LEFT JOIN raw_event ON raw_event.id = orders.source_event_id
        ORDER BY COALESCE(orders.updated_at, orders.created_at) DESC, orders.id DESC
      `)
      .all()
      .map((row) => ({
        id: row.id,
        partner_id: row.partner_id,
        partner_name: row.partner_name,
        items: [
          `${row.item_name_snapshot || "품목"} ${formatQuantity(row.quantity)}${row.unit || ""}`.trim(),
        ],
        total_amount: Number(row.amount || 0),
        order_date: row.order_date,
        due_date: row.due_date,
        status: row.status,
        source: row.source,
      }));
  }

  function buildReceivableSummaryForUi() {
    const rows = sqliteDb
      .prepare(`
        SELECT amount, days_overdue, status
        FROM receivables
        WHERE status != 'paid'
      `)
      .all();

    return rows.reduce(
      (summary, row) => {
        const amount = Number(row.amount || 0);
        const overdue = Number(row.days_overdue || 0);
        summary.total += amount;
        if (overdue >= 30) summary.over30 += amount;
        if (overdue >= 60) summary.over60 += amount;
        return summary;
      },
      { total: 0, over30: 0, over60: 0 },
    );
  }

  function listReceivablesForUi() {
    return sqliteDb
      .prepare(`
        SELECT
          receivables.id,
          receivables.partner_id,
          COALESCE(partners.name, '미확인 거래처') AS partner_name,
          receivables.amount,
          receivables.issue_date,
          receivables.due_date,
          receivables.paid_date,
          receivables.status,
          receivables.days_overdue
        FROM receivables
        LEFT JOIN partners ON partners.id = receivables.partner_id
        ORDER BY COALESCE(receivables.updated_at, receivables.created_at) DESC, receivables.id DESC
      `)
      .all()
      .map((row) => ({
        id: row.id,
        partner_id: row.partner_id,
        partner_name: row.partner_name,
        invoice_id: `AR-${String(row.id).padStart(4, "0")}`,
        amount: Number(row.amount || 0),
        issue_date: row.issue_date,
        due_date: row.due_date,
        paid_date: row.paid_date,
        status: row.status,
        overdue_days: Number(row.days_overdue || 0),
      }));
  }

  function listPriceHistoryForUi() {
    return sqliteDb
      .prepare(`
        SELECT
          price_history.id,
          price_history.item_id,
          COALESCE(items.name, '미확인 품목') AS item_name,
          price_history.old_price,
          price_history.new_price,
          price_history.change_rate,
          price_history.changed_at
        FROM price_history
        LEFT JOIN items ON items.id = price_history.item_id
        ORDER BY price_history.changed_at DESC, price_history.id DESC
      `)
      .all()
      .map((row) => {
        const impactedRows = sqliteDb
          .prepare(`
            SELECT DISTINCT COALESCE(partners.name, '미확인 거래처') AS partner_name
            FROM orders
            LEFT JOIN partners ON partners.id = orders.partner_id
            WHERE orders.item_id = ?
          `)
          .all(row.item_id);
        const averageMonthlyVolume =
          sqliteDb
            .prepare(`
              SELECT COALESCE(SUM(quantity), 0) AS total_quantity
              FROM orders
              WHERE item_id = ?
                AND date(order_date) >= date('now', '-30 days')
            `)
            .get(row.item_id)?.total_quantity || 0;
        const delta = Number(row.new_price || 0) - Number(row.old_price || 0);

        return {
          id: row.id,
          item_id: row.item_id,
          item_code: `ITEM-${String(row.item_id || row.id).padStart(3, "0")}`,
          item_name: row.item_name,
          old_price: Number(row.old_price || 0),
          new_price: Number(row.new_price || 0),
          change_rate: Number(row.change_rate || 0),
          affected_partner_names: impactedRows.map((item) => item.partner_name),
          average_monthly_volume: Number(averageMonthlyVolume || 0),
          expected_monthly_delta: delta * Number(averageMonthlyVolume || 0),
          changed_at: row.changed_at,
        };
      });
  }

  function listPipelineCardsForUi() {
    return sqliteDb
      .prepare(`
        SELECT
          orders.id,
          orders.partner_id,
          orders.item_name_snapshot,
          orders.quantity,
          orders.unit,
          orders.amount,
          orders.order_date,
          orders.due_date,
          orders.status,
          COALESCE(partners.name, '미확인 거래처') AS partner_name,
          COALESCE(partners.manager_name, '미지정') AS manager_name,
          COALESCE(partners.default_payment_terms_days, 0) AS payment_terms_days,
          COALESCE(partners.importance, 'normal') AS importance
        FROM orders
        LEFT JOIN partners ON partners.id = orders.partner_id
        ORDER BY COALESCE(orders.updated_at, orders.created_at) DESC, orders.id DESC
      `)
      .all()
      .map((row) => {
        const receivable = sqliteDb
          .prepare(`
            SELECT amount, days_overdue
            FROM receivables
            WHERE partner_id = ?
              AND status != 'paid'
            ORDER BY days_overdue DESC, id DESC
            LIMIT 1
          `)
          .get(row.partner_id);
        const dDay = row.due_date ? diffDaysFromToday(row.due_date) : 0;
        const stage = mapOrderStatusToPipelineStage(row.status);
        const managerName = row.manager_name || "미지정";
        const orderLabel = `${row.item_name_snapshot || "품목"} ${formatQuantity(row.quantity)}${row.unit || ""}`.trim();
        const receivableAmount = Number(receivable?.amount || 0);
        const receivableOverdueDays = Number(receivable?.days_overdue || 0);

        return {
          id: `pipeline-${row.id}`,
          partnerId: String(row.partner_id || ""),
          partnerName: row.partner_name,
          orderId: `PO-${String(row.id).padStart(4, "0")}`,
          title: orderLabel,
          stage,
          totalAmount: Number(row.amount || 0),
          dueDate: row.due_date || "",
          dDay,
          managerName,
          managerInitials: buildInitials(managerName),
          receivableAmount,
          receivableOverdueDays,
          priceVersion: "실데이터",
          paymentTerms: row.payment_terms_days ? `발행 후 ${row.payment_terms_days}일` : "미설정",
          splitSchedule: row.due_date ? `납기 ${row.due_date}` : "미정",
          aiInsight: buildPipelineInsight(row.status, dDay, receivableAmount, receivableOverdueDays),
          lastContactDays: 0,
          idleDays: row.order_date ? Math.max(diffDaysFromToday(row.order_date) * -1, 0) : 0,
          timeline: buildPipelineTimeline(row, receivableAmount, receivableOverdueDays),
        };
      });
  }

  function listQuoteBuilderPartnersForUi() {
    return sqliteDb
      .prepare(`
        SELECT id, name, default_payment_terms_days, manager_name
        FROM partners
        ORDER BY updated_at DESC, id DESC
      `)
      .all()
      .map((row) => ({
        id: String(row.id),
        name: row.name,
        paymentTerms: row.default_payment_terms_days ? `발행 후 ${row.default_payment_terms_days}일` : "미설정",
        returnPolicy: "반품 정책 미연동",
        manager: row.manager_name || "미지정",
        preferredPriceVersion: "실데이터",
        recommendedItems: [],
      }));
  }

  function listQuoteBuilderProductsForUi() {
    return sqliteDb
      .prepare(`
        SELECT id, name, current_price, unit
        FROM items
        ORDER BY updated_at DESC, id DESC
      `)
      .all()
      .map((row) => ({
        id: String(row.id),
        itemCode: `ITEM-${String(row.id).padStart(3, "0")}`,
        itemName: row.name,
        unitPrice: Number(row.current_price || 0),
        unit: row.unit || "개",
        vatIncluded: false,
      }));
  }

  function buildInitials(name) {
    const normalized = String(name || "").trim();
    if (!normalized) return "--";
    return normalized.slice(0, 2);
  }

  function mapOrderStatusToPipelineStage(status) {
    if (status === "draft") return "견적 요청";
    if (status === "registered") return "발주 확인";
    if (status === "waiting_shipment" || status === "delayed") return "분납 진행 중";
    if (status === "shipped") return "결제 대기";
    return "정산 완료";
  }

  function buildPipelineInsight(status, dDay, receivableAmount, receivableOverdueDays) {
    if (receivableOverdueDays > 0) {
      return `미수금 ${formatMoneyLabel(receivableAmount)}이 D+${receivableOverdueDays} 상태입니다.`;
    }
    if (dDay > 0) {
      return `납기가 ${formatDayLabel(dDay)} 지났습니다. 바로 확인이 필요합니다.`;
    }
    if (dDay === -1) {
      return "내일 납기 예정 건입니다. 출고 준비 여부를 확인해 주세요.";
    }
    if (status === "registered") {
      return "등록된 주문입니다. 다음 진행 상태를 확인해 주세요.";
    }
    return "실제 주문 데이터 기준으로 생성된 카드입니다.";
  }

  function buildPipelineTimeline(row, receivableAmount, receivableOverdueDays) {
    const timeline = [];

    if (row.order_date) {
      timeline.push({
        id: `order-${row.id}`,
        type: "발주",
        title: "발주 등록",
        detail: `${row.item_name_snapshot || "품목"} 주문이 등록되었습니다.`,
        at: row.order_date,
      });
    }

    if (row.due_date) {
      timeline.push({
        id: `due-${row.id}`,
        type: row.status === "delayed" ? "이상" : "AI처리",
        title: "납기 일정",
        detail: `${row.due_date} 납기 기준으로 추적 중입니다.`,
        at: row.due_date,
      });
    }

    if (receivableAmount > 0) {
      timeline.push({
        id: `receivable-${row.id}`,
        type: "입금",
        title: "미수금 추적",
        detail: `${formatMoneyLabel(receivableAmount)} / D+${receivableOverdueDays}`,
        at: nowIso(),
      });
    }

    return timeline;
  }

  function formatQuantity(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0";
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
  }

  function formatDayLabel(value) {
    if (value === 0) return "D-Day";
    return value > 0 ? `D+${value}` : `D${value}`;
  }

  function computePriorityScore({ severity, amount, dueAt, partnerImportance, confidence }) {
    let score = SEVERITY_SCORE[severity] || 0;
    if (amount >= 10000000) score += 40;
    else if (amount >= 3000000) score += 25;
    else if (amount >= 1000000) score += 15;

    if (dueAt) {
      const delta = diffDaysFromToday(dueAt);
      if (delta >= 1) score += 40;
      else if (delta === 0) score += 30;
      else if (delta === -1) score += 20;
      else if (delta === -3) score += 10;
    }

    if (partnerImportance === "key") score += 25;
    else if (partnerImportance === "risky") score += 15;

    if (confidence >= 0.9) score += 10;
    else if (confidence >= 0.6) score += 5;

    return score;
  }

  function updateTaskStatus(taskId, status) {
    sqliteDb.prepare("UPDATE action_task SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), taskId);
  }

  function insertLearningMemory(memoryType, beforeValue, afterValue, context) {
    sqliteDb
      .prepare(`
        INSERT INTO learning_memory (
          memory_type, before_value, after_value, context_json, confidence_boost
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(memoryType, beforeValue, afterValue, JSON.stringify(context || {}), 0.05);
  }

  function queueNotification(channel, recipient, title, message, payload) {
    sqliteDb
      .prepare(`
        INSERT INTO notifications (
          channel, recipient, title, message, payload_json, status, scheduled_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?)
      `)
      .run(channel, recipient || null, title || null, message, JSON.stringify(payload || {}), nowIso());
  }

  function logAutomation(engineName, triggerType, inputRef, action, result, summary, error) {
    sqliteDb
      .prepare(`
        INSERT INTO automation_log (
          engine_name, trigger_type, input_ref, action, result, summary, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(engineName, triggerType || null, inputRef || null, action || null, result || null, summary || null, error ? String(error.message || error) : null);
    if (typeof log === "function") {
      log(`[automation:${engineName}] ${summary || action || result}`);
    }
  }

  function inferEventType(text, hint) {
    const lower = `${text} ${hint}`.toLowerCase();
    if (hint === "pricelist" || lower.includes("단가") || lower.includes("가격표")) return "pricelist";
    if (lower.includes("미수금") || lower.includes("입금") || lower.includes("결제")) return "receivable";
    if (lower.includes("납기") || lower.includes("출고")) return "deadline";
    if (lower.includes("거래처 건강") || lower.includes("발주 감소")) return "partner_health";
    if (parseQuantity(text)) return "order";
    return "unknown";
  }

  function buildRecommendedAction(eventType, decision) {
    if (eventType === "order") {
      if (decision === "auto_process") return "자동 등록 후 납기 추적을 시작합니다.";
      if (decision === "needs_confirmation") return "발주 등록 전 거래처와 품목을 확인하세요.";
      return "분류가 어려워 보류함으로 보냅니다.";
    }
    if (eventType === "receivable") return "담당자에게 먼저 확인 요청하세요.";
    if (eventType === "deadline") return "담당자에게 출고 상태를 확인하세요.";
    if (eventType === "pricelist") return "적용 여부를 확인하고 거래처 안내문을 생성하세요.";
    if (eventType === "partner_health") return "담당자가 거래처 상황을 확인하는 것이 좋습니다.";
    return "자료 유형과 핵심 정보를 확인하세요.";
  }

  function findPartnerMatch(text) {
    const allPartners = sqliteDb.prepare("SELECT * FROM partners").all();
    const lower = text.toLowerCase();
    let best = null;

    for (const partner of allPartners) {
      const aliases = safeJsonArray(partner.aliases);
      const candidates = [partner.name, ...aliases].filter(Boolean);
      for (const candidate of candidates) {
        if (lower.includes(String(candidate).toLowerCase())) {
          const confidence = String(candidate).toLowerCase() === lower.trim().toLowerCase() ? 0.99 : 0.9;
          if (!best || confidence > best.confidence) {
            best = { ...partner, confidence };
          }
        }
      }
    }

    return best;
  }

  function findItemMatch(text) {
    const allItems = sqliteDb.prepare("SELECT * FROM items").all();
    const lower = text.toLowerCase();
    let best = null;

    for (const item of allItems) {
      const aliases = safeJsonArray(item.aliases);
      const candidates = [item.name, ...aliases].filter(Boolean);
      for (const candidate of candidates) {
        if (lower.includes(String(candidate).toLowerCase())) {
          const confidence = String(candidate).toLowerCase() === lower.trim().toLowerCase() ? 0.99 : 0.91;
          if (!best || confidence > best.confidence) {
            best = { ...item, confidence };
          }
        }
      }
    }

    return best;
  }

  function findPartnerByName(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    return sqliteDb
      .prepare("SELECT * FROM partners")
      .all()
      .find((partner) => {
        const aliases = safeJsonArray(partner.aliases);
        return [partner.name, ...aliases].some((candidate) => String(candidate).toLowerCase() === lower);
      }) || null;
  }

  function findItemByName(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    return sqliteDb
      .prepare("SELECT * FROM items")
      .all()
      .find((item) => {
        const aliases = safeJsonArray(item.aliases);
        return [item.name, ...aliases].some((candidate) => String(candidate).toLowerCase() === lower);
      }) || null;
  }

  function guessPartnerName(text) {
    const match = text.match(/([A-Za-z0-9가-힣]+(?:상사|유통|거래처))/);
    return match ? match[1] : "미확인 거래처";
  }

  function parseQuantity(text) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*(개|박스|세트|묶음|건)/);
    return match ? Number(match[1]) : null;
  }

  function parseUnit(text) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*(개|박스|세트|묶음|건)/);
    return match ? match[2] : null;
  }

  function parseAmount(text) {
    const manWonMatch = text.match(/(\d[\d,]*)\s*만\s*원/);
    if (manWonMatch) {
      return Number(manWonMatch[1].replace(/,/g, "")) * 10000;
    }
    const wonMatch = text.match(/(\d[\d,]*)\s*원/);
    if (wonMatch) {
      return Number(wonMatch[1].replace(/,/g, ""));
    }
    return null;
  }

  function parsePaymentTermsDays(text) {
    const match = text.match(/(\d+)\s*일\s*(결제|정산|마감)/);
    return match ? Number(match[1]) : null;
  }

  function parseDueDate(text) {
    if (text.includes("내일까지") || text.includes("내일")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().slice(0, 10);
    }

    const dateMatch = text.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
    if (dateMatch) {
      const year = dateMatch[1];
      const month = dateMatch[2].padStart(2, "0");
      const day = dateMatch[3].padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  function parsePriceListRows(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const rows = [];

    for (const line of lines) {
      const parts = line.split(/[,\t]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const [name, oldValue, newValue] = parts;
        const parsedNew = parseNumericPrice(newValue || oldValue);
        const parsedOld = parseNumericPrice(oldValue);
        if (parsedNew != null) {
          rows.push({
            name,
            oldPrice: parsedOld || 0,
            newPrice: parsedNew,
          });
        }
        continue;
      }

      const inlineMatch = line.match(/([A-Za-z0-9가-힣\s]+)\s+(\d[\d,]*)\s*원?\s*[-~>→]\s*(\d[\d,]*)/);
      if (inlineMatch) {
        rows.push({
          name: inlineMatch[1].trim(),
          oldPrice: parseNumericPrice(inlineMatch[2]) || 0,
          newPrice: parseNumericPrice(inlineMatch[3]) || 0,
        });
      }
    }

    return rows;
  }

  function evaluateReceivable(receivable, partner) {
    const daysOverdue = receivable.due_date ? Math.max(diffDaysFromToday(receivable.due_date), 0) : 0;
    let severity = "P3";
    let status = "expected";

    if ((daysOverdue >= 1 && receivable.amount >= 1000000) || daysOverdue >= 7 || (partner?.importance === "key" && daysOverdue >= 1)) {
      severity = "P1";
      status = "overdue";
    } else if ((daysUntilDate(receivable.due_date) <= 3 && daysUntilDate(receivable.due_date) >= 0) || receivable.amount >= 3000000) {
      severity = "P2";
      status = "due_soon";
    }

    return {
      severity,
      status,
      daysOverdue,
      priorityScore: computePriorityScore({
        severity,
        amount: receivable.amount,
        dueAt: receivable.due_date ? `${receivable.due_date}T09:00:00.000Z` : null,
        partnerImportance: partner?.importance || "normal",
        confidence: 0.95,
      }),
    };
  }

  function buildPriorityReason(task, amount, partner) {
    const reasons = [];
    if (task.severity === "P1") reasons.push("즉시 확인 필요");
    if (amount >= 1000000) reasons.push(`금액 ${formatMoneyLabel(amount)}`);
    if (partner?.importance === "key") reasons.push("핵심 거래처");
    return reasons.join(" / ");
  }

  function resolveRelatedAmount(task) {
    if (task.related_type === "receivable") {
      return sqliteDb.prepare("SELECT amount FROM receivables WHERE id = ?").get(task.related_id)?.amount || 0;
    }
    if (task.related_type === "order") {
      return sqliteDb.prepare("SELECT amount FROM orders WHERE id = ?").get(task.related_id)?.amount || 0;
    }
    return 0;
  }

  function resolveRelatedPartner(task) {
    if (task.related_type === "receivable") {
      const receivable = sqliteDb.prepare("SELECT partner_id FROM receivables WHERE id = ?").get(task.related_id);
      return receivable?.partner_id ? sqliteDb.prepare("SELECT * FROM partners WHERE id = ?").get(receivable.partner_id) : null;
    }
    if (task.related_type === "order") {
      const order = sqliteDb.prepare("SELECT partner_id FROM orders WHERE id = ?").get(task.related_id);
      return order?.partner_id ? sqliteDb.prepare("SELECT * FROM partners WHERE id = ?").get(order.partner_id) : null;
    }
    if (task.related_type === "partner") {
      return sqliteDb.prepare("SELECT * FROM partners WHERE id = ?").get(task.related_id) || null;
    }
    return null;
  }

  function resolveRelatedConfidence(task) {
    if (task.related_type === "order") {
      return sqliteDb.prepare("SELECT confidence FROM orders WHERE id = ?").get(task.related_id)?.confidence || 0;
    }
    return 0.8;
  }

  function resolveTaskRecipient(task) {
    const partner = resolveRelatedPartner(task);
    return partner?.manager_contact || null;
  }

  function buildPartnerMessage(task) {
    return `${task.title}\n${task.summary}\n필요하신 경우 담당자가 바로 확인드리겠습니다.`;
  }

  function inferAmountFromItem(itemId, quantity) {
    if (!itemId) return 0;
    const item = sqliteDb.prepare("SELECT current_price FROM items WHERE id = ?").get(itemId);
    return Number(item?.current_price || 0) * Number(quantity || 0);
  }

  function formatMoneyLabel(amount) {
    return `₩${new Intl.NumberFormat("ko-KR").format(Math.round(amount / 10000))}만`;
  }

  function formatCurrency(amount) {
    return `₩${new Intl.NumberFormat("ko-KR").format(amount)}`;
  }

  function diffDaysFromToday(dateText) {
    const date = new Date(dateText);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - date.getTime()) / 86400000);
  }

  function daysUntilDate(dateText) {
    const date = new Date(dateText);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return Math.round((date.getTime() - today.getTime()) / 86400000);
  }

  function currentDateText() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentMonthText() {
    return new Date().toISOString().slice(0, 7);
  }

  function previousMonthText() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().slice(0, 7);
  }

  function parseNumericPrice(value) {
    if (value == null) return null;
    const numeric = String(value).replace(/[^\d.-]/g, "");
    if (!numeric) return null;
    return Number(numeric);
  }

  function sanitizeFileName(value) {
    return String(value || "upload.bin").replace(/[^\w.-]/g, "_");
  }

  function safeJsonArray(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function ensureDir(targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

module.exports = {
  CONFIDENCE_AUTO,
  CONFIDENCE_CONFIRM,
  CONFIDENCE_HOLD,
  createWholesaleAutomationRuntime,
};
