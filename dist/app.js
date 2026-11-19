import {
  ACTIONS, STAGES, STAGE_META, TEMPLATE_INTERVAL_LABELS, TEMPLATE_STAGE_ORDER,
  applyAction, canAct, createTask, deadlineForCurrentStage, evaluateReminders,
  getResponsible, taskBucket, validateTemplate
} from "./domain.js";
import { USERS, currentUser, loadState, resetState, saveState, stageLabel } from "./store.js";
import { createIdentityAdapter, createReminderAdapter } from "./adapters.js";

let state = loadState();
if (state.activeView === "admin" && currentUser(state).role !== "admin") state.activeView = "todo";
let filters = { query: "", level: "all", owner: "all", risk: "all" };
let selectedTaskId = null;
let modal = null;

const app = document.querySelector("#app");
const toastRoot = document.querySelector("#toast-root");

function activeTemplates() {
  return state.templates.filter((template) => template.enabled !== false);
}

function templateForLevel(level) {
  return state.templates.find((template) => template.level === level);
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#66716b";
}

function levelBadge(level, className = "level") {
  const template = templateForLevel(level);
  const color = safeColor(template?.color);
  return `<span class="${className}" style="color:${color};background:${color}1a">${escapeHtml(level)}</span>`;
}

const icon = (name) => {
  const paths = {
    todo: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    board: '<rect x="3" y="3" width="7" height="18" rx="2"/><rect x="14" y="3" width="7" height="12" rx="2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-1.6-1H2V10h.09A1.7 1.7 0 0 0 3.64 8.9 1.7 1.7 0 0 0 3.3 7l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.09A1.7 1.7 0 0 0 14.1 4.64 1.7 1.7 0 0 0 16 4.3l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 18.4 9a1.7 1.7 0 0 0 1.6 1h.09v4H20a1.7 1.7 0 0 0-.6 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatDate(value, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  }).format(new Date(value));
}

function relativeTime(value) {
  const diff = new Date(value).getTime() - Date.now();
  const hours = Math.round(Math.abs(diff) / 3600000);
  if (Math.abs(diff) < 3600000) return diff >= 0 ? "1小时内" : "刚刚超期";
  if (hours < 24) return diff >= 0 ? `${hours}小时后` : `超期${hours}小时`;
  const days = Math.round(hours / 24);
  return diff >= 0 ? `${days}天后` : `超期${days}天`;
}

function isOverdue(task) {
  const deadline = deadlineForCurrentStage(task);
  return deadline && new Date(deadline).getTime() < Date.now() && ![STAGES.PUBLISHED, STAGES.CANCELLED, STAGES.PAUSED].includes(task.currentStage);
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.textContent = message;
  toastRoot.append(node);
  setTimeout(() => node.classList.add("show"), 10);
  setTimeout(() => { node.classList.remove("show"); setTimeout(() => node.remove(), 220); }, 2600);
}

function persist(next = state) {
  state = saveState(next);
  render();
}

function roleLabel(role) {
  return ({ director: "编导", editor: "剪辑", reviewer: "中台审核", admin: "管理员" })[role] || role;
}

function pageTitle() {
  return ({ todo: ["我的待办", "把今天需要推进的片子处理掉"], board: ["团队看板", "一眼看清每条片子卡在哪里"], admin: ["管理后台", "配置排期模板、角色与提醒策略"] })[state.activeView];
}

function renderShell(content) {
  const user = currentUser(state);
  const [title, subtitle] = pageTitle();
  const templateReady = activeTemplates().length > 0 && activeTemplates().every((item) => item.confirmed && validateTemplate(item).valid);
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark"><span></span><span></span><span></span></div>
          <div><strong>视频协作台</strong><small>PRODUCTION FLOW</small></div>
        </div>
        <nav class="nav-list" aria-label="主导航">
          ${navButton("todo", "我的待办", "todo")}
          ${navButton("board", "团队看板", "board")}
          ${user.role === "admin" ? navButton("admin", "管理后台", "settings") : ""}
        </nav>
        <div class="sidebar-note">
          <span class="pulse-dot"></span>
          <div><strong>${state.settings.identityMode === "demo" ? "演示模式" : "飞书已连接"}</strong><small>${templateReady ? "排期模板已就绪" : "待确认排期模板"}</small></div>
        </div>
        <div class="identity-card">
          <div class="avatar">${escapeHtml(user.avatar || user.name.slice(0, 1))}</div>
          <div class="identity-copy"><strong>${escapeHtml(user.name)}</strong><span>${roleLabel(user.role)}</span></div>
          <button class="icon-button" data-action="switch-user" title="切换演示身份">⌄</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><h1>${title}</h1><p>${subtitle}</p></div>
          <div class="top-actions">
            <div class="sync-pill"><span></span> 本地已同步</div>
            ${["director", "admin"].includes(user.role) ? `<button class="primary-button" data-action="open-create">${icon("plus")} 新建视频</button>` : ""}
          </div>
        </header>
        <div class="page-body">${content}</div>
      </main>
    </div>
    ${selectedTaskId ? renderDrawer() : ""}
    ${modal ? renderModal() : ""}
  `;
}

function navButton(view, label, iconName) {
  return `<button class="nav-item ${state.activeView === view ? "active" : ""}" data-view="${view}">${icon(iconName)}<span>${label}</span>${view === "todo" ? `<em>${myActionableTasks().length}</em>` : ""}</button>`;
}

function myActionableTasks() {
  const user = currentUser(state);
  return state.tasks.filter((task) => canAct(task, user) && ![STAGES.PUBLISHED, STAGES.CANCELLED].includes(task.currentStage));
}

function riskBanner() {
  const unconfirmed = activeTemplates().filter((template) => !template.confirmed).map((template) => template.level).join(" / ");
  if (!unconfirmed) return "";
  return `<div class="setup-banner">${icon("warning")}<div><strong>自动排期尚未启用</strong><span>${unconfirmed} 级模板仍是演示草案。请由管理员在后台核对并确认后再创建生产任务。</span></div><button class="text-button" data-view="admin">去配置</button></div>`;
}

function renderTodo() {
  const user = currentUser(state);
  const buckets = { overdue: [], today: [], upcoming: [], waiting: [] };
  state.tasks.filter((task) => !task.archived && task.currentStage !== STAGES.CANCELLED).forEach((task) => {
    const bucket = taskBucket(task, user);
    if (buckets[bucket]) buckets[bucket].push(task);
  });
  const counts = {
    overdue: buckets.overdue.length,
    today: buckets.today.length,
    unclaimed: state.tasks.filter((task) => task.currentStage === STAGES.WAITING_CLAIM).length,
    soon: state.tasks.filter((task) => {
      const diff = new Date(task.publishAt).getTime() - Date.now();
      return diff > 0 && diff < 48 * 3600000 && task.currentStage !== STAGES.PUBLISHED;
    }).length
  };
  const greeting = new Date().getHours() < 12 ? "早上好" : new Date().getHours() < 18 ? "下午好" : "晚上好";
  return renderShell(`
    ${riskBanner()}
    <section class="hero-panel">
      <div><span class="eyebrow">${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span><h2>${greeting}，${escapeHtml(user.name)}。</h2><p>你有 <strong>${counts.overdue + counts.today}</strong> 条片子需要优先处理，先把超期风险清掉。</p></div>
      <div class="hero-orbit"><span>${counts.overdue + counts.today}</span><small>待推进</small></div>
    </section>
    <section class="metric-grid">
      ${metricCard("超期任务", counts.overdue, "需要立即处理", "danger")}
      ${metricCard("今日处理", counts.today, "截止到今天", "amber")}
      ${metricCard("等待认领", counts.unclaimed, "剪辑池待响应", "blue")}
      ${metricCard("48h 内发布", counts.soon, "留意审核缓冲", "mint")}
    </section>
    <section class="todo-grid">
      ${todoSection("超期", "已经越过当前节点截止时间", buckets.overdue, "danger")}
      ${todoSection("今日处理", "今天需要完成的动作", buckets.today, "amber")}
      ${todoSection("即将开始", "已排期且由你负责", buckets.upcoming, "blue")}
      ${todoSection("等待他人", "关注即可，暂时无需操作", buckets.waiting.slice(0, 6), "muted")}
    </section>
  `);
}

function metricCard(label, value, hint, tone) {
  return `<article class="metric-card tone-${tone}"><div class="metric-top"><span>${label}</span><i></i></div><strong>${value}</strong><small>${hint}</small></article>`;
}

function todoSection(title, subtitle, tasks, tone) {
  return `<section class="todo-section">
    <header><div><span class="section-dot ${tone}"></span><h3>${title}</h3><em>${tasks.length}</em></div><p>${subtitle}</p></header>
    <div class="task-stack">${tasks.length ? tasks.map((task) => renderTaskCard(task, true)).join("") : `<div class="empty-state"><span>✓</span><p>这里暂时没有任务</p></div>`}</div>
  </section>`;
}

function primaryAction(task) {
  const map = {
    [STAGES.WAITING_CLAIM]: [ACTIONS.CLAIM, "认领"],
    [STAGES.WAITING_SHOOT]: [ACTIONS.SHOOT_COMPLETE, "完成拍摄"],
    [STAGES.WAITING_MATERIAL]: [ACTIONS.MATERIAL_READY, "素材就绪"],
    [STAGES.EDITING]: [ACTIONS.SUBMIT_CUT, "提交成片"],
    [STAGES.INITIAL_REVIEW]: ["open-review", "开始初审"],
    [STAGES.DIRECTOR_REVIEW]: ["open-review", "开始审核"],
    [STAGES.MODIFYING]: [ACTIONS.SUBMIT_CUT, "提交修改"],
    [STAGES.READY_PUBLISH]: [ACTIONS.PUBLISH, "确认发布"]
  };
  return map[task.currentStage] || null;
}

function renderTaskCard(task, wide = false) {
  const responsible = getResponsible(task);
  const deadline = deadlineForCurrentStage(task);
  const overdue = isOverdue(task);
  const action = primaryAction(task);
  const actionable = canAct(task, currentUser(state));
  return `<article class="task-card ${wide ? "wide" : ""} ${overdue ? "overdue" : ""}" data-task-id="${task.id}" tabindex="0">
    <div class="task-card-top">${levelBadge(task.level)}<span class="account">${escapeHtml(task.account)}</span><span class="task-code">${escapeHtml(task.code)}</span></div>
    <h4>${escapeHtml(task.title)}</h4>
    <div class="task-meta">
      <span class="stage-pill">${stageLabel(task.currentStage)}</span>
      <span class="owner-mini"><i>${escapeHtml((responsible.name || "待").slice(0, 1))}</i>${escapeHtml(responsible.name || "待指定")}</span>
    </div>
    <div class="task-card-bottom">
      <span class="deadline ${overdue ? "is-overdue" : ""}">${icon("clock")} ${overdue ? relativeTime(deadline) : `${formatDate(deadline)} · ${relativeTime(deadline)}`}</span>
      ${actionable && action ? `<button class="quick-button" data-task-action="${action[0]}" data-task-id="${task.id}">${action[1]}</button>` : `<button class="ghost-arrow" data-open-task="${task.id}" title="查看详情">详情</button>`}
    </div>
  </article>`;
}

function renderBoard() {
  const stages = [STAGES.WAITING_CLAIM, STAGES.WAITING_SHOOT, STAGES.WAITING_MATERIAL, STAGES.EDITING, STAGES.INITIAL_REVIEW, STAGES.DIRECTOR_REVIEW, STAGES.MODIFYING, STAGES.READY_PUBLISH, STAGES.PUBLISHED];
  const visible = filteredTasks();
  return renderShell(`
    ${riskBanner()}
    <section class="filter-bar">
      <label class="search-box">${icon("search")}<input id="board-search" value="${escapeHtml(filters.query)}" placeholder="搜索选题、账号或任务编号" /></label>
      <select id="filter-level"><option value="all">全部等级</option>${state.templates.map((template) => `<option value="${escapeHtml(template.level)}" ${filters.level === template.level ? "selected" : ""}>${escapeHtml(template.name)}${template.enabled === false ? "（已停用）" : ""}</option>`).join("")}</select>
      <select id="filter-owner"><option value="all">全部负责人</option>${USERS.map((user) => `<option value="${user.id}" ${filters.owner === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`).join("")}</select>
      <select id="filter-risk"><option value="all">全部状态</option><option value="overdue" ${filters.risk === "overdue" ? "selected" : ""}>仅看超期</option><option value="soon" ${filters.risk === "soon" ? "selected" : ""}>48h内发布</option></select>
      <span class="result-count">${visible.length} 条任务</span>
    </section>
    <section class="kanban" aria-label="团队视频任务看板">
      ${stages.map((stage) => {
        const tasks = visible.filter((task) => task.currentStage === stage);
        return `<div class="kanban-column"><header><div><span class="column-dot stage-${stage}"></span><h3>${STAGE_META[stage].label}</h3></div><em>${tasks.length}</em></header><div class="kanban-stack">${tasks.map((task) => renderTaskCard(task)).join("") || `<div class="column-empty">暂无任务</div>`}</div></div>`;
      }).join("")}
    </section>
  `);
}

function filteredTasks() {
  return state.tasks.filter((task) => {
    const text = `${task.title} ${task.account} ${task.code}`.toLowerCase();
    if (filters.query && !text.includes(filters.query.toLowerCase())) return false;
    if (filters.level !== "all" && task.level !== filters.level) return false;
    if (filters.owner !== "all" && ![task.directorId, task.editorId, task.reviewerId, task.shooterId].includes(filters.owner)) return false;
    if (filters.risk === "overdue" && !isOverdue(task)) return false;
    if (filters.risk === "soon") {
      const diff = new Date(task.publishAt).getTime() - Date.now();
      if (!(diff > 0 && diff < 48 * 3600000)) return false;
    }
    return true;
  });
}

function renderAdmin() {
  const enabledTemplates = activeTemplates();
  const confirmedCount = enabledTemplates.filter((item) => item.confirmed && validateTemplate(item).valid).length;
  const allReady = enabledTemplates.length > 0 && confirmedCount === enabledTemplates.length;
  return renderShell(`
    <section class="admin-intro">
      <div><span class="eyebrow">WORKFLOW CONTROL</span><h2>按节点间隔配置，而不是从发布时间倒排。</h2><p>每个小时数表示“前一节点确认后，到下一节点确认前”的最长处理时间。</p></div>
      <div class="readiness ${allReady ? "ready" : "pending"}"><span>${allReady ? "✓" : confirmedCount}</span><div><strong>${allReady ? "模板已就绪" : `已确认 ${confirmedCount}/${enabledTemplates.length}`}</strong><small>${allReady ? "可以开启提醒" : "需确认全部启用模板"}</small></div></div>
    </section>
    <section class="admin-grid">
      <div class="admin-main">
        <div class="panel-header"><div><h3>等级节点间隔模板</h3><p>可新增任意等级；停用后不影响历史任务</p></div><button class="secondary-button compact" data-action="open-add-template">${icon("plus")} 新增等级</button></div>
        <div class="template-list">${state.templates.map(renderTemplate).join("")}</div>
      </div>
      <aside class="admin-side">
        <section class="settings-card"><div class="settings-icon">${icon("bell")}</div><h3>飞书提醒</h3><p>模板全部确认后才可开启。演示环境只生成提醒预览，不会发送真实消息。</p><label class="switch-row"><span><strong>启用自动提醒</strong><small>${state.settings.enabled ? "当前已启用" : "当前未启用"}</small></span><input type="checkbox" id="reminder-enabled" ${state.settings.enabled ? "checked" : ""} ${allReady ? "" : "disabled"}/><i></i></label><button class="secondary-button full" data-action="scan-reminders">运行一次提醒扫描</button><div class="reminder-count">已记录 ${state.reminders.length} 条提醒事件</div></section>
        <section class="settings-card"><h3>上线配置</h3><dl class="config-list"><div><dt>身份</dt><dd>飞书 SSO 适配器</dd></div><div><dt>剪辑池</dt><dd>剪辑中台</dd></div><div><dt>升级群</dt><dd>${escapeHtml(state.settings.groupName)}</dd></div><div><dt>数据</dt><dd>演示为浏览器本地</dd></div></dl></section>
        <button class="danger-link" data-action="reset-demo">恢复演示数据</button>
      </aside>
    </section>
  `);
}

function renderTemplate(template) {
  const validation = validateTemplate(template);
  return `<article class="template-card ${template.confirmed ? "confirmed" : ""} ${template.enabled === false ? "disabled" : ""}" data-level="${escapeHtml(template.level)}">
    <header>${levelBadge(template.level, "template-level")}<div><strong>${escapeHtml(template.name)}</strong><span>${template.enabled === false ? "已停用 · 仅保留历史任务" : template.confirmed ? `由 ${escapeHtml(template.confirmedBy || "管理员")} 确认` : "待业务负责人核对"}</span></div><div class="template-actions"><button data-action="edit-template" data-level="${escapeHtml(template.level)}">编辑</button><button data-action="toggle-template-enabled" data-level="${escapeHtml(template.level)}">${template.enabled === false ? "启用" : "停用"}</button><button class="template-toggle" data-action="toggle-template" data-level="${escapeHtml(template.level)}" ${template.enabled === false ? "disabled" : ""}>${template.confirmed ? "取消确认" : "确认模板"}</button></div></header>
    <div class="offset-grid">${TEMPLATE_STAGE_ORDER.map((stage) => {
      const skipped = stage === STAGES.INITIAL_REVIEW && !template.includeInitialReview;
      const label = stage === STAGES.DIRECTOR_REVIEW && !template.includeInitialReview
        ? "剪辑交付 → 编导审核"
        : TEMPLATE_INTERVAL_LABELS[stage];
      return `<label class="offset-field ${skipped ? "skipped" : ""}"><span>${label}</span>${skipped ? `<em>自动跳过</em>` : `<div><input type="number" min="0" step="1" data-interval-level="${template.level}" data-interval-stage="${stage}" value="${template.intervals[stage] ?? ""}" ${template.confirmed ? "disabled" : ""}/><small>h</small></div>`}</label>`;
    }).join("")}</div>
    ${validation.valid ? "" : `<div class="template-errors">${validation.errors.map((error) => `<span>${escapeHtml(error)}</span>`).join("")}</div>`}
  </article>`;
}

function renderDrawer() {
  const task = state.tasks.find((item) => item.id === selectedTaskId);
  if (!task) return "";
  const responsible = getResponsible(task);
  const deadline = deadlineForCurrentStage(task);
  const action = primaryAction(task);
  return `<div class="drawer-backdrop" data-action="close-drawer"></div><aside class="drawer" aria-label="任务详情">
    <header class="drawer-header"><div><div class="drawer-badges">${levelBadge(task.level)}<span>${escapeHtml(task.code)}</span></div><h2>${escapeHtml(task.title)}</h2><p>${escapeHtml(task.account)} · ${task.needsShoot ? "需要拍摄" : "已有素材"}</p></div><button class="icon-button large" data-action="close-drawer">${icon("x")}</button></header>
    <div class="drawer-status"><div><small>当前环节</small><strong>${stageLabel(task.currentStage)}</strong></div><div><small>当前负责人</small><strong>${escapeHtml(responsible.name)}</strong></div><div class="${isOverdue(task) ? "danger-copy" : ""}"><small>节点截止</small><strong>${formatDate(deadline)}</strong><span>${relativeTime(deadline)}</span></div></div>
    <div class="progress-track">${renderProgress(task)}</div>
    <section class="drawer-section"><div class="section-title"><h3>交付文件</h3><span>${task.versions.length} 个成片版本</span></div><div class="file-list">${renderFiles(task)}</div></section>
    <section class="drawer-section"><div class="section-title"><h3>操作时间轴</h3><span>${task.events.length} 条记录</span></div><div class="timeline">${[...task.events].reverse().map(renderEvent).join("")}</div></section>
    <footer class="drawer-actions">
      ${canAct(task, currentUser(state)) && action ? `<button class="primary-button grow" data-task-action="${action[0]}" data-task-id="${task.id}">${action[1]}</button>` : ""}
      ${!task.readOnly && ![STAGES.PUBLISHED, STAGES.CANCELLED].includes(task.currentStage) && (currentUser(state).role === "admin" || task.directorId === currentUser(state).id) ? `<button class="secondary-button" data-task-action="${task.currentStage === STAGES.PAUSED ? ACTIONS.RESUME : ACTIONS.PAUSE}" data-task-id="${task.id}">${task.currentStage === STAGES.PAUSED ? "恢复" : "暂停"}</button><button class="more-button" data-task-action="more" data-task-id="${task.id}">•••</button>` : ""}
    </footer>
  </aside>`;
}

function renderProgress(task) {
  const stages = [STAGES.WAITING_CLAIM, ...(task.needsShoot ? [STAGES.WAITING_SHOOT] : []), STAGES.WAITING_MATERIAL, STAGES.EDITING, ...(task.requiresInitialReview ? [STAGES.INITIAL_REVIEW] : []), STAGES.DIRECTOR_REVIEW, STAGES.MODIFYING, STAGES.READY_PUBLISH, STAGES.PUBLISHED];
  const current = stages.indexOf(task.currentStage);
  return stages.map((stage, index) => `<div class="progress-step ${index < current ? "done" : index === current ? "current" : ""}"><i>${index < current ? "✓" : index + 1}</i><span>${stageLabel(stage)}</span></div>`).join("");
}

function renderFiles(task) {
  const files = [
    task.scriptUrl && { label: "脚本 / Brief", url: task.scriptUrl, type: "DOC" },
    task.materialUrl && { label: "原始素材", url: task.materialUrl, type: "RAW" },
    ...task.versions.map((version) => ({ label: `成片 V${version.number}`, url: version.url, type: "MP4", meta: `${version.submittedBy} · ${formatDate(version.submittedAt)}` }))
  ].filter(Boolean);
  return files.length ? files.map((file) => `<a class="file-row" href="${escapeHtml(file.url)}" target="_blank" rel="noopener"><span>${file.type}</span><div><strong>${escapeHtml(file.label)}</strong><small>${escapeHtml(file.meta || "点击打开链接")}</small></div>${icon("link")}</a>`).join("") : `<div class="empty-inline">尚未添加交付文件</div>`;
}

function renderEvent(event) {
  return `<div class="timeline-item"><i></i><div><strong>${escapeHtml(event.label)}</strong><p>${escapeHtml(event.actorName)} · ${formatDate(event.at)}</p>${event.note ? `<blockquote>${escapeHtml(event.note)}</blockquote>` : ""}</div></div>`;
}

function renderModal() {
  if (modal.type === "create") return renderCreateModal();
  if (modal.type === "user") return renderUserModal();
  if (modal.type === "action") return renderActionModal();
  if (modal.type === "template") return renderTemplateModal();
  return "";
}

function renderCreateModal() {
  const readyTemplates = activeTemplates().filter((item) => item.confirmed && validateTemplate(item).valid);
  return modalShell("新建视频任务", "四项必填，其他信息可以后补", `
    <form id="create-form" class="modal-form">
      <label class="form-field full"><span>视频选题 <em>*</em></span><input name="title" required maxlength="80" placeholder="一句话说明这条片子要讲什么" autofocus /></label>
      <label class="form-field"><span>账号 / 达人 <em>*</em></span><input name="account" required placeholder="例如：万万" /></label>
      <label class="form-field"><span>视频等级 <em>*</em></span><select name="level" required><option value="">请选择</option>${activeTemplates().map((template) => `<option value="${escapeHtml(template.level)}" ${readyTemplates.includes(template) ? "" : "disabled"}>${escapeHtml(template.name)}${readyTemplates.includes(template) ? "" : "（模板未确认）"}</option>`).join("")}</select></label>
      <label class="form-field full"><span>计划发布时间 <em>*</em></span><input name="publishAt" type="datetime-local" required /></label>
      <label class="shoot-toggle full"><div><strong>需要重新拍摄</strong><span>关闭后将自动跳过“待拍摄”环节</span></div><input name="needsShoot" type="checkbox" checked/><i></i></label>
      ${readyTemplates.length ? "" : `<div class="form-warning full">请先在管理后台确认至少一个等级的节点间隔模板。</div>`}
      <div class="modal-footer full"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button" ${readyTemplates.length ? "" : "disabled"}>创建并发布</button></div>
    </form>
  `);
}

function renderUserModal() {
  return modalShell("切换演示身份", "生产环境将由飞书登录自动识别", `<div class="user-grid">${USERS.map((user) => `<button class="user-option ${state.currentUserId === user.id ? "active" : ""}" data-user-id="${user.id}"><span>${escapeHtml(user.avatar)}</span><div><strong>${escapeHtml(user.name)}</strong><small>${roleLabel(user.role)}</small></div>${state.currentUserId === user.id ? "✓" : ""}</button>`).join("")}</div>`);
}

function renderTemplateModal() {
  const editing = modal.level ? templateForLevel(modal.level) : null;
  const sourceOptions = state.templates.map((template) => `<option value="${escapeHtml(template.level)}">${escapeHtml(template.name)}</option>`).join("");
  return modalShell(editing ? "编辑等级模板" : "新增等级模板", editing ? "修改流程属性后需重新确认模板" : "等级代码创建后不可修改，避免历史任务失联", `
    <form id="template-form" class="modal-form">
      <input type="hidden" name="originalLevel" value="${escapeHtml(editing?.level || "")}" />
      <label class="form-field"><span>等级代码 <em>*</em></span><input name="level" required maxlength="8" value="${escapeHtml(editing?.level || "")}" placeholder="例如：P0" ${editing ? "readonly" : ""}/></label>
      <label class="form-field"><span>等级名称 <em>*</em></span><input name="name" required maxlength="20" value="${escapeHtml(editing?.name || "")}" placeholder="例如：热点急单" /></label>
      <label class="form-field"><span>标识颜色</span><input class="color-input" name="color" type="color" value="${safeColor(editing?.color || "#6b7280")}" /></label>
      ${editing ? `<div class="form-field"><span>状态</span><div class="readonly-value">${editing.enabled === false ? "已停用" : "启用中"}</div></div>` : `<label class="form-field"><span>复制节点间隔</span><select name="copyFrom">${sourceOptions}</select></label>`}
      <label class="shoot-toggle full"><div><strong>需要中台初审</strong><span>开启后，成片先进入中台初审，再进入编导审核</span></div><input name="includeInitialReview" type="checkbox" ${editing?.includeInitialReview ? "checked" : ""}/><i></i></label>
      <label class="shoot-toggle full"><div><strong>创建后立即启用</strong><span>停用模板不会出现在新建任务中，但历史任务继续保留</span></div><input name="enabled" type="checkbox" ${editing?.enabled === false ? "" : "checked"}/><i></i></label>
      <div class="modal-footer full"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button">${editing ? "保存修改" : "新增模板"}</button></div>
    </form>
  `);
}

function actionSpec(task, action) {
  const specs = {
    [ACTIONS.MATERIAL_READY]: { title: "确认素材就绪", desc: "添加素材文件夹链接后进入剪辑环节", url: "素材链接", submit: "确认并推进" },
    [ACTIONS.SUBMIT_CUT]: { title: task.currentStage === STAGES.MODIFYING ? "提交修改版本" : "提交成片", desc: "新版本会保留，不覆盖历史成片", url: "成片链接", note: "版本说明（可选）", submit: "提交审核" },
    [ACTIONS.PUBLISH]: { title: "确认视频发布", desc: "发布后任务归档，只读保留完整记录", url: "发布链接（可选）", note: "发布备注（可选）", submit: "确认已发布" },
    [ACTIONS.PAUSE]: { title: "暂停任务", desc: "暂停后停止所有提醒，恢复时回到原环节", note: "暂停原因", submit: "确认暂停", danger: true },
    [ACTIONS.RESUME]: { title: "恢复任务", desc: "任务将回到暂停前的环节并重新参与提醒", note: "恢复说明（可选）", submit: "恢复任务" },
    [ACTIONS.CANCEL]: { title: "取消任务", desc: "取消后停止提醒并保留全部历史记录", note: "取消原因", submit: "确认取消", danger: true },
    [ACTIONS.APPROVE]: { title: "审核通过", desc: task.currentStage === STAGES.INITIAL_REVIEW ? "通过后进入编导终审" : "通过后进入待发布", note: "审核意见（可选）", submit: "通过" },
    [ACTIONS.REJECT]: { title: "退回修改", desc: "请写清楚修改点，剪辑提交后会生成新版本", note: "修改意见", submit: "退回剪辑", danger: true }
  };
  return specs[action] || { title: "确认操作", desc: "系统将自动记录操作人和时间", submit: "确认" };
}

function renderActionModal() {
  const task = state.tasks.find((item) => item.id === modal.taskId);
  if (!task) return "";
  if (modal.action === "open-review") {
    return modalShell(`审核 · ${stageLabel(task.currentStage)}`, "审核结果将决定下一步流程", `<div class="review-preview">${task.versions.length ? `<span>当前版本 V${task.versions.at(-1).number}</span><strong>${escapeHtml(task.title)}</strong><a href="${escapeHtml(task.versions.at(-1).url)}" target="_blank" rel="noopener">打开成片 ${icon("link")}</a>` : "暂无成片版本"}</div><div class="review-actions"><button class="approve-button" data-review-action="${ACTIONS.APPROVE}" data-task-id="${task.id}">✓ 通过审核</button><button class="reject-button" data-review-action="${ACTIONS.REJECT}" data-task-id="${task.id}">↩ 退回修改</button></div>`);
  }
  if (modal.action === "more") {
    return modalShell("更多操作", "异常操作必须填写原因并保留记录", `<div class="more-actions"><button data-more-action="reschedule" data-task-id="${task.id}"><strong>调整发布时间</strong><span>重新计算全部未完成节点</span></button><button data-more-action="transfer" data-task-id="${task.id}"><strong>转交负责人</strong><span>将当前环节移交给其他成员</span></button><button class="danger" data-review-action="${ACTIONS.CANCEL}" data-task-id="${task.id}"><strong>取消任务</strong><span>停止流程和提醒</span></button></div>`);
  }
  if (modal.action === "reschedule") {
    return modalShell("调整发布时间", "系统将按已确认模板重新计算节点", `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${ACTIONS.RESCHEDULE}"/><label class="form-field full"><span>新发布时间</span><input name="publishAt" type="datetime-local" required/></label><label class="form-field full"><span>改期原因</span><textarea name="note" required placeholder="说明为什么需要改期"></textarea></label>${modalFooter("确认改期")}</form>`);
  }
  if (modal.action === "transfer") {
    return modalShell("转交负责人", "只变更当前环节负责人，不修改历史记录", `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${ACTIONS.TRANSFER}"/><label class="form-field full"><span>新负责人</span><select name="userId" required><option value="">请选择</option>${USERS.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label><label class="form-field full"><span>转交原因</span><textarea name="note" required></textarea></label>${modalFooter("确认转交")}</form>`);
  }
  const spec = actionSpec(task, modal.action);
  return modalShell(spec.title, spec.desc, `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${modal.action}"/>${spec.url ? `<label class="form-field full"><span>${spec.url}</span><input name="url" type="url" ${modal.action === ACTIONS.PUBLISH ? "" : "required"} placeholder="https://"/></label>` : ""}${spec.note ? `<label class="form-field full"><span>${spec.note}</span><textarea name="note" ${[ACTIONS.PAUSE, ACTIONS.CANCEL, ACTIONS.REJECT].includes(modal.action) ? "required" : ""} placeholder="${spec.note}"></textarea></label>` : ""}${modalFooter(spec.submit, spec.danger)}</form>`);
}

function modalFooter(label, danger = false) {
  return `<div class="modal-footer full"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="${danger ? "danger-button" : "primary-button"}">${label}</button></div>`;
}

function modalShell(title, subtitle, content) {
  return `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-card" role="dialog" aria-modal="true"><header><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-button large" data-action="close-modal">${icon("x")}</button></header><div class="modal-content">${content}</div></section>`;
}

function openAction(taskId, action) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if ([ACTIONS.CLAIM, ACTIONS.SHOOT_COMPLETE].includes(action)) {
    performAction(taskId, action, {});
    return;
  }
  modal = { type: "action", taskId, action };
  render();
}

