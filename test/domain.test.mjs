import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, STAGES, applyAction, buildDeadlines, canAct, consolidateLegacyAssistanceTasks, createAssistanceTask, createTask,
  evaluateReminders, getResponsible, migrateLegacyTask, taskBucket, taskIsRelatedToUser, validateTemplate
} from "../dist/domain.js";

const director = { id: "director", name: "编导", role: "director" };
const editor = { id: "editor", name: "剪辑", role: "editor" };
const reviewer = { id: "reviewer", name: "中台", role: "reviewer" };
const baseIntervals = {
  [STAGES.WAITING_MATERIAL]: 48,
  [STAGES.EDITING]: 24,
  [STAGES.INITIAL_REVIEW]: 16,
  [STAGES.DIRECTOR_REVIEW]: 10,
  [STAGES.READY_PUBLISH]: 0
};
const templates = ["S", "A", "B", "C"].map((level) => ({
  level, name: `${level}级视频`, enabled: true, confirmed: true,
  includeInitialReview: ["S", "A"].includes(level), intervals: { ...baseIntervals }
}));
const now = new Date("2026-11-17T02:00:00.000Z");
const publishAt = "2026-11-20T02:00:00.000Z";

test("拍摄与出镜协助同日多时段合为一条需求，认领完成并保留节点快照", () => {
  let task = createAssistanceTask({ requestType: "shooting", account: "万万", serviceDate: "2026-11-20", timeSlots: ["15:30-18:30", "09:30-12:30"] }, director, now);
  assert.deepEqual(task.timeSlots, ["09:30-12:30", "15:30-18:30"]);
  assert.equal(task.deadlines[STAGES.WAITING_CLAIM], "2026-11-20T01:30:00.000Z");
  assert.equal(task.deadlines[STAGES.ASSISTING], "2026-11-20T10:30:00.000Z");
  assert.equal(taskIsRelatedToUser(task, director), true);
  assert.equal(taskIsRelatedToUser(task, editor), false);
  assert.equal(taskBucket(task, editor, now), "waiting");
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, new Date("2026-11-19T01:00:00Z"));
  assert.equal(task.currentStage, STAGES.ASSISTING);
  assert.equal(taskIsRelatedToUser(task, editor), true);
  assert.equal(task.events.at(-1).metadata.plannedDeadline, "2026-11-20T01:30:00.000Z");
  assert.equal(task.events.at(-1).metadata.responsibleName, "剪辑认领池");
  assert.equal(getResponsible(task).id, director.id);
  assert.equal(canAct(task, director), true);
  assert.equal(canAct(task, editor), false);
  assert.equal(taskBucket(task, editor, now), "waiting");
  assert.throws(() => applyAction(task, ACTIONS.COMPLETE_ASSIST, editor, {}, now), /只有需求下发人/);
  assert.throws(() => applyAction(task, ACTIONS.COMPLETE_ASSIST, { id: "admin", role: "admin" }, {}, now), /只有需求下发人/);
  task = applyAction(task, ACTIONS.COMPLETE_ASSIST, director, { note: "现场完成" }, new Date("2026-11-20T04:00:00Z"));
  assert.equal(task.currentStage, STAGES.ASSIST_DONE);
  assert.equal(task.completedAt, "2026-11-20T04:00:00.000Z");
  assert.equal(task.events.at(-1).metadata.responsibleName, director.name);
  assert.equal(task.readOnly, true);
  assert.throws(() => applyAction(task, ACTIONS.CANCEL, director, { note: "取消" }, now), /已结束任务不可修改/);
});

