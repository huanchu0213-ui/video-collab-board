import { ACTIONS, STAGES, STAGE_META, assistanceSlots, requestTypeLabel } from "./domain.js";
import { chinaDateKey } from "./schedule.js";

const TIMEZONE = "Asia/Shanghai";
const BASE_COLUMNS = [
  "需求类型", "需求编号", "选题 / 事项", "账号 / 达人", "视频等级", "计划发布日期 / 协助日期",
  "协助时段", "当前状态", "需求下发人", "承接剪辑 / 协助人",
  "编导提需时间（北京时间）", "编导提需人",
  "剪辑认领时间（北京时间）", "认领剪辑",
  "拍摄及素材交接时间（北京时间）", "拍摄及素材交接人",
  "已有素材确认时间（北京时间）", "素材确认人"
];
const END_COLUMNS = [
  "视频发布时间（北京时间）", "发布确认人",
  "协助完成时间（北京时间）", "协助完成确认人"
];

export function formatBeijingTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function safeCell(value) {
  const cell = String(value ?? "");
  const protectedCell = /^[\s\u0000-\u001f]*[=+\-@]/.test(cell) ? `'${cell}` : cell;
  return `"${protectedCell.replaceAll('"', '""')}"`;
}

function selectedTasks(tasks, startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw new Error("请选择有效的起止日期，结束日期不能早于开始日期");
  }
  return tasks.filter((task) => {
    const date = task.requestType && task.requestType !== "video" ? task.serviceDate : chinaDateKey(task.publishAt);
    return date && date >= startDate && date <= endDate;
  });
}

function eventList(task, predicate) {
  return (task.events || []).filter(predicate).sort((left, right) => new Date(left.at) - new Date(right.at));
}

function alignReviews(cuts, reviews) {
  const aligned = [];
  for (const review of reviews) {
    let index = cuts.findLastIndex((cut) => new Date(cut.at) <= new Date(review.at));
    if (index < 0) index = 0;
    while (aligned[index]) index++;
    aligned[index] = review;
  }
  return aligned;
}

function milestones(task) {
  const first = (predicate) => eventList(task, predicate)[0];
  const created = first((event) => [ACTIONS.CREATE, ACTIONS.CREATE_ASSIST].includes(event.action));
  const cuts = eventList(task, (event) => event.action === ACTIONS.SUBMIT_CUT);
  const cutTimes = new Set(cuts.map((event) => event.at));
  for (const version of task.versions || []) {
    if (version.submittedAt && !cutTimes.has(version.submittedAt)) {
      cuts.push({ at: version.submittedAt, actorName: version.submittedBy || "" });
      cutTimes.add(version.submittedAt);
    }
  }
  cuts.sort((left, right) => new Date(left.at) - new Date(right.at));
  const review = (stage) => eventList(task, (event) =>
    [ACTIONS.APPROVE, ACTIONS.REJECT].includes(event.action) && event.fromStage === stage);
  return {
    created: created || (task.createdAt ? { at: task.createdAt, actorName: task.issuerName || task.directorName || "" } : null),
    claim: first((event) => event.action === ACTIONS.CLAIM)
      || (task.claimedAt ? { at: task.claimedAt, actorName: task.editorName || "" } : null),
    shoot: first((event) => event.action === ACTIONS.SHOOT_COMPLETE),
    material: first((event) => event.action === ACTIONS.MATERIAL_READY),
    cuts,
    initialReviews: alignReviews(cuts, review(STAGES.INITIAL_REVIEW)),
    directorReviews: alignReviews(cuts, review(STAGES.DIRECTOR_REVIEW)),
    publish: first((event) => event.action === ACTIONS.PUBLISH)
      || (task.currentStage === STAGES.PUBLISHED && task.completedAt ? { at: task.completedAt, actorName: "" } : null),
    assistDone: first((event) => event.action === ACTIONS.COMPLETE_ASSIST)
      || (task.currentStage === STAGES.ASSIST_DONE && task.completedAt ? { at: task.completedAt, actorName: "" } : null)
  };
}

function pair(event) {
  return [formatBeijingTime(event?.at), event?.actorName || ""];
}

function reviewCells(event) {
  return [...pair(event), event?.action === ACTIONS.APPROVE ? "通过" : event?.action === ACTIONS.REJECT ? "退回修改" : ""];
}

function roundColumns(round) {
  const cut = round === 0 ? "剪辑首次交付" : `剪辑修改第${round}次交付`;
  const initial = round === 0 ? "中台初审" : `中台初审第${round + 1}次`;
  const director = round === 0 ? "编导审核" : `编导审核第${round + 1}次`;
  return [
    `${cut}时间（北京时间）`, `${cut}人`,
    `${initial}时间（北京时间）`, `${initial}人`, `${initial}结果`,
    `${director}时间（北京时间）`, `${director}人`, `${director}结果`
  ];
}

export function exportTable(tasks, startDate, endDate) {
  const selected = selectedTasks(tasks, startDate, endDate);
  const records = selected.map((task) => ({ task, nodes: milestones(task) }));
  const rounds = records.reduce((maximum, { task, nodes }) => task.requestType && task.requestType !== "video"
    ? maximum : Math.max(maximum, 1, nodes.cuts.length, nodes.initialReviews.length, nodes.directorReviews.length), 0);
  const columns = [...BASE_COLUMNS, ...Array.from({ length: rounds }, (_, index) => roundColumns(index)).flat(), ...END_COLUMNS];
  const rows = records.map(({ task, nodes }) => [
    requestTypeLabel(task.requestType), task.code || "", task.title || "", task.account || "",
    task.requestType && task.requestType !== "video" ? "" : task.level || "",
    task.requestType && task.requestType !== "video" ? task.serviceDate || "" : chinaDateKey(task.publishAt),
    task.requestType && task.requestType !== "video" ? assistanceSlots(task).join("、") : "",
    STAGE_META[task.currentStage]?.label || task.currentStage || "",
    nodes.created?.actorName || task.issuerName || task.directorName || "", task.editorName || "",
    ...pair(nodes.created), ...pair(nodes.claim), ...pair(nodes.shoot), ...pair(nodes.material),
    ...Array.from({ length: rounds }, (_, index) => [
      ...pair(nodes.cuts[index]), ...reviewCells(nodes.initialReviews[index]), ...reviewCells(nodes.directorReviews[index])
    ]).flat(),
    ...pair(nodes.publish), ...pair(nodes.assistDone)
  ]);
  return { columns, rows, count: selected.length };
}

export function exportCsv(tasks, startDate, endDate) {
  const table = exportTable(tasks, startDate, endDate);
  return {
    count: table.count,
    csv: `\uFEFF${[table.columns, ...table.rows].map((row) => row.map(safeCell).join(",")).join("\r\n")}`
  };
}
