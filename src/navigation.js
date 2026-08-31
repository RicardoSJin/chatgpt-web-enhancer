(function initializeNavigation(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ChatGPTStableNavigation = api;
  }
})(typeof globalThis === "undefined" ? undefined : globalThis, function createNavigation() {
  "use strict";

  const DEFAULT_OFFSET = 96;
  const DEFAULT_TOLERANCE = 2;
  const READING_LINE_MIN = 104;
  const READING_LINE_RATIO = 0.32;
  const READING_LINE_BOTTOM_GAP = 80;
  const CORRECTION_DELAYS = [0, 64, 120, 220, 360, 520];
  const queue = [];
  let activeToken = null;
  let processing = false;
  let serial = 0;

  function isDocumentScroller(element) {
    return element === document.scrollingElement
      || element === document.documentElement
      || element === document.body;
  }

  function getScrollContainerForElement(element) {
    let current = element instanceof Element ? element : null;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      if (/(auto|scroll|overlay)/.test(style.overflowY)) {
        return current;
      }
      current = current.parentElement;
    }

    return document.scrollingElement || document.documentElement || document.body;
  }

  function targetViewportTop(scrollContainer, offset = DEFAULT_OFFSET) {
    if (isDocumentScroller(scrollContainer)) {
      return offset;
    }

    const rect = scrollContainer.getBoundingClientRect();
    const usableOffset = Math.min(offset, Math.max(16, scrollContainer.clientHeight * 0.35));
    return rect.top + usableOffset;
  }

  function readingLineOffset(viewportHeight) {
    const height = Math.max(1, Number(viewportHeight) || 0);
    const maximum = Math.max(16, height - READING_LINE_BOTTOM_GAP);
    const minimum = Math.min(READING_LINE_MIN, maximum);
    return Math.max(minimum, Math.min(maximum, height * READING_LINE_RATIO));
  }

  function viewportReadingLine(scrollContainer) {
    const documentScroller = isDocumentScroller(scrollContainer);
    const height = documentScroller ? window.innerHeight : scrollContainer.clientHeight;
    const top = documentScroller ? 0 : scrollContainer.getBoundingClientRect().top;
    return top + readingLineOffset(height);
  }

  function getAlignmentDelta(element, scrollContainer, offset = DEFAULT_OFFSET) {
    return element.getBoundingClientRect().top - targetViewportTop(scrollContainer, offset);
  }

  function isAlignedOrClamped(element, scrollContainer, offset, tolerance) {
    const delta = getAlignmentDelta(element, scrollContainer, offset);
    if (Math.abs(delta) <= tolerance) {
      return true;
    }

    const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    return (scrollContainer.scrollTop <= tolerance && delta < 0)
      || (scrollContainer.scrollTop >= maximum - tolerance && delta > 0);
  }

  function setScrollTopInstant(scrollContainer, nextTop) {
    if (!scrollContainer) {
      return 0;
    }

    const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const clampedTop = Math.min(maximum, Math.max(0, Number(nextTop) || 0));
    const previousBehavior = scrollContainer.style?.getPropertyValue("scroll-behavior") || "";
    const previousPriority = scrollContainer.style?.getPropertyPriority("scroll-behavior") || "";

    if (scrollContainer.style) {
      scrollContainer.style.setProperty("scroll-behavior", "auto", "important");
    }
    scrollContainer.scrollTop = clampedTop;
    if (scrollContainer.style) {
      if (previousBehavior) {
        scrollContainer.style.setProperty("scroll-behavior", previousBehavior, previousPriority);
      } else {
        scrollContainer.style.removeProperty("scroll-behavior");
      }
    }
    return clampedTop;
  }

  function alignElementNow(element, options = {}) {
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      return { aligned: false, container: null, delta: Number.NaN };
    }

    const container = getScrollContainerForElement(element);
    const delta = getAlignmentDelta(element, container, options.offset ?? DEFAULT_OFFSET);
    if (Math.abs(delta) > (options.tolerance ?? DEFAULT_TOLERANCE)) {
      setScrollTopInstant(container, container.scrollTop + delta);
    }
    return { aligned: true, container, delta };
  }

  function wait(milliseconds, token) {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(!token?.cancelled), Math.max(0, milliseconds));
    });
  }

  function waitForDomChange(milliseconds, token, observeRoot = document.body) {
    return new Promise((resolve) => {
      if (token?.cancelled || !observeRoot) {
        resolve(false);
        return;
      }

      let settled = false;
      const finish = (changed) => {
        if (settled) {
          return;
        }
        settled = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(changed && !token?.cancelled);
      };
      const observer = new MutationObserver(() => finish(true));
      observer.observe(observeRoot, { childList: true, subtree: true });
      const timer = window.setTimeout(() => finish(false), Math.max(0, milliseconds));
    });
  }

  async function alignToResolver(resolveTarget, options = {}, token = activeToken) {
    const timeoutMs = options.timeoutMs ?? 2200;
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const deadline = Date.now() + timeoutMs;
    let stablePasses = 0;
    let latestElement = null;

    for (let index = 0; Date.now() <= deadline && !token?.cancelled; index += 1) {
      const element = resolveTarget();
      if (!(element instanceof HTMLElement) || !element.isConnected) {
        stablePasses = 0;
        await waitForDomChange(Math.min(160, Math.max(20, deadline - Date.now())), token);
        continue;
      }

      latestElement = element;
      const result = alignElementNow(element, options);
      if (typeof options.onStep === "function") {
        options.onStep(element, result);
      }

      await wait(CORRECTION_DELAYS[Math.min(index, CORRECTION_DELAYS.length - 1)], token);
      const freshElement = resolveTarget();
      if (!(freshElement instanceof HTMLElement) || !freshElement.isConnected) {
        stablePasses = 0;
        continue;
      }

      latestElement = freshElement;
      const container = getScrollContainerForElement(freshElement);
      const offset = options.offset ?? DEFAULT_OFFSET;
      const delta = getAlignmentDelta(freshElement, container, offset);
      if (isAlignedOrClamped(freshElement, container, offset, tolerance)) {
        stablePasses += 1;
        if (stablePasses >= 2) {
          return { ok: true, element: freshElement, container };
        }
      } else {
        stablePasses = 0;
        setScrollTopInstant(container, container.scrollTop + delta);
      }
    }

    return {
      ok: false,
      cancelled: Boolean(token?.cancelled),
      element: latestElement,
      container: latestElement ? getScrollContainerForElement(latestElement) : null,
    };
  }

  function removeCancelListeners(token) {
    token.cancelEvents?.forEach((eventName) => {
      window.removeEventListener(eventName, token.cancelFromInput, true);
    });
  }

  function installCancelListeners(token) {
    token.cancelEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
    token.cancelFromInput = () => {
      token.cancelled = true;
    };
    token.cancelEvents.forEach((eventName) => {
      window.addEventListener(eventName, token.cancelFromInput, {
        capture: true,
        passive: true,
      });
    });
  }

  async function processQueue() {
    if (processing) {
      return;
    }

    processing = true;
    while (queue.length > 0) {
      const entry = queue.shift();
      const token = {
        cancelled: false,
        id: entry.id,
      };
      activeToken = token;
      installCancelListeners(token);

      try {
        const result = await entry.task(token);
        entry.resolve(result);
      } catch (error) {
        entry.reject(error);
      } finally {
        removeCancelListeners(token);
        if (activeToken === token) {
          activeToken = null;
        }
      }
    }
    processing = false;
  }

  function enqueue(task, options = {}) {
    if (options.replace !== false) {
      if (activeToken) {
        activeToken.cancelled = true;
      }
      while (queue.length > 0) {
        const obsolete = queue.shift();
        obsolete.resolve({ ok: false, cancelled: true });
      }
    }

    return new Promise((resolve, reject) => {
      queue.push({ id: ++serial, task, resolve, reject });
      processQueue();
    });
  }

  function cancelActive() {
    if (activeToken) {
      activeToken.cancelled = true;
    }
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  return Object.freeze({
    alignElementNow,
    alignToResolver,
    cancelActive,
    cssEscape,
    enqueue,
    getAlignmentDelta,
    getScrollContainerForElement,
    readingLineOffset,
    setScrollTopInstant,
    targetViewportTop,
    viewportReadingLine,
    wait,
    waitForDomChange,
  });
});
