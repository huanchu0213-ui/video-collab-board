const assetVersion = new URL(import.meta.url).searchParams.get("v");
const assetSuffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : "";
const [domainModule, storeModule, adapterModule, scheduleModule, exportModule] = await Promise.all([
  import(`./domain.js${assetSuffix}`),
  import(`./store.js${assetSuffix}`),
  import(`./adapters.js${assetSuffix}`),
  import(`./schedule.js${assetSuffix}`),
  import(`./export.js${assetSuffix}`)
]);
const {
  ACTIONS, ASSISTANCE_SLOTS, STAGES, STAGE_META, TEMPLATE_INTERVAL_LABELS, TEMPLATE_STAGE_ORDER,
  applyAction, assistanceSlots, canAct, createAssistanceTask, createTask, deadlineForCurrentStage, evaluateReminders,
  getResponsible, requestTypeLabel, taskIsRelatedToUser, validateTemplate
} = domainModule;
const { USERS, currentUser, loadState, resetState, saveState, stageLabel } = storeModule;
const { createIdentityAdapter, createReminderAdapter } = adapterModule;
const { WEEK_GROUPS, chinaDateKey, mondayOf, shiftDate, weekSlices } = scheduleModule;
const { exportCsv } = exportModule;

let state = loadState();
if (!canAccessView(currentUser(state), state.activeView)) state.activeView = firstAccessibleView(currentUser(state));
let filters = { query: "", level: "all", owner: "all", risk: "all", date: "all", start: "", end: "" };
let todoFilters = { date: "all", status: "all", start: "", end: "" };
let datePickerOpen = false;
let calendarMonth = "";
let selectedTaskId = null;
let modal = null;
let scheduleMonday = mondayOf(chinaDateKey(new Date()));
let exportDates = { start: chinaDateKey(new Date()), end: chinaDateKey(new Date()) };

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

function isAssistance(task) {
  return task.requestType === "shooting" || task.requestType === "acting";
}

function taskBadge(task) {
  return isAssistance(task) ? `<span class="level assist-badge">${requestTypeLabel(task.requestType)}</span>` : levelBadge(task.level);
}

function taskScheduleLabel(task) {
  return isAssistance(task) ? `协助 ${escapeHtml(task.serviceDate)} ${escapeHtml(assistanceSlots(task).join("、"))}` : `发布 ${formatDate(task.publishAt, false)}`;
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
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
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
  return deadline && new Date(deadline).getTime() < Date.now() && ![STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED, STAGES.PAUSED].includes(task.currentStage);
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

function readAttachment(file) {
  if (!file?.name) return Promise.resolve(null);
  if (file.size > 1024 * 1024) return Promise.reject(new Error("演示环境附件请控制在 1MB 以内"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, dataUrl: reader.result });
    reader.onerror = () => reject(new Error("附件读取失败，请重新选择"));
    reader.readAsDataURL(file);
  });
}

function roleLabel(role) {
  return ({ director: "编导", editor: "剪辑", reviewer: "中台审核", admin: "管理员" })[role] || role;
}

function configuredUsers() {
  return Array.isArray(state.users) && state.users.length ? state.users : USERS;
}

function activeUsers() {
  return configuredUsers().filter((user) => user.enabled !== false);
}

function canAccessView(user, view) {
  if (!user) return false;
  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : user.role === "admin" ? ["todo", "board", "admin"] : ["todo", "board"];
  if (view === "schedule") return permissions.includes("board");
  return permissions.includes(view) && (view !== "admin" || user.role === "admin");
}

function firstAccessibleView(user) {
  return ["todo", "board", "admin"].find((view) => canAccessView(user, view)) || "todo";
}

function pageTitle() {
  return ({ todo: ["我的待办", "把今天需要推进的片子处理掉"], board: ["团队看板", "一眼看清每条片子卡在哪里"], schedule: ["日期汇总", "按自然周查看任务当前进度"], admin: ["管理后台", "配置排期模板、角色与提醒策略"] })[state.activeView];
}

function renderShell(content) {
  const user = currentUser(state);
  const manualIdentity = state.settings.identityMode !== "feishu";
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
          ${canAccessView(user, "todo") ? navButton("todo", "我的待办", "todo") : ""}
          ${canAccessView(user, "board") ? navButton("board", "团队看板", "board") : ""}
          ${canAccessView(user, "schedule") ? navButton("schedule", "日期汇总", "calendar") : ""}
          ${canAccessView(user, "admin") ? navButton("admin", "管理后台", "settings") : ""}
        </nav>
        <div class="sidebar-note">
          <span class="pulse-dot"></span>
          <div><strong>${manualIdentity ? "手动身份模式" : "飞书 SSO"}</strong><small>${templateReady ? "排期模板已就绪" : "待确认排期模板"}</small></div>
        </div>
        <button class="identity-card" ${manualIdentity ? 'data-action="switch-user"' : "disabled"} title="${manualIdentity ? "切换手动身份" : "身份由飞书 SSO 自动识别"}" aria-label="${manualIdentity ? "切换手动身份" : "飞书 SSO 身份"}，当前为${escapeHtml(user.name)}">
          <div class="avatar">${escapeHtml(user.avatar || user.name.slice(0, 1))}</div>
          <div class="identity-copy"><strong>${escapeHtml(user.name)}</strong><span>${roleLabel(user.role)}</span></div>
          <span class="identity-compact-label" aria-hidden="true">${manualIdentity ? "切换" : "SSO"}</span>
          <span class="identity-chevron" aria-hidden="true">⌄</span>
        </button>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><h1>${title}</h1><p>${subtitle}</p></div>
          <div class="top-actions">
            <button class="mobile-identity-button" ${manualIdentity ? 'data-action="switch-user"' : "disabled"} title="${manualIdentity ? "切换手动身份" : "身份由飞书 SSO 自动识别"}" aria-label="${manualIdentity ? "切换手动身份" : "飞书 SSO 身份"}，当前为${escapeHtml(user.name)}"><span>${escapeHtml(user.avatar || user.name.slice(0, 1))}</span><small>${manualIdentity ? "切换身份" : "SSO 身份"}</small></button>
            <div class="sync-pill"><span></span> 本地已同步</div>
            <button class="activity-trigger" data-action="open-activity" title="查看团队操作记录"><span class="activity-full">操作记录</span><span class="activity-short">记录</span></button>
            ${["director", "admin"].includes(user.role) ? `<button class="primary-button" data-action="open-create">${icon("plus")} 新建需求</button>` : ""}
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
  return state.tasks.filter((task) => canAct(task, user) && ![STAGES.WAITING_CLAIM, STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED].includes(task.currentStage));
}

