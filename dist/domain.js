export const DEFAULT_LEVELS = ["S", "A", "B", "C"];

export const STAGES = {
  WAITING_CLAIM: "waiting_claim",
  WAITING_SHOOT: "waiting_shoot",
  WAITING_MATERIAL: "waiting_material",
  EDITING: "editing",
  INITIAL_REVIEW: "initial_review",
  DIRECTOR_REVIEW: "director_review",
  MODIFYING: "modifying",
  READY_PUBLISH: "ready_publish",
  PUBLISHED: "published",
  ASSISTING: "assisting",
  ASSIST_DONE: "assist_done",
  PAUSED: "paused",
  CANCELLED: "cancelled"
};

export const STAGE_META = {
  [STAGES.WAITING_CLAIM]: { label: "待认领", action: "认领任务", owner: "editor_pool" },
  [STAGES.WAITING_SHOOT]: { label: "待拍摄", action: "完成拍摄", owner: "shooter" },
  [STAGES.WAITING_MATERIAL]: { label: "待素材", action: "素材就绪", owner: "director" },
  [STAGES.EDITING]: { label: "剪辑中", action: "提交成片", owner: "editor" },
  [STAGES.INITIAL_REVIEW]: { label: "中台初审", action: "初审处理", owner: "reviewer" },
  [STAGES.DIRECTOR_REVIEW]: { label: "编导审核", action: "审核成片", owner: "director" },
  [STAGES.MODIFYING]: { label: "修改中", action: "提交修改", owner: "editor" },
  [STAGES.READY_PUBLISH]: { label: "待发布", action: "确认发布", owner: "director" },
  [STAGES.PUBLISHED]: { label: "已发布", action: "已完成", owner: "director" },
  [STAGES.ASSISTING]: { label: "协助进行中", action: "确认协助完成", owner: "issuer" },
  [STAGES.ASSIST_DONE]: { label: "协助已完成", action: "已完成", owner: "editor" },
  [STAGES.PAUSED]: { label: "已暂停", action: "恢复任务", owner: "director" },
  [STAGES.CANCELLED]: { label: "已取消", action: "已取消", owner: "director" }
};

export const ACTIONS = {
  CREATE: "create",
  CREATE_ASSIST: "create_assist",
  CLAIM: "claim",
  SHOOT_COMPLETE: "shoot_complete",
  MATERIAL_READY: "material_ready",
  SUBMIT_CUT: "submit_cut",
  APPROVE: "approve",
  REJECT: "reject",
  PUBLISH: "publish",
  COMPLETE_ASSIST: "complete_assist",
  PAUSE: "pause",
  RESUME: "resume",
  CANCEL: "cancel",
  RESCHEDULE: "reschedule",
  TRANSFER: "transfer"
};

const ACTION_LABELS = {
  [ACTIONS.CREATE]: "创建并发布任务",
  [ACTIONS.CREATE_ASSIST]: "创建协助需求",
  [ACTIONS.CLAIM]: "认领任务",
  [ACTIONS.SHOOT_COMPLETE]: "完成拍摄并确认素材",
  [ACTIONS.MATERIAL_READY]: "确认素材就绪",
  [ACTIONS.SUBMIT_CUT]: "提交成片版本",
  [ACTIONS.APPROVE]: "审核通过",
  [ACTIONS.REJECT]: "退回修改",
  [ACTIONS.PUBLISH]: "确认视频发布",
  [ACTIONS.COMPLETE_ASSIST]: "确认协助完成",
  [ACTIONS.PAUSE]: "暂停任务",
  [ACTIONS.RESUME]: "恢复任务",
  [ACTIONS.CANCEL]: "取消任务",
  [ACTIONS.RESCHEDULE]: "调整发布时间",
  [ACTIONS.TRANSFER]: "转交负责人"
};

export const TEMPLATE_STAGE_ORDER = [
  STAGES.WAITING_MATERIAL,
  STAGES.EDITING,
  STAGES.INITIAL_REVIEW,
  STAGES.DIRECTOR_REVIEW,
  STAGES.READY_PUBLISH
];

