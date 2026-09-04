(function initializeQuestionTimeline() {
  "use strict";

  if (window.top !== window.self || window.__chatgptQuestionTimelineInitialized) return;

  const model = window.ChatGPTTimelineModel;
  const navigation = window.ChatGPTStableNavigation;
  if (!model || !navigation) return;

  window.__chatgptQuestionTimelineInitialized = true;

  const ROOT_ID = "cgpt-conversation-timeline";
  const PANEL_ID = "cgpt-timeline-question-panel";
  const TIMELINE_HOST_SELECTOR = '[data-side-pane-shell-host="true"]';
  const SCAN_DELAY_MS = 140;
  const FLASH_MS = 1500;
  const LOAD_EARLIER_TIMEOUT_MS = 45000;
  const LOCATE_TIMEOUT_MS = 15000;
  const TURN_SELECTOR = '[data-testid^="conversation-turn-"][data-turn]';
  const USER_TURN_SELECTOR = `${TURN_SELECTOR}[data-turn="user"]`;
  const MESSAGE_SELECTOR = '[data-message-author-role="user"]';
  const ORIGINAL_TIMELINE_SELECTORS = [
    '[data-testid="conversation-timeline"]',
    '[data-testid="chat-timeline"]',
    '[aria-label="对话时间轴"]',
    '[aria-label="Conversation timeline"]',
  ];

  const state = {
    activeId: null,
    conversationKey: "",
    fullyIndexed: false,
    host: null,
    lastG: 0,
    lastShiftG: 0,
    list: null,
    loadingEarlier: false,
    menuButton: null,
    navigationErrorId: null,
    navigationTargetId: null,
    observer: null,
    orderedIds: [],
    panel: null,
    panelInput: null,
    panelList: null,
    panelRenderSignature: "",
    records: new Map(),
    renderSignature: "",
    root: null,
    scanTimer: 0,
    searchQuery: "",
    tooltip: null,
  };

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function currentConversationKey() {
    const match = window.location.pathname.match(/^\/c\/([^/?#]+)/);
    if (match) return match[1];
    return document.querySelector(TURN_SELECTOR) ? `page:${window.location.pathname}` : "";
  }

  function findTimelineHost() {
    const hosts = Array.from(document.querySelectorAll(TIMELINE_HOST_SELECTOR));
    return hosts.find((host) => host.querySelector(TURN_SELECTOR))
      ?? hosts.find((host) => host.querySelector("[data-scroll-root]"))
      ?? hosts[0]
      ?? null;
  }

  function syncConversation() {
    const nextKey = currentConversationKey();
    if (nextKey === state.conversationKey) return;

    navigation.cancelActive();
    state.conversationKey = nextKey;
    state.records.clear();
    state.orderedIds = [];
    state.activeId = null;
    state.fullyIndexed = false;
    state.loadingEarlier = false;
    state.navigationErrorId = null;
    state.navigationTargetId = null;
    state.panelRenderSignature = "";
    state.renderSignature = "";
    closeTimelinePanel({ resetSearch: true });
    hideTooltip();
  }

  function extractQuestionText(turn) {
    const message = turn.querySelector(MESSAGE_SELECTOR);
    if (!message) return "";

    const clone = message.cloneNode(true);
    clone.querySelectorAll(
      "[data-chatgpt-answer-toc], [data-chatgpt-timeline], script, style",
    ).forEach((element) => element.remove());
    return normalizeText(clone.innerText || clone.textContent).slice(0, 4000);
  }

  function getStableTurnId(turn) {
    return normalizeText(turn.getAttribute("data-turn-id"));
  }

  function absoluteTopInContainer(element, container) {
    const containerRect = container.getBoundingClientRect();
    return element.getBoundingClientRect().top - containerRect.top + container.scrollTop;
  }

  function absolutePositionAtReadingLine(container) {
    const containerRect = container.getBoundingClientRect();
    const readingLine = navigation.viewportReadingLine(container);
    return readingLine - containerRect.top + container.scrollTop;
  }

  function discoverQuestions() {
    const connectedIds = new Set();
    const mountedIds = [];
    const measurements = [];
    const scrollContainer = findScrollContainer();

    document.querySelectorAll(USER_TURN_SELECTOR).forEach((turn) => {
      const id = getStableTurnId(turn);
      if (!id || connectedIds.has(id)) return;

      connectedIds.add(id);
      mountedIds.push(id);
      const previous = state.records.get(id);
      const absoluteTop = scrollContainer
        ? absoluteTopInContainer(turn, scrollContainer)
        : Number.NaN;
      measurements.push({ id, turn, previous, absoluteTop });
    });

    const anchorShift = model.computeAnchorShift(measurements.map(({ previous, absoluteTop }) => ({
      previousTop: previous?.absoluteTop,
      currentTop: absoluteTop,
    })));
    if (Math.abs(anchorShift) > 1) {
      state.records.forEach((record) => {
        if (Number.isFinite(record.absoluteTop)) record.absoluteTop += anchorShift;
      });
    }

    measurements.forEach(({ id, turn, previous, absoluteTop }) => {
      const searchText = extractQuestionText(turn)
        || previous?.searchText
        || previous?.excerpt
        || "";
      state.records.set(id, {
        id,
        role: "user",
        excerpt: searchText.slice(0, 220),
        searchText,
        element: turn,
        absoluteTop,
        measuredScrollHeight: scrollContainer?.scrollHeight || previous?.measuredScrollHeight || 0,
        sequence: previous?.sequence ?? Number.MAX_SAFE_INTEGER,
      });
    });

    state.orderedIds = model.mergeOrderedIds(state.orderedIds, mountedIds);
    const previousOrder = new Map(state.orderedIds.map((id, index) => [id, index]));
    state.orderedIds.sort((leftId, rightId) => {
      const left = state.records.get(leftId);
      const right = state.records.get(rightId);
      if (Number.isFinite(left?.absoluteTop) && Number.isFinite(right?.absoluteTop)) {
        const distance = left.absoluteTop - right.absoluteTop;
        if (Math.abs(distance) > 1) return distance;
      }
      return (previousOrder.get(leftId) ?? 0) - (previousOrder.get(rightId) ?? 0);
    });
    state.orderedIds.forEach((id, sequence) => {
      const record = state.records.get(id);
      if (record) record.sequence = sequence;
    });

    state.records.forEach((record, id) => {
      if (!connectedIds.has(id) && !record.element?.isConnected) record.element = null;
    });
  }

  function suppressOriginalTimeline() {
    ORIGINAL_TIMELINE_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (element === state.root || element.closest(`#${ROOT_ID}`)) return;
        element.dataset.cgptTimelineSuperseded = "true";
        element.setAttribute("aria-hidden", "true");
        element.hidden = true;
      });
    });
  }

  function createListMenuIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    icon.classList.add("cgpt-timeline__menu-icon");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("aria-hidden", "true");

    [5, 10, 15].forEach((y) => {
      const dot = document.createElementNS(namespace, "circle");
      dot.setAttribute("cx", "3.5");
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "1.25");
      dot.setAttribute("fill", "currentColor");

      const line = document.createElementNS(namespace, "line");
      line.setAttribute("x1", "7");
      line.setAttribute("x2", "18");
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-width", "1.8");
      icon.append(dot, line);
    });
    return icon;
  }

  function createSearchIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    icon.classList.add("cgpt-timeline__search-icon");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("aria-hidden", "true");

    const circle = document.createElementNS(namespace, "circle");
    circle.setAttribute("cx", "8.5");
    circle.setAttribute("cy", "8.5");
    circle.setAttribute("r", "5.25");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.8");

    const handle = document.createElementNS(namespace, "line");
    handle.setAttribute("x1", "12.5");
    handle.setAttribute("x2", "17");
    handle.setAttribute("y1", "12.5");
    handle.setAttribute("y2", "17");
    handle.setAttribute("stroke", "currentColor");
    handle.setAttribute("stroke-linecap", "round");
    handle.setAttribute("stroke-width", "1.8");
    icon.append(circle, handle);
    return icon;
  }

  function ensureRoot() {
    const host = findTimelineHost();
    if (!(host instanceof HTMLElement)) {
      if (state.root) state.root.hidden = true;
      closeTimelinePanel();
      state.host = null;
      return null;
    }

    if (
      state.root?.isConnected
      && state.tooltip?.isConnected
      && state.panel?.isConnected
    ) {
      if (state.root.parentElement !== host || state.panel.parentElement !== host) {
        host.append(state.root, state.panel);
      }
      state.host = host;
      return state.root;
    }

    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    document.querySelectorAll(
      '.cgpt-timeline__tooltip[data-chatgpt-timeline="tooltip"]',
    ).forEach((element) => element.remove());

    const root = document.createElement("nav");
    root.id = ROOT_ID;
    root.dataset.chatgptTimeline = "root";
    root.dataset.mountedInContent = "true";
    root.dataset.panelOpen = "false";
    root.setAttribute("aria-label", "用户问题时间轴");
    root.hidden = true;

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "cgpt-timeline__menu-button";
    menuButton.setAttribute("aria-label", "打开问题列表");
    menuButton.setAttribute("aria-controls", PANEL_ID);
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.title = "问题列表与搜索";
    menuButton.append(createListMenuIcon());
    menuButton.addEventListener("click", toggleTimelinePanel);

    const list = document.createElement("div");
    list.className = "cgpt-timeline__list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "用户问题");

    const tooltip = document.createElement("div");
    tooltip.className = "cgpt-timeline__tooltip";
    tooltip.dataset.chatgptTimeline = "tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "cgpt-timeline__panel";
    panel.dataset.chatgptTimeline = "panel";
    panel.setAttribute("aria-label", "问题列表");
    panel.hidden = true;

    const panelHeader = document.createElement("div");
    panelHeader.className = "cgpt-timeline__panel-header";

    const searchField = document.createElement("label");
    searchField.className = "cgpt-timeline__search-field";
    searchField.setAttribute("for", "cgpt-timeline-question-search");
    searchField.append(createSearchIcon());

    const panelInput = document.createElement("input");
    panelInput.id = "cgpt-timeline-question-search";
    panelInput.className = "cgpt-timeline__search-input";
    panelInput.type = "search";
    panelInput.placeholder = "搜索问题…";
    panelInput.setAttribute("aria-label", "搜索用户问题");
    panelInput.setAttribute("autocomplete", "off");
    panelInput.spellcheck = false;
    panelInput.addEventListener("input", handlePanelSearchInput);
    panelInput.addEventListener("keydown", handlePanelSearchKeydown);
    searchField.append(panelInput);
    panelHeader.append(searchField);

    const panelList = document.createElement("ol");
    panelList.className = "cgpt-timeline__panel-list";
    panelList.setAttribute("aria-label", "用户问题搜索结果");
    panel.append(panelHeader, panelList);

    root.append(menuButton, list);
    host.append(root, panel);
    document.body.append(tooltip);
    state.host = host;
    state.root = root;
    state.list = list;
    state.menuButton = menuButton;
    state.panel = panel;
    state.panelInput = panelInput;
    state.panelList = panelList;
    state.panelRenderSignature = "";
    state.tooltip = tooltip;
    return root;
  }

  function visibleRecords() {
    return model.getQuestionRecords(state.records.values());
  }

  function isTimelinePanelOpen() {
    return Boolean(state.panel && !state.panel.hidden);
  }

  function closeTimelinePanel({ resetSearch = true, returnFocus = false } = {}) {
    if (state.panel) state.panel.hidden = true;
    if (state.root) state.root.dataset.panelOpen = "false";
    if (state.menuButton) state.menuButton.setAttribute("aria-expanded", "false");

    if (resetSearch) {
      state.searchQuery = "";
      state.panelRenderSignature = "";
      if (state.panelInput) state.panelInput.value = "";
    }
    if (returnFocus) state.menuButton?.focus({ preventScroll: true });
  }

  function openTimelinePanel() {
    ensureRoot();
    if (!state.panel || !state.root || state.root.hidden) return;

    hideTooltip();
    state.panel.hidden = false;
    state.root.dataset.panelOpen = "true";
    state.menuButton?.setAttribute("aria-expanded", "true");
    state.panelRenderSignature = "";
    renderPanelList();
    window.requestAnimationFrame(() => state.panelInput?.focus({ preventScroll: true }));
  }

  function toggleTimelinePanel() {
    if (isTimelinePanelOpen()) closeTimelinePanel();
    else openTimelinePanel();
  }

  function handlePanelSearchInput(event) {
    state.searchQuery = event.currentTarget.value;
    state.panelRenderSignature = "";
    renderPanelList();
  }

  function handlePanelSearchKeydown(event) {
    if (event.key !== "Enter") return;
    const firstResult = state.panelList?.querySelector(".cgpt-timeline__panel-item-button");
    if (!firstResult) return;
    event.preventDefault();
    firstResult.click();
  }

  function renderPanelList() {
    if (!isTimelinePanelOpen() || !state.panelList) return;

    const records = visibleRecords();
    const signature = [
      state.searchQuery,
      ...records.map((record) => [
        record.id,
        record.sequence,
        record.excerpt,
        record.searchText,
      ].join(":")),
    ].join("\u001f");
    if (signature === state.panelRenderSignature) {
      updatePanelActiveItem();
      return;
    }

    state.panelRenderSignature = signature;
    const numberById = new Map(records.map((record, index) => [record.id, index + 1]));
    const matches = model.filterQuestionRecords(records, state.searchQuery);
    const fragment = document.createDocumentFragment();

    if (matches.length === 0) {
      const empty = document.createElement("li");
      empty.className = "cgpt-timeline__panel-empty";
      empty.textContent = "没有匹配的问题";
      fragment.append(empty);
    } else {
      matches.forEach((record) => {
        const questionNumber = numberById.get(record.id) || 1;
        const item = document.createElement("li");
        item.className = "cgpt-timeline__panel-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "cgpt-timeline__panel-item-button";
        button.dataset.turnKey = record.id;
        button.setAttribute("aria-label", `问题 ${questionNumber}：${record.excerpt || "用户问题"}`);
        button.title = record.searchText || record.excerpt || "用户问题";

        const number = document.createElement("span");
        number.className = "cgpt-timeline__panel-item-number";
        number.textContent = String(questionNumber);

        const text = document.createElement("span");
        text.className = "cgpt-timeline__panel-item-text";
        text.textContent = record.excerpt || "用户问题";

        button.append(number, text);
        button.addEventListener("click", () => {
          closeTimelinePanel();
          jumpToRecord(record.id);
        });
        item.append(button);
        fragment.append(item);
      });
    }

    state.panelList.replaceChildren(fragment);
    updatePanelActiveItem();
  }

  function updatePanelActiveItem() {
    state.panelList?.querySelectorAll(".cgpt-timeline__panel-item-button").forEach((button) => {
      if (button.dataset.turnKey === state.activeId) {
        button.setAttribute("aria-current", "location");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function handleDocumentPointerDown(event) {
    if (!isTimelinePanelOpen()) return;
    const target = event.target;
    if (
      target instanceof Node
      && (state.panel?.contains(target) || state.menuButton?.contains(target))
    ) {
      return;
    }
    closeTimelinePanel();
  }

  function recordSignature(record) {
    return [
      record.id,
      record.sequence,
      Math.round(record.absoluteTop || 0),
      record.element?.isConnected ? 1 : 0,
      record.excerpt,
    ].join(":");
  }

  function renderTimeline() {
    const root = ensureRoot();
    if (!root) {
      closeTimelinePanel();
      hideTooltip();
      return;
    }
    const records = visibleRecords();
    if (!state.conversationKey || records.length === 0) {
      root.hidden = true;
      closeTimelinePanel();
      hideTooltip();
      return;
    }

    root.hidden = false;
    root.setAttribute("aria-busy", String(state.loadingEarlier || Boolean(state.navigationTargetId)));
    const signature = [
      state.conversationKey,
      state.fullyIndexed ? "complete" : "partial",
      state.loadingEarlier ? "loading" : "idle",
      state.navigationTargetId || "",
      state.navigationErrorId || "",
      ...records.map(recordSignature),
    ].join("\u001f");
    if (signature === state.renderSignature) {
      updateActiveNode();
      renderPanelList();
      return;
    }

    state.renderSignature = signature;
    hideTooltip();
    const fragment = document.createDocumentFragment();
    if (!state.fullyIndexed) fragment.append(createLoadEarlierButton());
    records.forEach((record, index) => fragment.append(createTimelineNode(record, index + 1)));
    state.list.replaceChildren(fragment);
    updateActiveNode();
    renderPanelList();
  }

  function createLoadEarlierButton() {
    const item = document.createElement("div");
    item.className = "cgpt-timeline__item cgpt-timeline__item--load-earlier";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cgpt-timeline__load-earlier";
    button.disabled = state.loadingEarlier;
    button.setAttribute("aria-label", state.loadingEarlier ? "正在加载更早问题" : "加载全部更早问题");
    button.title = state.loadingEarlier ? "正在加载更早问题" : "加载更早问题";
    button.dataset.loading = String(state.loadingEarlier);

    const accessibleText = document.createElement("span");
    accessibleText.className = "cgpt-timeline__sr-only";
    accessibleText.textContent = button.getAttribute("aria-label");
    button.append(accessibleText);
    button.addEventListener("click", loadEarlierQuestions);
    item.append(button);
    return item;
  }

  function createTimelineNode(record, questionNumber) {
    const item = document.createElement("div");
    item.className = "cgpt-timeline__item";
    item.setAttribute("role", "listitem");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cgpt-timeline__node";
    button.dataset.turnKey = record.id;
    button.dataset.loading = String(state.navigationTargetId === record.id);
    button.dataset.error = String(state.navigationErrorId === record.id);
    const preview = record.excerpt || "用户问题";
    button.setAttribute("aria-label", `问题 ${questionNumber}：${preview}`);

    const accessibleText = document.createElement("span");
    accessibleText.className = "cgpt-timeline__sr-only";
    accessibleText.textContent = `问题 ${questionNumber}`;
    button.append(accessibleText);
    button.addEventListener("click", () => jumpToRecord(record.id));
    button.addEventListener("mouseenter", () => showTooltip(button, record, questionNumber));
    button.addEventListener("mouseleave", hideTooltip);
    button.addEventListener("focus", () => showTooltip(button, record, questionNumber));
    button.addEventListener("blur", hideTooltip);
    item.append(button);
    return item;
  }

  function showTooltip(button, record, questionNumber) {
    if (!state.tooltip || isTimelinePanelOpen()) return;

    const heading = document.createElement("strong");
    heading.textContent = state.navigationErrorId === record.id
      ? `问题 ${questionNumber}暂未挂载`
      : `问题 ${questionNumber}`;
    const text = document.createElement("span");
    text.textContent = state.navigationErrorId === record.id
      ? "请先点击时间轴最上方的加载标记，再重试。"
      : (record.excerpt || "滚动到该问题后可读取完整内容。");
    state.tooltip.replaceChildren(heading, text);
    state.tooltip.hidden = false;

    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = state.tooltip.getBoundingClientRect();
    state.tooltip.style.left = `${Math.round(Math.max(
      12,
      Math.min(window.innerWidth - tooltipRect.width - 12, buttonRect.right + 10),
    ))}px`;
    state.tooltip.style.top = `${Math.round(Math.min(
      window.innerHeight - tooltipRect.height - 12,
      Math.max(12, buttonRect.top + buttonRect.height / 2 - tooltipRect.height / 2),
    ))}px`;
  }

  function hideTooltip() {
    if (state.tooltip) state.tooltip.hidden = true;
  }

  function findTurnElement(turnId) {
    const selector = `${USER_TURN_SELECTOR}[data-turn-id="${navigation.cssEscape(turnId)}"]`;
    const mounted = document.querySelector(selector);
    const record = state.records.get(turnId);
    if (record) record.element = mounted instanceof HTMLElement ? mounted : null;
    return mounted instanceof HTMLElement ? mounted : null;
  }

  function findScrollContainer() {
    const turn = document.querySelector(TURN_SELECTOR);
    return turn
      ? navigation.getScrollContainerForElement(turn)
      : (document.scrollingElement || document.documentElement);
  }

  function flashTurn(turn) {
    turn.classList.remove("cgpt-timeline__target-flash");
    void turn.offsetWidth;
    turn.classList.add("cgpt-timeline__target-flash");
    window.setTimeout(() => turn.classList.remove("cgpt-timeline__target-flash"), FLASH_MS);
  }

  async function alignRecord(turnId, token) {
    const result = await navigation.alignToResolver(
      () => findTurnElement(turnId),
      { offset: 88, timeoutMs: 2600 },
      token,
    );
    const turn = findTurnElement(turnId);
    if (result.ok && turn) flashTurn(turn);
    return result;
  }

  function connectedSequenceRange() {
    const connected = visibleRecords().filter((record) => findTurnElement(record.id));
    if (connected.length === 0) return null;
    return {
      minimum: Math.min(...connected.map((record) => record.sequence)),
      maximum: Math.max(...connected.map((record) => record.sequence)),
    };
  }

  async function locateVirtualizedRecord(turnId, token) {
    const deadline = Date.now() + LOCATE_TIMEOUT_MS;
    let attempt = 0;

    while (!token.cancelled && Date.now() < deadline) {
      discoverQuestions();
      if (findTurnElement(turnId)) return alignRecord(turnId, token);

      const record = state.records.get(turnId);
      const container = findScrollContainer();
      if (!record || !container) break;

      const records = visibleRecords();
      const targetIndex = records.findIndex((candidate) => candidate.id === turnId);
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const range = connectedSequenceRange();
      let nextTop;

      if (Number.isFinite(record.absoluteTop)) {
        const nudgePattern = [0, -0.32, 0.32, 0];
        const nudge = nudgePattern[attempt % nudgePattern.length] * container.clientHeight;
        nextTop = record.absoluteTop - 88 + nudge;
      } else if (!range) {
        const ratio = records.length > 1 ? targetIndex / (records.length - 1) : 0;
        nextTop = ratio * maxScroll;
      } else if (record.sequence < range.minimum) {
        nextTop = container.scrollTop - Math.max(container.clientHeight * 0.82, 520);
      } else if (record.sequence > range.maximum) {
        nextTop = container.scrollTop + Math.max(container.clientHeight * 0.82, 520);
      } else {
        const ratio = records.length > 1 ? targetIndex / (records.length - 1) : 0;
        nextTop = ratio * maxScroll;
      }

      attempt += 1;
      navigation.setScrollTopInstant(container, nextTop);
      await navigation.waitForDomChange(280, token);
      await navigation.wait(70, token);
    }

    return { ok: false, cancelled: token.cancelled };
  }

  function jumpToRecord(turnId) {
    hideTooltip();
    navigation.enqueueWithHistory(async (token) => {
      state.navigationTargetId = turnId;
      state.navigationErrorId = null;
      state.activeId = turnId;
      renderTimeline();

      const result = findTurnElement(turnId)
        ? await alignRecord(turnId, token)
        : await locateVirtualizedRecord(turnId, token);

      state.navigationTargetId = null;
      if (!result.ok && !result.cancelled) {
        state.navigationErrorId = turnId;
        window.setTimeout(() => {
          if (state.navigationErrorId === turnId) {
            state.navigationErrorId = null;
            state.renderSignature = "";
            renderTimeline();
          }
        }, 3200);
      }
      state.renderSignature = "";
      renderTimeline();
      scheduleActiveUpdate();
      return result;
    });
  }

  function loadEarlierQuestions() {
    hideTooltip();
    navigation.enqueue(async (token) => {
      state.loadingEarlier = true;
      state.navigationErrorId = null;
      state.renderSignature = "";
      renderTimeline();

      const deadline = Date.now() + LOAD_EARLIER_TIMEOUT_MS;
      let previousSignature = "";
      let stablePasses = 0;
      let firstTurnPasses = 0;

      while (!token.cancelled && Date.now() < deadline) {
        discoverQuestions();
        const container = findScrollContainer();
        if (!container) break;

        const step = Math.max(container.clientHeight * 2.25, 1200);
        navigation.setScrollTopInstant(container, Math.max(0, container.scrollTop - step));
        await navigation.waitForDomChange(220, token);
        await navigation.wait(70, token);
        discoverQuestions();

        const signature = state.orderedIds.join("\u001f");
        const refreshedContainer = findScrollContainer();
        const atTop = !refreshedContainer || refreshedContainer.scrollTop <= 2;
        const firstUserTurnMounted = Boolean(document.querySelector(
          '[data-testid="conversation-turn-1"][data-turn="user"][data-turn-id]',
        ));
        if (signature === previousSignature && atTop) stablePasses += 1;
        else stablePasses = 0;
        if (firstUserTurnMounted && atTop) firstTurnPasses += 1;
        else firstTurnPasses = 0;
        previousSignature = signature;
        if (firstTurnPasses >= 2 || stablePasses >= 8) {
          state.fullyIndexed = true;
          break;
        }
      }

      state.loadingEarlier = false;
      state.renderSignature = "";
      renderTimeline();

      if (!token.cancelled && state.orderedIds.length > 0) {
        const firstId = state.orderedIds[0];
        state.activeId = firstId;
        state.navigationTargetId = firstId;
        await alignRecord(firstId, token);
        state.navigationTargetId = null;
        state.renderSignature = "";
        renderTimeline();
        scheduleActiveUpdate();
      }
      return { ok: state.fullyIndexed, cancelled: token.cancelled };
    });
  }

  let activeAnimationFrame = 0;
  function scheduleActiveUpdate() {
    if (activeAnimationFrame) return;
    activeAnimationFrame = window.requestAnimationFrame(() => {
      activeAnimationFrame = 0;
      updateActiveFromViewport();
    });
  }

  function updateActiveFromViewport() {
    if (state.navigationTargetId || state.loadingEarlier) {
      updateActiveNode();
      return;
    }

    const records = visibleRecords();
    if (records.length === 0) return;

    const scrollContainer = findScrollContainer();
    const maximumScroll = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const atConversationEnd = maximumScroll > 0 && scrollContainer.scrollTop >= maximumScroll - 2;
    let active = atConversationEnd ? records.at(-1) : null;

    if (!active) {
      const absoluteAnchor = absolutePositionAtReadingLine(scrollContainer);
      active = model.getActiveQuestionAtPosition(
        records.map((record) => ({ ...record, position: record.absoluteTop })),
        absoluteAnchor,
      );
    }

    if (!active) {
      const connected = records.filter((record) => findTurnElement(record.id));
      const viewportAnchor = navigation.viewportReadingLine(scrollContainer);
      active = model.getActiveQuestionAtPosition(
        connected.map((record) => ({
          ...record,
          position: record.element.getBoundingClientRect().top,
        })),
        viewportAnchor,
      );
    }
    state.activeId = active?.id ?? null;
    updateActiveNode();
  }

  function releaseNavigationFocusFromInput() {
    if (!state.navigationTargetId) return;
    state.navigationTargetId = null;
    state.renderSignature = "";
    renderTimeline();
    scheduleActiveUpdate();
  }

  function updateActiveNode() {
    if (!state.root) return;

    let activeNode = null;
    state.root.querySelectorAll(".cgpt-timeline__node").forEach((node) => {
      const active = node.dataset.turnKey === state.activeId;
      node.dataset.active = String(active);
      if (active) {
        node.setAttribute("aria-current", "location");
        activeNode = node;
      } else {
        node.removeAttribute("aria-current");
      }
    });
    updatePanelActiveItem();

    if (!activeNode || !state.list) return;
    const top = activeNode.offsetTop;
    const bottom = top + activeNode.offsetHeight;
    if (top < state.list.scrollTop) state.list.scrollTop = top;
    else if (bottom > state.list.scrollTop + state.list.clientHeight) {
      state.list.scrollTop = bottom - state.list.clientHeight;
    }
  }

  function navigateRelative(direction) {
    const target = model.getRelativeQuestion(state.records.values(), state.activeId, direction);
    if (target) jumpToRecord(target.id);
  }

  function jumpToEdge(edge) {
    if (edge === "first" && !state.fullyIndexed) {
      loadEarlierQuestions();
      return;
    }
    const records = visibleRecords();
    const target = edge === "first" ? records[0] : records.at(-1);
    if (target) jumpToRecord(target.id);
  }

  function isEditableTarget(target) {
    return target instanceof Element && Boolean(
      target.closest('input, textarea, select, [contenteditable="true"]'),
    );
  }

  function handleGlobalKeydown(event) {
    if (event.key === "Escape") {
      if (isTimelinePanelOpen()) {
        event.preventDefault();
        event.stopPropagation();
        closeTimelinePanel({ returnFocus: true });
        return;
      }
      hideTooltip();
      navigation.cancelActive();
      return;
    }
    if (
      !state.root
      || state.root.hidden
      || isEditableTarget(event.target)
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) return;

    if (event.key === "j" && !event.shiftKey) {
      event.preventDefault();
      navigateRelative(1);
      return;
    }
    if (event.key === "k" && !event.shiftKey) {
      event.preventDefault();
      navigateRelative(-1);
      return;
    }

    const now = Date.now();
    if (event.key === "g") {
      if (now - state.lastG < 600) {
        event.preventDefault();
        state.lastG = 0;
        jumpToEdge("first");
      } else state.lastG = now;
      return;
    }
    if (event.key === "G") {
      if (now - state.lastShiftG < 600) {
        event.preventDefault();
        state.lastShiftG = 0;
        jumpToEdge("last");
      } else state.lastShiftG = now;
    }
  }

  function scan() {
    state.scanTimer = 0;
    syncConversation();
    ensureRoot();
    suppressOriginalTimeline();
    discoverQuestions();
    renderTimeline();
    scheduleActiveUpdate();
  }

  function scheduleScan() {
    if (state.scanTimer) window.clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scan, SCAN_DELAY_MS);
  }

  function start() {
    state.observer = new MutationObserver(scheduleScan);
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("keydown", handleGlobalKeydown, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("scroll", scheduleActiveUpdate, { passive: true, capture: true });
    window.addEventListener("wheel", releaseNavigationFocusFromInput, { passive: true, capture: true });
    window.addEventListener("touchstart", releaseNavigationFocusFromInput, { passive: true, capture: true });
    window.addEventListener("pointerdown", releaseNavigationFocusFromInput, { passive: true, capture: true });
    window.addEventListener("keydown", releaseNavigationFocusFromInput, { capture: true });
    window.addEventListener("resize", hideTooltip, { passive: true });
    window.addEventListener("popstate", scheduleScan);
    scan();
  }

  start();
})();
