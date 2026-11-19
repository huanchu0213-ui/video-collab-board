import { STAGES, STAGE_META } from "./domain.js";

const STORAGE_KEY = "video-collab-board:v1";
const DEFAULT_ACCOUNTS = ["万万", "丝丝", "周周", "西西", "女团集合号"];
const DEFAULT_MATERIAL_METHODS = ["飞书", "现场传输", "剪映云空间"];

export const USERS = [
  { id: "u_director_zhou", name: "周周编导", role: "director", avatar: "周" },
  { id: "u_director_gu", name: "顾晨曦", role: "director", avatar: "顾" },
  { id: "u_editor_lin", name: "林澄", role: "editor", avatar: "林" },
  { id: "u_editor_chen", name: "陈川", role: "editor", avatar: "陈" },
  { id: "u_reviewer_xu", name: "徐青", role: "reviewer", avatar: "徐" },
  { id: "u_admin", name: "储焕", role: "admin", avatar: "储" }
];

const templateIntervals = {
  S: [48, 72, 24, 24, 24],
  A: [36, 48, 16, 16, 12],
  B: [24, 24, 0, 12, 8],
  C: [12, 12, 0, 6, 4]
};

function makeTemplates() {
  const order = [
    STAGES.WAITING_MATERIAL, STAGES.EDITING, STAGES.INITIAL_REVIEW,
    STAGES.DIRECTOR_REVIEW, STAGES.READY_PUBLISH
  ];
  return Object.entries(templateIntervals).map(([level, values]) => ({
    level,
    name: `${level}级视频`,
    color: ({ S: "#9a5a18", A: "#2f7555", B: "#3d5fbd", C: "#66716b" })[level],
    enabled: true,
    includeInitialReview: ["S", "A"].includes(level),
    confirmed: false,
    includeShoot: true,
    intervals: Object.fromEntries(order.map((stage, index) => [stage, values[index]])),
    updatedAt: null,
    confirmedBy: null
  }));
}

