import { ACTIONS, STAGES } from "./domain.js";

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
    const inWeek = (value) => {
      const key = chinaDateKey(value);
      return key && key >= start && key <= end;
    };
    const unique = (items) => [...new Map(items.map((task) => [task.id, task])).values()];
    const byEvent = (action) => unique(tasks.filter((task) => (task.events || []).some((event) => event.action === action && inWeek(event.at))));
    return {
      start,
      end,
      shooting: tasks.filter((task) => task.needsShoot && inWeek(task.deadlines?.[STAGES.WAITING_SHOOT])),
      delivered: unique([...byEvent(ACTIONS.SUBMIT_CUT), ...tasks.filter((task) => (task.versions || []).some((version) => inWeek(version.submittedAt)))]),
      unclaimed: tasks.filter((task) => task.currentStage === STAGES.WAITING_CLAIM && inWeek(task.deadlines?.[STAGES.WAITING_CLAIM])),
      plannedPublish: tasks.filter((task) => inWeek(task.publishAt)),
      published: tasks.filter((task) => task.currentStage === STAGES.PUBLISHED && inWeek(task.completedAt || task.publishAt))
    };
  });
}
