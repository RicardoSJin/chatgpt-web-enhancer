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
  const HISTORY_CHANGE_EVENT = "chatgpt-stable-navigation-history-change";
  const HISTORY_LIMIT = 50;
  const HISTORY_RESTORE_TIMEOUT_MS = 3200;
  const HISTORY_TURN_SELECTOR = '[data-testid^="conversation-turn-"][data-turn][data-turn-id]';
  const queue = [];
  let activeToken = null;
  let historyBusy = false;
  let historyLocationKey = "";
  let processing = false;
  let serial = 0;

  function createHistoryState(limit = HISTORY_LIMIT) {
    const maximumEntries = Math.max(2, Number(limit) || HISTORY_LIMIT);
    let entries = [];
    let index = -1;

    function equivalent(left, right) {
      if (!left || !right || left.locationKey !== right.locationKey) {
        return false;
      }
      if (left.anchorTurnId && right.anchorTurnId && left.anchorTurnId === right.anchorTurnId) {
        return Math.abs(left.anchorOffset - right.anchorOffset) < 2;
      }
      return Math.abs(left.scrollTop - right.scrollTop) < 2;
    }

    function record(before, after) {
      if (!before || !after || equivalent(before, after)) {
        return false;
      }

      if (index < 0) {
        entries = [before];
        index = 0;
      } else {
        entries[index] = before;
        entries = entries.slice(0, index + 1);
      }

      entries.push(after);
      index = entries.length - 1;
      if (entries.length > maximumEntries) {
        const overflow = entries.length - maximumEntries;
        entries.splice(0, overflow);
        index -= overflow;
      }
      return true;
    }

    function prepare(direction, current) {
      if (index >= 0 && current) {
        entries[index] = current;
      }
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= entries.length) {
        return null;
      }
      return { index: targetIndex, snapshot: entries[targetIndex] };
    }

    function commit(targetIndex) {
      if (targetIndex >= 0 && targetIndex < entries.length) {
        index = targetIndex;
        return true;
      }
      return false;
    }

    function reset() {
      entries = [];
      index = -1;
    }

    function getState() {
      return {
        canGoBack: index > 0,
        canGoForward: index >= 0 && index < entries.length - 1,
        index,
        length: entries.length,
      };
    }

    return Object.freeze({ commit, getState, prepare, record, reset });
  }

  const history = createHistoryState();

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

  function currentLocationKey() {
    if (typeof window === "undefined" || !window.location) {
      return "";
    }
    return `${window.location.origin}${window.location.pathname}${window.location.search}`;
  }

  function dispatchHistoryChange() {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
      return;
    }
    window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT, {
      detail: getHistoryState({ ensureLocation: false }),
    }));
  }

  function ensureHistoryLocation() {
    const locationKey = currentLocationKey();
    if (locationKey === historyLocationKey) {
      return;
    }
    historyLocationKey = locationKey;
    history.reset();
    historyBusy = false;
    dispatchHistoryChange();
  }

  function findConversationTurns() {
    return Array.from(document.querySelectorAll(HISTORY_TURN_SELECTOR)).filter((turn) => {
      return turn instanceof HTMLElement
        && turn.isConnected
        && turn.getClientRects().length > 0;
    });
  }

  function findConversationScrollContainer(turns = findConversationTurns()) {
    return turns.length > 0
      ? getScrollContainerForElement(turns[0])
      : (document.scrollingElement || document.documentElement || document.body);
  }

  function distanceFromLine(element, readingLine) {
    const rect = element.getBoundingClientRect();
    if (rect.top <= readingLine && rect.bottom >= readingLine) {
      return 0;
    }
    return rect.top > readingLine ? rect.top - readingLine : readingLine - rect.bottom;
  }

  function captureLocation() {
    ensureHistoryLocation();
    const turns = findConversationTurns();
    const scrollContainer = findConversationScrollContainer(turns);
    if (!scrollContainer) {
      return null;
    }

    const readingLine = viewportReadingLine(scrollContainer);
    const anchor = turns
      .map((turn, index) => ({
        distance: distanceFromLine(turn, readingLine),
        index,
        turn,
      }))
      .sort((left, right) => left.distance - right.distance || right.index - left.index)
      .at(0)?.turn ?? null;
    const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);

    return Object.freeze({
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - readingLine : 0,
      anchorTurnId: anchor?.getAttribute("data-turn-id") || "",
      locationKey: historyLocationKey,
      scrollRatio: maximum > 0 ? scrollContainer.scrollTop / maximum : 0,
      scrollTop: scrollContainer.scrollTop,
    });
  }

  function findTurnById(turnId) {
    if (!turnId) {
      return null;
    }
    const turn = document.querySelector(
      `${HISTORY_TURN_SELECTOR}[data-turn-id="${cssEscape(turnId)}"]`,
    );
    return turn instanceof HTMLElement ? turn : null;
  }

  function fallbackSnapshotTop(snapshot, scrollContainer) {
    const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    if (snapshot.scrollTop <= maximum) {
      return snapshot.scrollTop;
    }
    return maximum * Math.max(0, Math.min(1, snapshot.scrollRatio || 0));
  }

  function snapshotIsAligned(turn, scrollContainer, snapshot, tolerance = DEFAULT_TOLERANCE) {
    const desiredTop = viewportReadingLine(scrollContainer) + snapshot.anchorOffset;
    const delta = turn.getBoundingClientRect().top - desiredTop;
    if (Math.abs(delta) <= tolerance) {
      return true;
    }
    const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    return (scrollContainer.scrollTop <= tolerance && delta < 0)
      || (scrollContainer.scrollTop >= maximum - tolerance && delta > 0);
  }

  async function restoreLocation(snapshot, token = activeToken) {
    if (!snapshot || snapshot.locationKey !== currentLocationKey()) {
      return { ok: false, locationChanged: true };
    }

    const deadline = Date.now() + HISTORY_RESTORE_TIMEOUT_MS;
    let initialized = false;
    let stablePasses = 0;

    while (Date.now() <= deadline && !token?.cancelled) {
      const turns = findConversationTurns();
      let scrollContainer = findConversationScrollContainer(turns);
      if (!scrollContainer) {
        await waitForDomChange(160, token);
        continue;
      }

      if (!initialized) {
        setScrollTopInstant(scrollContainer, fallbackSnapshotTop(snapshot, scrollContainer));
        initialized = true;
        await wait(64, token);
      }

      const anchor = findTurnById(snapshot.anchorTurnId);
      if (!anchor) {
        setScrollTopInstant(scrollContainer, fallbackSnapshotTop(snapshot, scrollContainer));
        await waitForDomChange(180, token);
        continue;
      }

      scrollContainer = getScrollContainerForElement(anchor);
      const desiredTop = viewportReadingLine(scrollContainer) + snapshot.anchorOffset;
      const delta = anchor.getBoundingClientRect().top - desiredTop;
      if (Math.abs(delta) > DEFAULT_TOLERANCE) {
        setScrollTopInstant(scrollContainer, scrollContainer.scrollTop + delta);
      }

      await wait(CORRECTION_DELAYS[Math.min(stablePasses + 1, CORRECTION_DELAYS.length - 1)], token);
      const freshAnchor = findTurnById(snapshot.anchorTurnId);
      if (freshAnchor) {
        const freshContainer = getScrollContainerForElement(freshAnchor);
        if (snapshotIsAligned(freshAnchor, freshContainer, snapshot)) {
          stablePasses += 1;
          if (stablePasses >= 2) {
            return { ok: true, element: freshAnchor, container: freshContainer };
          }
        } else {
          stablePasses = 0;
        }
      } else {
        stablePasses = 0;
      }
    }

    return { ok: false, cancelled: Boolean(token?.cancelled) };
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

  function enqueueWithHistory(task, options = {}) {
    return enqueue(async (token) => {
      ensureHistoryLocation();
      const before = captureLocation();
      const result = await task(token);
      if (result?.ok && !token.cancelled) {
        await wait(0, token);
        const after = captureLocation();
        if (history.record(before, after)) {
          dispatchHistoryChange();
        }
      }
      return result;
    }, options);
  }

  function getHistoryState(options = {}) {
    if (options.ensureLocation !== false) {
      ensureHistoryLocation();
    }
    return Object.freeze({
      ...history.getState(),
      busy: historyBusy,
    });
  }

  function navigateHistory(direction) {
    ensureHistoryLocation();
    if (historyBusy) {
      return Promise.resolve({ ok: false, busy: true });
    }

    const pending = history.prepare(direction, captureLocation());
    if (!pending) {
      return Promise.resolve({ ok: false, unavailable: true });
    }

    historyBusy = true;
    dispatchHistoryChange();
    return enqueue(async (token) => {
      const result = await restoreLocation(pending.snapshot, token);
      if (result.ok && !token.cancelled) {
        history.commit(pending.index);
      }
      return result;
    }).finally(() => {
      historyBusy = false;
      dispatchHistoryChange();
    });
  }

  function goBack() {
    return navigateHistory(-1);
  }

  function goForward() {
    return navigateHistory(1);
  }

  function resetHistory() {
    historyLocationKey = currentLocationKey();
    history.reset();
    historyBusy = false;
    dispatchHistoryChange();
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
    HISTORY_CHANGE_EVENT,
    alignElementNow,
    alignToResolver,
    cancelActive,
    captureLocation,
    cssEscape,
    createHistoryState,
    enqueue,
    enqueueWithHistory,
    getHistoryState,
    getAlignmentDelta,
    getScrollContainerForElement,
    goBack,
    goForward,
    readingLineOffset,
    resetHistory,
    restoreLocation,
    setScrollTopInstant,
    targetViewportTop,
    viewportReadingLine,
    wait,
    waitForDomChange,
  });
});
