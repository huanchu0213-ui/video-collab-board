import { ACTIONS, STAGES, STAGE_META, getResponsible, requestTypeLabel } from "./domain.js";
import { chinaDateKey } from "./schedule.js";

export const EXPORT_COLUMNS = [
  "需求类型", "需求编号", "选题 / 事项", "账号 / 达人", "视频等级", "服务日期 / 计划发布日期", "协助时段",
  "创建编导", "承接剪辑 / 协助人", "当前状态", "节点", "节点负责人", "计划截止时间", "实际完成时间",
  "实际操作人", "操作", "备注", "超期小时", "操作时间", "节点岗位", "操作人角色"
];

const ROLE_LABELS = { director: "编导", editor: "剪辑", reviewer: "中台审核", admin: "管理员" };
const NODE_ROLES = { editor_pool: "剪辑认领池", shooter: "拍摄负责人", director: "编导", editor: "剪辑 / 协助", reviewer: "中台审核" };

function safeCell(value) {
  const text = String(value ?? "");
  const protectedText = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

function hoursLate(planned, actual) {
  if (!planned || !actual) return "";
  const difference = (new Date(actual).getTime() - new Date(planned).getTime()) / 3600000;
  return Number.isFinite(difference) ? Math.max(0, difference).toFixed(2) : "";
}

export function exportRows(tasks, startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw new Error("请选择有效的起止日期，结束日期不能早于开始日期");
  }
  const selected = tasks.filter((task) => {
    const date = task.requestType && task.requestType !== "video" ? task.serviceDate : chinaDateKey(task.publishAt);
    return date && date >= startDate && date <= endDate;
  });
  const rows = [];
  for (const task of selected) {
    const rowCountBeforeTask = rows.length;
    const assistance = task.requestType && task.requestType !== "video";
    const common = [
      requestTypeLabel(task.requestType), task.code, task.title, task.account, assistance ? "" : task.level,
      assistance ? task.serviceDate : chinaDateKey(task.publishAt), assistance ? task.timeSlot : "",
      task.directorName, task.editorName || "", STAGE_META[task.currentStage]?.label || task.currentStage
    ];
    for (const event of task.events || []) {
      const created = [ACTIONS.CREATE, ACTIONS.CREATE_ASSIST].includes(event.action);
      const completed = created || [ACTIONS.CLAIM, ACTIONS.SHOOT_COMPLETE, ACTIONS.MATERIAL_READY,
        ACTIONS.SUBMIT_CUT, ACTIONS.APPROVE, ACTIONS.REJECT, ACTIONS.PUBLISH, ACTIONS.COMPLETE_ASSIST].includes(event.action);
      const node = created ? "编导提需" : STAGE_META[event.fromStage]?.label || event.fromStage || "";
      const planned = created ? "" : event.metadata?.plannedDeadline || "";
      const actual = completed ? event.at || "" : "";
      const responsible = created ? event.actorName : event.metadata?.responsibleName || "";
      const nodeRole = created ? "编导" : NODE_ROLES[STAGE_META[event.fromStage]?.owner] || "";
      rows.push([...common, node, responsible, planned, actual, event.actorName || "", event.label || event.action,
        event.note || "", hoursLate(planned, actual), event.at || "", nodeRole, ROLE_LABELS[event.role] || event.role || ""]);
    }
    if (![STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED].includes(task.currentStage) && !task.readOnly) {
      const owner = getResponsible(task);
      rows.push([...common, STAGE_META[task.currentStage]?.label || task.currentStage, owner.name || "",
        task.deadlines?.[task.currentStage] || "", "", "", "待完成", "", "", "", NODE_ROLES[STAGE_META[task.currentStage]?.owner] || "", ""]);
    }
    if (rows.length === rowCountBeforeTask) rows.push([...common, "", "", "", "", "", "", "", "", "", "", "", ""]);
  }
  return rows;
}

export function exportCsv(tasks, startDate, endDate) {
  const rows = exportRows(tasks, startDate, endDate);
  return { count: new Set(rows.map((row) => row[1])).size,
    csv: `\uFEFF${[EXPORT_COLUMNS, ...rows].map((row) => row.map(safeCell).join(",")).join("\r\n")}` };
}
