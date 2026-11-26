import { STAGES } from "./domain.js";

export const WEEK_GROUPS = [
  { key: "unclaimed", label: "待剪辑认领" },
  { key: "materials", label: "待拍摄 / 素材" },
  { key: "editing", label: "剪辑 / 修改中" },
  { key: "reviewing", label: "审核 / 待发布" },
  { key: "assisting", label: "协助进行中" },
  { key: "assist_done", label: "协助已完成" },
  { key: "published", label: "已发布" },
  { key: "stopped", label: "已暂停 / 取消" }
];

export function chinaDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function mondayOf(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  const daysBack = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysBack);
  return chinaDateKey(date);
}

export function shiftDate(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return chinaDateKey(date);
}

export function weekSlices(tasks, firstMonday, count = 4) {
  return Array.from({ length: count }, (_, index) => {
    const start = shiftDate(firstMonday, index * 7);
    const end = shiftDate(start, 6);
    const assigned = tasks.filter((task) => {
      const key = task.serviceDate || chinaDateKey(task.publishAt || task.completedAt || task.createdAt);
      return key && key >= start && key <= end;
    }).sort((left, right) => new Date(left.publishAt || left.completedAt || left.createdAt) - new Date(right.publishAt || right.completedAt || right.createdAt));
    const groups = Object.fromEntries(WEEK_GROUPS.map(({ key }) => [key, []]));
    for (const task of assigned) {
      let key;
      if (task.currentStage === STAGES.PUBLISHED) key = "published";
      else if (task.currentStage === STAGES.ASSIST_DONE) key = "assist_done";
      else if ([STAGES.PAUSED, STAGES.CANCELLED].includes(task.currentStage)) key = "stopped";
      else if (task.currentStage === STAGES.WAITING_CLAIM) key = "unclaimed";
      else if (task.currentStage === STAGES.ASSISTING) key = "assisting";
      else if ([STAGES.WAITING_SHOOT, STAGES.WAITING_MATERIAL].includes(task.currentStage)) key = "materials";
      else if ([STAGES.EDITING, STAGES.MODIFYING].includes(task.currentStage)) key = "editing";
      else key = "reviewing";
      groups[key].push(task);
    }
    return {
      start,
      end,
      tasks: assigned,
      groups
    };
  });
}