test("协助承接人转交后，完成确认仍由原下发人执行", () => {
  let task = createAssistanceTask({ requestType: "acting", account: "丝丝", serviceDate: "2026-11-20", timeSlots: ["12:30-15:30"] }, director, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  const otherEditor = { id: "other_editor", name: "新承接剪辑", role: "editor" };
  task = applyAction(task, ACTIONS.TRANSFER, director, { user: otherEditor, note: "排班调整" }, now);
  assert.equal(task.editorId, otherEditor.id);
  assert.equal(getResponsible(task).id, director.id);
  assert.equal(canAct(task, otherEditor), false);
  assert.throws(() => applyAction(task, ACTIONS.COMPLETE_ASSIST, otherEditor, {}, now), /只有需求下发人/);
  task = applyAction(task, ACTIONS.COMPLETE_ASSIST, director, {}, now);
  assert.equal(task.currentStage, STAGES.ASSIST_DONE);
});

test("协助需求校验日期与时段", () => {
  assert.throws(() => createAssistanceTask({ requestType: "acting", account: "万万", serviceDate: "2026-02-30", timeSlots: ["09:30-12:30"] }, director), /有效的协助日期/);
  assert.throws(() => createAssistanceTask({ requestType: "acting", account: "万万", serviceDate: "2026-11-20", timeSlots: [] }, director), /至少选择一个/);
});

test("旧版同次创建的同日时段合并，已认领者保留负责人和历史事件", () => {
  const first = createAssistanceTask({ requestType: "shooting", account: "丝丝", serviceDate: "2026-12-01", timeSlots: ["09:30-12:30"] }, director, now);
  const second = createAssistanceTask({ requestType: "shooting", account: "丝丝", serviceDate: "2026-12-01", timeSlots: ["12:30-15:30"] }, director, now);
  const legacyFirst = { ...first, timeSlots: undefined };
  const legacySecond = { ...second, timeSlots: undefined };
  const claimed = applyAction(legacyFirst, ACTIONS.CLAIM, editor, {}, now);
  const [merged] = consolidateLegacyAssistanceTasks([claimed, legacySecond]);
  assert.equal(merged.id, claimed.id);
  assert.deepEqual(merged.timeSlots, ["09:30-12:30", "12:30-15:30"]);
  assert.equal(merged.editorId, editor.id);
  assert.equal(merged.currentStage, STAGES.ASSISTING);
  assert.equal(merged.deadlines[STAGES.ASSISTING], "2026-12-01T07:30:00.000Z");
  assert.equal(merged.events.filter((event) => event.action === ACTIONS.CREATE_ASSIST).length, 2);
  assert.equal(consolidateLegacyAssistanceTasks([merged]).length, 1);
});

test("旧时段若已由不同剪辑认领，不自动改写负责人", () => {
  const first = createAssistanceTask({ requestType: "acting", account: "丝丝", serviceDate: "2026-12-01", timeSlots: ["09:30-12:30"] }, director, now);
  const second = createAssistanceTask({ requestType: "acting", account: "丝丝", serviceDate: "2026-12-01", timeSlots: ["12:30-15:30"] }, director, now);
  const otherEditor = { id: "editor_2", name: "另一剪辑", role: "editor" };
  const tasks = [applyAction({ ...first, timeSlots: undefined }, ACTIONS.CLAIM, editor, {}, now),
    applyAction({ ...second, timeSlots: undefined }, ACTIONS.CLAIM, otherEditor, {}, now)];
  assert.deepEqual(consolidateLegacyAssistanceTasks(tasks).map((task) => task.editorId), [editor.id, otherEditor.id]);
});

test("节点间隔模板拒绝负数和缺失值，不要求数值递减", () => {
  const invalid = { level: "S", name: "S级视频", includeInitialReview: true, confirmed: false, intervals: { ...baseIntervals, [STAGES.EDITING]: -1 } };
  const result = validateTemplate(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes("剪辑中")));
  const valid = validateTemplate({ level: "S", name: "S级视频", includeInitialReview: true, confirmed: true, intervals: { ...baseIntervals, [STAGES.EDITING]: 80, [STAGES.READY_PUBLISH]: 2 } });
  assert.equal(valid.valid, true);
});

test("自定义等级可以独立决定是否经过中台初审", () => {
  const customTemplates = [...templates, {
    level: "P0", name: "热点急单", enabled: true, confirmed: true,
    includeInitialReview: false, intervals: { ...baseIntervals }
  }];
  let task = createTask({ title: "热点", account: "集合号", level: "P0", publishAt, needsShoot: false }, director, customTemplates, now);
  assert.equal(task.requiresInitialReview, false);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间", deliveryNote: "项目：热点" }, now);
  assert.equal(task.currentStage, STAGES.DIRECTOR_REVIEW);
});

