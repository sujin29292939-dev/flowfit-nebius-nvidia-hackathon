(() => {
  if (window.__flowfit_gate_bridge_injected) return;
  window.__flowfit_gate_bridge_injected = true;

  const allowedOriginPatterns = [
    /^http:\/\/localhost(?::\d+)?$/,
    /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
    /^https:\/\/flowfit\.app$/,
    /^https:\/\/[a-z0-9-]+\.flowfit\.app$/,
  ];

  function isAllowedOrigin(origin) {
    return allowedOriginPatterns.some((pattern) => pattern.test(origin));
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !isAllowedOrigin(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "FLOWFIT_CONFIG") {
      if (!data.serverUrl) return;
      chrome.runtime
        .sendMessage({
          type: "CONNECT",
          config: {
            serverUrl: data.serverUrl,
            authToken: data.authToken || "",
            sessionId: data.sessionId || "",
            autoConnect: true,
            pollIntervalMs: data.pollIntervalMs || 1500,
          },
        })
        .catch(() => {});
      window.postMessage({ type: "FLOWFIT_CONFIG_ACK", ok: true }, event.origin);
    }

    if (data.type === "FLOWFIT_LOGOUT") {
      chrome.runtime.sendMessage({ type: "DISCONNECT" }).catch(() => {});
      window.postMessage({ type: "FLOWFIT_LOGOUT_ACK", ok: true }, event.origin);
    }

    if (data.type === "FLOWFIT_TOKEN_REFRESH" && data.authToken) {
      chrome.runtime
        .sendMessage({
          type: "UPDATE_CONFIG",
          config: { authToken: data.authToken },
        })
        .catch(() => {});
    }

    if (data.type === "FLOWFIT_PING") {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
        window.postMessage({ type: "FLOWFIT_PONG", status }, event.origin);
      });
    }
  });

  window.addEventListener("load", () => {
    chrome.runtime
      .sendMessage({
        type: "PAGE_EVENT",
        event: { name: "PAGE_LOADED", url: location.href, title: document.title, ts: Date.now() },
      })
      .catch(() => {});
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    chrome.runtime
      .sendMessage({
        type: "PAGE_EVENT",
        event: { name: "URL_CHANGED", url: location.href, title: document.title, ts: Date.now() },
      })
      .catch(() => {});
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener(
    "submit",
    (event) => {
      chrome.runtime
        .sendMessage({
          type: "PAGE_EVENT",
          event: {
            name: "FORM_SUBMITTED",
            action: event.target?.action || null,
            method: event.target?.method || null,
            url: location.href,
            ts: Date.now(),
          },
        })
        .catch(() => {});
    },
    true,
  );
})();
