# AGENTS.md

ChatGPT 网页增强：一个只有内容脚本的 Chrome / Edge Manifest V3 扩展，在 `https://chatgpt.com/*` 上提供当前回答的标题目录（可折叠）、目录旁的"返回 / 前进"跳转历史、左侧用户问题时间轴（悬停预览、问题列表搜索、`j` / `k` / `gg` / `GG` 快捷键），并自动关闭"获取 Pro"推广弹窗。核心难点是 ChatGPT 长对话的虚拟列表：消息会被卸载、重新挂载、整体重编号，所以每次跳转都按稳定的 `data-turn-id` 重新查找目标，并反复校准位置。

## 技术栈与约束

- 纯 JavaScript，**无依赖、无构建步骤、没有 `package.json`**；仓库根目录就是可直接"加载已解压的扩展程序"的扩展目录
- 只有 `content_scripts`（`document_idle`，只匹配 `https://chatgpt.com/*`），没有 background / popup / options 页，**没有任何 `permissions` / `host_permissions`**
- 内容脚本是普通脚本（不是 ES Module），模块之间通过 `window` 上的全局对象通信，**`manifest.json` 里 `js` 的顺序就是依赖顺序**
- 未声明 `minimum_chrome_version`；CSS 用了 `color-mix()`（Chrome 111+），实际支持的最低版本没测过 ❓
- 界面文字和 `aria-label` 都是中文；代码标识符、提交信息用英文
- 测试只用 Node 自带的 `node:test`

## 目录结构

| 文件 | 作用 |
|---|---|
| `manifest.json` | MV3 清单：只声明内容脚本和两份 CSS |
| `src/outline.js` | 纯函数（全局 `ChatGPTAnswerTocOutline`）：标题 → 目录条目（压缩跨级层级、`hasChildren`、稳定折叠键）、折叠后的可见条目 |
| `src/navigation.js` | 共享导航层（全局 `ChatGPTStableNavigation`）：阅读线、滚动容器识别、串行导航队列、对齐校准、跳转历史 |
| `src/content.js` | 回答目录：顶部目录按钮 + 返回 / 前进按钮、目录面板、标题跳转 |
| `src/timeline-model.js` | 纯函数（全局 `ChatGPTTimelineModel`）：问题排序与合并、锚点位移、当前问题判定、搜索、编辑分支裁剪、切换聊天判定 |
| `src/timeline.js` | 左侧问题时间轴：索引用户问题、悬停预览、问题列表搜索、快捷键、虚拟列表定位、加载更早问题、隐藏原生时间轴 |
| `src/dismiss-promos.js` | 自动关闭"获取 Pro"推广弹窗（全局 `ChatGPTProDialogDismissal`，加载即启动） |
| `src/styles.css` / `src/timeline.css` | 目录 / 时间轴样式（含暗色主题、`prefers-reduced-motion`、`forced-colors`） |
| `demo/index.html` + `demo/demo.js` | 本地模拟页：模拟 ChatGPT 的 DOM 结构，直接加载 `src/` 下的脚本，带调试按钮 |
| `tests/*.test.cjs` | `node:test` 单元测试，只覆盖 `outline.js`、`navigation.js`、`timeline-model.js`、`dismiss-promos.js` 里的纯逻辑 |
| `README.md` | 面向用户的中文说明、各版本更新说明，以及**"页面契约"**一节（依赖的 ChatGPT DOM 结构） |

`content.js`、`timeline.js` 是只能在浏览器里运行的 IIFE，没有单元测试，靠 demo 和真实页面验证。

## 常用命令

| 用途 | 命令 |
|---|---|
| 安装依赖 / 构建 / 代码检查 | 无 |
| 测试 | `node --test tests/*.test.cjs`（34 个用例） |
| 语法检查 | `for f in src/*.js demo/demo.js; do node --check "$f"; done`（成功时无输出；PowerShell 写法见 README"本地演示和检查"） |
| 查看清单版本 | `node -p "require('./manifest.json').version"` |
| 打包（macOS，生成的 10 个文件与已发布 ZIP 一致） | `mkdir -p dist && zip -q -X -D -r dist/chatgpt-web-enhancer-$(node -p "require('./manifest.json').version").zip manifest.json README.md src -x '*.DS_Store'` |

- `dist/` 已在 `.gitignore` 里
- 发布 ZIP 只含 `manifest.json`、`README.md`、`src/`，不含 `demo/`、`tests/`
- 仓库里没有打包脚本；已发布的 ZIP 是在 Windows 上生成的（`zipinfo` 显示 fat 属性），用的是什么工具不清楚 ❓