async function performAction(taskId, action, payload) {
  try {
    if (action === ACTIONS.CLAIM && globalThis.navigator?.locks) {
      await navigator.locks.request(`video-board:claim:${taskId}`, async () => {
        const fresh = loadState();
        const index = fresh.tasks.findIndex((item) => item.id === taskId);
        if (index < 0) throw new Error("任务不存在");
        const nextTask = applyAction(fresh.tasks[index], action, currentUser(state), payload);
        const tasks = [...fresh.tasks];
        tasks[index] = nextTask;
        state = saveState({ ...fresh, currentUserId: state.currentUserId, tasks });
        modal = null;
        render();
        toast(`${nextTask.title}：认领成功`);
      });
      return;
    }
    const index = state.tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return;
    const nextTask = applyAction(state.tasks[index], action, currentUser(state), payload);
    const tasks = [...state.tasks];
    tasks[index] = nextTask;
    modal = null;
    persist({ ...state, tasks });
    toast(`${nextTask.title}：${stageLabel(nextTask.currentStage)}`);
  } catch (error) {
    toast(error.message, "error");
  }
}

function handleSubmit(event) {
  if (event.target.id === "template-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const originalLevel = data.get("originalLevel");
    const level = String(data.get("level") || "").trim().toUpperCase();
    const name = String(data.get("name") || "").trim();
    const enabled = data.get("enabled") === "on";
    const includeInitialReview = data.get("includeInitialReview") === "on";
    const color = safeColor(data.get("color"));
    if (!originalLevel && state.templates.some((template) => template.level.toUpperCase() === level.toUpperCase())) {
      toast("等级代码已存在", "error");
      return;
    }
    if (originalLevel) {
      const templates = state.templates.map((template) => template.level === originalLevel
        ? { ...template, name, color, enabled, includeInitialReview, confirmed: false, confirmedBy: null, updatedAt: new Date().toISOString() }
        : template);
      modal = null;
      persist({ ...state, templates, settings: { ...state.settings, enabled: false } });
      toast(`${originalLevel} 级模板已更新，请重新确认`);
      return;
    }
    const source = templateForLevel(data.get("copyFrom")) || state.templates[0];
    const template = {
      level, name, color, enabled, includeInitialReview, confirmed: false,
      intervals: structuredClone(source?.intervals || {
        [STAGES.WAITING_MATERIAL]: 24, [STAGES.EDITING]: 24,
        [STAGES.INITIAL_REVIEW]: 12, [STAGES.DIRECTOR_REVIEW]: 12,
        [STAGES.READY_PUBLISH]: 8
      }),
      updatedAt: new Date().toISOString(), confirmedBy: null
    };
    const validation = validateTemplate(template);
    if (!validation.valid) { toast(validation.errors[0], "error"); return; }
    modal = null;
    persist({ ...state, templates: [...state.templates, template], settings: { ...state.settings, enabled: false } });
    toast(`${level} 级模板已新增，请配置并确认`);
    return;
  }
  if (event.target.id === "create-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      const task = createTask({
        title: data.get("title"), account: data.get("account"), level: data.get("level"),
        publishAt: data.get("publishAt"), needsShoot: data.get("needsShoot") === "on",
        reviewerId: "u_reviewer_xu", reviewerName: "徐青"
      }, currentUser(state), state.templates);
      modal = null;
      persist({ ...state, tasks: [task, ...state.tasks] });
      toast("任务已创建并进入剪辑认领池");
    } catch (error) { toast(error.message, "error"); }
  }
  if (event.target.id === "action-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const action = data.get("action");
    const payload = { url: data.get("url"), note: data.get("note"), publishAt: data.get("publishAt") };
    if (action === ACTIONS.TRANSFER) payload.user = USERS.find((user) => user.id === data.get("userId"));
    if (action === ACTIONS.RESCHEDULE) payload.templates = state.templates;
    performAction(modal.taskId, action, payload);
  }
}