export const TEMPLATE_INTERVAL_LABELS = {
  [STAGES.WAITING_MATERIAL]: "认领后 → 素材确认",
  [STAGES.EDITING]: "素材确认 → 剪辑交付",
  [STAGES.INITIAL_REVIEW]: "剪辑交付 → 中台初审",
  [STAGES.DIRECTOR_REVIEW]: "上级确认 → 编导审核",
  [STAGES.READY_PUBLISH]: "编导审核 → 视频发布"
};

export const ASSISTANCE_SLOTS = ["09:30-12:30", "12:30-15:30", "15:30-18:30"];

export function requestTypeLabel(type) {
  return ({ video: "视频剪辑", shooting: "拍摄协助", acting: "出镜协助" })[type || "video"] || "视频剪辑";
}

export function makeId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizePublishAt(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return new Date(`${value}T23:59:00+08:00`).toISOString();
  }
  return new Date(value).toISOString();
}

export function validateTemplate(template) {
  const errors = [];
  const level = template?.level?.trim();
  if (!level || level.length > 8) errors.push("等级代码需为 1–8 个字符");
  if (!template?.name?.trim() || template.name.trim().length > 20) errors.push("等级名称需为 1–20 个字符");
  const intervals = template?.intervals || {};
  const required = TEMPLATE_STAGE_ORDER.filter((stage) => stage !== STAGES.INITIAL_REVIEW || template?.includeInitialReview);
  for (const stage of required) {
    const value = Number(intervals[stage]);
    if (!Number.isFinite(value) || value < 0) errors.push(`${STAGE_META[stage].label}需填写非负小时数`);
  }
  return { valid: errors.length === 0, errors };
}

export function buildDeadlines(publishAt, template, { needsShoot = true, startAt = new Date() } = {}) {
  const validation = validateTemplate(template);
  if (!template?.confirmed) throw new Error(`${template?.level || "该等级"}节点间隔模板尚未确认`);
  if (!validation.valid) throw new Error(validation.errors.join("；"));
  const publishTime = new Date(normalizePublishAt(publishAt)).getTime();
  if (!Number.isFinite(publishTime)) throw new Error("计划发布时间无效");
  let cursor = new Date(startAt).getTime();
  if (!Number.isFinite(cursor)) throw new Error("排期起始时间无效");
  const deadlines = {};
  const setNext = (stage, intervalStage = stage) => {
    cursor += Number(template.intervals[intervalStage]) * 3600000;
    deadlines[stage] = new Date(cursor).toISOString();
  };
  setNext(STAGES.WAITING_MATERIAL);
  deadlines[STAGES.WAITING_CLAIM] = deadlines[STAGES.WAITING_MATERIAL];
  if (needsShoot) deadlines[STAGES.WAITING_SHOOT] = deadlines[STAGES.WAITING_MATERIAL];
  setNext(STAGES.EDITING);
  if (template.includeInitialReview) setNext(STAGES.INITIAL_REVIEW);
  setNext(STAGES.DIRECTOR_REVIEW);
  deadlines[STAGES.MODIFYING] = new Date(cursor + Number(template.intervals[STAGES.EDITING]) * 3600000).toISOString();
  setNext(STAGES.READY_PUBLISH);
  deadlines[STAGES.PUBLISHED] = new Date(publishTime).toISOString();
  return deadlines;
}

export function nextAfterClaim(task) {
  return task.needsShoot ? STAGES.WAITING_SHOOT : STAGES.WAITING_MATERIAL;
}

export function nextReviewStage(task) {
  return task.requiresInitialReview ? STAGES.INITIAL_REVIEW : STAGES.DIRECTOR_REVIEW;
}

function eventFor(task, action, actor, now, payload = {}) {
  const owner = task.currentStage ? getResponsible(task) : null;
  return {
    id: makeId("evt"),
    taskId: task.id,
    action,
    label: ACTION_LABELS[action],
    actorId: actor.id,
    actorName: actor.name,
    role: actor.role,
    at: new Date(now).toISOString(),
    fromStage: task.currentStage,
    toStage: payload.toStage ?? task.currentStage,
    note: payload.note || "",
    metadata: { ...(payload.metadata || {}), plannedDeadline: task.currentStage ? task.deadlines?.[task.currentStage] || "" : "", responsibleId: owner?.id || "", responsibleName: owner?.name || "" }
  };
}