## 本地调试

**真实页面**

1. `chrome://extensions`（或 `edge://extensions`）开启开发者模式 →"加载已解压的扩展程序"→ 选仓库根目录。README 里写的 `chatgpt-answer-toc` 是作者本地的旧目录名；换一个目录加载会变成另一个未打包扩展
2. 改代码后在扩展页点"重新加载"，再强制刷新 ChatGPT 页面（`Ctrl+Shift+R` / `Cmd+Shift+R`）；内容脚本只在页面加载时注入
3. 内容脚本运行在隔离环境：在 DevTools 控制台的上下文下拉框里切到本扩展，才能访问 `window.ChatGPTStableNavigation` 等全局对象。代码里没有 `console` 日志

**`demo/` 模拟页**（不用登录 ChatGPT，也不用加载扩展）

- 直接用浏览器打开 `demo/index.html`（macOS：`open demo/index.html`）。它把 `src/` 下的脚本按 manifest 的顺序当普通页面脚本加载，模拟了 `data-side-pane-shell-host`、`conversation-options-button`、`conversation-turn-N` + `data-turn-id`、`data-scroll-root` 等结构
- 正常时：顶部"更多"按钮右侧出现目录按钮（角标 7）和返回 / 前进按钮，左侧时间轴有 2 条短横线，红色的"模拟原时间轴"被隐藏
- 调试按钮：模拟流式新增标题、卸载当前问题节点、显示获取 Pro 弹窗（应被自动关闭）/ 显示普通弹窗（不应被关闭）、替换主内容容器、模拟编辑消息后重发、模拟长目录
- 虚拟列表模拟：对话区滚到顶部会挂载 4 个更早的轮次并整体重编号；挂载 1.8 秒后再往下滚超过 700 px，会把它们换成等高占位块并从 `conversation-turn-21` 重新编号
- demo 没有模拟单页切换聊天（URL 不是 `/c/<id>`），切换聊天相关的修改只能在真实 ChatGPT 上验证
- `demo/index.html` 引用脚本和样式时带 `?v=XXYY` 缓存参数（共 9 处），升版本时一起改

## 架构要点

