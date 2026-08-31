(function initializeProDialogDismissal(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (!root) {
    return;
  }

  root.ChatGPTProDialogDismissal = api;

  if (
    !root.document
    || root.top !== root.self
    || root.__chatgptProDialogDismissalInitialized
  ) {
    return;
  }

  root.__chatgptProDialogDismissalInitialized = true;
  api.start(root);
})(typeof globalThis === "undefined" ? undefined : globalThis, function createProDialogDismissal() {
  "use strict";

  const CLOSE_BUTTON_SELECTOR = [
    'button[data-testid="close-button"][aria-label="关闭"]',
    'button[data-testid="close-button"][aria-label="Close"]',
  ].join(",");
  const EXPLICIT_DIALOG_SELECTOR = '[role="dialog"],[aria-modal="true"]';
  const SCAN_DELAY_MS = 60;
  const RETRY_DELAY_MS = 320;
  const MAX_CLICK_ATTEMPTS = 3;
  const MAX_FALLBACK_DEPTH = 8;
  const MAX_FALLBACK_TEXT_LENGTH = 2500;
  const PRO_PROMOTION_PATTERNS = Object.freeze([
    /获取\s*(?:ChatGPT\s*)?Pro/i,
    /升级(?:到|为)?\s*(?:ChatGPT\s*)?Pro/i,
    /订阅\s*(?:ChatGPT\s*)?Pro/i,
    /购买\s*(?:ChatGPT\s*)?Pro/i,
    /\bGet\s+(?:ChatGPT\s+)?Pro\b/i,
    /\bUpgrade\s+to\s+(?:ChatGPT\s+)?Pro\b/i,
    /\bSubscribe\s+to\s+(?:ChatGPT\s+)?Pro\b/i,
    /\bTry\s+(?:ChatGPT\s+)?Pro\b/i,
  ]);

  function normalizeWhitespace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function matchesProPromotionText(value) {
    const text = normalizeWhitespace(value);
    return text.length > 0 && PRO_PROMOTION_PATTERNS.some((pattern) => pattern.test(text));
  }

  function start(win) {
    const doc = win?.document;
    if (!doc?.documentElement || typeof win.MutationObserver !== "function") {
      return null;
    }

    const pendingButtons = new WeakSet();
    const clickAttempts = new WeakMap();
    let scanTimer = 0;

    function containerText(container) {
      return normalizeWhitespace(container?.innerText || container?.textContent);
    }

    function isLikelyOverlayContainer(container) {
      const className = typeof container.className === "string" ? container.className : "";
      const semanticHint = [
        className,
        container.getAttribute?.("data-testid") || "",
        container.getAttribute?.("data-radix-portal") || "",
      ].join(" ");

      if (/(?:modal|dialog|overlay|popover|fixed)/i.test(semanticHint)) {
        return true;
      }

      return win.getComputedStyle?.(container).position === "fixed";
    }

    function findPromotionContainer(button) {
      const explicitDialog = button.closest(EXPLICIT_DIALOG_SELECTOR);
      if (explicitDialog && matchesProPromotionText(containerText(explicitDialog))) {
        return explicitDialog;
      }

      let container = button.parentElement;
      let depth = 0;
      while (
        container
        && container !== doc.body
        && container !== doc.documentElement
        && depth < MAX_FALLBACK_DEPTH
      ) {
        const text = containerText(container);
        if (
          text.length <= MAX_FALLBACK_TEXT_LENGTH
          && matchesProPromotionText(text)
          && isLikelyOverlayContainer(container)
        ) {
          return container;
        }
        container = container.parentElement;
        depth += 1;
      }

      return null;
    }

    function isClickable(button) {
      return button instanceof win.HTMLButtonElement
        && button.isConnected
        && !button.disabled
        && button.getClientRects().length > 0;
    }

    function scheduleScan(delay = SCAN_DELAY_MS) {
      win.clearTimeout(scanTimer);
      scanTimer = win.setTimeout(scan, delay);
    }

    function dismissButton(button) {
      const attempts = clickAttempts.get(button) || 0;
      if (
        pendingButtons.has(button)
        || attempts >= MAX_CLICK_ATTEMPTS
        || !isClickable(button)
        || !findPromotionContainer(button)
      ) {
        return false;
      }

      pendingButtons.add(button);
      clickAttempts.set(button, attempts + 1);
      win.requestAnimationFrame(() => {
        if (isClickable(button) && findPromotionContainer(button)) {
          button.click();
        }

        win.setTimeout(() => {
          pendingButtons.delete(button);
          if (button.isConnected && (clickAttempts.get(button) || 0) < MAX_CLICK_ATTEMPTS) {
            scheduleScan(0);
          }
        }, RETRY_DELAY_MS);
      });
      return true;
    }

    function scan() {
      scanTimer = 0;
      doc.querySelectorAll(CLOSE_BUTTON_SELECTOR).forEach(dismissButton);
    }

    const observer = new win.MutationObserver(scheduleScan);
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scan();

    return Object.freeze({
      disconnect() {
        observer.disconnect();
        win.clearTimeout(scanTimer);
      },
      scan,
    });
  }

  return Object.freeze({
    matchesProPromotionText,
    normalizeWhitespace,
    start,
  });
});