test("已有素材任务跳过拍摄，B/C 跳过中台初审", () => {
  const task = createTask({ title: "测试视频", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  assert.equal(task.currentStage, STAGES.WAITING_CLAIM);
  assert.equal(task.deadlines[STAGES.WAITING_SHOOT], undefined);
  assert.equal(task.deadlines[STAGES.INITIAL_REVIEW], undefined);
  const claimed = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  assert.equal(claimed.currentStage, STAGES.WAITING_MATERIAL);
  const materialReadyAt = new Date("2026-11-18T06:00:00.000Z");
  const editing = applyAction(claimed, ACTIONS.MATERIAL_READY, director, { materialMethod: "剪映云空间", note: "已上传", attachment: { name: "素材清单.xlsx", size: 1024, type: "application/vnd.ms-excel", dataUrl: "data:application/vnd.ms-excel;base64,ZmFrZQ==" } }, materialReadyAt);
  assert.equal(editing.deadlines[STAGES.EDITING], "2026-11-19T06:00:00.000Z");
  assert.equal(editing.materialMethod, "剪映云空间");
  assert.equal(editing.materialAttachments[0].name, "素材清单.xlsx");
  assert.match(editing.materialAttachments[0].dataUrl, /^data:/);
});

test("待拍摄任务完成拍摄时同步确认素材并直接进入剪辑", () => {
  let task = createTask({ title: "拍摄交接", account: "万万", level: "B", publishAt, needsShoot: true }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  assert.equal(task.currentStage, STAGES.WAITING_SHOOT);
  assert.throws(() => applyAction(task, ACTIONS.SHOOT_COMPLETE, director, {}, now), /请选择素材给予方式/);
  task = applyAction(task, ACTIONS.SHOOT_COMPLETE, director, { materialMethod: "现场传输", note: "现场交接完成" }, now);
  assert.equal(task.currentStage, STAGES.EDITING);
  assert.equal(task.materialMethod, "现场传输");
  assert.equal(task.events.at(-1).toStage, STAGES.EDITING);
});

test("角色权限阻止非剪辑认领和非负责人审核", () => {
  const task = createTask({ title: "权限测试", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  assert.throws(() => applyAction(task, ACTIONS.CLAIM, director, {}, now), /只有剪辑/);
  let reviewTask = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  reviewTask = applyAction(reviewTask, ACTIONS.MATERIAL_READY, director, { materialMethod: "现场传输" }, now);
  reviewTask = applyAction(reviewTask, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "飞书" }, now);
  assert.throws(() => applyAction(reviewTask, ACTIONS.APPROVE, reviewer, {}, now), /只有当前审核负责人/);
});

test("全部相关任务按角色区分创建、认领与全量范围", () => {
  const created = createTask({ title: "归属测试", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  assert.equal(taskIsRelatedToUser(created, director), true);
  assert.equal(taskIsRelatedToUser(created, editor), false);
  assert.equal(taskIsRelatedToUser(created, reviewer), true);
  assert.equal(taskIsRelatedToUser(created, { id: "admin", role: "admin" }), true);

  const claimed = applyAction(created, ACTIONS.CLAIM, editor, {}, now);
  assert.equal(taskIsRelatedToUser(claimed, editor), true);
  const transferred = { ...claimed, editorId: "editor_2", editorName: "新剪辑" };
  assert.equal(taskIsRelatedToUser(transferred, editor), true);
  assert.equal(taskIsRelatedToUser(transferred, { id: "editor_2", role: "editor" }), true);

  const transferredDirector = { ...created, directorId: "director_2", directorName: "新编导" };
  assert.equal(taskIsRelatedToUser(transferredDirector, director), true);
  assert.equal(taskIsRelatedToUser(transferredDirector, { id: "director_2", role: "director" }), false);
});

test("S/A 成片必须经过中台初审，再进入编导终审", () => {
  let task = createTask({ title: "重点视频", account: "周周", level: "S", publishAt, needsShoot: false, reviewerId: reviewer.id, reviewerName: reviewer.name }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间", deliveryNote: "S级项目" }, now);
  assert.equal(task.currentStage, STAGES.INITIAL_REVIEW);
  task = applyAction(task, ACTIONS.APPROVE, reviewer, { note: "通过" }, now);
  assert.equal(task.currentStage, STAGES.DIRECTOR_REVIEW);
  task = applyAction(task, ACTIONS.APPROVE, director, {}, now);
  assert.equal(task.currentStage, STAGES.READY_PUBLISH);
});

test("退回修改保留旧版本并生成新版本", () => {
  let task = createTask({ title: "修改测试", account: "丝丝", level: "C", publishAt, needsShoot: false }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间", deliveryNote: "项目 V1" }, now);
  task = applyAction(task, ACTIONS.REJECT, director, { note: "字幕需要调整" }, now);
  assert.equal(task.currentStage, STAGES.MODIFYING);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "飞书", deliveryNote: "文件夹 V2" }, now);
  assert.equal(task.versions.length, 2);
  assert.equal(task.versions[0].deliveryMethod, "剪映云空间");
  assert.equal(task.versions[0].deliveryNote, "项目 V1");
  assert.equal(task.versions[1].number, 2);
  assert.equal(task.versions[1].deliveryMethod, "飞书");
});

test("退回修改允许不填写备注", () => {
  let task = createTask({ title: "无备注退回", account: "丝丝", level: "C", publishAt, needsShoot: false }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间" }, now);
  task = applyAction(task, ACTIONS.REJECT, director, {}, now);
  assert.equal(task.currentStage, STAGES.MODIFYING);
  assert.equal(task.events.at(-1).note, "");
});

test("提交成片必须选择交片渠道", () => {
  let task = createTask({ title: "交片校验", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  assert.throws(() => applyAction(task, ACTIONS.SUBMIT_CUT, editor, {}, now), /请选择交片渠道/);
});

test("成片附件随版本保存，后续修改不会覆盖旧附件", () => {
  let task = createTask({ title: "附件版本", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "飞书", attachment: { name: "第一版.png", type: "image/png", size: 10, dataUrl: "data:image/png;base64,AA==" } }, now);
  task = applyAction(task, ACTIONS.REJECT, director, {}, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "飞书", attachment: { name: "第二版.pdf", type: "application/pdf", size: 12, dataUrl: "data:application/pdf;base64,AA==" } }, now);
  assert.deepEqual(task.versions.map((version) => version.attachment.name), ["第一版.png", "第二版.pdf"]);
});

test("暂停任务停止提醒，恢复后回到原环节", () => {
  let task = createTask({ title: "暂停测试", account: "万万", level: "A", publishAt, needsShoot: false, reviewerId: reviewer.id, reviewerName: reviewer.name }, director, templates, now);
  task = applyAction(task, ACTIONS.PAUSE, director, { note: "等待商务确认" }, now);
  assert.equal(task.currentStage, STAGES.PAUSED);
  assert.equal(task.reminderEnabled, false);
  task = applyAction(task, ACTIONS.RESUME, director, {}, now);
  assert.equal(task.currentStage, STAGES.WAITING_CLAIM);
  assert.equal(task.reminderEnabled, true);
});

test("提醒记录按任务、节点和类型去重", () => {
  const task = {
    id: "task-1", title: "提醒测试", currentStage: STAGES.EDITING,
    editorId: "editor", editorName: "剪辑", directorId: "director", directorName: "编导",
    publishAt, stageStartedAt: "2026-11-16T00:00:00.000Z",
    deadlines: { [STAGES.EDITING]: "2026-11-17T01:00:00.000Z" },
    reminderEnabled: true, archived: false
  };
  const settings = { enabled: true, groupId: "group", groupName: "协作群" };
  const first = evaluateReminders([task], [], settings, now);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "due");
  const second = evaluateReminders([task], first, settings, now);
  assert.equal(second.length, 0);
});

test("超期四小时升级到协作群", () => {
  const task = {
    id: "task-2", currentStage: STAGES.WAITING_CLAIM,
    directorId: "director", directorName: "编导",
    publishAt, stageStartedAt: "2026-11-15T00:00:00.000Z",
    deadlines: { [STAGES.WAITING_CLAIM]: "2026-11-16T20:00:00.000Z" },
    reminderEnabled: true, archived: false
  };
  const output = evaluateReminders([task], [], { enabled: true, groupId: "group", groupName: "协作群" }, now);
  assert.equal(output[0].kind, "escalated");
  assert.equal(output[0].channel, "group");
});

test("已发布旧任务迁移为只读归档，不参与提醒", () => {
  const legacy = migrateLegacyTask({ id: "old", title: "旧任务", level: "B", publishAt, publishedAt: now.toISOString() }, templates, now);
  assert.equal(legacy.currentStage, STAGES.PUBLISHED);
  assert.equal(legacy.archived, true);
  assert.equal(legacy.readOnly, true);
  assert.equal(legacy.reminderEnabled, false);
});

test("节点日期按实际起始时间和相邻间隔向后计算", () => {
  const deadlines = buildDeadlines(publishAt, templates[0], { needsShoot: true, startAt: now });
  assert.equal(deadlines[STAGES.WAITING_CLAIM], "2026-11-19T02:00:00.000Z");
  assert.equal(deadlines[STAGES.WAITING_SHOOT], deadlines[STAGES.WAITING_MATERIAL]);
  assert.equal(deadlines[STAGES.EDITING], "2026-11-20T02:00:00.000Z");
  assert.equal(deadlines[STAGES.MODIFYING], "2026-11-22T04:00:00.000Z");
  assert.equal(deadlines[STAGES.PUBLISHED], publishAt);
});

test("发布日期支持日维度并按北京时间当天结束保存", () => {
  const task = createTask({ title: "日维度排期", account: "万万", level: "B", publishAt: "2026-11-20", needsShoot: false }, director, templates, now);
  assert.equal(task.publishAt, "2026-11-20T15:59:00.000Z");
  assert.equal(task.deadlines[STAGES.PUBLISHED], task.publishAt);
});

test("素材确认必须选择后台配置的给予方式", () => {
  let task = createTask({ title: "素材交接", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  assert.throws(() => applyAction(task, ACTIONS.MATERIAL_READY, director, {}, now), /请选择素材给予方式/);
});
