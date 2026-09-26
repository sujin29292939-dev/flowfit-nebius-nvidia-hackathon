// device-executor.js  (content script)
// FlowFit 얇은 실행 에이전트의 "손" — 실제 페이지 DOM을 조작한다.
// background(device-agent.js)가 명령 스텝을 보내면 이 스크립트가 실행하고
// 검증 결과 + 화면 증거 해시를 돌려준다. 판단은 하지 않는다.
//
// 검증된 TS DomDriver 로직을 플레인 JS로 미러링한 것.

(() => {
  if (window.__flowfit_device_executor) return;
  window.__flowfit_device_executor = true;

  const DANGER_CONFIRM_PATTERNS = [
    /결제\s*확정/, /환불\s*확정/, /영구\s*삭제/, /전체\s*삭제/, /계정\s*삭제/,
    /송금\s*실행/, /대량\s*발송\s*확정/,
  ];

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function requireEl(selector) {
    if (!selector) throw new Error("selector_required");
    const el = document.querySelector(selector);
    if (!el) throw new Error("element_not_found:" + selector);
    return el;
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function isSelector(value) {
    if (/^https?:\/\//i.test(value)) return false;
    return /^[#.\[]|^[a-zA-Z]/.test(value);
  }

  async function performOp(step) {
    const op = String(step.op || "").toUpperCase();
    switch (op) {
      case "NAVIGATE": if (step.target) location.href = step.target; await wait(50); return;
      case "CLICK": requireEl(step.target).click(); return;
      case "TYPE": { const el = requireEl(step.target); el.focus && el.focus(); el.value = step.value ?? ""; fire(el, "input"); fire(el, "change"); return; }
      case "CLEAR": { const el = requireEl(step.target); el.value = ""; fire(el, "input"); return; }
      case "SELECT": { const el = requireEl(step.target); el.value = step.value ?? ""; fire(el, "change"); return; }
      case "FOCUS": { const el = requireEl(step.target); el.focus && el.focus(); return; }
      case "SUBMIT": {
        const el = requireEl(step.target);
        const form = el.tagName === "FORM" ? el : (el.closest && el.closest("form"));
        if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); } else { el.click(); }
        await wait(80); return;
      }
      case "GET_TEXT": case "GET_HTML": case "FIND_ELEMENTS": requireEl(step.target); return;
      case "WAIT_FOR": { for (let i = 0; i < 30; i++) { if (step.target && document.querySelector(step.target)) return; await wait(100); } throw new Error("wait_for_timeout:" + step.target); }
      case "WAIT_MS": await wait(Number(step.value ?? 200)); return;
      default: throw new Error("unsupported_op:" + op);
    }
  }

  async function checkVerify(verify) {
    const [kind, ...rest] = verify.split(":");
    const arg = rest.join(":");
    switch (kind) {
      case "url_contains": return location.href.includes(arg);
      case "value_set": { const el = document.querySelector(arg); return Boolean(el && el.value && el.value.trim().length > 0); }
      case "text_contains": return (document.body?.textContent ?? "").includes(arg);
      case "toast_contains": { const t = document.querySelector(".toast, .notification, [role='alert'], .alert"); return ((t?.textContent ?? document.body?.textContent ?? "")).includes(arg); }
      case "element_exists": return Boolean(document.querySelector(arg));
      default: return false;
    }
  }

  async function evidenceForStep(step) {
    let targetHtml = "";
    if (step.target && isSelector(step.target)) {
      try { targetHtml = document.querySelector(step.target)?.outerHTML ?? ""; } catch { targetHtml = ""; }
    }
    return sha256(location.href + "|" + step.op + "|" + targetHtml.slice(0, 2000));
  }

  async function detectDanger() {
    const text = document.body?.textContent ?? "";
    return DANGER_CONFIRM_PATTERNS.some((re) => re.test(text));
  }

  async function runStep(step) {
    const capturedAt = new Date().toISOString();
    try {
      await performOp(step);
      const passed = step.verify ? await checkVerify(step.verify) : true;
      const evidenceHash = await evidenceForStep(step);
      return { op: step.op, verify: step.verify, passed, evidenceHash, capturedAt, error: passed ? undefined : "verify_failed:" + step.verify };
    } catch (error) {
      return { op: step.op, verify: step.verify, passed: false, capturedAt, error: String(error) };
    }
  }

  async function captureFinal() {
    const bodyHtml = document.body?.outerHTML ?? "";
    return { screenshotHash: await sha256(location.href + "|" + bodyHtml.slice(0, 8000)), url: location.href };
  }

  // 명령 전체 실행 (executor.ts 로직 미러)
  async function executeCommand(steps) {
    const stepResults = [];
    for (const step of steps) {
      if (await detectDanger()) {
        stepResults.push({ op: step.op, verify: step.verify, passed: false, capturedAt: new Date().toISOString(), error: "danger_detected_aborted" });
        return { status: "failed", stepResults, error: "danger_detected" };
      }
      const result = await runStep(step);
      stepResults.push(result);
      if (!result.passed) {
        const final = await captureFinal();
        return { status: "failed", stepResults, finalScreenshotHash: final.screenshotHash, finalUrl: final.url, error: "step_failed:" + step.op };
      }
    }
    const final = await captureFinal();
    return { status: "succeeded", stepResults, finalScreenshotHash: final.screenshotHash, finalUrl: final.url };
  }

  // background로부터 명령 실행 요청 수신
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "FLOWFIT_EXECUTE_COMMAND" && Array.isArray(msg.steps)) {
      executeCommand(msg.steps).then(reply).catch((e) => reply({ status: "failed", stepResults: [], error: String(e) }));
      return true; // async reply
    }
    if (msg?.type === "FLOWFIT_DETECT_DANGER") {
      detectDanger().then((d) => reply({ danger: d }));
      return true;
    }
  });
})();