export function createTask(input, actor, templates, now = new Date()) {
  if (!actor || !["director", "admin"].includes(actor.role)) throw new Error("只有编导或管理员可以创建任务");
  for (const key of ["title", "account", "level", "publishAt"]) {
    if (!input[key]) throw new Error(`缺少必填字段：${key}`);
  }
  const template = templates.find((item) => item.level === input.level);
  if (!template || template.enabled === false) throw new Error("所选等级模板不存在或已停用");
  if (template.includeInitialReview && !input.reviewerId) throw new Error(`${template.level} 级任务尚未配置中台审核人`);
  const needsShoot = input.needsShoot !== false;
  const id = makeId("video");
  const task = {
    id,
    code: `VD-${String(new Date(now).getFullYear()).slice(-2)}${String(new Date(now).getMonth() + 1).padStart(2, "0")}-${id.slice(-5).toUpperCase()}`,
    title: input.title.trim(),
    requestType: "video",
    account: input.account.trim(),
    level: input.level,
    levelName: template.name,
    requiresInitialReview: Boolean(template.includeInitialReview),
    needsShoot,
    publishAt: normalizePublishAt(input.publishAt),
    currentStage: STAGES.WAITING_CLAIM,
    previousStage: null,
    directorId: actor.id,
    directorName: actor.name,
    editorId: null,
    editorName: null,
    reviewerId: input.reviewerId || null,
    reviewerName: input.reviewerName || null,
    shooterId: input.shooterId || actor.id,
    shooterName: input.shooterName || actor.name,
    scriptUrl: input.scriptUrl || "",
    materialUrl: "",
    materialMethod: "",
    materialNote: "",
    materialAttachments: [],
    versions: [],
    scheduleIntervals: structuredClone(template.intervals),
    deadlines: buildDeadlines(input.publishAt, template, { needsShoot, startAt: now }),
    stageStartedAt: new Date(now).toISOString(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    completedAt: null,
    archived: false,
    readOnly: false,
    reminderEnabled: true,
    pauseReason: "",
    events: []
  };
  task.events.push(eventFor({ ...task, currentStage: null }, ACTIONS.CREATE, actor, now, { toStage: task.currentStage }));
  return task;
}

export function createAssistanceTask(input, actor, now = new Date()) {
  if (!actor || !["director", "admin"].includes(actor.role)) throw new Error("只有编导或管理员可以创建协助需求");
  if (!["shooting", "acting"].includes(input.requestType)) throw new Error("请选择拍摄协助或出镜协助");
  const account = String(input.account || "").trim();
  const serviceDate = String(input.serviceDate || "");
  const slots = ASSISTANCE_SLOTS.filter((slot) => new Set(input.timeSlots || []).has(slot));
  if (!account) throw new Error("请选择账号 / 达人");
  const parsedDate = new Date(`${serviceDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== serviceDate) throw new Error("请选择有效的协助日期");
  if (!slots.length || (input.timeSlots || []).some((slot) => !ASSISTANCE_SLOTS.includes(slot))) throw new Error("请至少选择一个三小时时段");
  const title = String(input.title || "").trim() || `${account}${requestTypeLabel(input.requestType)}`;
  const startsAt = new Date(`${serviceDate}T${slots[0].split("-")[0]}:00+08:00`).toISOString();
  const endsAt = new Date(`${serviceDate}T${slots.at(-1).split("-")[1]}:00+08:00`).toISOString();
  const id = makeId("assist");
  const task = {
    id, code: `AS-${serviceDate.replaceAll("-", "").slice(2)}-${id.slice(-5).toUpperCase()}`,
    title, account, requestType: input.requestType, level: "", levelName: requestTypeLabel(input.requestType),
    serviceDate, timeSlots: slots, timeSlot: slots.join("、"), startsAt, endsAt, publishAt: endsAt,
    currentStage: STAGES.WAITING_CLAIM, previousStage: null,
    directorId: actor.id, directorName: actor.name, editorId: null, editorName: null,
    issuerId: actor.id, issuerName: actor.name,
    reviewerId: null, reviewerName: "", shooterId: null, shooterName: "",
    requiresInitialReview: false, needsShoot: false, scriptUrl: "", materialUrl: "",
    materialMethod: "", materialNote: "", materialAttachments: [], versions: [], scheduleIntervals: {},
    deadlines: { [STAGES.WAITING_CLAIM]: startsAt, [STAGES.ASSISTING]: endsAt, [STAGES.ASSIST_DONE]: endsAt },
    stageStartedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    completedAt: null, archived: false, readOnly: false, reminderEnabled: true, pauseReason: "", events: []
  };
  task.events.push(eventFor({ ...task, currentStage: null }, ACTIONS.CREATE_ASSIST, actor, now, { toStage: task.currentStage, metadata: { timeSlots: slots } }));
  return task;
}

export function assistanceSlots(task) {
  return Array.isArray(task.timeSlots) && task.timeSlots.length ? task.timeSlots : task.timeSlot ? [task.timeSlot] : [];
}

export function consolidateLegacyAssistanceTasks(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    if (!["shooting", "acting"].includes(task.requestType) || !ASSISTANCE_SLOTS.includes(task.timeSlot)
      || Array.isArray(task.timeSlots) || ![STAGES.WAITING_CLAIM, STAGES.ASSISTING].includes(task.currentStage)) continue;
    const allowedEvents = (task.events || []).every((event) => [ACTIONS.CREATE_ASSIST, ACTIONS.CLAIM].includes(event.action));
    if (!allowedEvents) continue;
    const key = [task.requestType, task.account, task.serviceDate, task.directorId, task.title, task.createdAt].join("\u0000");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const replacements = new Map();
  const removed = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map((task) => task.timeSlot)).size !== group.length
      || group.some((task) => !Number.isFinite(new Date(task.startsAt).getTime()) || !Number.isFinite(new Date(task.endsAt).getTime()))) continue;
    const owners = new Set(group.map((task) => task.editorId).filter(Boolean));
    if (owners.size > 1) continue;
    const slots = ASSISTANCE_SLOTS.filter((slot) => group.some((task) => task.timeSlot === slot));
    const master = group.find((task) => task.editorId) || group[0];
    const startsAt = new Date(Math.min(...group.map((task) => new Date(task.startsAt).getTime()))).toISOString();
    const endsAt = new Date(Math.max(...group.map((task) => new Date(task.endsAt).getTime()))).toISOString();
    const events = group.flatMap((task) => (task.events || []).map((event) => ({
      ...event, taskId: master.id, metadata: { ...event.metadata, sourceTaskId: task.id }
    }))).sort((left, right) => new Date(left.at) - new Date(right.at));
    const updatedAt = group.map((task) => task.updatedAt || task.createdAt).sort().at(-1);
    events.push({ id: `evt_merge_assist_${master.id}`, taskId: master.id, action: "merge_assist_slots",
      label: "合并同日协助时段", actorId: "system", actorName: "系统", role: "system", at: updatedAt,
      fromStage: master.currentStage, toStage: master.currentStage, note: `保留原需求记录，时段：${slots.join("、")}`,
      metadata: { sourceTaskIds: group.map((task) => task.id) } });
    replacements.set(master.id, {
      ...master, timeSlots: slots, timeSlot: slots.join("、"), startsAt, endsAt, publishAt: endsAt,
      deadlines: { ...master.deadlines, [STAGES.WAITING_CLAIM]: startsAt, [STAGES.ASSISTING]: endsAt, [STAGES.ASSIST_DONE]: endsAt },
      updatedAt, events
    });
    group.filter((task) => task.id !== master.id).forEach((task) => removed.add(task.id));
  }
  return tasks.filter((task) => !removed.has(task.id)).map((task) => replacements.get(task.id) || task);
}

function assertStage(task, allowed, action) {
  if (task.readOnly || task.archived) throw new Error("归档任务不可修改");
  if (!allowed.includes(task.currentStage)) throw new Error(`当前环节不能执行“${ACTION_LABELS[action]}”`);
}

function move(task, toStage, actor, action, now, payload = {}) {
  const next = structuredClone(task);
  const from = next.currentStage;
  next.previousStage = from;
  next.currentStage = toStage;
  next.stageStartedAt = new Date(now).toISOString();
  next.updatedAt = new Date(now).toISOString();
  const intervalStage = toStage === STAGES.MODIFYING ? STAGES.EDITING : toStage;
  const interval = Number(next.scheduleIntervals?.[intervalStage]);
  const shouldKeepMaterialDeadline = toStage === STAGES.WAITING_MATERIAL && task.currentStage === STAGES.WAITING_SHOOT;
  if (Number.isFinite(interval) && !shouldKeepMaterialDeadline) {
    next.deadlines[toStage] = new Date(new Date(now).getTime() + interval * 3600000).toISOString();
    next.scheduleRisk = new Date(next.deadlines[toStage]).getTime() > new Date(next.publishAt).getTime();
  }
  if (toStage === STAGES.PUBLISHED) next.completedAt = new Date(now).toISOString();
  next.events.push(eventFor({ ...task, currentStage: from }, action, actor, now, { ...payload, toStage }));
  return next;
}

function authorizeAction(task, action, actor) {
  if (!actor) throw new Error("无法识别当前用户");
  if (action === ACTIONS.COMPLETE_ASSIST && actor.id !== getIssuer(task).id) throw new Error("只有需求下发人可以确认协助完成");
  if (actor.role === "admin") return;
  const directorActions = [ACTIONS.PAUSE, ACTIONS.RESUME, ACTIONS.CANCEL, ACTIONS.RESCHEDULE, ACTIONS.TRANSFER, ACTIONS.PUBLISH];
  if (action === ACTIONS.CLAIM && actor.role !== "editor") throw new Error("只有剪辑可以认领任务");
  if (action === ACTIONS.SHOOT_COMPLETE && ![task.shooterId, task.directorId].includes(actor.id)) throw new Error("只有拍摄负责人或编导可以确认拍摄");
  if (action === ACTIONS.MATERIAL_READY && ![task.shooterId, task.directorId].includes(actor.id)) throw new Error("只有素材负责人或编导可以确认素材");
  if (action === ACTIONS.SUBMIT_CUT && actor.id !== task.editorId) throw new Error("只有已认领剪辑可以提交成片");
  if ([ACTIONS.APPROVE, ACTIONS.REJECT].includes(action)) {
    const expected = task.currentStage === STAGES.INITIAL_REVIEW ? task.reviewerId : task.directorId;
    if (actor.id !== expected) throw new Error("只有当前审核负责人可以处理审核");
  }
  if (directorActions.includes(action) && actor.id !== task.directorId) throw new Error("只有负责编导可以执行该操作");
}

function completeMaterialHandoff(task, action, actor, payload, now) {
  if (!payload.materialMethod?.trim()) throw new Error("请选择素材给予方式");
  const attachment = normalizeAttachment(payload.attachment);
  const note = payload.note?.trim() || "";
  const next = move(task, STAGES.EDITING, actor, action, now, {
    note,
    metadata: { materialMethod: payload.materialMethod.trim(), attachment: attachment?.name || "" }
  });
  next.materialUrl = "";
  next.materialMethod = payload.materialMethod.trim();
  next.materialNote = note;
  next.materialAttachments = attachment ? [...(task.materialAttachments || []), attachment] : [...(task.materialAttachments || [])];
  return next;
}

function normalizeAttachment(input) {
  return input?.name ? {
    name: input.name,
    size: Number(input.size) || 0,
    type: input.type || "",
    lastModified: Number(input.lastModified) || null,
    dataUrl: /^data:/.test(input.dataUrl || "") ? input.dataUrl : ""
  } : null;
}

export function applyAction(task, action, actor, payload = {}, now = new Date()) {
  if (task.readOnly || task.archived || [STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED].includes(task.currentStage)) throw new Error("已结束任务不可修改");
  authorizeAction(task, action, actor);
  switch (action) {
    case ACTIONS.CLAIM: {
      assertStage(task, [STAGES.WAITING_CLAIM], action);
      if (task.editorId && task.editorId !== actor.id) throw new Error("任务已被其他剪辑认领");
      const next = move(task, task.requestType && task.requestType !== "video" ? STAGES.ASSISTING : nextAfterClaim(task), actor, action, now);
      next.editorId = actor.id;
      next.editorName = actor.name;
      return next;
    }
    case ACTIONS.COMPLETE_ASSIST: {
      assertStage(task, [STAGES.ASSISTING], action);
      const next = move(task, STAGES.ASSIST_DONE, actor, action, now, { note: payload.note });
      next.completedAt = new Date(now).toISOString();
      next.archived = true;
      next.readOnly = true;
      next.reminderEnabled = false;
      return next;
    }
    case ACTIONS.SHOOT_COMPLETE: {
      assertStage(task, [STAGES.WAITING_SHOOT], action);
      return completeMaterialHandoff(task, action, actor, payload, now);
    }
    case ACTIONS.MATERIAL_READY: {
      assertStage(task, [STAGES.WAITING_MATERIAL], action);
      return completeMaterialHandoff(task, action, actor, payload, now);
    }
    case ACTIONS.SUBMIT_CUT: {
      assertStage(task, [STAGES.EDITING, STAGES.MODIFYING], action);
      if (!payload.cutDeliveryMethod?.trim()) throw new Error("请选择交片渠道");
      const version = {
        id: makeId("version"),
        number: task.versions.length + 1,
        url: payload.url || "",
        deliveryMethod: payload.cutDeliveryMethod.trim(),
        deliveryNote: payload.deliveryNote?.trim() || "",
        attachment: normalizeAttachment(payload.attachment),
        note: payload.note || "",
        submittedBy: actor.name,
        submittedAt: new Date(now).toISOString()
      };
      const next = move(task, nextReviewStage(task), actor, action, now, { metadata: { version: version.number, deliveryMethod: version.deliveryMethod } });
      next.versions.push(version);
      return next;
    }
    case ACTIONS.APPROVE:
      assertStage(task, [STAGES.INITIAL_REVIEW, STAGES.DIRECTOR_REVIEW], action);
      return move(
        task,
        task.currentStage === STAGES.INITIAL_REVIEW ? STAGES.DIRECTOR_REVIEW : STAGES.READY_PUBLISH,
        actor,
        action,
        now,
        { note: payload.note }
      );
    case ACTIONS.REJECT:
      assertStage(task, [STAGES.INITIAL_REVIEW, STAGES.DIRECTOR_REVIEW], action);
      return move(task, STAGES.MODIFYING, actor, action, now, { note: payload.note });
    case ACTIONS.PUBLISH: {
      assertStage(task, [STAGES.READY_PUBLISH], action);
      const next = move(task, STAGES.PUBLISHED, actor, action, now, { note: payload.note, metadata: { url: payload.url || "" } });
      next.archived = true;
      next.readOnly = true;
      next.reminderEnabled = false;
      return next;
    }
    case ACTIONS.PAUSE: {
      assertStage(task, Object.values(STAGES).filter((stage) => ![STAGES.PAUSED, STAGES.PUBLISHED, STAGES.CANCELLED].includes(stage)), action);
      if (!payload.note?.trim()) throw new Error("暂停任务必须填写原因");
      const next = move(task, STAGES.PAUSED, actor, action, now, { note: payload.note, metadata: { resumeStage: task.currentStage } });
      next.pauseReason = payload.note;
      next.reminderEnabled = false;
      return next;
    }
    case ACTIONS.RESUME: {
      assertStage(task, [STAGES.PAUSED], action);
      const resumeStage = [...task.events].reverse().find((event) => event.action === ACTIONS.PAUSE)?.metadata?.resumeStage;
      if (!resumeStage) throw new Error("无法确定恢复环节");
      const next = move(task, resumeStage, actor, action, now, { note: payload.note });
      next.pauseReason = "";
      next.reminderEnabled = true;
      return next;
    }
    case ACTIONS.CANCEL: {
      if (!payload.note?.trim()) throw new Error("取消任务必须填写原因");
      const next = move(task, STAGES.CANCELLED, actor, action, now, { note: payload.note });
      next.reminderEnabled = false;
      return next;
    }
    case ACTIONS.RESCHEDULE: {
      if (!payload.publishAt || !payload.note?.trim()) throw new Error("改期必须填写新发布时间和原因");
      if (task.requestType && task.requestType !== "video") throw new Error("协助需求改期请重新创建对应时段");
      const template = payload.templates?.find((item) => item.level === task.level);
      const next = structuredClone(task);
      next.publishAt = normalizePublishAt(payload.publishAt);
      next.scheduleIntervals = structuredClone(template.intervals);
      next.deadlines = buildDeadlines(payload.publishAt, template, { needsShoot: task.needsShoot, startAt: now });
      next.updatedAt = new Date(now).toISOString();
      next.events.push(eventFor(task, action, actor, now, { note: payload.note, metadata: { publishAt: next.publishAt } }));
      return next;
    }
    case ACTIONS.TRANSFER: {
      if (!payload.user?.id || !payload.note?.trim()) throw new Error("转交必须选择负责人并填写原因");
      if (task.requestType && task.requestType !== "video" && task.currentStage !== STAGES.ASSISTING) throw new Error("协助需求认领后才能转交承接人");
      if (task.requestType && task.requestType !== "video" && payload.user.role !== "editor") throw new Error("协助承接人必须是剪辑");
      const next = structuredClone(task);
      const owner = STAGE_META[task.currentStage]?.owner;
      if (owner === "editor" || owner === "issuer") {
        next.editorId = payload.user.id;
        next.editorName = payload.user.name;
      } else if (owner === "reviewer") {
        next.reviewerId = payload.user.id;
        next.reviewerName = payload.user.name;
      } else {
        next.directorId = payload.user.id;
        next.directorName = payload.user.name;
      }
      next.updatedAt = new Date(now).toISOString();
      next.events.push(eventFor(task, action, actor, now, { note: payload.note, metadata: { userId: payload.user.id, userName: payload.user.name } }));
      return next;
    }
    default:
      throw new Error("未知操作");
  }
}

export function getIssuer(task) {
  const created = (task.events || []).find((event) => event.action === ACTIONS.CREATE_ASSIST);
  return {
    id: task.issuerId || created?.actorId || task.directorId,
    name: task.issuerName || created?.actorName || task.directorName || "需求下发人",
    kind: "user"
  };
}

export function getResponsible(task) {
  const owner = STAGE_META[task.currentStage]?.owner;
  if (owner === "editor_pool") return { id: "editor_pool", name: "剪辑认领池", kind: "group" };
  if (owner === "issuer") return getIssuer(task);
  if (owner === "editor") return { id: task.editorId, name: task.editorName || "待指定剪辑", kind: "user" };
  if (owner === "reviewer") return { id: task.reviewerId || "review_pool", name: task.reviewerName || "中台审核人", kind: "user" };
  if (owner === "shooter") return { id: task.shooterId, name: task.shooterName || task.directorName, kind: "user" };
  return { id: task.directorId, name: task.directorName, kind: "user" };
}

export function taskIsRelatedToUser(task, user) {
  if (!task || !user) return false;
  if (["reviewer", "admin"].includes(user.role)) return true;
  const events = Array.isArray(task.events) ? task.events : [];
  if (user.role === "editor") {
    return task.editorId === user.id || events.some((event) => event.action === ACTIONS.CLAIM && event.actorId === user.id);
  }
  if (user.role === "director") {
    const createEvents = events.filter((event) => [ACTIONS.CREATE, ACTIONS.CREATE_ASSIST].includes(event.action));
    return createEvents.length ? createEvents.some((event) => event.actorId === user.id) : task.directorId === user.id;
  }
  return false;
}

export function canAct(task, user) {
  if (!user || task.readOnly || task.archived) return false;
  if (task.currentStage === STAGES.ASSISTING && task.requestType && task.requestType !== "video") return getIssuer(task).id === user.id;
  if (user.role === "admin") return true;
  const responsible = getResponsible(task);
  if (task.currentStage === STAGES.WAITING_CLAIM) return user.role === "editor";
  return responsible.id === user.id;
}

export function deadlineForCurrentStage(task) {
  return task.deadlines?.[task.currentStage] || task.publishAt || null;
}

export function taskBucket(task, user, now = new Date()) {
  if ([STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED].includes(task.currentStage)) return "done";
  if (task.currentStage === STAGES.WAITING_CLAIM) return "waiting";
  if (!canAct(task, user)) return "waiting";
  const deadline = new Date(deadlineForCurrentStage(task)).getTime();
  const nowMs = new Date(now).getTime();
  if (deadline < nowMs) return "overdue";
  if (new Date(deadline).toDateString() === new Date(nowMs).toDateString()) return "today";
  return "upcoming";
}

export function evaluateReminders(tasks, records, settings, now = new Date()) {
  if (!settings?.enabled) return [];
  const nowMs = new Date(now).getTime();
  const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(nowMs));
  const existing = new Set(records.map((record) => record.dedupeKey));
  const output = [];
  for (const task of tasks) {
    if (!task.reminderEnabled || task.archived || [STAGES.PUBLISHED, STAGES.ASSIST_DONE, STAGES.CANCELLED, STAGES.PAUSED].includes(task.currentStage)) continue;
    const deadline = new Date(deadlineForCurrentStage(task)).getTime();
    const start = new Date(task.stageStartedAt).getTime();
    if (!Number.isFinite(deadline) || !Number.isFinite(start)) continue;
    const durationHours = Math.max(0, (deadline - start) / 3600000);
    const remainingHours = (deadline - nowMs) / 3600000;
    const overdueHours = -remainingHours;
    const responsible = getResponsible(task);
    let kind = null;
    let channel = "direct";
    if (remainingHours > 0 && remainingHours <= (durationHours > 24 ? 24 : 2)) kind = "pre_due";
    else if (remainingHours <= 0 && overdueHours < 4) kind = "due";
    else if (overdueHours >= 4) {
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(new Date(nowMs)));
      const escalatedKey = `${task.id}:${task.currentStage}:escalated`;
      if (!existing.has(escalatedKey)) {
        kind = "escalated";
        channel = "group";
      } else if (hour >= 10) {
        kind = "daily";
        channel = "group";
      }
    }
    if (!kind) continue;
    const dedupeKey = kind === "daily"
      ? `${task.id}:${task.currentStage}:daily:${dateKey}`
      : `${task.id}:${task.currentStage}:${kind}`;
    if (existing.has(dedupeKey)) continue;
    output.push({
      id: makeId("reminder"), taskId: task.id, stage: task.currentStage, kind, channel,
      recipientId: channel === "group" ? settings.groupId : responsible.id,
      recipientName: channel === "group" ? settings.groupName : responsible.name,
      dedupeKey, createdAt: new Date(nowMs).toISOString(), status: "pending"
    });
  }
  return output;
}

export function migrateLegacyTask(legacy, templates, now = new Date()) {
  let currentStage = STAGES.WAITING_CLAIM;
  let archived = false;
  let readOnly = false;
  if (legacy.publishedAt) {
    currentStage = STAGES.PUBLISHED;
    archived = true;
    readOnly = true;
  } else if (legacy.confirmed) currentStage = STAGES.READY_PUBLISH;
  else if (legacy.cutUrl) {
    const legacyTemplate = templates.find((item) => item.level === legacy.level);
    currentStage = legacyTemplate?.includeInitialReview ? STAGES.INITIAL_REVIEW : STAGES.DIRECTOR_REVIEW;
  }
  else if (legacy.editorId && legacy.materialUrl) currentStage = STAGES.EDITING;
  else if (legacy.editorId) currentStage = legacy.needsShoot === false ? STAGES.WAITING_MATERIAL : STAGES.WAITING_SHOOT;
  const template = templates.find((item) => item.level === legacy.level);
  let deadlines = {};
  let needsConfirmation = false;
  try { deadlines = buildDeadlines(legacy.publishAt, template, { needsShoot: legacy.needsShoot !== false, startAt: legacy.updatedAt || now }); }
  catch { needsConfirmation = true; }
  return {
    ...legacy,
    id: legacy.id || makeId("legacy"),
    currentStage,
    archived,
    readOnly,
    reminderEnabled: !archived && !needsConfirmation,
    migrationNeedsConfirmation: needsConfirmation,
    deadlines,
    scheduleIntervals: template?.intervals ? structuredClone(template.intervals) : {},
    levelName: legacy.levelName || template?.name || `${legacy.level}级视频`,
    requiresInitialReview: Boolean(legacy.requiresInitialReview ?? template?.includeInitialReview),
    stageStartedAt: legacy.updatedAt || new Date(now).toISOString(),
    events: legacy.events || []
  };
}
