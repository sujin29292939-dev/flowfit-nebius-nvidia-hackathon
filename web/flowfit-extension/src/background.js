// ============================================================
// FlowFit Agent Bridge — Background Service Worker v2
//
// 핵심 변경: WebSocket push → HTTP 승인 큐 폴링
//
// 이전: 에이전트 → WebSocket → 확장 → 즉시 실행
// 지금: 에이전트 → Gate → 승인 큐 → 확장이 폴링 → 승인된 것만 실행
//
// 보안 효과:
//   BLOCK  명령 → 큐에 들어오지 않음 → 실행 불가
//   CONFIRM 명령 → 승인 전까지 pending → 확장이 꺼낼 수 없음
//   SAFE   명령 → Gate가 approved 처리 → 확장이 꺼내서 실행
// ============================================================

const VERSION = '2.0.0';

// 신규 얇은 실행 에이전트 (Runner /devices/* 교신). 레거시 gate 폴링과 병존.
import { FlowFitDeviceAgent } from './device-agent.js';

// ── 상태 ──────────────────────────────────────────────────────
let pollTimer   = null;
let isPolling   = false;
let sessionId   = null;
let pollCount   = 0;
let lastPollAt  = null;
let credentialSafeMode = false;
let credentialSafeTabId = null;
let config = {
  serverUrl:      '',
  authToken:      '',
  sessionId:      '',
  autoConnect:    false,
  pollIntervalMs: 1500,
};

// ── 초기화 ────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const { config: s } = await chrome.storage.local.get(['config']);
  if (s) config = { ...config, ...s };
  updateBadge('off');
  if (config.autoConnect && config.serverUrl) startPolling();
});

chrome.runtime.onStartup.addListener(async () => {
  const { config: s } = await chrome.storage.local.get(['config']);
  if (s) config = { ...config, ...s };
  if (config.autoConnect && config.serverUrl) startPolling();
});

// ── 폴링 제어 ─────────────────────────────────────────────────
// 설정에 기기 토큰이 있으면 신규 device 에이전트도 함께 시동
function maybeStartDeviceAgent() {
  if (config.deviceId && config.deviceToken && config.serverUrl) {
    FlowFitDeviceAgent.start({
      runnerUrl: config.serverUrl,
      deviceId: config.deviceId,
      deviceToken: config.deviceToken,
      pollIntervalMs: config.pollIntervalMs || 1500,
      stage: config.stage || 'SHADOW',
    }).catch(() => {});
  }
}

function startPolling() {
  if (isPolling) return;
  if (!config.serverUrl) { updateBadge('err'); return; }

  isPolling = true;
  sessionId = config.sessionId || crypto.randomUUID();
  chrome.storage.local.set({ config: { ...config, sessionId } });

  updateBadge('on');
  broadcast({ type: 'CONNECTION_STATUS', status: 'polling', sessionId });
  schedulePoll();
}

function stopPolling() {
  isPolling = false;
  clearTimeout(pollTimer);
  pollTimer = null;
  sessionId = null;
  updateBadge('off');
  broadcast({ type: 'CONNECTION_STATUS', status: 'stopped' });
}

function schedulePoll() {
  if (!isPolling) return;
  pollTimer = setTimeout(doPoll, config.pollIntervalMs);
}