async function scanReminders() {
  const pending = evaluateReminders(state.tasks, state.reminders, state.settings, new Date());
  if (!pending.length) return toast("当前没有新的提醒事件", "neutral");
  try {
    const sent = await createReminderAdapter().send(pending);
    persist({ ...state, reminders: [...state.reminders, ...sent] });
    toast(`已生成 ${sent.length} 条提醒预览`);
  } catch (error) { toast(error.message, "error"); }
}

function handleClick(event) {
  const view = event.target.closest("[data-view]")?.dataset.view;
  if (view) { state.activeView = view; selectedTaskId = null; modal = null; persist(state); return; }
  const actionEl = event.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === "open-create") modal = { type: "create" };
    if (action === "switch-user") modal = { type: "user" };
    if (action === "close-modal") modal = null;
    if (action === "close-drawer") selectedTaskId = null;
    if (action === "reset-demo") { state = resetState(); modal = null; selectedTaskId = null; toast("演示数据已恢复"); }
    if (action === "scan-reminders") { scanReminders(); return; }
    if (action === "toggle-template") toggleTemplate(actionEl.dataset.level);
    if (action === "open-add-template") modal = { type: "template", level: null };
    if (action === "edit-template") modal = { type: "template", level: actionEl.dataset.level };
    if (action === "toggle-template-enabled") toggleTemplateEnabled(actionEl.dataset.level);
    render(); return;
  }
  const userId = event.target.closest("[data-user-id]")?.dataset.userId;
  if (userId) {
    const user = USERS.find((item) => item.id === userId);
    modal = null;
    persist({ ...state, currentUserId: userId, activeView: user?.role === "admin" ? state.activeView : (state.activeView === "admin" ? "todo" : state.activeView) });
    return;
  }
  const taskAction = event.target.closest("[data-task-action]");
  if (taskAction) { event.stopPropagation(); openAction(taskAction.dataset.taskId, taskAction.dataset.taskAction); return; }
  const reviewAction = event.target.closest("[data-review-action]");
  if (reviewAction) { modal = { type: "action", taskId: reviewAction.dataset.taskId, action: reviewAction.dataset.reviewAction }; render(); return; }
  const moreAction = event.target.closest("[data-more-action]");
  if (moreAction) { modal = { type: "action", taskId: moreAction.dataset.taskId, action: moreAction.dataset.moreAction }; render(); return; }
  const openTask = event.target.closest("[data-open-task]")?.dataset.openTask || event.target.closest(".task-card")?.dataset.taskId;
  if (openTask) { selectedTaskId = openTask; modal = null; render(); }
}