- **模块形式**：`outline.js`、`navigation.js`、`timeline-model.js`、`dismiss-promos.js` 是 UMD 写法，同时导出 `module.exports`（给测试用）和 `window.ChatGPT*` 全局对象；`content.js`、`timeline.js` 是 IIFE，启动时检查依赖的全局对象是否存在。所有模块都跳过 iframe（`window.top !== window.self`），并用 `window.__chatgpt*Initialized` 防止重复初始化
- **DOM 监听**：`content.js`（防抖 120 ms）和 `timeline.js`（140 ms）各用一个 `MutationObserver` 监听 `document.body` 的 `childList + subtree + characterData`；`dismiss-promos.js` 监听 `documentElement`（60 ms）。流式回答、新消息、单页导航、容器替换都靠重新扫描处理，没有路由钩子（时间轴另外监听 `popstate`）
- **避免自激循环**：扩展自己改 DOM 也会触发上面的观察器，所以写入前都先比较：`setAttributeIfChanged`、目录面板的 `signature`、时间轴的 `renderSignature` / `panelRenderSignature`，签名没变就不重建。新增渲染逻辑要沿用这个做法
- **阅读线**（`navigation.js` 的 `readingLineOffset` / `viewportReadingLine`）：滚动容器可视高度的 32%，下限 104 px，距底部至少 80 px。目录绑定"包含阅读线或离它最近"的助手回答（距离相同取靠后的）；时间轴取"缓存绝对坐标在阅读线之前的最后一个问题"；滚到容器底部（差 2 px 以内）时两者都直接取最后一个。目录面板里高亮的当前标题另用固定阈值：视口顶部 140 px 以上的最后一个标题
- **滚动容器**：从目标元素往上找第一个 `overflow-y` 为 `auto` / `scroll` / `overlay` 的祖先，找不到就用 `document.scrollingElement`，没有写死 ChatGPT 的容器选择器。滚动统一用 `setScrollTopInstant`，临时把 `scroll-behavior` 设为 `auto !important`
- **导航队列**（`navigation.enqueue`）：所有跳转串行执行；新任务默认取消正在执行的任务并丢弃排队任务；用户的 `wheel` / `touchstart` / `pointerdown` / `keydown` 会取消当前任务。`alignToResolver` 每一轮都重新查找目标元素（不持有旧 DOM 引用），按 0 / 64 / 120 / 220 / 360 / 520 ms 的节奏校准，连续 2 次对齐（误差 2 px 以内，或已到顶 / 底滚不动）才算成功。目录跳转偏移 96 px、超时 2.4 s；时间轴偏移 88 px、超时 2.6 s
- **跳转历史**：`enqueueWithHistory` 在跳转成功后记录跳转前、跳转后两个位置；位置 = 离阅读线最近轮次的 `data-turn-id` + 相对阅读线的偏移 + `scrollTop` + 滚动比例。最多 50 条，返回后再跳转会丢弃前进分支。恢复时先按 `scrollTop`（超出范围按比例）粗定位，等锚点轮次挂载后再校准，超时 3.2 s。URL（`origin + pathname + search`）变化、切换聊天、确认编辑分支替换时清空历史；状态变化通过 `chatgpt-stable-navigation-history-change` 事件通知按钮刷新。"加载更早问题"走 `enqueue`，不记历史
- **回答目录**（`content.js`）：助手轮次 = `primaryTurn`、`fallbackTurn`、`[data-message-author-role="assistant"]` 所在轮次三者的并集，按文档顺序排序；标题 = 轮次内助手消息里的 `h1`–`h6`。轮次键优先用 `native:<data-turn-id>`，没有时给元素写 `data-cgpt-toc-turn-key` 兜底。打开面板后锁定该回答；点击条目时按"序号 + 级别 + 文本"重新查找标题，找不到再按"级别 + 文本"找。跳转期间用 `activeTurnOverrideKey` 让按钮保持绑定目标回答，用户滚动输入会解除
- **目录层级与折叠**（`outline.js`）：用栈把跨级标题压缩成连续的显示层级（`displayLevel`），原始 `level` 仍用于定位；折叠状态按"级别 + 文本 + 第几次出现"生成的键保存，流式刷新后不会丢，关闭面板即清空；当前标题被折叠时高亮落到可见的上级标题
- **时间轴索引**（`timeline.js` 的 `discoverQuestions`）：只认 `data-turn="user"` 且有 `data-turn-id` 的轮次，记录它们在滚动内容中的绝对坐标。仍挂载的轮次坐标整体移动时（前面插入了旧消息），用位移中位数修正所有缓存坐标（`computeAnchorShift`）。顺序先用 `mergeOrderedIds` 按稳定锚点插入新 ID，再按绝对坐标排序。**`conversation-turn-N` 会随虚拟窗口重编号，不能当身份或排序依据。**问题文本只在内存里，最长 4000 字，摘要 220 字
- **虚拟列表定位**：目标问题没挂载时，`locateVirtualizedRecord` 按缓存坐标（加 ±32% 视口高度的抖动）或已挂载范围上下翻页并等待 DOM 变化，最长 15 s。时间轴没完整索引时顶部显示加载标记，`loadEarlierQuestions` 每次往上滚 max(2.25 屏, 1200 px)，直到 `conversation-turn-1` 挂载且已到顶（连续 2 次），或到顶后顺序连续 8 次不变，最长 45 s；未完整索引时按 `gg` 也会触发它
- **编辑分支替换**：按 `conversation-turn-N` 槽位记录对应的 `data-turn-id`；同一槽位换了 ID 且旧 ID 已不在 DOM 中时记为待定（12 s 内有效），只有新轮次里出现 `variants-turn-action-button`（"查看版本"）时才确认，随后 `reconcileReplacedBranch` 删除旧问题及其后面未挂载的旧分支尾部，并重置跳转历史。普通虚拟滚动不会触发清理
- **切换聊天**：会话键取 URL 里的 `/c/<id>`，否则在页面有轮次时用 `page:<pathname>`。键变化时取消导航、清空历史和全部记录，并记下旧聊天的轮次 ID；只要挂载的轮次里还有旧 ID，就暂停索引并隐藏时间轴（`isConversationDomReady`）
- **挂载位置**：时间轴和问题列表面板挂在"可见（非 `hidden` / `inert` / `aria-hidden`）且包含对话轮次"的 `[data-side-pane-shell-host="true"]` 里，绝对定位在它的左侧，容器被替换时自动迁移；悬停提示框挂在 `body`。目录面板也挂在 `body`，按按钮位置 fixed 定位
- **原生时间轴**：`ORIGINAL_TIMELINE_SELECTORS` 命中的元素加上 `data-cgpt-timeline-superseded`、`hidden`、`aria-hidden`，CSS 再用 `display: none !important` 兜底
- **推广弹窗**（`dismiss-promos.js`）：只找 `button[data-testid="close-button"]` 且 `aria-label` 正好是"关闭"或"Close"的按钮；它所在的 `[role="dialog"]` / `[aria-modal="true"]` 文本要匹配 `PRO_PROMOTION_PATTERNS`（获取 / 升级 / 订阅 / 购买 Pro，Get / Upgrade to / Subscribe to / Try Pro）。没有显式对话框时，最多往上找 8 层，要求容器文本不超过 2500 字、像浮层（类名 / testid 含 modal、dialog、overlay、popover、fixed，或 `position: fixed`）。点击前在下一帧再校验一次，同一个按钮最多点 3 次
- **快捷键**（`timeline.js`，在 `document` 捕获阶段监听）：`j` / `k` / `gg` / `GG`（两次按键间隔 600 ms 内）；焦点在输入框 / `contenteditable`、按着 Alt / Ctrl / Meta、或时间轴隐藏时不处理。`Escape` 关闭问题列表，或取消当前导航
- **模块间耦合**：时间轴忽略来自 `#cgpt-answer-toc-panel` 的滚动事件，提取问题文本时排除 `[data-chatgpt-answer-toc]` / `[data-chatgpt-timeline]`；`content.js` 把 `j` / `k` / `g` / `G` 当作用户导航输入，用来解除目录的临时绑定。改 ID、类名或快捷键时两边一起改

