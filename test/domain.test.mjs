import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, STAGES, applyAction, buildDeadlines, createTask,
  evaluateReminders, migrateLegacyTask, validateTemplate
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
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { url: "https://example.com/cut" }, now);
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

test("角色权限阻止非剪辑认领和非负责人审核", () => {
  const task = createTask({ title: "权限测试", account: "万万", level: "B", publishAt, needsShoot: false }, director, templates, now);
  assert.throws(() => applyAction(task, ACTIONS.CLAIM, director, {}, now), /只有剪辑/);
  let reviewTask = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  reviewTask = applyAction(reviewTask, ACTIONS.MATERIAL_READY, director, { materialMethod: "现场传输" }, now);
  reviewTask = applyAction(reviewTask, ACTIONS.SUBMIT_CUT, editor, { url: "https://example.com/cut" }, now);
  assert.throws(() => applyAction(reviewTask, ACTIONS.APPROVE, reviewer, {}, now), /只有当前审核负责人/);
});

test("S/A 成片必须经过中台初审，再进入编导终审", () => {
  let task = createTask({ title: "重点视频", account: "周周", level: "S", publishAt, needsShoot: false, reviewerId: reviewer.id, reviewerName: reviewer.name }, director, templates, now);
  task = applyAction(task, ACTIONS.CLAIM, editor, {}, now);
  task = applyAction(task, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, now);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { url: "https://example.com/v1" }, now);
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
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { url: "https://example.com/v1" }, now);
  task = applyAction(task, ACTIONS.REJECT, director, { note: "字幕需要调整" }, now);
  assert.equal(task.currentStage, STAGES.MODIFYING);
  task = applyAction(task, ACTIONS.SUBMIT_CUT, editor, { url: "https://example.com/v2" }, now);
  assert.equal(task.versions.length, 2);
  assert.equal(task.versions[0].url, "https://example.com/v1");
  assert.equal(task.versions[1].number, 2);
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