function toggleTemplate(level) {
  if (currentUser(state).role !== "admin") return toast("只有管理员可以确认模板", "error");
  const templates = state.templates.map((template) => {
    if (template.level !== level) return template;
    if (template.confirmed) return { ...template, confirmed: false, confirmedBy: null };
    const validation = validateTemplate(template);
    if (!validation.valid) { toast(validation.errors[0], "error"); return template; }
    return { ...template, confirmed: true, confirmedBy: currentUser(state).name, updatedAt: new Date().toISOString() };
  });
  state = saveState({ ...state, templates });
  toast(`${level} 级模板${templates.find((item) => item.level === level).confirmed ? "已确认" : "已取消确认"}`);
}

function toggleTemplateEnabled(level) {
  if (currentUser(state).role !== "admin") return toast("只有管理员可以启停模板", "error");
  const templates = state.templates.map((template) => template.level === level
    ? { ...template, enabled: template.enabled === false, confirmed: template.enabled === false ? false : template.confirmed, confirmedBy: template.enabled === false ? null : template.confirmedBy }
    : template);
  const next = templates.find((template) => template.level === level);
  state = saveState({ ...state, templates, settings: { ...state.settings, enabled: false } });
  toast(`${level} 级模板已${next.enabled === false ? "停用" : "启用，请重新确认"}`);
}