## 脆弱点（ChatGPT 改版时最先坏的地方）

README 的"页面契约"一节描述了这些依赖，改选择器时同步更新它，并在 `demo/index.html` 里同步改模拟结构。

| 依赖的页面结构 | 代码位置 | 失效后果 |
|---|---|---|
| `[data-testid="conversation-options-button"]`，且它的父元素是操作槽、祖父元素是按钮所在的行 | `content.js` 的 `SELECTORS.conversationOptions`、`ensureGlobalControl` | 目录、返回、前进按钮全部不出现（没有备用位置） |
| 轮次 `[data-testid^="conversation-turn-"][data-turn="user"/"assistant"]` + 稳定的 `data-turn-id` | `content.js` 的 `SELECTORS`、`navigation.js` 的 `HISTORY_TURN_SELECTOR`、`timeline.js` 的 `TURN_SELECTOR` | 时间轴和跳转历史完全依赖 `data-turn-id`，没有兜底；目录有兜底键 |
| `[data-message-author-role="assistant"]` / `"user"` | `content.js` 的 `SELECTORS.assistant`、`timeline.js` 的 `MESSAGE_SELECTOR` | 目录找不到回答；时间轴的问题文本为空 |
| 回答里的标题是真正的 `h1`–`h6` | `content.js` 的 `SELECTORS.heading` | 目录为空 |
| `[data-side-pane-shell-host="true"]`（`[data-scroll-root]` 只是挑选时的提示） | `timeline.js` 的 `TIMELINE_HOST_SELECTOR`、`findTimelineHost` | 时间轴整体隐藏 |
| `[data-testid="conversation-turn-1"]` 代表第一轮 | `timeline.js` 的 `loadEarlierQuestions` | 只能靠"到顶后 8 次不变"判断加载完，更慢 |
| `button[data-testid="variants-turn-action-button"]` | `timeline.js` 的 `VARIANT_BUTTON_SELECTOR` | 编辑重发后旧分支的问题残留在时间轴里 |
| 问题正文 `[data-testid="user-message-text"]`、`[data-message-text]`、`.whitespace-pre-wrap`、`[data-message-content]`；附件 / 引用的 testid、`data-content-type`、中英文 `aria-label` | `timeline.js` 的 `QUESTION_TEXT_SELECTORS`、`QUESTION_EXCLUDED_SELECTOR` | 预览和搜索混入文件名、引用内容，或退回整条消息的文本 |
| 原生时间轴：`conversation-timeline` / `chat-timeline` testid，或"对话时间轴" / "Conversation timeline" `aria-label`（是否对应 ChatGPT 当前的真实 DOM 未核实 ❓） | `timeline.js` 的 `ORIGINAL_TIMELINE_SELECTORS` | 原生时间轴重新出现（插件时间轴在左侧，不会重叠） |
| 关闭按钮 `data-testid="close-button"` + `aria-label` 正好是"关闭" / "Close"；推广文案 | `dismiss-promos.js` 的 `CLOSE_BUTTON_SELECTOR`、`PRO_PROMOTION_PATTERNS` | 弹窗不再自动关闭；中英文以外的界面语言本来就不匹配。README 的页面契约没写 `aria-label` 这个条件 |
| 对话 URL 形如 `/c/<id>` | `timeline.js` 的 `currentConversationKey` | 退回 `page:<pathname>`，仍按路径区分聊天 |
| 暗色主题标记 `html.dark` / `[data-theme="dark"]` / `[data-color-scheme="dark"]` | `timeline.css` 末尾 | 暗色模式下时间轴短横线颜色不对 |
| 消息列表的滚动容器是 `overflow-y: auto/scroll/overlay` 的祖先 | `navigation.js` 的 `getScrollContainerForElement` | 跳转、阅读线、历史全部失准 |
| 域名 `chatgpt.com` | `manifest.json` 的 `matches` | 其他域名不注入 |