function isoFromNow(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function baseTask(partial, index) {
  const stage = partial.currentStage;
  const publishAt = partial.publishAt || isoFromNow(72 + index * 16);
  const deadlines = {};
  const stages = Object.values(STAGES);
  for (let i = 0; i < stages.length; i += 1) deadlines[stages[i]] = isoFromNow((i - 2) * 10 + index * 4);
  deadlines[stage] = partial.deadline || isoFromNow(index % 3 === 0 ? -6 : index % 3 === 1 ? 4 : 26);
  deadlines[STAGES.PUBLISHED] = publishAt;
  return {
    id: `demo_${index + 1}`,
    code: `VD-2611-${String(31 + index).padStart(3, "0")}`,
    title: partial.title,
    account: partial.account,
    level: partial.level,
    levelName: `${partial.level}级视频`,
    requiresInitialReview: ["S", "A"].includes(partial.level),
    needsShoot: partial.needsShoot !== false,
    publishAt,
    currentStage: stage,
    previousStage: null,
    directorId: partial.directorId || "u_director_zhou",
    directorName: partial.directorName || "周周编导",
    editorId: partial.editorId || null,
    editorName: partial.editorName || null,
    reviewerId: "u_reviewer_xu",
    reviewerName: "徐青",
    shooterId: partial.directorId || "u_director_zhou",
    shooterName: partial.directorName || "周周编导",
    scriptUrl: "https://example.com/script",
    materialUrl: partial.materialUrl || "",
    materialMethod: partial.materialMethod || (stage === STAGES.EDITING || partial.materialUrl ? "飞书" : ""),
    materialNote: partial.materialNote || "",
    materialAttachments: partial.materialAttachments || [],
    versions: partial.versions || [],
    scheduleIntervals: Object.fromEntries([
      STAGES.WAITING_MATERIAL, STAGES.EDITING, STAGES.INITIAL_REVIEW,
      STAGES.DIRECTOR_REVIEW, STAGES.READY_PUBLISH
    ].map((stage, intervalIndex) => [stage, templateIntervals[partial.level][intervalIndex]])),
    deadlines,
    stageStartedAt: isoFromNow(-18 - index),
    createdAt: isoFromNow(-48 - index * 3),
    updatedAt: isoFromNow(-18 - index),
    completedAt: stage === STAGES.PUBLISHED ? isoFromNow(-10) : null,
    archived: stage === STAGES.PUBLISHED,
    readOnly: stage === STAGES.PUBLISHED,
    reminderEnabled: stage !== STAGES.PUBLISHED,
    pauseReason: "",
    events: [
      {
        id: `evt_demo_${index}`,
        taskId: `demo_${index + 1}`,
        action: "create",
        label: "创建并发布任务",
        actorId: partial.directorId || "u_director_zhou",
        actorName: partial.directorName || "周周编导",
        role: "director",
        at: isoFromNow(-48 - index * 3),
        fromStage: null,
        toStage: stage,
        note: "",
        metadata: {}
      }
    ]
  };
}

function seedTasks() {
  return [
    baseTask({ title: "iPhone 18 Pro 深度体验", account: "万万", level: "S", currentStage: STAGES.INITIAL_REVIEW, editorId: "u_editor_lin", editorName: "林澄", versions: [{ id: "v1", number: 1, url: "https://example.com/cut/1", note: "首版", submittedBy: "林澄", submittedAt: isoFromNow(-8) }] }, 0),
    baseTask({ title: "上门回收反转挑战", account: "丝丝", level: "A", currentStage: STAGES.EDITING, editorId: "u_editor_lin", editorName: "林澄", materialUrl: "https://example.com/material/2" }, 1),
    baseTask({ title: "二手手机避坑三件事", account: "女团集合号", level: "B", currentStage: STAGES.DIRECTOR_REVIEW, editorId: "u_editor_chen", editorName: "陈川", directorId: "u_director_gu", directorName: "顾晨曦", needsShoot: false, versions: [{ id: "v1", number: 1, url: "https://example.com/cut/3", note: "首版", submittedBy: "陈川", submittedAt: isoFromNow(-3) }] }, 2),
    baseTask({ title: "手机壳盲测快问快答", account: "周周", level: "C", currentStage: STAGES.WAITING_CLAIM }, 3),
    baseTask({ title: "门店黄金回收 Vlog", account: "西西", level: "A", currentStage: STAGES.WAITING_SHOOT, editorId: "u_editor_chen", editorName: "陈川" }, 4),
    baseTask({ title: "折叠屏通勤一天", account: "万万", level: "B", currentStage: STAGES.WAITING_MATERIAL, editorId: "u_editor_lin", editorName: "林澄" }, 5),
    baseTask({ title: "旧机数据迁移教程", account: "丝丝", level: "C", currentStage: STAGES.MODIFYING, editorId: "u_editor_chen", editorName: "陈川", needsShoot: false, materialUrl: "https://example.com/material/7", versions: [{ id: "v1", number: 1, url: "https://example.com/cut/7", note: "需调整字幕", submittedBy: "陈川", submittedAt: isoFromNow(-7) }] }, 6),
    baseTask({ title: "双十一门店战报", account: "女团集合号", level: "A", currentStage: STAGES.READY_PUBLISH, editorId: "u_editor_lin", editorName: "林澄", directorId: "u_director_gu", directorName: "顾晨曦", versions: [{ id: "v1", number: 1, url: "https://example.com/cut/8", note: "终版", submittedBy: "林澄", submittedAt: isoFromNow(-20) }] }, 7),
    baseTask({ title: "回收知识一分钟", account: "周周", level: "C", currentStage: STAGES.PUBLISHED, editorId: "u_editor_lin", editorName: "林澄", needsShoot: false }, 8)
  ];
}

export function defaultState() {
  return {
    schemaVersion: 3,
    revision: 1,
    currentUserId: "u_director_zhou",
    activeView: "todo",
    tasks: seedTasks(),
    templates: makeTemplates(),
    reminders: [],
    settings: {
      enabled: false,
      groupId: "oc_video_collab_demo",
      groupName: "剪辑中台协作群",
      editorLeadId: "u_admin",
      identityMode: "demo",
      accounts: [...DEFAULT_ACCOUNTS],
      materialDeliveryMethods: [...DEFAULT_MATERIAL_METHODS]
    }
  };
}

function normalizeState(parsed) {
  const defaults = defaultState();
  return {
    ...parsed,
    settings: {
      ...defaults.settings,
      ...(parsed.settings || {}),
      accounts: Array.isArray(parsed.settings?.accounts) && parsed.settings.accounts.length
        ? parsed.settings.accounts
        : defaults.settings.accounts,
      materialDeliveryMethods: Array.isArray(parsed.settings?.materialDeliveryMethods) && parsed.settings.materialDeliveryMethods.length
        ? parsed.settings.materialDeliveryMethods
        : defaults.settings.materialDeliveryMethods
    },
    tasks: (parsed.tasks || []).map((task) => ({
      ...task,
      materialMethod: task.materialMethod || (task.materialUrl ? "飞书" : ""),
      materialNote: task.materialNote || "",
      materialAttachments: Array.isArray(task.materialAttachments) ? task.materialAttachments : []
    }))
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 3) return defaultState();
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  const next = { ...state, revision: (state.revision || 0) + 1 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function resetState() {
  const next = defaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function currentUser(state) {
  return USERS.find((user) => user.id === state.currentUserId) || USERS[0];
}

export function stageLabel(stage) {
  return STAGE_META[stage]?.label || stage;
}