function handleChange(event) {
  if (event.target.id === "filter-level") { filters.level = event.target.value; render(); }
  if (event.target.id === "filter-owner") { filters.owner = event.target.value; render(); }
  if (event.target.id === "filter-risk") { filters.risk = event.target.value; render(); }
  if (event.target.id === "reminder-enabled") {
    if (currentUser(state).role !== "admin") return toast("只有管理员可以修改提醒设置", "error");
    persist({ ...state, settings: { ...state.settings, enabled: event.target.checked } });
  }
  if (event.target.matches("[data-interval-level]")) {
    const { intervalLevel, intervalStage } = event.target.dataset;
    const templates = state.templates.map((template) => template.level === intervalLevel
      ? { ...template, intervals: { ...template.intervals, [intervalStage]: Number(event.target.value) } }
      : template);
    state = saveState({ ...state, templates });
    render();
  }
}

function handleInput(event) {
  if (event.target.id === "board-search") {
    filters.query = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const next = document.querySelector("#board-search");
    next?.focus(); next?.setSelectionRange(cursor, cursor);
  }
}

function render() {
  const content = state.activeView === "board" ? renderBoard() : state.activeView === "admin" ? renderAdmin() : renderTodo();
  app.innerHTML = content;
}

app.addEventListener("click", handleClick);
app.addEventListener("submit", handleSubmit);
app.addEventListener("change", handleChange);
app.addEventListener("input", handleInput);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { modal = null; selectedTaskId = null; render(); }
});

createIdentityAdapter(state);
render();

globalThis.addEventListener("storage", (event) => {
  if (event.key === "video-collab-board:v1") {
    state = loadState();
    render();
  }
});