## 安全与隐私约束（不要放宽）

- 不申请任何权限，不加 `host_permissions`、background 或远程代码；内容脚本只匹配 `https://chatgpt.com/*`
- 不发网络请求，不用任何存储（`chrome.storage`、`localStorage`、IndexedDB 都没用）；问题文本只在内存里，切换聊天时清空。README 向用户承诺了"不保存或上传对话内容"
- 只用 `createElement` / `textContent` / `setAttribute` 构建界面，**不用 `innerHTML`**：标题和问题文本都来自对话内容
- 自动点击只限推广弹窗的关闭按钮，必须同时满足"按钮选择器 + 推广文案 + 对话框 / 浮层容器"；不要扩大到普通关闭按钮，也不要去点升级、订阅之类的按钮
- 对 ChatGPT 自己节点的写入只有三种：目录兜底键 `data-cgpt-toc-turn-key`、跳转后的闪烁类名、隐藏原生时间轴；不要删除或改写对话内容节点

## 开发流程

- 目前全部直接提交到 `main`，没有用过分支和 PR；提交信息是简短的英文祈使句（如 `Add collapsible answer outlines`）
- 每个版本一个提交，同一个提交里：
  - 改 `manifest.json` 的 `version`
  - 改 README 的"当前版本"，在"从旧版本更新"最前面加一段该版本的说明，按需更新"功能"和"页面契约"
  - 把 `demo/index.html` 里 9 处 `?v=XXYY` 改成新版本（如 0.8.4 → `0804`）
  - 补测试
- 发布：`node --test tests/*.test.cjs` → 打包 → 给该提交打 tag `v<版本>` → 创建 GitHub Release `v<版本>`，上传 `chatgpt-web-enhancer-<版本>.zip`，说明写一段中文更新说明（与 README 里那段相近）
- 资产名格式不要改：GitHub 插件下载器（`RicardoSJin/github-extension-loader`）按 `chatgpt-web-enhancer-*.zip` 匹配本仓库的 Release
- `main` 上的版本可能领先最新 Release（写本文时 `manifest.json` 已是 0.8.4，最新 Release 是 v0.8.3），发布前用 `gh release list --repo RicardoSJin/chatgpt-web-enhancer` 核对

## 编码风格

- 两空格缩进、双引号、分号、多行参数带尾逗号；每个模块内 `"use strict"`
- 纯逻辑放进 UMD 模块（`outline.js`、`timeline-model.js`，或 `navigation.js` 里不碰 DOM 的部分）并在 `tests/` 写 `.test.cjs`；DOM 逻辑放在 `content.js` / `timeline.js`
- 新增 `src/` 脚本要同时加进 `manifest.json` 的 `js` 数组（按依赖顺序）和 `demo/index.html`
- 选择器、延时、超时等常量集中在文件顶部，新选择器加进对应常量，不要散在函数里
- 命名前缀：目录用 `cgpt-answer-toc__*`（BEM），时间轴用 `cgpt-timeline__*`；自有 data 属性用 `data-chatgpt-answer-toc`、`data-chatgpt-timeline`、`data-cgpt-*`。`answer-toc` 是项目改名前的旧名，跨模块有引用，不要顺手改
- 无障碍：按钮要有中文 `aria-label` / `title`，状态用 `aria-expanded` / `aria-current`，动画要有 `prefers-reduced-motion` 降级
- 不引入框架、构建工具和依赖；跟随所在文件的写法（`timeline.js` 多用单行 `if (...) return;`，`content.js` 习惯带大括号）
