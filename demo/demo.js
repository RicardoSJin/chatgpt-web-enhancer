"use strict";

document.getElementById("simulate-stream").addEventListener("click", (event) => {
  const answer = document.querySelector('[data-testid="conversation-turn-2"] [data-message-author-role="assistant"]');
  const heading = document.createElement("h2");
  const paragraph = document.createElement("p");

  heading.textContent = "流式新增章节";
  paragraph.textContent = "这个标题在页面加载后动态插入，用于验证目录数字和列表会自动刷新。";
  answer.append(heading, paragraph);
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "已新增标题";
});

document.getElementById("simulate-unmount-current-question").addEventListener("click", (event) => {
  document.querySelector('[data-turn="user"][data-turn-id="demo-user-1"]')?.remove();
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "当前问题节点已卸载";
});

function showDialog({ id, title, description }) {
  document.querySelector(".demo-dialog-overlay")?.remove();

  const overlay = document.createElement("div");
  const dialog = document.createElement("div");
  const heading = document.createElement("h2");
  const paragraph = document.createElement("p");
  const closeButton = document.createElement("button");

  overlay.className = "demo-dialog-overlay";
  dialog.className = "demo-dialog";
  dialog.id = id;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  heading.id = `${id}-title`;
  heading.textContent = title;
  paragraph.textContent = description;
  closeButton.className = "demo-dialog-close";
  closeButton.type = "button";
  closeButton.dataset.testid = "close-button";
  closeButton.setAttribute("aria-label", "关闭");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => overlay.remove());
  dialog.append(heading, paragraph, closeButton);
  overlay.append(dialog);
  document.body.append(overlay);
}

document.getElementById("simulate-pro-dialog").addEventListener("click", () => {
  showDialog({
    id: "demo-pro-dialog",
    title: "获取 Pro",
    description: "升级到 ChatGPT Pro，获得更多使用额度。",
  });
});

document.getElementById("simulate-ordinary-dialog").addEventListener("click", () => {
  showDialog({
    id: "demo-ordinary-dialog",
    title: "普通设置",
    description: "这个弹窗用于确认扩展不会误点其他关闭按钮。",
  });
});

document.getElementById("simulate-host-replacement").addEventListener("click", (event) => {
  const host = document.querySelector('[data-side-pane-shell-host="true"]');
  if (!host) return;

  const replacement = host.cloneNode(true);
  replacement.dataset.demoHostGeneration = "2";
  host.replaceWith(replacement);
  event.currentTarget.disabled = true;
});

const demoScroller = document.querySelector("main");
let olderTurns = null;
let olderTurnsMounted = false;
let virtualIndexReady = false;
let allowVirtualUnmount = false;
let olderBlockHeight = 0;
demoScroller.dataset.demoVirtualStage = "recent";

function createOlderTurn(role, id, text) {
  const turn = document.createElement("section");
  turn.dataset.turn = role;
  turn.dataset.turnId = id;
  const message = document.createElement("div");
  message.dataset.messageAuthorRole = role;
  if (role === "user") {
    message.textContent = text;
  } else {
    const heading = document.createElement("h2");
    heading.textContent = text;
    const paragraph = document.createElement("p");
    paragraph.textContent = "这是滚动到顶部后才挂载的模拟旧回答，用来复现 ChatGPT 长对话的虚拟窗口。";
    paragraph.style.minHeight = "3600px";
    message.append(heading, paragraph);
  }
  turn.append(message);
  return turn;
}

function renumberMountedTurns(startAt) {
  demoScroller.querySelectorAll("section[data-turn]").forEach((turn, index) => {
    turn.dataset.testid = `conversation-turn-${startAt + index}`;
  });
}

function mountOlderTurns() {
  if (olderTurnsMounted) {
    return;
  }
  if (!olderTurns) {
    olderTurns = [
      createOlderTurn("user", "demo-user-old-1", "这是虚拟加载的第一个旧问题。"),
      createOlderTurn("assistant", "demo-assistant-old-1", "旧回答一"),
      createOlderTurn("user", "demo-user-old-2", "这是虚拟加载的第二个旧问题。"),
      createOlderTurn("assistant", "demo-assistant-old-2", "旧回答二"),
    ];
  }

  document.getElementById("demo-virtual-spacer")?.remove();
  const firstTurn = demoScroller.querySelector("section[data-turn]");
  olderTurns.forEach((turn) => demoScroller.insertBefore(turn, firstTurn));
  olderTurnsMounted = true;
  virtualIndexReady = true;
  allowVirtualUnmount = false;
  demoScroller.dataset.demoVirtualStage = "indexed";
  window.setTimeout(() => {
    allowVirtualUnmount = true;
  }, 1800);
  renumberMountedTurns(1);
}

function unmountOlderTurns() {
  if (!olderTurnsMounted) {
    return;
  }
  const height = olderTurns.reduce((total, turn) => total + turn.getBoundingClientRect().height, 0);
  olderBlockHeight = height;
  const spacer = document.createElement("div");
  spacer.id = "demo-virtual-spacer";
  spacer.style.height = `${Math.max(1, height)}px`;
  demoScroller.insertBefore(spacer, olderTurns[0]);
  olderTurns.forEach((turn) => turn.remove());
  olderTurnsMounted = false;
  demoScroller.dataset.demoVirtualStage = "virtualized";
  renumberMountedTurns(21);
}

demoScroller.addEventListener("scroll", () => {
  if (!virtualIndexReady && demoScroller.scrollTop <= 2) {
    mountOlderTurns();
    return;
  }

  if (
    virtualIndexReady
    && allowVirtualUnmount
    && olderTurnsMounted
    && demoScroller.scrollTop > 700
  ) {
    unmountOlderTurns();
  } else if (
    virtualIndexReady
    && !olderTurnsMounted
    && demoScroller.scrollTop < Math.max(360, olderBlockHeight)
  ) {
    mountOlderTurns();
  }
});
