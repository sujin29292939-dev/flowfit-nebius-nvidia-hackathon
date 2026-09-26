// device-agent.js  (background service worker module)
// FlowFit 얇은 실행 에이전트의 "머리 없는 몸통" — 판단하지 않고 실행만 조율한다.
//
// 루프: Runner /devices/:id/commands 폴링
//   → 본문해시·TTL 검증 (무결성·신선도)
//   → 로컬 게이트 검문 (서버 정책 캐시 사본, BLOCK이면 거부)
//   → content script(device-executor)로 스텝 전달해 실제 DOM 실행
//   → 화면 증거 수집 → Runner /devices/:id/results 보고
//
// 보안 주의: 명령 진위는 기기 토큰 인증 채널로 보장한다.
// 본문해시로 스텝 변조를 막고, TTL로 재사용을 막는다.
// (HMAC 서명 전체 검증은 대칭키 노출 문제로 확장에 두지 않는다 —
//  운영 전 비대칭 서명으로 전환해 공개키 검증을 여기에 추가할 것.)

const FlowFitDeviceAgent = (() => {
  let cfg = { runnerUrl: "", deviceId: "", deviceToken: "", pollIntervalMs: 1500, stage: "SHADOW" };
  let timer = null;
  let gate = null; // { safe:Set, confirm:Set, block:Set }
  let running = false;

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // 서버 signing.hashCommandBody와 동일한 안정 직렬화
  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }

  function headers() {
    return { Authorization: "Bearer " + cfg.deviceToken, "Content-Type": "application/json" };
  }
  function url(path) {
    return cfg.runnerUrl.replace(/\/$/, "") + path;
  }

  async function syncGatePolicy() {
    const res = await fetch(url(`/devices/${cfg.deviceId}/gate-policy`), { headers: headers() });
    if (!res.ok) return;
    const snap = await res.json();
    gate = {
      safe: new Set((snap.safe || []).map((s) => s.toUpperCase())),
      confirm: new Set((snap.confirm || []).map((s) => s.toUpperCase())),
      block: new Set((snap.block || []).map((s) => s.toUpperCase())),
    };
  }

  function localGateAllows(steps) {
    if (!gate) return { allowed: false, blockedOps: ["gate_not_synced"] };
    const blockedOps = steps.map((s) => String(s.op).toUpperCase())
      .filter((op) => gate.block.has(op) || (!gate.safe.has(op) && !gate.confirm.has(op)));
    return { allowed: blockedOps.length === 0, blockedOps };
  }

  async function verifyCommand(cmd) {
    // 1) 본문 해시(스텝 무결성)
    const recomputed = await sha256(stableStringify(cmd.steps));
    if (recomputed !== cmd.bodyHash) return { ok: false, reason: "body_hash_mismatch" };
    // 2) TTL
    if (Date.parse(cmd.expiresAt) < Date.now()) return { ok: false, reason: "command_expired" };
    return { ok: true };
  }

  // 활성 탭의 content script로 스텝 실행 요청
  async function executeInPage(steps) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return { status: "failed", stepResults: [], error: "no_active_tab" };
    return await chrome.tabs.sendMessage(tab.id, { type: "FLOWFIT_EXECUTE_COMMAND", steps })
      .catch((e) => ({ status: "failed", stepResults: [], error: "content_script_unreachable:" + String(e) }));
  }

  async function reportResult(cmd, outcome) {
    const res = await fetch(url(`/devices/${cfg.deviceId}/results`), {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        commandId: cmd.commandId, nonce: cmd.nonce, status: outcome.status,
        result: { error: outcome.error },
        evidence: { stepResults: outcome.stepResults, finalScreenshotHash: outcome.finalScreenshotHash, finalUrl: outcome.finalUrl },
      }),
    });
    return res.json().catch(() => ({}));
  }

  async function tick() {
    if (cfg.stage === "SHADOW") return; // 관찰 단계는 실행 안 함 (관찰 전송은 content가 담당)
    if (!gate) await syncGatePolicy();

    const res = await fetch(url(`/devices/${cfg.deviceId}/commands`), { headers: headers() });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const commands = body.commands || [];

    for (const cmd of commands) {
      const v = await verifyCommand(cmd);
      if (!v.ok) { console.warn("[FlowFit] command rejected:", v.reason); continue; }

      const g = localGateAllows(cmd.steps);
      if (!g.allowed) {
        await reportResult(cmd, { status: "failed", stepResults: [], error: "local_gate_block:" + g.blockedOps.join(",") });
        continue;
      }

      const outcome = await executeInPage(cmd.steps);
      await reportResult(cmd, outcome);
    }
  }

  function loop() {
    if (!running) return;
    tick().catch((e) => console.warn("[FlowFit] tick error:", e)).finally(() => {
      if (running) timer = setTimeout(loop, cfg.pollIntervalMs);
    });
  }

  return {
    configure(next) { cfg = { ...cfg, ...next }; },
    async start(next) {
      if (next) cfg = { ...cfg, ...next };
      if (!cfg.deviceId || !cfg.deviceToken || !cfg.runnerUrl) return false;
      running = true;
      await syncGatePolicy().catch(() => {});
      loop();
      return true;
    },
    stop() { running = false; clearTimeout(timer); timer = null; },
    status() { return { running, deviceId: cfg.deviceId, stage: cfg.stage, gateSynced: Boolean(gate) }; },
  };
})();

export { FlowFitDeviceAgent };