function shanghaiDateKey(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function matchesPublishDate(task, { date: value, start, end }) {
  if (value === "all") return true;
  const today = shanghaiDateKey(new Date());
  const taskDate = shanghaiDateKey(task.publishAt);
  if (value === "custom") return !start || !end || (taskDate >= start && taskDate <= end);
  if (value === "today") return taskDate === today;
  if (value === "overdue") return taskDate < today;
  const days = value === "next3" ? 3 : 7;
  const presetEnd = new Date(`${today}T00:00:00+08:00`);
  presetEnd.setUTCDate(presetEnd.getUTCDate() + days);
  return taskDate >= today && taskDate <= shanghaiDateKey(presetEnd);
}

const TODO_DATE_PRESETS = [
  ["all", "全部计划日期"],
  ["today", "今天安排"],
  ["next3", "未来 3 天"],
  ["next7", "未来 7 天"],
  ["overdue", "已过计划日期"]
];

function activeDateFilters() {
  return state.activeView === "board" ? filters : todoFilters;
}

function updateDateFilters(patch) {
  if (state.activeView === "board") filters = { ...filters, ...patch };
  else todoFilters = { ...todoFilters, ...patch };
}

function availableDateYears() {
  const user = currentUser(state);
  const years = state.tasks
    .filter((task) => state.activeView === "board" || taskIsRelatedToUser(task, user))
    .map((task) => Number(shanghaiDateKey(task.publishAt).slice(0, 4)))
    .filter(Number.isFinite);
  const uniqueYears = [...new Set(years)].sort((left, right) => left - right);
  return uniqueYears.length ? uniqueYears : [Number(shanghaiDateKey(new Date()).slice(0, 4))];
}

function ensureCalendarMonth() {
  const preferred = calendarMonth || (activeDateFilters().start || shanghaiDateKey(new Date())).slice(0, 7);
  const [preferredYear, preferredMonth] = preferred.split("-").map(Number);
  const years = availableDateYears();
  const year = years.includes(preferredYear)
    ? preferredYear
    : years.reduce((closest, candidate) => Math.abs(candidate - preferredYear) < Math.abs(closest - preferredYear) ? candidate : closest);
  calendarMonth = `${year}-${String(preferredMonth).padStart(2, "0")}`;
}

function shiftCalendarMonth(offset) {
  ensureCalendarMonth();
  const years = availableDateYears();
  let [year, month] = calendarMonth.split("-").map(Number);
  if (offset > 0 && month === 12) {
    const nextYear = years.find((candidate) => candidate > year);
    if (!nextYear) return;
    year = nextYear;
    month = 1;
  } else if (offset < 0 && month === 1) {
    const previousYear = [...years].reverse().find((candidate) => candidate < year);
    if (!previousYear) return;
    year = previousYear;
    month = 12;
  } else {
    month += offset;
  }
  calendarMonth = `${year}-${String(month).padStart(2, "0")}`;
}

function compactDateLabel(dateKey) {
  if (!dateKey) return "";
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function dateFilterLabel() {
  const { date, start, end } = activeDateFilters();
  if (date !== "custom") return TODO_DATE_PRESETS.find(([value]) => value === date)?.[1] || "全部计划日期";
  if (!start) return "选择日期区间";
  if (!end) return `${compactDateLabel(start)}·选择结束日`;
  return `${compactDateLabel(start)} – ${compactDateLabel(end)}`;
}

function renderDateCalendar() {
  ensureCalendarMonth();
  const [year, month] = calendarMonth.split("-").map(Number);
  const availableYears = availableDateYears();
  const { start, end } = activeDateFilters();
  const yearOptions = availableYears
    .map((optionYear) => `<option value="${optionYear}" ${optionYear === year ? "selected" : ""}>${optionYear}年</option>`)
    .join("");
  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
    .map((optionMonth) => `<option value="${optionMonth}" ${optionMonth === month ? "selected" : ""}>${optionMonth}月</option>`)
    .join("");
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = shanghaiDateKey(new Date());
  const previousDisabled = year === availableYears[0] && month === 1;
  const nextDisabled = year === availableYears.at(-1) && month === 12;
  const cells = [
    ...Array.from({ length: firstWeekday }, () => '<span class="calendar-day-placeholder" aria-hidden="true"></span>'),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isStart = dateKey === start;
      const isEnd = dateKey === end;
      const inRange = Boolean(start && end && dateKey > start && dateKey < end);
      const classes = [isStart ? "range-start" : "", isEnd ? "range-end" : "", inRange ? "in-range" : "", dateKey === today ? "is-today" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="calendar-day ${classes}" data-calendar-date="${dateKey}" aria-label="${year}年${month}月${day}日" aria-pressed="${isStart || isEnd}">${day}</button>`;
    })
  ].join("");
  return `
    <div class="calendar-heading">
      <button type="button" data-calendar-shift="-1" ${previousDisabled ? "disabled" : ""}>上月</button>
      <div class="calendar-month-selects">
        <select id="calendar-year-select" aria-label="选择年份">${yearOptions}</select>
        <select id="calendar-month-select" aria-label="选择月份">${monthOptions}</select>
      </div>
      <button type="button" data-calendar-shift="1" ${nextDisabled ? "disabled" : ""}>下月</button>
    </div>
    <div class="calendar-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
    <div class="calendar-grid">${cells}</div>
  `;
}

function renderDateFilter() {
  const { date, start, end } = activeDateFilters();
  const selectionHint = date === "custom" && start && !end
    ? `已选 ${compactDateLabel(start)}，请选择结束日期`
    : date === "custom" && start && end
      ? `已选 ${compactDateLabel(start)} 至 ${compactDateLabel(end)}`
      : "点击第一个日期作为起点";
  return `
    <div class="date-filter-control">
      <button type="button" id="${state.activeView === "board" ? "board-date-filter" : "todo-date-filter"}" class="date-filter-trigger ${date === "custom" ? "has-range" : ""}" data-action="toggle-date-filter" aria-haspopup="dialog" aria-expanded="${datePickerOpen}">
        ${icon("calendar")}<span>${escapeHtml(dateFilterLabel())}</span><i aria-hidden="true">⌄</i>
      </button>
      ${datePickerOpen ? `<div class="date-filter-popover" role="dialog" aria-label="选择计划日期区间">
        <div class="date-filter-head"><div><strong>计划日期</strong><span>${selectionHint}</span></div><button type="button" data-action="clear-date-filter">清除</button></div>
        <div class="date-preset-list" aria-label="快捷日期筛选">
          ${TODO_DATE_PRESETS.map(([value, label]) => `<button type="button" class="${date === value ? "active" : ""}" data-date-preset="${value}">${label}</button>`).join("")}
        </div>
        <div class="date-calendar">${renderDateCalendar()}</div>
        <div class="date-filter-footer"><span>首尾日期深色，区间日期浅色</span><button type="button" data-action="close-date-filter">完成</button></div>
      </div>` : ""}
    </div>
  `;
}

function riskBanner() {
  const unconfirmed = activeTemplates().filter((template) => !template.confirmed).map((template) => template.level).join(" / ");
  if (!unconfirmed) return "";
  return `<div class="setup-banner">${icon("warning")}<div><strong>自动排期尚未启用</strong><span>${unconfirmed} 级模板仍是演示草案。请由管理员在后台核对并确认后再创建生产任务。</span></div><button class="text-button" data-view="admin">去配置</button></div>`;
}

function renderTodo() {
  const user = currentUser(state);
  const nonOperationalStages = [STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED, STAGES.PAUSED];
  const activeTasks = state.tasks.filter((task) => !nonOperationalStages.includes(task.currentStage));
  const actionableTasks = activeTasks.filter((task) => task.currentStage !== STAGES.WAITING_CLAIM && canAct(task, user));
  const overdueTasks = actionableTasks
    .filter(isOverdue)
    .sort((left, right) => new Date(deadlineForCurrentStage(left)) - new Date(deadlineForCurrentStage(right)));
  const pendingTasks = actionableTasks
    .filter((task) => !isOverdue(task))
    .sort((left, right) => new Date(deadlineForCurrentStage(left)) - new Date(deadlineForCurrentStage(right)));
  const allRelatedTasks = state.tasks
    .filter((task) => taskIsRelatedToUser(task, user))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
  const waitingTasks = allRelatedTasks
    .filter((task) => !nonOperationalStages.includes(task.currentStage) && !canAct(task, user))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
  const filteredRelatedTasks = allRelatedTasks.filter((task) => {
    if (!matchesPublishDate(task, todoFilters)) return false;
    if (todoFilters.status !== "all") return task.currentStage === todoFilters.status;
    return true;
  });
  const counts = {
    overdue: overdueTasks.length,
    pending: pendingTasks.length,
    waiting: waitingTasks.length,
    published: allRelatedTasks.filter((task) => [STAGES.PUBLISHED, STAGES.ASSIST_DONE].includes(task.currentStage)).length
  };
  const relatedDescription = user.role === "director"
    ? "我创建的全部需求，包含已发布、已完成、暂停和取消"
    : user.role === "editor"
      ? "我认领过的全部需求，转交后仍保留记录"
      : "全部需求，包含已发布、已完成、暂停和取消";
  const greeting = new Date().getHours() < 12 ? "早上好" : new Date().getHours() < 18 ? "下午好" : "晚上好";
  return renderShell(`
    ${riskBanner()}
    <section class="hero-panel">
      <div><span class="eyebrow">${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span><h2>${greeting}，${escapeHtml(user.name)}。</h2><p>你有 <strong>${counts.overdue + counts.pending}</strong> 条需求需要推进，优先处理超期任务。</p></div>
      <div class="hero-orbit"><span>${counts.overdue + counts.pending}</span><small>待推进</small></div>
    </section>
    <section class="metric-grid">
      ${metricCard("超期任务", counts.overdue, "需要立即处理", "danger")}
      ${metricCard("待处理", counts.pending, "当前由你推进", "amber")}
      ${metricCard("等待他人", counts.waiting, "当前无需操作", "blue")}
      ${metricCard("已发布 / 完成", counts.published, "全部相关需求", "mint")}
    </section>
    ${user.role === "editor" ? renderClaimPool() : ""}
    <section class="todo-grid operational-grid">
      ${todoSection("超期", "当前由你处理，且已越过节点截止时间", overdueTasks, "danger")}
      ${todoSection("待处理", "当前由你处理，且尚未超期", pendingTasks, "amber")}
      ${todoSection("等待他人", "相关任务正在由其他负责人推进", waitingTasks, "muted")}
    </section>
    <section class="related-task-area">
      <header class="related-task-heading"><div><span class="section-dot blue"></span><h3>全部相关任务</h3><em>${allRelatedTasks.length}</em></div><p>${relatedDescription}</p></header>
      <section class="filter-bar todo-filter-bar" aria-label="全部相关任务筛选">
        ${renderDateFilter()}
        <select id="todo-status-filter">
          <option value="all">全部状态</option>
          ${Object.entries(STAGE_META).map(([stage, meta]) => `<option value="${stage}" ${todoFilters.status === stage ? "selected" : ""}>${meta.label}</option>`).join("")}
        </select>
        <span class="result-count">筛选后 ${filteredRelatedTasks.length} / 共 ${allRelatedTasks.length} 条</span>
      </section>
      <div class="related-task-stack">${filteredRelatedTasks.length ? filteredRelatedTasks.map((task) => renderTaskCard(task, true)).join("") : `<div class="empty-state"><span>✓</span><p>当前筛选条件下没有相关任务</p></div>`}</div>
    </section>
  `);
}

function renderClaimPool() {
  const tasks = state.tasks.filter((task) => task.currentStage === STAGES.WAITING_CLAIM && !task.readOnly)
    .sort((left, right) => new Date(deadlineForCurrentStage(left)) - new Date(deadlineForCurrentStage(right)));
  return `<section class="claim-pool" aria-label="剪辑认领池">
    <header><div><span class="eyebrow">CLAIM POOL</span><h3>剪辑认领池 <em>${tasks.length}</em></h3><p>按认领截止时间排序，包含视频剪辑及拍摄／出镜协助</p></div></header>
    <div class="claim-pool-list" ${tasks.length > 4 ? 'tabindex="0" aria-label="待认领任务列表"' : ""}>${tasks.length ? tasks.map((task) => `<article class="claim-pool-item"><div class="claim-pool-title">${taskBadge(task)}<strong>${escapeHtml(task.title)}</strong></div><p>${escapeHtml(task.account)} · 编导 ${escapeHtml(task.directorName || "待指定")} · ${taskScheduleLabel(task)}</p><span class="${isOverdue(task) ? "is-overdue" : ""}">认领截止 ${formatDate(deadlineForCurrentStage(task))}</span><button class="quick-button" data-task-action="${ACTIONS.CLAIM}" data-task-id="${task.id}">认领</button></article>`).join("") : `<div class="empty-inline">目前没有待认领任务</div>`}</div>
  </section>`;
}

function metricCard(label, value, hint, tone) {
  return `<article class="metric-card tone-${tone}"><div class="metric-top"><span>${label}</span><i></i></div><strong>${value}</strong><small>${hint}</small></article>`;
}

function todoSection(title, subtitle, tasks, tone) {
  return `<section class="todo-section">
    <header><div><span class="section-dot ${tone}"></span><h3>${title}</h3><em>${tasks.length}</em></div><p>${subtitle}</p></header>
    <div class="task-stack" ${tasks.length > 2 ? `tabindex="0" aria-label="${title}任务列表，共${tasks.length}条，可在区域内滚动"` : ""}>${tasks.length ? tasks.map((task) => renderTaskCard(task, true)).join("") : `<div class="empty-state"><span>✓</span><p>这里暂时没有任务</p></div>`}</div>
    ${tasks.length > 2 ? `<p class="todo-section-footer">区域内滚动查看全部 ${tasks.length} 条</p>` : ""}
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
    [STAGES.READY_PUBLISH]: [ACTIONS.PUBLISH, "确认发布"],
    [STAGES.ASSISTING]: [ACTIONS.COMPLETE_ASSIST, "确认协助完成"]
  };
  return map[task.currentStage] || null;
}

function renderTaskCard(task, wide = false) {
  const responsible = getResponsible(task);
  const deadline = deadlineForCurrentStage(task);
  const overdue = isOverdue(task);
  const action = primaryAction(task);
  const actionable = canAct(task, currentUser(state));
  let deadlineCopy;
  if (task.currentStage === STAGES.PUBLISHED) deadlineCopy = `已发布 · ${formatDate(task.completedAt || task.publishAt)}`;
  else if (task.currentStage === STAGES.ASSIST_DONE) deadlineCopy = `已完成 · ${formatDate(task.completedAt || task.endsAt)}`;
  else if (task.currentStage === STAGES.CANCELLED) deadlineCopy = `已取消 · ${formatDate(task.updatedAt || task.publishAt)}`;
  else if (task.currentStage === STAGES.PAUSED) deadlineCopy = "已暂停，当前不发送提醒";
  else if (overdue) deadlineCopy = relativeTime(deadline);
  else deadlineCopy = `${formatDate(deadline)} · ${relativeTime(deadline)}`;
  return `<article class="task-card ${wide ? "wide" : ""} ${overdue ? "overdue" : ""}" data-task-id="${task.id}" tabindex="0">
    <div class="task-card-top">${taskBadge(task)}<span class="account">${escapeHtml(task.account)}</span><span class="task-code">${escapeHtml(task.code)}</span></div>
    <h4>${escapeHtml(task.title)}</h4>
    <div class="task-meta">
      <span class="stage-pill">${stageLabel(task.currentStage)}</span>
      <span class="owner-mini"><i>${escapeHtml((responsible.name || "待").slice(0, 1))}</i>${escapeHtml(responsible.name || "待指定")}</span>
    </div>
    <div class="task-card-bottom">
      <span class="deadline ${overdue ? "is-overdue" : ""}">${icon("clock")} ${deadlineCopy}</span>
      ${actionable && action ? `<button class="quick-button" data-task-action="${action[0]}" data-task-id="${task.id}">${action[1]}</button>` : `<button class="ghost-arrow" data-open-task="${task.id}" title="查看详情">详情</button>`}
    </div>
  </article>`;
}

function renderBoard() {
  const stages = [STAGES.WAITING_CLAIM, STAGES.WAITING_SHOOT, STAGES.WAITING_MATERIAL, STAGES.EDITING, STAGES.INITIAL_REVIEW, STAGES.DIRECTOR_REVIEW, STAGES.MODIFYING, STAGES.READY_PUBLISH, STAGES.ASSISTING, STAGES.PUBLISHED, STAGES.ASSIST_DONE];
  const visible = filteredTasks();
  return renderShell(`
    ${riskBanner()}
    <section class="filter-bar board-filter-bar" aria-label="团队看板筛选">
      <div class="board-filter-main">
        ${renderDateFilter()}
        <label class="search-box">${icon("search")}<input id="board-search" value="${escapeHtml(filters.query)}" placeholder="搜索选题、账号或任务编号" /></label>
      </div>
      <div class="board-filter-options">
        <select id="filter-level"><option value="all">全部等级 / 类型</option><option value="assistance" ${filters.level === "assistance" ? "selected" : ""}>拍摄／出镜协助</option>${state.templates.map((template) => `<option value="${escapeHtml(template.level)}" ${filters.level === template.level ? "selected" : ""}>${escapeHtml(template.name)}${template.enabled === false ? "（已停用）" : ""}</option>`).join("")}</select>
        <select id="filter-owner"><option value="all">全部负责人</option>${activeUsers().map((user) => `<option value="${user.id}" ${filters.owner === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`).join("")}</select>
        <select id="filter-risk"><option value="all">全部状态</option><option value="overdue" ${filters.risk === "overdue" ? "selected" : ""}>仅看超期</option><option value="soon" ${filters.risk === "soon" ? "selected" : ""}>48h内发布</option></select>
        <span class="result-count">${visible.length} 条任务</span>
      </div>
    </section>
    <section class="kanban" aria-label="团队需求看板">
      ${stages.map((stage) => {
        const tasks = visible.filter((task) => task.currentStage === stage);
        return `<div class="kanban-column"><header><div><span class="column-dot stage-${stage}"></span><h3>${STAGE_META[stage].label}</h3></div><em>${tasks.length}</em></header><div class="kanban-stack">${tasks.map((task) => renderTaskCard(task)).join("") || `<div class="column-empty">暂无任务</div>`}</div></div>`;
      }).join("")}
    </section>
  `);
}

function filteredTasks() {
  return state.tasks.filter((task) => {
    if (!matchesPublishDate(task, filters)) return false;
    const text = `${task.title} ${task.account} ${task.code}`.toLowerCase();
    if (filters.query && !text.includes(filters.query.toLowerCase())) return false;
    if (filters.level === "assistance" && !isAssistance(task)) return false;
    if (filters.level !== "all" && filters.level !== "assistance" && task.level !== filters.level) return false;
    if (filters.owner !== "all" && ![task.directorId, task.editorId, task.reviewerId, task.shooterId].includes(filters.owner)) return false;
    if (filters.risk === "overdue" && !isOverdue(task)) return false;
    if (filters.risk === "soon") {
      const diff = new Date(task.publishAt).getTime() - Date.now();
      if (!(diff > 0 && diff < 48 * 3600000)) return false;
    }
    return true;
  });
}

function weekLabel(start, end) {
  const [startYear, startMonth, startDay] = start.split("-");
  const [endYear, endMonth, endDay] = end.split("-");
  return `${startYear}年${Number(startMonth)}月${Number(startDay)}日—${startYear === endYear ? "" : `${endYear}年`}${Number(endMonth)}月${Number(endDay)}日`;
}

function renderWeekGroup(title, tasks) {
  return `<div class="week-group"><div class="week-group-heading"><strong>${title}</strong><em>${tasks.length}</em></div><div class="week-task-list">${tasks.map((task) => `<button type="button" class="week-task" data-open-task="${task.id}"><span>${taskBadge(task)}<strong>${escapeHtml(task.title)}</strong></span><small>${escapeHtml(task.account)} · ${stageLabel(task.currentStage)} · ${taskScheduleLabel(task)}</small></button>`).join("")}</div></div>`;
}

function renderSchedule() {
  const slices = weekSlices(state.tasks, scheduleMonday);
  const lastEnd = slices.at(-1).end;
  const todayMonday = mondayOf(chinaDateKey(new Date()));
  return renderShell(`
    <section class="schedule-intro"><div><span class="eyebrow">WEEKLY OVERVIEW</span><h2>按自然周查看需求排期</h2><p>视频按计划发布日期、协助按服务日期归入自然周；每条需求只显示一次，点击可查看节点记录。</p></div><div class="schedule-range">${weekLabel(scheduleMonday, lastEnd)}</div></section>
    <div class="schedule-controls"><button class="secondary-button" data-action="schedule-prev">上一组四周</button><button class="secondary-button" data-action="schedule-today" ${scheduleMonday === todayMonday ? "disabled" : ""}>回到本周</button><button class="secondary-button" data-action="schedule-next">下一组四周</button><label>跳转到日期 <input id="schedule-jump" type="date" value="${scheduleMonday}" aria-label="跳转到所在自然周" /></label></div>
    <div class="week-slices">${slices.map((week) => `<section class="week-slice ${week.start === todayMonday ? "current" : ""}" aria-label="${weekLabel(week.start, week.end)}排期"><header><div><span>${week.start === todayMonday ? "本周" : "自然周"}</span><h3>${weekLabel(week.start, week.end)}</h3></div><strong>${week.tasks.length} 条任务</strong></header><div class="week-counts">${WEEK_GROUPS.map(({ key, label }) => `<span>${label} <b>${week.groups[key].length}</b></span>`).join("")}</div><div class="week-groups">${week.tasks.length ? WEEK_GROUPS.filter(({ key }) => week.groups[key].length).map(({ key, label }) => renderWeekGroup(label, week.groups[key])).join("") : `<div class="week-empty-state">这个自然周暂无任务</div>`}</div></section>`).join("")}</div>
  `);
}

function renderAdmin() {
  const enabledTemplates = activeTemplates();
  const confirmedCount = enabledTemplates.filter((item) => item.confirmed && validateTemplate(item).valid).length;
  const allReady = enabledTemplates.length > 0 && confirmedCount === enabledTemplates.length;
  const enabledUsers = activeUsers();
  const manualIdentity = state.settings.identityMode !== "feishu";
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
        <section class="settings-card"><div class="settings-icon">${icon("settings")}</div><h3>基础选项配置</h3><p>统一维护账号、素材给予方式和交片渠道，前台直接选择，避免名称不一致。</p><div class="catalog-block"><strong>账号 / 达人</strong><div class="catalog-chips">${state.settings.accounts.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div><div class="catalog-block"><strong>素材给予方式</strong><div class="catalog-chips">${state.settings.materialDeliveryMethods.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div><div class="catalog-block"><strong>交片渠道</strong><div class="catalog-chips">${state.settings.cutDeliveryMethods.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></div><button class="secondary-button full" data-action="open-catalogs">管理基础选项</button></section>
        <section class="settings-card"><div class="settings-icon">${icon("user")}</div><h3>平台权限与身份</h3><p>手动维护身份、角色与页面权限，也可切换为飞书 SSO 自动识别。</p><dl class="config-list"><div><dt>身份模式</dt><dd>${manualIdentity ? "手动配置" : "飞书 SSO"}</dd></div><div><dt>启用身份</dt><dd>${enabledUsers.length} 人</dd></div><div><dt>后台管理员</dt><dd>${enabledUsers.filter((user) => canAccessView(user, "admin")).length} 人</dd></div><div><dt>数据</dt><dd>演示为浏览器本地</dd></div></dl><button class="secondary-button full" data-action="open-access-settings">管理平台权限与身份</button></section>
        <section class="settings-card"><div class="settings-icon">${icon("calendar")}</div><h3>需求节点数据导出</h3><p>按视频计划发布日期或协助服务日期筛选，导出节点负责人、计划截止、实际完成及操作记录。当前仅导出本浏览器的数据。</p><form id="export-form" class="export-form"><label>开始日期<input name="start" type="date" value="${exportDates.start}" required /></label><label>结束日期<input name="end" type="date" value="${exportDates.end}" required /></label><button class="secondary-button full" type="submit">导出 CSV</button></form></section>
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
    <header class="drawer-header"><div><div class="drawer-badges">${taskBadge(task)}<span>${escapeHtml(task.code)}</span></div><h2>${escapeHtml(task.title)}</h2><p>${escapeHtml(task.account)} · ${isAssistance(task) ? taskScheduleLabel(task) : task.needsShoot ? "待拍摄素材" : "已有素材"}</p></div><button class="icon-button large" data-action="close-drawer">${icon("x")}</button></header>
    <div class="drawer-status"><div><small>当前环节</small><strong>${stageLabel(task.currentStage)}</strong></div><div><small>当前负责人</small><strong>${escapeHtml(responsible.name)}</strong></div><div><small>${isAssistance(task) ? "承接协助" : "承接剪辑"}</small><strong>${escapeHtml(task.editorName || "待认领")}</strong></div><div><small>负责编导</small><strong>${escapeHtml(task.directorName || "待指定")}</strong></div><div class="${isOverdue(task) ? "danger-copy" : ""}"><small>节点截止</small><strong>${formatDate(deadline)}</strong><span>${[STAGES.ASSIST_DONE, STAGES.PUBLISHED].includes(task.currentStage) ? "已完成" : relativeTime(deadline)}</span></div></div>
    <div class="progress-track">${renderProgress(task)}</div>
    ${isAssistance(task) ? "" : `<section class="drawer-section"><div class="section-title"><h3>交付文件</h3><span>${task.versions.length} 个成片版本</span></div><div class="file-list">${renderFiles(task)}</div></section>`}
    <section class="drawer-section"><div class="section-title"><h3>操作时间轴</h3><span>${task.events.length} 条记录</span></div><div class="timeline">${[...task.events].reverse().map(renderEvent).join("")}</div></section>
    <footer class="drawer-actions">
      ${canAct(task, currentUser(state)) && action ? `<button class="primary-button grow" data-task-action="${action[0]}" data-task-id="${task.id}">${action[1]}</button>` : ""}
      ${!task.readOnly && ![STAGES.PUBLISHED, STAGES.CANCELLED].includes(task.currentStage) && (currentUser(state).role === "admin" || task.directorId === currentUser(state).id) ? `<button class="secondary-button" data-task-action="${task.currentStage === STAGES.PAUSED ? ACTIONS.RESUME : ACTIONS.PAUSE}" data-task-id="${task.id}">${task.currentStage === STAGES.PAUSED ? "恢复" : "暂停"}</button><button class="more-button" data-task-action="more" data-task-id="${task.id}">•••</button>` : ""}
    </footer>
  </aside>`;
}

function renderProgress(task) {
  if (isAssistance(task)) {
    const stages = [STAGES.WAITING_CLAIM, STAGES.ASSISTING, STAGES.ASSIST_DONE];
    const current = stages.indexOf(task.currentStage);
    return stages.map((stage, index) => `<div class="progress-step ${index < current ? "done" : index === current ? "current" : ""}"><i>${index < current ? "✓" : index + 1}</i><span>${stageLabel(stage)}</span></div>`).join("");
  }
  const materialStage = task.needsShoot ? STAGES.WAITING_SHOOT : STAGES.WAITING_MATERIAL;
  const stages = [STAGES.WAITING_CLAIM, materialStage, STAGES.EDITING, ...(task.requiresInitialReview ? [STAGES.INITIAL_REVIEW] : []), STAGES.DIRECTOR_REVIEW, STAGES.MODIFYING, STAGES.READY_PUBLISH, STAGES.PUBLISHED];
  const current = stages.indexOf(task.currentStage);
  return stages.map((stage, index) => `<div class="progress-step ${index < current ? "done" : index === current ? "current" : ""}"><i>${index < current ? "✓" : index + 1}</i><span>${stageLabel(stage)}</span></div>`).join("");
}

function renderFiles(task) {
  const linkedFiles = [
    task.scriptUrl && { label: "脚本 / Brief", url: task.scriptUrl, type: "DOC" },
    task.materialUrl && { label: "历史素材链接", url: task.materialUrl, type: "RAW" },
    ...task.versions.filter((version) => version.url).map((version) => ({ label: `成片 V${version.number}`, url: version.url, type: "MP4", meta: `${version.submittedBy} · ${formatDate(version.submittedAt)}` }))
  ].filter(Boolean);
  const materialRows = [];
  if (task.materialMethod) {
    const attachmentNames = (task.materialAttachments || []).map((item) => item.name).filter(Boolean);
    const meta = [task.materialMethod, attachmentNames.length ? `附件：${attachmentNames.join("、")}` : "", task.materialNote].filter(Boolean).join(" · ");
    materialRows.push(`<div class="file-row material-row"><span>RAW</span><div><strong>素材给予方式</strong><small>${escapeHtml(meta)}</small></div></div>`);
  }
  for (const [index, attachment] of (task.materialAttachments || []).entries()) {
    if (attachment.dataUrl) materialRows.push(`<div class="file-row"><span>ATT</span><div><strong>${escapeHtml(attachment.name)}</strong><small>${attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : "素材附件"}</small></div><button type="button" class="file-preview-button" data-preview-task="${task.id}" data-preview-kind="material" data-preview-index="${index}">预览</button></div>`);
  }
  const cutRows = task.versions.map((version, index) => {
    if (version.url && !version.attachment?.dataUrl) return "";
    const meta = [version.deliveryMethod, version.deliveryNote, `${version.submittedBy} · ${formatDate(version.submittedAt)}`].filter(Boolean).join(" · ");
    return `<div class="file-row cut-row"><span>V${version.number}</span><div><strong>成片 V${version.number}${version.attachment ? ` · ${escapeHtml(version.attachment.name)}` : ""}</strong><small>${escapeHtml(meta)}</small></div>${version.attachment?.dataUrl ? `<button type="button" class="file-preview-button" data-preview-task="${task.id}" data-preview-kind="version" data-preview-index="${index}">预览附件</button>` : ""}</div>`;
  });
  const linkedRows = linkedFiles.map((file) => `<a class="file-row" href="${escapeHtml(file.url)}" target="_blank" rel="noopener"><span>${file.type}</span><div><strong>${escapeHtml(file.label)}</strong><small>${escapeHtml(file.meta || "点击打开链接")}</small></div>${icon("link")}</a>`);
  return [...materialRows, ...cutRows, ...linkedRows].filter(Boolean).join("") || `<div class="empty-inline">尚未添加交付文件</div>`;
}

function renderEvent(event) {
  return `<div class="timeline-item"><i></i><div><strong>${escapeHtml(event.label)}</strong><p>${escapeHtml(event.actorName)} · ${formatDate(event.at)}</p>${event.note ? `<blockquote>${escapeHtml(event.note)}</blockquote>` : ""}</div></div>`;
}

function renderModal() {
  if (modal.type === "create") return renderCreateModal();
  if (modal.type === "user") return renderUserModal();
  if (modal.type === "action") return renderActionModal();
  if (modal.type === "template") return renderTemplateModal();
  if (modal.type === "catalogs") return renderCatalogModal();
  if (modal.type === "access") return renderAccessModal();
  if (modal.type === "activity") return renderActivityModal();
  if (modal.type === "preview") return renderPreviewModal();
  return "";
}

function renderActivityModal() {
  const events = state.tasks.flatMap((task) => (task.events || []).map((event) => ({ ...event, taskTitle: task.title, taskCode: task.code, taskId: task.id })))
    .sort((left, right) => new Date(right.at) - new Date(left.at)).slice(0, 100);
  return modalShell("团队操作记录", "按操作时间倒序展示最近 100 条记录", `<div class="activity-list">${events.length ? events.map((event) => `<button type="button" class="activity-row" data-activity-task="${event.taskId}"><span class="activity-mark">${escapeHtml((event.actorName || "系").slice(0, 1))}</span><span><strong>${escapeHtml(event.actorName || "系统")} · ${escapeHtml(event.label || event.action)}</strong><small>${escapeHtml(event.taskTitle)} · ${escapeHtml(event.taskCode || "")}</small>${event.note ? `<em>${escapeHtml(event.note)}</em>` : ""}</span><time>${formatDate(event.at)}</time></button>`).join("") : `<div class="empty-inline">暂无操作记录</div>`}</div>`, true);
}

function renderPreviewModal() {
  const task = state.tasks.find((item) => item.id === modal.taskId);
  const attachment = modal.kind === "version" ? task?.versions?.[modal.index]?.attachment : task?.materialAttachments?.[modal.index];
  if (!attachment) return "";
  const source = attachment.dataUrl || "";
  const type = attachment.type || source.match(/^data:([^;]+)/)?.[1] || "";
  const safeData = /^data:(image\/(png|jpeg|webp|gif)|application\/pdf|video\/(mp4|webm));base64,/i.test(source);
  let preview = `<div class="preview-unsupported">此文件类型暂无在线预览，可下载后查看。</div>`;
  if (safeData && type.startsWith("image/")) preview = `<img src="${escapeHtml(source)}" alt="${escapeHtml(attachment.name)}" />`;
  else if (safeData && type.startsWith("video/")) preview = `<video src="${escapeHtml(source)}" controls playsinline></video>`;
  else if (safeData && type === "application/pdf") preview = `<iframe src="${escapeHtml(source)}" title="${escapeHtml(attachment.name)}" sandbox></iframe>`;
  return modalShell("附件预览", `${task.title} · ${attachment.name}`, `<div class="preview-content">${preview}</div><div class="preview-footer"><span>${attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : "附件"}</span>${/^data:/.test(source) ? `<a class="secondary-button" href="${escapeHtml(source)}" download="${escapeHtml(attachment.name)}">下载附件</a>` : ""}</div>`, true);
}

function renderCreateModal() {
  const requestType = modal.requestType || "video";
  const tabs = `<div class="create-type-tabs" role="tablist" aria-label="需求类型">${[["video", "视频剪辑"], ["shooting", "拍摄协助"], ["acting", "出镜协助"]].map(([type, label]) => `<button type="button" role="tab" aria-selected="${type === requestType}" class="${type === requestType ? "active" : ""}" data-create-type="${type}">${label}</button>`).join("")}</div>`;
  if (requestType !== "video") {
    return modalShell(`新建${requestTypeLabel(requestType)}需求`, "同一天选中的时段合在一条需求中，由一位剪辑承接", `
      ${tabs}
      <form id="assist-create-form" class="modal-form">
        <label class="form-field full"><span>事项说明（可选）</span><input name="title" maxlength="80" placeholder="不填则使用账号和需求类型自动命名" autofocus /></label>
        <label class="form-field full"><span>账号 / 达人 <em>*</em></span><select name="account" required><option value="">请选择</option>${state.settings.accounts.map((account) => `<option value="${escapeHtml(account)}">${escapeHtml(account)}</option>`).join("")}</select></label>
        <label class="form-field full"><span>协助日期 <em>*</em></span><input name="serviceDate" type="date" required /></label>
        <fieldset class="assist-slots full"><legend>协助时段 <em>*</em>（可多选）</legend>${ASSISTANCE_SLOTS.map((slot) => `<label><input type="checkbox" name="timeSlots" value="${slot}" /><span>${slot}</span></label>`).join("")}</fieldset>
        ${state.settings.accounts.length ? "" : `<div class="form-warning full">请先在管理后台配置至少一个账号 / 达人。</div>`}
        <div class="modal-footer full"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button" ${state.settings.accounts.length ? "" : "disabled"}>创建协助需求</button></div>
      </form>
    `);
  }
  const readyTemplates = activeTemplates().filter((item) => item.confirmed && validateTemplate(item).valid);
  const canCreate = readyTemplates.length > 0 && state.settings.accounts.length > 0;
  return modalShell("新建视频任务", "五项选择完成后即可发布任务", `
    ${tabs}
    <form id="create-form" class="modal-form">
      <label class="form-field full"><span>视频选题 <em>*</em></span><input name="title" required maxlength="80" placeholder="一句话说明这条片子要讲什么" autofocus /></label>
      <label class="form-field"><span>账号 / 达人 <em>*</em></span><select name="account" required><option value="">请选择</option>${state.settings.accounts.map((account) => `<option value="${escapeHtml(account)}">${escapeHtml(account)}</option>`).join("")}</select></label>
      <label class="form-field"><span>视频等级 <em>*</em></span><select name="level" required><option value="">请选择</option>${activeTemplates().map((template) => `<option value="${escapeHtml(template.level)}" ${readyTemplates.includes(template) ? "" : "disabled"}>${escapeHtml(template.name)}${readyTemplates.includes(template) ? "" : "（模板未确认）"}</option>`).join("")}</select></label>
      <label class="form-field full"><span>计划发布日期 <em>*</em></span><input name="publishAt" type="date" required /></label>
      <label class="form-field full"><span>素材状态 <em>*</em></span><select name="materialStatus" required><option value="">请选择</option><option value="existing">已有素材</option><option value="needs_shoot">待拍摄素材</option></select></label>
      ${readyTemplates.length ? "" : `<div class="form-warning full">请先在管理后台确认至少一个等级的节点间隔模板。</div>`}
      ${state.settings.accounts.length ? "" : `<div class="form-warning full">请先在管理后台配置至少一个账号 / 达人。</div>`}
      <div class="modal-footer full"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button" ${canCreate ? "" : "disabled"}>创建并发布</button></div>
    </form>
  `);
}

function renderCatalogModal() {
  return modalShell("基础选项配置", "每行填写一个选项，保存后立即用于前台选择", `
    <form id="catalog-form" class="modal-form single">
      <label class="form-field full"><span>账号 / 达人 <em>*</em></span><textarea name="accounts" required rows="7" placeholder="每行一个账号">${escapeHtml(state.settings.accounts.join("\n"))}</textarea><small class="field-help">统一维护后，新建任务只需选择，不再手动输入。</small></label>
      <label class="form-field full"><span>素材给予方式 <em>*</em></span><textarea name="materialMethods" required rows="5" placeholder="每行一种方式">${escapeHtml(state.settings.materialDeliveryMethods.join("\n"))}</textarea><small class="field-help">例如：飞书、现场传输、剪映云空间。</small></label>
      <label class="form-field full"><span>交片渠道 <em>*</em></span><textarea name="cutMethods" required rows="5" placeholder="每行一种渠道">${escapeHtml(state.settings.cutDeliveryMethods.join("\n"))}</textarea><small class="field-help">例如：剪映云空间、飞书、现场传输。</small></label>
      ${modalFooter("保存配置")}
    </form>
  `);
}

function renderUserModal() {
  return modalShell("切换手动身份", "可切换范围由管理后台的身份配置决定", `<div class="user-grid">${activeUsers().map((user) => `<button class="user-option ${state.currentUserId === user.id ? "active" : ""}" data-user-id="${user.id}"><span>${escapeHtml(user.avatar)}</span><div><strong>${escapeHtml(user.name)}</strong><small>${roleLabel(user.role)} · ${(user.permissions || []).map((view) => ({ todo: "待办", board: "看板", admin: "后台" })[view]).filter(Boolean).join("/")}</small></div>${state.currentUserId === user.id ? "✓" : ""}</button>`).join("")}</div>`);
}

function renderAccessModal() {
  const roles = [["director", "编导"], ["editor", "剪辑"], ["reviewer", "中台审核"], ["admin", "管理员"]];
  const views = [["todo", "我的待办"], ["board", "团队看板"], ["admin", "管理后台"]];
  const roleOptions = (selected = "director") => roles.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
  const permissionChecks = (name, permissions = ["todo", "board"]) => views.map(([value, label]) => `<label><input type="checkbox" name="${name}" value="${value}" ${permissions.includes(value) ? "checked" : ""}/><span>${label}</span></label>`).join("");
  const members = configuredUsers().map((user, index) => `
    <div class="access-member-row">
      <span class="access-avatar">${escapeHtml(user.avatar || user.name.slice(0, 1))}</span>
      <label class="access-field"><span>姓名</span><input name="memberName_${index}" value="${escapeHtml(user.name)}" required maxlength="20" /></label>
      <label class="access-field"><span>角色</span><select name="memberRole_${index}">${roleOptions(user.role)}</select></label>
      <label class="access-enabled"><input type="checkbox" name="memberEnabled_${index}" ${user.enabled === false ? "" : "checked"}/><span>启用</span></label>
      <div class="access-permissions"><strong>页面权限</strong>${permissionChecks(`memberPermission_${index}`, user.permissions)}</div>
    </div>`).join("");
  return modalShell("平台权限与身份", "角色决定流程操作权，页面权限决定导航入口", `
    <form id="access-form" class="access-form">
      <label class="form-field"><span>身份识别方式</span><select name="identityMode"><option value="manual" ${state.settings.identityMode === "feishu" ? "" : "selected"}>手动身份</option><option value="feishu" ${state.settings.identityMode === "feishu" ? "selected" : ""}>飞书 SSO</option></select><small class="field-help">飞书 SSO 模式下不允许手动切换当前身份。</small></label>
      <div class="access-section-title"><strong>已配置身份</strong><span>${configuredUsers().length} 人</span></div>
      <div class="access-member-list">${members}</div>
      <div class="access-add-member">
        <div class="access-section-title"><strong>新增身份（可选）</strong><span>保存后可继续新增</span></div>
        <div class="access-add-grid"><label class="access-field"><span>姓名</span><input name="newMemberName" maxlength="20" placeholder="输入新成员姓名" /></label><label class="access-field"><span>角色</span><select name="newMemberRole">${roleOptions()}</select></label></div>
        <div class="access-permissions"><strong>页面权限</strong>${permissionChecks("newMemberPermission")}</div>
      </div>
      <div class="form-warning">至少保留一位启用中、拥有管理后台权限的管理员，避免平台无法维护。</div>
      ${modalFooter("保存权限与身份")}
    </form>
  `, true);
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
    [ACTIONS.COMPLETE_ASSIST]: { title: "确认协助完成", desc: "完成后记录协助人和时间，需求将归档", note: "完成备注（可选）", submit: "确认完成" },
    [ACTIONS.SUBMIT_CUT]: { title: task.currentStage === STAGES.MODIFYING ? "提交修改版本" : "提交成片", desc: "选择交片渠道；新版本会保留，不覆盖历史成片", note: "版本说明（可选）", submit: "提交审核" },
    [ACTIONS.PUBLISH]: { title: "确认视频发布", desc: "发布后任务归档，只读保留完整记录", url: "发布链接（可选）", note: "发布备注（可选）", submit: "确认已发布" },
    [ACTIONS.PAUSE]: { title: "暂停任务", desc: "暂停后停止所有提醒，恢复时回到原环节", note: "暂停原因", submit: "确认暂停", danger: true },
    [ACTIONS.RESUME]: { title: "恢复任务", desc: "任务将回到暂停前的环节并重新参与提醒", note: "恢复说明（可选）", submit: "恢复任务" },
    [ACTIONS.CANCEL]: { title: "取消任务", desc: "取消后停止提醒并保留全部历史记录", note: "取消原因", submit: "确认取消", danger: true },
    [ACTIONS.APPROVE]: { title: "审核通过", desc: task.currentStage === STAGES.INITIAL_REVIEW ? "通过后进入编导终审" : "通过后进入待发布", note: "审核意见（可选）", submit: "通过" },
    [ACTIONS.REJECT]: { title: "退回修改", desc: "退回后剪辑提交会生成新版本", note: "修改意见（可选）", submit: "退回剪辑", danger: true }
  };
  return specs[action] || { title: "确认操作", desc: "系统将自动记录操作人和时间", submit: "确认" };
}

function renderActionModal() {
  const task = state.tasks.find((item) => item.id === modal.taskId);
  if (!task) return "";
  if (modal.action === "open-review") {
    const version = task.versions.at(-1);
    const delivery = version?.url
      ? `<a href="${escapeHtml(version.url)}" target="_blank" rel="noopener">打开成片 ${icon("link")}</a>`
      : `<p class="review-delivery">交片渠道：${escapeHtml(version?.deliveryMethod || "未记录")}${version?.deliveryNote ? ` · ${escapeHtml(version.deliveryNote)}` : ""}</p>`;
    return modalShell(`审核 · ${stageLabel(task.currentStage)}`, "备注可选，填写后直接选择审核结果", `<div class="review-preview">${version ? `<span>当前版本 V${version.number}</span><strong>${escapeHtml(task.title)}</strong>${delivery}` : "暂无成片版本"}</div><form id="review-form" class="review-inline-form"><label class="form-field"><span>审核备注（可选）</span><textarea name="note" placeholder="可补充通过说明或需要修改的内容"></textarea></label><div class="review-actions"><button type="submit" class="approve-button" name="reviewAction" value="${ACTIONS.APPROVE}">✓ 通过审核</button><button type="submit" class="reject-button" name="reviewAction" value="${ACTIONS.REJECT}">↩ 退回修改</button></div></form>`);
  }
  if (modal.action === "more") {
    return modalShell("更多操作", "异常操作必须填写原因并保留记录", `<div class="more-actions">${isAssistance(task) ? "" : `<button data-more-action="reschedule" data-task-id="${task.id}"><strong>调整发布时间</strong><span>重新计算全部未完成节点</span></button>`}<button data-more-action="transfer" data-task-id="${task.id}"><strong>转交负责人</strong><span>将当前环节移交给其他成员</span></button><button class="danger" data-review-action="${ACTIONS.CANCEL}" data-task-id="${task.id}"><strong>取消任务</strong><span>停止流程和提醒</span></button></div>`);
  }
  if (modal.action === "reschedule") {
    return modalShell("调整发布日期", "系统将按已确认模板重新计算节点", `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${ACTIONS.RESCHEDULE}"/><label class="form-field full"><span>新计划发布日期</span><input name="publishAt" type="date" required/></label><label class="form-field full"><span>改期原因</span><textarea name="note" required placeholder="说明为什么需要改期"></textarea></label>${modalFooter("确认改期")}</form>`);
  }
  if (modal.action === "transfer") {
    return modalShell("转交负责人", "只变更当前环节负责人，不修改历史记录", `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${ACTIONS.TRANSFER}"/><label class="form-field full"><span>新负责人</span><select name="userId" required><option value="">请选择</option>${activeUsers().map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${roleLabel(user.role)}</option>`).join("")}</select></label><label class="form-field full"><span>转交原因</span><textarea name="note" required></textarea></label>${modalFooter("确认转交")}</form>`);
  }
  if ([ACTIONS.SHOOT_COMPLETE, ACTIONS.MATERIAL_READY].includes(modal.action)) {
    const completesShoot = modal.action === ACTIONS.SHOOT_COMPLETE;
    return modalShell(completesShoot ? "完成拍摄并交接素材" : "确认素材就绪", completesShoot ? "一次确认拍摄完成与素材给予方式，提交后直接进入剪辑环节" : "选择素材给予方式后进入剪辑环节", `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${modal.action}"/><label class="form-field full"><span>素材给予方式 <em>*</em></span><select name="materialMethod" required><option value="">请选择</option>${state.settings.materialDeliveryMethods.map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join("")}</select></label><label class="form-field full"><span>附件（可选）</span><input name="attachment" type="file"/><small class="field-help">可补充交接单或素材说明文件；演示环境支持 1MB 以内附件。</small></label><label class="form-field full"><span>备注（可选）</span><textarea name="note" placeholder="例如：素材已交接，缺少的镜头稍后补充"></textarea></label>${modalFooter(completesShoot ? "确认并进入剪辑" : "确认并推进")}</form>`);
  }
  if (modal.action === ACTIONS.SUBMIT_CUT) {
    const spec = actionSpec(task, modal.action);
    return modalShell(spec.title, spec.desc, `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${ACTIONS.SUBMIT_CUT}"/><label class="form-field full"><span>交片渠道 <em>*</em></span><select name="cutDeliveryMethod" required><option value="">请选择</option>${state.settings.cutDeliveryMethods.map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join("")}</select></label><label class="form-field full"><span>交片位置 / 备注（可选）</span><textarea name="deliveryNote" placeholder="例如：剪映云空间项目名称、飞书文件夹位置或现场接收人"></textarea></label><label class="form-field full"><span>小附件（可选）</span><input name="attachment" type="file"/><small class="field-help">支持预览图片、PDF 和小视频；演示环境限 1MB。</small></label><label class="form-field full"><span>${spec.note}</span><textarea name="note" placeholder="${spec.note}"></textarea></label>${modalFooter(spec.submit)}</form>`);
  }
  const spec = actionSpec(task, modal.action);
  return modalShell(spec.title, spec.desc, `<form id="action-form" class="modal-form single"><input type="hidden" name="action" value="${modal.action}"/>${spec.url ? `<label class="form-field full"><span>${spec.url}</span><input name="url" type="url" ${modal.action === ACTIONS.PUBLISH ? "" : "required"} placeholder="https://"/></label>` : ""}${spec.note ? `<label class="form-field full"><span>${spec.note}</span><textarea name="note" ${[ACTIONS.PAUSE, ACTIONS.CANCEL].includes(modal.action) ? "required" : ""} placeholder="${spec.note}"></textarea></label>` : ""}${modalFooter(spec.submit, spec.danger)}</form>`);
}

function modalFooter(label, danger = false) {
  return `<div class="modal-footer full"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="${danger ? "danger-button" : "primary-button"}">${label}</button></div>`;
}

function modalShell(title, subtitle, content, wide = false) {
  return `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-card ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true"><header><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-button large" data-action="close-modal">${icon("x")}</button></header><div class="modal-content">${content}</div></section>`;
}

function openAction(taskId, action) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (action === ACTIONS.CLAIM) {
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

async function handleSubmit(event) {
  if (event.target.id === "export-form") {
    event.preventDefault();
    if (currentUser(state).role !== "admin") return toast("只有管理员可以导出数据", "error");
    const data = new FormData(event.target);
    exportDates = { start: String(data.get("start") || ""), end: String(data.get("end") || "") };
    try {
      const { csv, count } = exportCsv(state.tasks, exportDates.start, exportDates.end);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `达人视频协作需求_${exportDates.start}_${exportDates.end}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`已导出 ${count} 条需求的节点记录`);
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.id === "assist-create-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      const task = createAssistanceTask({
        requestType: modal.requestType, title: data.get("title"), account: data.get("account"),
        serviceDate: data.get("serviceDate"), timeSlots: data.getAll("timeSlots")
      }, currentUser(state));
      modal = null;
      persist({ ...state, tasks: [task, ...state.tasks] });
      toast(`已创建 1 条协助需求，包含 ${task.timeSlots.length} 个时段，等待剪辑认领`);
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.id === "review-form") {
    event.preventDefault();
    const action = event.submitter?.value;
    if (![ACTIONS.APPROVE, ACTIONS.REJECT].includes(action)) return toast("请选择审核结果", "error");
    const data = new FormData(event.target);
    performAction(modal.taskId, action, { note: data.get("note") });
    return;
  }
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
  if (event.target.id === "catalog-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const parseOptions = (value) => [...new Set(String(value || "").split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean))];
    const accounts = parseOptions(data.get("accounts"));
    const materialDeliveryMethods = parseOptions(data.get("materialMethods"));
    const cutDeliveryMethods = parseOptions(data.get("cutMethods"));
    if (!accounts.length || !materialDeliveryMethods.length || !cutDeliveryMethods.length) return toast("账号、素材给予方式和交片渠道都至少保留一项", "error");
    modal = null;
    persist({ ...state, settings: { ...state.settings, accounts, materialDeliveryMethods, cutDeliveryMethods } });
    toast("基础选项已更新");
    return;
  }
  if (event.target.id === "access-form") {
    event.preventDefault();
    if (currentUser(state).role !== "admin") return toast("只有管理员可以修改平台权限", "error");
    const data = new FormData(event.target);
    const existingUsers = configuredUsers();
    const users = existingUsers.map((user, index) => {
      const name = String(data.get(`memberName_${index}`) || "").trim();
      const role = String(data.get(`memberRole_${index}`) || "director");
      const permissions = data.getAll(`memberPermission_${index}`).map(String).filter((view) => view !== "admin" || role === "admin");
      return { ...user, name, role, avatar: name.slice(0, 1) || user.avatar, enabled: data.get(`memberEnabled_${index}`) === "on", permissions: permissions.length ? permissions : ["todo"] };
    });
    if (users.some((user) => !user.name)) return toast("已配置身份的姓名不能为空", "error");
    const newMemberName = String(data.get("newMemberName") || "").trim();
    if (newMemberName) {
      const role = String(data.get("newMemberRole") || "director");
      const permissions = data.getAll("newMemberPermission").map(String).filter((view) => view !== "admin" || role === "admin");
      users.push({ id: `manual_${Date.now().toString(36)}`, name: newMemberName, role, avatar: newMemberName.slice(0, 1), enabled: true, permissions: permissions.length ? permissions : ["todo"] });
    }
    const enabledUsers = users.filter((user) => user.enabled !== false);
    if (!enabledUsers.length) return toast("至少保留一个启用身份", "error");
    if (!enabledUsers.some((user) => user.role === "admin" && user.permissions.includes("admin"))) return toast("至少保留一位拥有管理后台权限的管理员", "error");
    const nameById = Object.fromEntries(users.map((user) => [user.id, user.name]));
    const tasks = state.tasks.map((task) => {
      const next = { ...task };
      [["directorId", "directorName"], ["editorId", "editorName"], ["reviewerId", "reviewerName"], ["shooterId", "shooterName"]].forEach(([idField, nameField]) => {
        if (nameById[next[idField]]) next[nameField] = nameById[next[idField]];
      });
      return next;
    });
    let currentUserId = state.currentUserId;
    if (!enabledUsers.some((user) => user.id === currentUserId)) currentUserId = enabledUsers.find((user) => user.role === "admin")?.id || enabledUsers[0].id;
    const nextCurrentUser = users.find((user) => user.id === currentUserId) || enabledUsers[0];
    const activeView = canAccessView(nextCurrentUser, state.activeView) ? state.activeView : firstAccessibleView(nextCurrentUser);
    modal = null;
    persist({ ...state, users, tasks, currentUserId, activeView, settings: { ...state.settings, identityMode: data.get("identityMode") === "feishu" ? "feishu" : "manual" } });
    toast("平台权限与身份已更新");
    return;
  }
  if (event.target.id === "create-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      const reviewer = activeUsers().find((user) => user.role === "reviewer");
      const task = createTask({
        title: data.get("title"), account: data.get("account"), level: data.get("level"),
        publishAt: data.get("publishAt"), needsShoot: data.get("materialStatus") === "needs_shoot",
        reviewerId: reviewer?.id || null, reviewerName: reviewer?.name || ""
      }, currentUser(state), state.templates);
      modal = null;
      persist({ ...state, tasks: [task, ...state.tasks] });
      toast("任务已创建并进入剪辑认领池");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.id === "action-form") {
    event.preventDefault();
    const data = new FormData(event.target);
    const action = data.get("action");
    const payload = {
      url: data.get("url"), note: data.get("note"), publishAt: data.get("publishAt"),
      materialMethod: data.get("materialMethod"), cutDeliveryMethod: data.get("cutDeliveryMethod"),
      deliveryNote: data.get("deliveryNote")
    };
    const attachment = data.get("attachment");
    if (attachment?.name) {
      try { payload.attachment = await readAttachment(attachment); }
      catch (error) { toast(error.message, "error"); return; }
    }
    if (action === ACTIONS.TRANSFER) payload.user = activeUsers().find((user) => user.id === data.get("userId"));
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
  const createType = event.target.closest("[data-create-type]")?.dataset.createType;
  if (createType) {
    modal = { type: "create", requestType: createType };
    render();
    return;
  }
  const previewButton = event.target.closest("[data-preview-task]");
  if (previewButton) {
    modal = { type: "preview", taskId: previewButton.dataset.previewTask, kind: previewButton.dataset.previewKind, index: Number(previewButton.dataset.previewIndex) };
    render();
    return;
  }
  const activityTaskId = event.target.closest("[data-activity-task]")?.dataset.activityTask;
  if (activityTaskId) {
    modal = null;
    selectedTaskId = activityTaskId;
    render();
    return;
  }
  const dateInput = event.target.closest('input[type="date"]');
  if (dateInput) {
    dateInput.focus();
    try { dateInput.showPicker?.(); } catch { /* 浏览器不支持时保留原生日期输入行为 */ }
  }
  const datePreset = event.target.closest("[data-date-preset]")?.dataset.datePreset;
  if (datePreset) {
    updateDateFilters({ date: datePreset, start: "", end: "" });
    datePickerOpen = false;
    render();
    return;
  }
  const calendarDate = event.target.closest("[data-calendar-date]")?.dataset.calendarDate;
  if (calendarDate) {
    const { date, start, end } = activeDateFilters();
    if (date !== "custom" || !start || end) {
      updateDateFilters({ date: "custom", start: calendarDate, end: "" });
    } else {
      const [first, last] = [start, calendarDate].sort();
      updateDateFilters({ start: first, end: last });
      datePickerOpen = false;
    }
    render();
    return;
  }
  const calendarShift = event.target.closest("[data-calendar-shift]")?.dataset.calendarShift;
  if (calendarShift) {
    shiftCalendarMonth(Number(calendarShift));
    render();
    return;
  }
  const view = event.target.closest("[data-view]")?.dataset.view;
  if (view) {
    if (!canAccessView(currentUser(state), view)) {
      toast("当前身份没有该页面的访问权限", "error");
      return;
    }
    state.activeView = view;
    datePickerOpen = false;
    selectedTaskId = null;
    modal = null;
    persist(state);
    return;
  }
  const actionEl = event.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === "open-create") modal = { type: "create", requestType: "video" };
    if (action === "open-activity") modal = { type: "activity" };
    if (action === "schedule-prev") scheduleMonday = shiftDate(scheduleMonday, -28);
    if (action === "schedule-next") scheduleMonday = shiftDate(scheduleMonday, 28);
    if (action === "schedule-today") scheduleMonday = mondayOf(chinaDateKey(new Date()));
    if (action === "toggle-date-filter") {
      datePickerOpen = !datePickerOpen;
      if (datePickerOpen) {
        calendarMonth = (activeDateFilters().start || shanghaiDateKey(new Date())).slice(0, 7);
        ensureCalendarMonth();
      }
    }
    if (action === "close-date-filter") datePickerOpen = false;
    if (action === "clear-date-filter") {
      updateDateFilters({ date: "all", start: "", end: "" });
      calendarMonth = shanghaiDateKey(new Date()).slice(0, 7);
    }
    if (action === "switch-user") modal = { type: "user" };
    if (action === "close-modal") modal = null;
    if (action === "close-drawer") selectedTaskId = null;
    if (action === "reset-demo") { state = resetState(); modal = null; selectedTaskId = null; toast("演示数据已恢复"); }
    if (action === "scan-reminders") { scanReminders(); return; }
    if (action === "toggle-template") toggleTemplate(actionEl.dataset.level);
    if (action === "open-add-template") modal = { type: "template", level: null };
    if (action === "open-catalogs") modal = { type: "catalogs" };
    if (action === "open-access-settings") modal = { type: "access" };
    if (action === "edit-template") modal = { type: "template", level: actionEl.dataset.level };
    if (action === "toggle-template-enabled") toggleTemplateEnabled(actionEl.dataset.level);
    render(); return;
  }
  const userId = event.target.closest("[data-user-id]")?.dataset.userId;
  if (userId) {
    const user = activeUsers().find((item) => item.id === userId);
    if (!user) {
      toast("该身份已停用或不存在", "error");
      return;
    }
    modal = null;
    const activeView = canAccessView(user, state.activeView) ? state.activeView : firstAccessibleView(user);
    persist({ ...state, currentUserId: userId, activeView });
    return;
  }
  const taskAction = event.target.closest("[data-task-action]");
  if (taskAction) { event.stopPropagation(); openAction(taskAction.dataset.taskId, taskAction.dataset.taskAction); return; }
  const reviewAction = event.target.closest("[data-review-action]");
  if (reviewAction) {
    const choice = reviewAction.dataset.reviewAction;
    modal = { type: "action", taskId: reviewAction.dataset.taskId, action: choice };
    render();
    return;
  }
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
  if (event.target.id === "schedule-jump" && event.target.value) {
    scheduleMonday = mondayOf(event.target.value);
    render();
    return;
  }
  if (event.target.id === "calendar-year-select") {
    ensureCalendarMonth();
    calendarMonth = `${event.target.value}-${calendarMonth.slice(5, 7)}`;
    render();
  }
  if (event.target.id === "calendar-month-select") {
    ensureCalendarMonth();
    calendarMonth = `${calendarMonth.slice(0, 4)}-${String(event.target.value).padStart(2, "0")}`;
    render();
  }
  if (event.target.id === "todo-status-filter") { todoFilters.status = event.target.value; render(); }
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
  const content = state.activeView === "board" ? renderBoard() : state.activeView === "schedule" ? renderSchedule() : state.activeView === "admin" ? renderAdmin() : renderTodo();
  app.innerHTML = content;
}

app.addEventListener("click", handleClick);
app.addEventListener("submit", handleSubmit);
app.addEventListener("change", handleChange);
app.addEventListener("input", handleInput);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { modal = null; selectedTaskId = null; datePickerOpen = false; render(); }
});
document.addEventListener("click", (event) => {
  if (datePickerOpen && !event.target.closest(".date-filter-control")) {
    datePickerOpen = false;
    render();
  }
});

createIdentityAdapter(state);
render();

globalThis.addEventListener("storage", (event) => {
  if (event.key === "video-collab-board:v1") {
    state = loadState();
    render();
  }
});
