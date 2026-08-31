(function initializeAnswerToc() {
  "use strict";

  if (window.top !== window.self || window.__chatgptAnswerTocInitialized) {
    return;
  }

  const outlineApi = window.ChatGPTAnswerTocOutline;
  const navigation = window.ChatGPTStableNavigation;
  if (!outlineApi || !navigation) {
    return;
  }

  window.__chatgptAnswerTocInitialized = true;

  const SELECTORS = Object.freeze({
    conversationOptions: '[data-testid="conversation-options-button"]',
    primaryTurn: '[data-testid^="conversation-turn-"][data-turn="assistant"]',
    fallbackTurn: '[data-turn="assistant"]',
    assistant: '[data-message-author-role="assistant"]',
    heading: "h1,h2,h3,h4,h5,h6",
  });

  const CLASS_NAMES = Object.freeze({
    control: "cgpt-answer-toc__control",
    button: "cgpt-answer-toc__button",
    count: "cgpt-answer-toc__count",
    panel: "cgpt-answer-toc__panel",
    panelHeader: "cgpt-answer-toc__panel-header",
    panelTitle: "cgpt-answer-toc__panel-title",
    close: "cgpt-answer-toc__close",
    list: "cgpt-answer-toc__list",
    empty: "cgpt-answer-toc__empty",
    item: "cgpt-answer-toc__item",
    itemLevel: "cgpt-answer-toc__item-level",
    itemText: "cgpt-answer-toc__item-text",
    targetFlash: "cgpt-answer-toc__target-flash",
  });

  const PANEL_ID = "cgpt-answer-toc-panel";
  const SCAN_DELAY_MS = 120;
  const TARGET_FLASH_MS = 1500;

  let scanTimer = 0;
  let animationFrame = 0;
  let activeTurnFrame = 0;
  let openState = null;
  let globalControl = null;
  let activeTurnOverrideKey = null;
  let ignoreOverrideScrollUntil = 0;
  let fallbackTurnSerial = 0;
  const flashTimers = new WeakMap();

  function findAssistantTurns() {
    const candidates = new Set([
      ...document.querySelectorAll(SELECTORS.primaryTurn),
      ...document.querySelectorAll(SELECTORS.fallbackTurn),
    ]);

    document.querySelectorAll(SELECTORS.assistant).forEach((message) => {
      candidates.add(
        message.closest(SELECTORS.primaryTurn)
        ?? message.closest(SELECTORS.fallbackTurn)
        ?? message,
      );
    });

    return Array.from(candidates).filter((turn) => {
      if (!(turn instanceof HTMLElement)) {
        return false;
      }

      return turn.matches(SELECTORS.assistant) || Boolean(turn.querySelector(SELECTORS.assistant));
    }).sort((left, right) => {
      if (left === right) {
        return 0;
      }
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function findAssistantMessages(turn) {
    if (turn.matches(SELECTORS.assistant)) {
      return [turn];
    }

    return Array.from(turn.querySelectorAll(SELECTORS.assistant));
  }

  function getTurnKey(turn) {
    const nativeId = turn.getAttribute("data-turn-id");
    if (nativeId) {
      return `native:${nativeId}`;
    }

    if (!turn.dataset.cgptTocTurnKey) {
      fallbackTurnSerial += 1;
      turn.dataset.cgptTocTurnKey = `fallback-${fallbackTurnSerial}`;
    }
    return `fallback:${turn.dataset.cgptTocTurnKey}`;
  }

  function findTurnByKey(turnKey) {
    if (turnKey.startsWith("native:")) {
      const nativeId = turnKey.slice("native:".length);
      return document.querySelector(
        `${SELECTORS.primaryTurn}[data-turn-id="${navigation.cssEscape(nativeId)}"],`
        + `${SELECTORS.fallbackTurn}[data-turn-id="${navigation.cssEscape(nativeId)}"]`,
      );
    }

    const fallbackId = turnKey.slice("fallback:".length);
    return document.querySelector(
      `[data-cgpt-toc-turn-key="${navigation.cssEscape(fallbackId)}"]`,
    );
  }

  function collectHeadings(turn) {
    const rawHeadings = findAssistantMessages(turn)
      .flatMap((message) => Array.from(message.querySelectorAll(SELECTORS.heading)))
      .filter((heading) => !heading.closest(`.${CLASS_NAMES.panel}`))
      .map((element) => ({
        element,
        level: Number.parseInt(element.tagName.slice(1), 10),
        textContent: element.textContent,
      }));

    return outlineApi.buildOutlineEntries(rawHeadings);
  }

  function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }

  function createDirectoryIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("width", "20");
    icon.setAttribute("height", "20");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("fill", "none");

    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", "M4.25 5.25h11.5M4.25 8.75h11.5M4.25 12.25h11.5M4.25 15.75h7.5");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    icon.append(path);
    return icon;
  }

  function createGlobalControl() {
    const control = document.createElement("div");
    control.className = CLASS_NAMES.control;
    control.dataset.chatgptAnswerToc = "control";
    control.dataset.placement = "conversation-header";

    const button = document.createElement("button");
    button.type = "button";
    button.className = CLASS_NAMES.button;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", PANEL_ID);

    const count = document.createElement("span");
    count.className = CLASS_NAMES.count;
    count.setAttribute("aria-hidden", "true");
    count.textContent = "0";

    button.append(createDirectoryIcon(), count);
    button.addEventListener("click", () => {
      const turn = findActiveAssistantTurn();
      if (turn) {
        togglePanel(turn, button);
      }
    });
    control.append(button);
    return control;
  }

  function ensureGlobalControl() {
    const optionsButton = document.querySelector(SELECTORS.conversationOptions);
    const optionsSlot = optionsButton?.parentElement;
    const host = optionsSlot?.parentElement;
    if (!(optionsButton instanceof HTMLButtonElement)
      || !(optionsSlot instanceof HTMLElement)
      || !(host instanceof HTMLElement)) {
      return null;
    }

    if (!(globalControl instanceof HTMLElement)) {
      globalControl = createGlobalControl();
    }

    if (globalControl.parentElement !== host || globalControl.previousElementSibling !== optionsSlot) {
      optionsSlot.insertAdjacentElement("afterend", globalControl);
    }

    document.querySelectorAll(`[data-chatgpt-answer-toc="control"]`).forEach((control) => {
      if (control !== globalControl) {
        control.remove();
      }
    });
    return globalControl;
  }

  function turnDistanceFromReadingLine(turn, readingLine) {
    const rect = turn.getBoundingClientRect();
    if (rect.top <= readingLine && rect.bottom >= readingLine) {
      return 0;
    }
    if (rect.top > readingLine) {
      return rect.top - readingLine;
    }
    return readingLine - rect.bottom;
  }

  function findActiveAssistantTurn() {
    if (openState) {
      const lockedTurn = findTurnByKey(openState.turnKey);
      if (lockedTurn instanceof HTMLElement) {
        return lockedTurn;
      }
    }

    if (activeTurnOverrideKey) {
      const overrideTurn = findTurnByKey(activeTurnOverrideKey);
      if (overrideTurn instanceof HTMLElement) {
        return overrideTurn;
      }
      activeTurnOverrideKey = null;
    }

    const turns = findAssistantTurns()
      .filter((turn) => turn.isConnected && turn.getClientRects().length > 0);
    const lastTurn = turns.at(-1);
    if (lastTurn) {
      const scrollContainer = navigation.getScrollContainerForElement(lastTurn);
      const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      if (maximum > 0 && scrollContainer.scrollTop >= maximum - 2) {
        return lastTurn;
      }
    }

    const readingLine = turns.length > 0
      ? navigation.viewportReadingLine(navigation.getScrollContainerForElement(turns[0]))
      : navigation.readingLineOffset(window.innerHeight);
    return turns
      .map((turn, index) => ({
        turn,
        index,
        distance: turnDistanceFromReadingLine(turn, readingLine),
      }))
      .sort((left, right) => left.distance - right.distance || right.index - left.index)
      .at(0)?.turn ?? null;
  }

  function updateGlobalControl() {
    const control = ensureGlobalControl();
    if (!control) {
      return null;
    }

    const button = control.querySelector(`.${CLASS_NAMES.button}`);
    const count = control.querySelector(`.${CLASS_NAMES.count}`);
    const turn = findActiveAssistantTurn();
    const headingCount = turn ? collectHeadings(turn).length : 0;
    const countText = String(headingCount);

    if (count.textContent !== countText) {
      count.textContent = countText;
    }

    if (button.disabled !== (headingCount === 0)) {
      button.disabled = headingCount === 0;
    }

    const label = !turn
      ? "当前没有可识别的回答"
      : headingCount === 0
        ? "当前回答没有可跳转的标题"
        : `打开当前回答目录，共 ${headingCount} 个标题`;
    setAttributeIfChanged(button, "aria-label", label);
    setAttributeIfChanged(button, "title", label);
    setAttributeIfChanged(button, "aria-expanded", String(openState?.button === button));
    if (turn) {
      button.dataset.activeTurnKey = getTurnKey(turn);
    } else {
      delete button.dataset.activeTurnKey;
    }

    return control;
  }

  function headingSignature(entries) {
    return entries.map((entry) => `${entry.level}:${entry.text}`).join("\u001f");
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = CLASS_NAMES.panel;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "当前回答目录");
    panel.hidden = true;

    const header = document.createElement("div");
    header.className = CLASS_NAMES.panelHeader;

    const title = document.createElement("strong");
    title.className = CLASS_NAMES.panelTitle;
    title.textContent = "当前回答目录";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = CLASS_NAMES.close;
    closeButton.setAttribute("aria-label", "关闭回答目录");
    closeButton.title = "关闭";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => closePanel({ restoreFocus: true }));

    const list = document.createElement("nav");
    list.className = CLASS_NAMES.list;
    list.setAttribute("aria-label", "本回答的大纲");

    header.append(title, closeButton);
    panel.append(header, list);
    document.body.append(panel);
    return panel;
  }

  function renderPanel(entries) {
    if (!openState) {
      return;
    }

    const signature = headingSignature(entries);
    if (openState.signature === signature) {
      openState.entries = entries;
      return;
    }

    openState.signature = signature;
    openState.entries = entries;
    const list = openState.panel.querySelector(`.${CLASS_NAMES.list}`);
    const fragment = document.createDocumentFragment();

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = CLASS_NAMES.empty;
      empty.textContent = "这条回答暂时还没有标题。";
      fragment.append(empty);
    } else {
      entries.forEach((entry, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = CLASS_NAMES.item;
        item.style.setProperty("--cgpt-toc-depth", String(Math.min(entry.depth, 5)));
        item.dataset.headingIndex = String(index);
        item.title = `跳转到 H${entry.level}：${entry.text}`;

        const level = document.createElement("span");
        level.className = CLASS_NAMES.itemLevel;
        level.setAttribute("aria-hidden", "true");
        level.textContent = `H${entry.level}`;

        const text = document.createElement("span");
        text.className = CLASS_NAMES.itemText;
        text.textContent = entry.text;

        item.append(level, text);
        const target = {
          turnKey: openState.turnKey,
          index,
          level: entry.level,
          text: entry.text,
        };
        item.addEventListener("click", () => jumpToHeading(target));
        fragment.append(item);
      });
    }

    list.replaceChildren(fragment);
    updateActiveItem();
  }

  function positionPanel() {
    if (!openState || openState.panel.hidden) {
      return;
    }

    const panel = openState.panel;
    const buttonRect = openState.button.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(340, window.innerWidth - margin * 2);

    panel.style.width = `${width}px`;
    const measuredHeight = Math.min(panel.scrollHeight, Math.max(180, window.innerHeight - margin * 2));
    const roomBelow = window.innerHeight - buttonRect.bottom - margin;
    const top = roomBelow >= Math.min(measuredHeight, 260)
      ? buttonRect.bottom + gap
      : Math.max(margin, buttonRect.top - measuredHeight - gap);
    const left = Math.min(
      window.innerWidth - width - margin,
      Math.max(margin, buttonRect.right - width),
    );

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function updateActiveItem() {
    if (!openState || openState.entries.length === 0) {
      return;
    }

    let activeIndex = 0;
    openState.entries.forEach((entry, index) => {
      if (entry.element?.isConnected && entry.element.getBoundingClientRect().top <= 140) {
        activeIndex = index;
      }
    });

    openState.panel.querySelectorAll(`.${CLASS_NAMES.item}`).forEach((item, index) => {
      if (index === activeIndex) {
        item.dataset.active = "true";
        item.setAttribute("aria-current", "location");
      } else {
        delete item.dataset.active;
        item.removeAttribute("aria-current");
      }
    });
  }

  function schedulePanelPosition() {
    if (animationFrame) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = 0;
      if (!openState || !openState.button.isConnected) {
        closePanel();
        return;
      }

      positionPanel();
      updateActiveItem();
    });
  }

  function handleOutsidePointer(event) {
    if (!openState) {
      return;
    }

    if (!openState.panel.contains(event.target) && !openState.button.contains(event.target)) {
      closePanel();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && openState) {
      event.preventDefault();
      closePanel({ restoreFocus: true });
    }
  }

  function togglePanel(turn, button) {
    if (openState?.button === button) {
      closePanel({ restoreFocus: true });
      return;
    }

    const entries = collectHeadings(turn);
    if (entries.length === 0) {
      return;
    }

    closePanel();
    const panel = document.getElementById(PANEL_ID) ?? createPanel();
    openState = {
      turn,
      turnKey: getTurnKey(turn),
      button,
      entries: [],
      panel,
      signature: "",
    };

    panel.hidden = false;
    setAttributeIfChanged(button, "aria-expanded", "true");
    renderPanel(entries);
    positionPanel();

    document.addEventListener("pointerdown", handleOutsidePointer, true);
    document.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", schedulePanelPosition, { passive: true });
    window.addEventListener("scroll", schedulePanelPosition, { passive: true, capture: true });

    panel.querySelector(`.${CLASS_NAMES.item}`)?.focus({ preventScroll: true });
  }

  function closePanel(options = {}) {
    if (!openState) {
      return;
    }

    const previousState = openState;
    openState = null;
    previousState.panel.hidden = true;
    previousState.button.setAttribute("aria-expanded", "false");

    document.removeEventListener("pointerdown", handleOutsidePointer, true);
    document.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("resize", schedulePanelPosition);
    window.removeEventListener("scroll", schedulePanelPosition, true);

    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    if (options.restoreFocus && previousState.button.isConnected) {
      previousState.button.focus({ preventScroll: true });
    }
  }

  function resolveHeading(target) {
    const turn = findTurnByKey(target.turnKey);
    if (!(turn instanceof HTMLElement)) {
      return null;
    }

    const entries = collectHeadings(turn);
    const indexed = entries[target.index];
    if (indexed && indexed.level === target.level && indexed.text === target.text) {
      return indexed.element;
    }

    return entries.find((entry) => {
      return entry.level === target.level && entry.text === target.text;
    })?.element ?? null;
  }

  function flashHeading(heading) {
    const existingTimer = flashTimers.get(heading);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    heading.classList.remove(CLASS_NAMES.targetFlash);
    void heading.offsetWidth;
    heading.classList.add(CLASS_NAMES.targetFlash);

    const timer = window.setTimeout(() => {
      heading.classList.remove(CLASS_NAMES.targetFlash);
      flashTimers.delete(heading);
    }, TARGET_FLASH_MS);
    flashTimers.set(heading, timer);
  }

  function jumpToHeading(target) {
    activeTurnOverrideKey = target.turnKey;
    ignoreOverrideScrollUntil = Date.now() + 3000;
    closePanel();
    navigation.enqueue(async (token) => {
      await navigation.wait(0, token);
      const result = await navigation.alignToResolver(
        () => resolveHeading(target),
        { offset: 96, timeoutMs: 2400 },
        token,
      );
      const heading = resolveHeading(target);
      if (result.ok && heading) {
        flashHeading(heading);
        ignoreOverrideScrollUntil = Date.now() + 1500;
      } else if (activeTurnOverrideKey === target.turnKey) {
        activeTurnOverrideKey = null;
      }
      updateGlobalControl();
      return result;
    });
  }

  function scanAnswers() {
    scanTimer = 0;
    updateGlobalControl();

    if (openState) {
      const turn = findTurnByKey(openState.turnKey);
      if (!(turn instanceof HTMLElement)) {
        closePanel();
      } else {
        openState.turn = turn;
        const control = updateGlobalControl();
        const button = control?.querySelector(`.${CLASS_NAMES.button}`);
        if (button) {
          openState.button = button;
          setAttributeIfChanged(button, "aria-expanded", "true");
        }
        renderPanel(collectHeadings(turn));
        schedulePanelPosition();
      }
    }
  }

  function scheduleScan() {
    if (scanTimer) {
      window.clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(scanAnswers, SCAN_DELAY_MS);
  }

  function scheduleActiveTurnUpdate() {
    if (activeTurnFrame) {
      return;
    }

    activeTurnFrame = window.requestAnimationFrame(() => {
      activeTurnFrame = 0;
      updateGlobalControl();
    });
  }

  function handleViewportScroll() {
    if (activeTurnOverrideKey && Date.now() > ignoreOverrideScrollUntil) {
      activeTurnOverrideKey = null;
    }
    scheduleActiveTurnUpdate();
  }

  function clearActiveTurnOverrideFromInput(event) {
    if (!activeTurnOverrideKey) {
      return;
    }

    if (event.type === "pointerdown"
      && (globalControl?.contains(event.target)
        || document.getElementById(PANEL_ID)?.contains(event.target))) {
      return;
    }

    if (event.type === "keydown"
      && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "j", "k", "g", "G"].includes(event.key)) {
      return;
    }

    activeTurnOverrideKey = null;
    ignoreOverrideScrollUntil = 0;
    scheduleActiveTurnUpdate();
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.addEventListener("resize", scheduleActiveTurnUpdate, { passive: true });
  window.addEventListener("scroll", handleViewportScroll, { passive: true, capture: true });
  window.addEventListener("wheel", clearActiveTurnOverrideFromInput, { passive: true, capture: true });
  window.addEventListener("touchstart", clearActiveTurnOverrideFromInput, { passive: true, capture: true });
  window.addEventListener("pointerdown", clearActiveTurnOverrideFromInput, { passive: true, capture: true });
  window.addEventListener("keydown", clearActiveTurnOverrideFromInput, { capture: true });

  scanAnswers();
})();