// ── 핵심 폴링 루프 ────────────────────────────────────────────
async function doPoll() {
  if (!isPolling) return;
  pollCount++;
  lastPollAt = Date.now();

  try {
    // Gate 서버에서 approved 명령 하나 꺼내기
    const res = await fetch(
      `${config.serverUrl}/api/gate/poll?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: buildHeaders(), signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      if (res.status === 401) { stopPolling(); updateBadge('err'); return; }
      schedulePoll();
      return;
    }

    const msg = await res.json();

    // 큐 비어 있으면 다음 폴링
    if (!msg || !msg.commandId) { schedulePoll(); return; }

    // 명령 실행
    updateBadge('busy');
    const { commandId, command, params = {} } = msg;

    let result = null;
    let error  = null;
    try {
      result = await handleCommand(command, params);
    } catch (e) {
      error = e.message;
    }

    // 결과 반환
    await fetch(`${config.serverUrl}/api/gate/result`, {
      method:  'POST',
      headers: buildHeaders(),
      body:    JSON.stringify({ commandId, result, error }),
      signal:  AbortSignal.timeout(8000),
    }).catch(() => {});

    updateBadge('on');

  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'TypeError') {
      updateBadge('err');
      broadcast({ type: 'CONNECTION_STATUS', status: 'error', message: e.message });
    }
  }

  schedulePoll();
}

// ── 헬퍼 ──────────────────────────────────────────────────────
function buildHeaders() {
  const h = { 'Content-Type': 'application/json', 'X-Session-ID': sessionId || '' };
  if (config.authToken) h['Authorization'] = `Bearer ${config.authToken}`;
  return h;
}
function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }
function updateBadge(state) {
  const map = {
    on:   ['ON',  '#00C896'],
    busy: ['…',   '#F59E0B'],
    err:  ['!',   '#EF4444'],
    off:  ['',    '#5A5F72'],
  };
  const [text, color] = map[state] || map.off;
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color });
}

// ── 팝업 / 옵션 메시지 ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'GET_STATUS') {
    reply({ polling: isPolling, sessionId, version: VERSION,
            serverUrl: config.serverUrl, pollCount, lastPollAt });
    return true;
  }
  if (msg.type === 'CONNECT') {
    config = { ...config, ...msg.config };
    chrome.storage.local.set({ config });
    if (!isPolling) startPolling();
    maybeStartDeviceAgent();
    reply({ ok: true });
    return true;
  }
  // 신규 에이전트 전용 연결: 기기 토큰으로 Runner device 큐에 붙는다.
  if (msg.type === 'DEVICE_CONNECT' && msg.config) {
    config = { ...config, ...msg.config };
    chrome.storage.local.set({ config });
    FlowFitDeviceAgent.start({
      runnerUrl: config.serverUrl || msg.config.runnerUrl,
      deviceId: msg.config.deviceId,
      deviceToken: msg.config.deviceToken,
      pollIntervalMs: config.pollIntervalMs || 1500,
      stage: msg.config.stage || 'SHADOW',
    }).then((ok) => reply({ ok }));
    return true;
  }
  if (msg.type === 'DEVICE_STATUS') { reply(FlowFitDeviceAgent.status()); return true; }
  if (msg.type === 'DEVICE_DISCONNECT') { FlowFitDeviceAgent.stop(); reply({ ok: true }); return true; }
  if (msg.type === 'DISCONNECT') {
    config.autoConnect = false;
    chrome.storage.local.set({ config });
    stopPolling();
    FlowFitDeviceAgent.stop();
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'UPDATE_CONFIG') {
    config = { ...config, ...msg.config };
    chrome.storage.local.set({ config });
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'PAGE_EVENT' && isPolling && config.serverUrl) {
    fetch(`${config.serverUrl}/api/gate/event`, {
      method: 'POST', headers: buildHeaders(),
      body: JSON.stringify({ tabId: sender.tab?.id, event: msg.event }),
    }).catch(() => {});
  }
});

// ============================================================
// 명령 처리기 — Gate가 승인한 명령만 도달
// EVAL 등 BLOCK 명령은 여기에 절대 도달하지 않음
// ============================================================
async function handleCommand(command, params = {}) {
  switch (command) {
    case 'TAB_LIST':         return cmdTabList();
    case 'TAB_NEW':          return cmdTabNew(params);
    case 'TAB_CLOSE':        return cmdTabClose(params);
    case 'TAB_ACTIVATE':     return cmdTabActivate(params);
    case 'TAB_INFO':         return cmdTabInfo(params);
    case 'NAVIGATE':         return cmdNavigate(params);
    case 'BACK':             return cmdHistoryGo(params, -1);
    case 'FORWARD':          return cmdHistoryGo(params, 1);
    case 'RELOAD':           return cmdReload(params);
    case 'GET_HTML':         return cmdGetHtml(params);
    case 'GET_TEXT':         return cmdGetText(params);
    case 'FIND_ELEMENTS':    return cmdFindElements(params);
    case 'GET_ATTR':         return cmdGetAttr(params);
    case 'CLICK':            return cmdClick(params);
    case 'TYPE':             return cmdType(params);
    case 'CLEAR':            return cmdClear(params);
    case 'SELECT':           return cmdSelect(params);
    case 'SCROLL':           return cmdScroll(params);
    case 'FOCUS':            return cmdFocus(params);
    case 'HOVER':            return cmdHover(params);
    case 'SUBMIT':           return cmdSubmit(params);
    case 'KEY_PRESS':        return cmdKeyPress(params);
    case 'SCREENSHOT':       return cmdScreenshot(params);
    case 'SCREENSHOT_ELEMENT': return cmdScreenshotElement(params);
    case 'GET_COOKIES':      return cmdGetCookies(params);
    case 'SET_COOKIE':       return cmdSetCookie(params);
    case 'GET_LOCALSTORAGE': return cmdGetLocalStorage(params);
    case 'SET_LOCALSTORAGE': return cmdSetLocalStorage(params);
    case 'WAIT_FOR':         return cmdWaitFor(params);
    case 'WAIT_MS':          return cmdWaitMs(params);
    case 'GET_NETWORK_LOG':  return cmdGetNetworkLog(params);
    case 'CREDENTIAL_SAFE_MODE_START': return cmdCredentialSafeModeStart(params);
    case 'CREDENTIAL_SAFE_MODE_STOP':  return cmdCredentialSafeModeStop(params);
    case 'FOCUS_CREDENTIAL_FIELD':     return cmdFocusCredentialField(params);
    case 'PING':             return { pong: true, ts: Date.now() };
    case 'STATUS':           return { polling: isPolling, sessionId, version: VERSION, pollCount, credentialSafeMode };
    default:
      throw new Error(`Unrecognized command after gate: ${command}`);
  }
}

// ── 탭 ────────────────────────────────────────────────────────
async function getActiveTab(tabId) {
  if (tabId) return chrome.tabs.get(tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function execScript(tabId, func, args = []) {
  const r = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r[0]?.result;
}
async function cmdTabList() {
  return (await chrome.tabs.query({})).map(t =>
    ({ id: t.id, url: t.url, title: t.title, active: t.active }));
}
async function cmdTabNew({ url = 'about:blank', active = true } = {}) {
  const t = await chrome.tabs.create({ url, active }); return { tabId: t.id, url: t.url };
}
async function cmdTabClose({ tabId } = {}) {
  const t = await getActiveTab(tabId); await chrome.tabs.remove(t.id); return { closed: t.id };
}
async function cmdTabActivate({ tabId } = {}) {
  await chrome.tabs.update(tabId, { active: true }); return { activated: tabId };
}
async function cmdTabInfo({ tabId } = {}) {
  const t = await getActiveTab(tabId); return { id: t.id, url: t.url, title: t.title, status: t.status };
}

// ── 탐색 ──────────────────────────────────────────────────────
function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    const fn = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
  });
}
async function cmdNavigate({ url, tabId, waitLoad = true } = {}) {
  const t = await getActiveTab(tabId);
  await chrome.tabs.update(t.id, { url });
  if (waitLoad) await waitForTabLoad(t.id);
  const u = await chrome.tabs.get(t.id);
  return { tabId: u.id, url: u.url, title: u.title };
}
async function cmdHistoryGo({ tabId } = {}, delta) {
  const t = await getActiveTab(tabId);
  await execScript(t.id, d => history.go(d), [delta]);
  await waitForTabLoad(t.id);
  return { url: (await chrome.tabs.get(t.id)).url };
}
async function cmdReload({ tabId, hardReload = false } = {}) {
  const t = await getActiveTab(tabId);
  await chrome.tabs.reload(t.id, { bypassCache: hardReload });
  await waitForTabLoad(t.id);
  return { reloaded: t.id };
}

// ── DOM 읽기 ──────────────────────────────────────────────────
async function cmdGetHtml({ tabId, selector = 'html' } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, sel => {
    const isCredentialElement = (el) => {
      const text = [el.type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder]
        .filter(Boolean).join(' ').toLowerCase();
      return el.matches?.('input[type="password"], input[autocomplete="one-time-code"]') ||
        /password|passwd|pwd|otp|2fa|mfa|one.?time|verification.?code|인증|비밀번호/.test(text);
    };
    const maskCredentialValues = (root) => {
      for (const el of Array.from(root.querySelectorAll?.('input, textarea') ?? [])) {
        if (isCredentialElement(el)) {
          el.setAttribute('value', '[credential hidden]');
          el.textContent = '[credential hidden]';
        } else if ('value' in el) {
          el.removeAttribute('value');
        }
      }
    };
    const root = document.querySelector(sel);
    if (!root) return null;
    const clone = root.cloneNode(true);
    maskCredentialValues(clone);
    return clone.outerHTML ?? null;
  }, [selector]);
}
async function cmdGetText({ tabId, selector = 'body' } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, sel => document.querySelector(sel)?.innerText ?? null, [selector]);
}
async function cmdFindElements({ tabId, selector, limit = 50 } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, (sel, lim) =>
    Array.from(document.querySelectorAll(sel)).slice(0, lim).map(el => {
      const text = [el.type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder]
        .filter(Boolean).join(' ').toLowerCase();
      const credentialField = el.matches?.('input[type="password"], input[autocomplete="one-time-code"]') ||
        /password|passwd|pwd|otp|2fa|mfa|one.?time|verification.?code|인증|비밀번호/.test(text);
      return {
        tag: el.tagName.toLowerCase(), id: el.id || null,
        text: el.innerText?.slice(0, 200), href: el.href || null,
        value: credentialField ? null : (el.value !== undefined ? el.value : null),
        credentialField,
        rect: el.getBoundingClientRect().toJSON(),
      };
    }), [selector, limit]);
}
async function cmdGetAttr({ tabId, selector, attr } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, (sel, a) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const text = [el.type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder]
      .filter(Boolean).join(' ').toLowerCase();
    const credentialField = el.matches?.('input[type="password"], input[autocomplete="one-time-code"]') ||
      /password|passwd|pwd|otp|2fa|mfa|one.?time|verification.?code|인증|비밀번호/.test(text);
    if (String(a).toLowerCase() === 'value' && credentialField) return null;
    return el.getAttribute(a) ?? null;
  }, [selector, attr]);
}

// ── DOM 조작 ──────────────────────────────────────────────────
async function cmdClick({ tabId, selector, x, y } = {}) {
  const t = await getActiveTab(tabId);
  if (selector) return execScript(t.id, sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    el.scrollIntoView({ block: 'center' }); el.click(); return { clicked: sel };
  }, [selector]);
  await debuggerAttach(t.id);
  await debuggerSend(t.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await debuggerSend(t.id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await debuggerDetach(t.id);
  return { clicked: { x, y } };
}
async function cmdType({ tabId, selector, text, clear = false } = {}) {
  const t = await getActiveTab(tabId);
  if (selector) await execScript(t.id, (sel, clr) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    const text = [el.type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder]
      .filter(Boolean).join(' ').toLowerCase();
    const credentialField = el.matches?.('input[type="password"], input[autocomplete="one-time-code"]') ||
      /password|passwd|pwd|otp|2fa|mfa|one.?time|verification.?code|인증|비밀번호/.test(text);
    if (credentialField) {
      throw new Error('Credential Safe Mode: AI cannot type into credential fields. Ask the user to enter it directly.');
    }
    el.focus();
    if (clr) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, [selector, clear]);
  if (!selector && credentialSafeMode) {
    throw new Error('Credential Safe Mode: coordinate typing is blocked while user credentials may be active.');
  }
  await debuggerAttach(t.id);
  for (const c of text) {
    await debuggerSend(t.id, 'Input.dispatchKeyEvent', { type: 'keyDown', text: c });
    await debuggerSend(t.id, 'Input.dispatchKeyEvent', { type: 'keyUp',   text: c });
  }
  await debuggerDetach(t.id);
  return { typed: text.length };
}
async function cmdClear({ tabId, selector } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    el.value = '';
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { cleared: sel };
  }, [selector]);
}
async function cmdSelect({ tabId, selector, value } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    el.value = val; el.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: val };
  }, [selector, value]);
}
async function cmdScroll({ tabId, selector, x = 0, y = 0, behavior = 'smooth' } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, (sel, sx, sy, beh) => {
    (sel ? document.querySelector(sel) : window).scrollBy({ left: sx, top: sy, behavior: beh });
    return { scrolled: { x: sx, y: sy } };
  }, [selector, x, y, behavior]);
}
async function cmdFocus({ tabId, selector } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, sel => { document.querySelector(sel)?.focus(); return { focused: sel }; }, [selector]);
}
async function cmdHover({ tabId, selector } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, sel => {
    document.querySelector(sel)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return { hovered: sel };
  }, [selector]);
}
async function cmdSubmit({ tabId, selector } = {}) {
  const t = await getActiveTab(tabId);
  return execScript(t.id, sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    (el.closest('form') || el).submit?.() || el.click();
    return { submitted: sel };
  }, [selector]);
}
async function cmdKeyPress({ tabId, key } = {}) {
  const t = await getActiveTab(tabId);
  await debuggerAttach(t.id);
  await debuggerSend(t.id, 'Input.dispatchKeyEvent', { type: 'keyDown', key });
  await debuggerSend(t.id, 'Input.dispatchKeyEvent', { type: 'keyUp',   key });
  await debuggerDetach(t.id);
  return { pressed: key };
}

// ── 스크린샷 ──────────────────────────────────────────────────
async function cmdScreenshot({ tabId, fullPage = false } = {}) {
  const t = await getActiveTab(tabId);
  const restoreMask = await maskCredentialsForScreenshot(t.id);
  if (fullPage) {
    try {
      await debuggerAttach(t.id);
      const { data } = await debuggerSend(t.id, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await debuggerDetach(t.id);
      return { dataUrl: 'data:image/png;base64,' + data, credentialMasked: true };
    } finally {
      await restoreMask();
    }
  }
  try {
    return { dataUrl: await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' }), credentialMasked: true };
  } finally {
    await restoreMask();
  }
}
async function cmdScreenshotElement({ tabId, selector } = {}) {
  const t = await getActiveTab(tabId);
  const restoreMask = await maskCredentialsForScreenshot(t.id);
  const rect = await execScript(t.id, sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    el.scrollIntoView({ block: 'center' });
    return el.getBoundingClientRect().toJSON();
  }, [selector]);
  await debuggerAttach(t.id);
  try {
    const { data } = await debuggerSend(t.id, 'Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
    });
    await debuggerDetach(t.id);
    return { dataUrl: 'data:image/png;base64,' + data, credentialMasked: true };
  } finally {
    await restoreMask();
  }
}

// ── 스토리지 ──────────────────────────────────────────────────
async function cmdGetCookies({ url } = {}) {
  if (credentialSafeMode) throw new Error('Credential Safe Mode: cookie export is blocked until login input is complete.');
  return chrome.cookies.getAll({ url });
}
async function cmdSetCookie(d = {}) { return chrome.cookies.set(d); }
async function cmdGetLocalStorage({ tabId, key } = {}) {
  if (credentialSafeMode) throw new Error('Credential Safe Mode: localStorage export is blocked until login input is complete.');
  const t = await getActiveTab(tabId);
  return execScript(t.id, k => {
    if (k) return localStorage.getItem(k);
    const obj = {};
    for (let i = 0; i < localStorage.length; i++) obj[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return obj;
  }, [key]);
}
async function cmdSetLocalStorage({ tabId, key, value } = {}) {
  if (credentialSafeMode) throw new Error('Credential Safe Mode: localStorage writes are blocked during credential input.');
  if (!key) throw new Error('key required');
  const t = await getActiveTab(tabId);
  return execScript(t.id, (k, v) => {
    localStorage.setItem(k, String(v ?? ''));
    return { key: k, stored: true };
  }, [key, value]);
}

// ── 대기 ──────────────────────────────────────────────────────
async function cmdWaitFor({ tabId, selector, timeout = 10000 } = {}) {
  const t = await getActiveTab(tabId);
  const found = await execScript(t.id, (sel, to) => new Promise(resolve => {
    if (document.querySelector(sel)) return resolve(true);
    const obs = new MutationObserver(() => {
      if (document.querySelector(sel)) { obs.disconnect(); resolve(true); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(false); }, to);
  }), [selector, timeout]);
  return { found };
}
async function cmdWaitMs({ ms = 1000 } = {}) {
  await new Promise(r => setTimeout(r, Math.min(ms, 10000)));
  return { waited: ms };
}

// ── 네트워크 로그 ─────────────────────────────────────────────
const networkLogs = new Map();
if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(
    d => {
      const logs = networkLogs.get(d.tabId) || [];
      logs.push({ url: d.url, method: d.method, status: d.statusCode, ts: Date.now() });
      if (logs.length > 200) logs.shift();
      networkLogs.set(d.tabId, logs);
    },
    { urls: ['<all_urls>'] }
  );
}
async function cmdGetNetworkLog({ tabId, filter } = {}) {
  if (credentialSafeMode) throw new Error('Credential Safe Mode: network log export is blocked during credential input.');
  const t = await getActiveTab(tabId);
  let logs = networkLogs.get(t.id) || [];
  if (filter) logs = logs.filter(l => l.url.includes(filter));
  return { logs };
}

// ── Credential Safe Mode ─────────────────────────────────────
async function cmdCredentialSafeModeStart({ tabId, reason = 'user credential input' } = {}) {
  const t = await getActiveTab(tabId);
  credentialSafeMode = true;
  credentialSafeTabId = t.id;
  await execScript(t.id, () => {
    document.documentElement.setAttribute('data-flowfit-credential-safe', 'true');
  });
  broadcast({ type: 'CREDENTIAL_SAFE_MODE', active: true, tabId: t.id, reason });
  updateBadge('busy');
  return { credentialSafeMode: true, tabId: t.id };
}

async function cmdCredentialSafeModeStop({ tabId } = {}) {
  const t = await getActiveTab(tabId || credentialSafeTabId);
  credentialSafeMode = false;
  credentialSafeTabId = null;
  if (t?.id) {
    await execScript(t.id, () => {
      document.documentElement.removeAttribute('data-flowfit-credential-safe');
    }).catch(() => {});
  }
  broadcast({ type: 'CREDENTIAL_SAFE_MODE', active: false, tabId: t?.id });
  updateBadge(isPolling ? 'on' : 'off');
  return { credentialSafeMode: false, tabId: t?.id ?? null };
}

async function cmdFocusCredentialField({ tabId, selector } = {}) {
  if (!selector) throw new Error('selector required');
  const t = await getActiveTab(tabId);
  await execScript(t.id, sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    el.scrollIntoView({ block: 'center' });
    el.focus();
    return true;
  }, [selector]);
  credentialSafeMode = true;
  credentialSafeTabId = t.id;
  return { focused: selector, credentialSafeMode: true, message: '사용자가 직접 입력해야 합니다. 입력값은 수집되지 않습니다.' };
}

async function maskCredentialsForScreenshot(tabId) {
  await execScript(tabId, () => {
    const isCredentialElement = (el) => {
      const text = [el.type, el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder]
        .filter(Boolean).join(' ').toLowerCase();
      return el.matches?.('input[type="password"], input[autocomplete="one-time-code"]') ||
        /password|passwd|pwd|otp|2fa|mfa|one.?time|verification.?code|인증|비밀번호/.test(text);
    };
    const targets = Array.from(document.querySelectorAll('input, textarea'));
    for (const el of targets) {
      if (!isCredentialElement(el)) continue;
      el.dataset.flowfitOldStyle = el.getAttribute('style') || '';
      el.style.color = 'transparent';
      el.style.textShadow = '0 0 0 transparent';
      el.style.background = '#111827';
      el.style.borderColor = '#111827';
      el.style.caretColor = 'transparent';
    }
  }).catch(() => {});
  return async () => {
    await execScript(tabId, () => {
      for (const el of Array.from(document.querySelectorAll('[data-flowfit-old-style]'))) {
        el.setAttribute('style', el.dataset.flowfitOldStyle || '');
        delete el.dataset.flowfitOldStyle;
      }
    }).catch(() => {});
  };
}

// ── Debugger 헬퍼 ─────────────────────────────────────────────
const attachedTabs = new Set();
async function debuggerAttach(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTabs.add(tabId);
}
async function debuggerDetach(tabId) {
  if (!attachedTabs.has(tabId)) return;
  await chrome.debugger.detach({ tabId });
  attachedTabs.delete(tabId);
}
function debuggerSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) =>
    chrome.debugger.sendCommand({ tabId }, method, params, result =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result)
    )
  );
}
chrome.debugger.onDetach.addListener(src => attachedTabs.delete(src.tabId));
