import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, STAGES, applyAction, createAssistanceTask, createTask } from "../dist/domain.js";
import { exportCsv, exportTable, formatBeijingTime } from "../dist/export.js";

const director = { id: "d", name: "编导", role: "director" };
const editor = { id: "e", name: "剪辑", role: "editor" };
const reviewer = { id: "r", name: "中台", role: "reviewer" };
const templates = [
  { level: "B", name: "B级视频", enabled: true, confirmed: true, includeInitialReview: false,
    intervals: { waiting_material: 2, editing: 3, director_review: 2, ready_publish: 2 } },
  { level: "S", name: "S级视频", enabled: true, confirmed: true, includeInitialReview: true,
    intervals: { waiting_material: 2, editing: 3, initial_review: 1, director_review: 2, ready_publish: 2 } }
];
const at = (hour) => new Date(`2026-11-19T${String(hour).padStart(2, "0")}:00:00Z`);
const cell = (table, row, name) => row[table.columns.indexOf(name)];

test("一条需求一行，时间为北京时间，未发生节点留空", () => {
  let video = createTask({ title: "=风险选题", account: "万万", level: "B", publishAt: "2026-11-20", needsShoot: false }, director, templates, at(1));
  video = applyAction(video, ACTIONS.CLAIM, editor, {}, at(2));
  video = applyAction(video, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, at(5));
  const assist = createAssistanceTask({ requestType: "acting", account: "万万", serviceDate: "2026-11-20", timeSlots: ["09:30-12:30"] }, director, at(1));
  const table = exportTable([video, assist], "2026-11-20", "2026-11-20");
  assert.equal(table.count, 2);
  assert.equal(table.rows.length, 2);
  assert.ok(table.rows.every((row) => row.length === table.columns.length));
  const row = table.rows.find((item) => cell(table, item, "需求编号") === video.code);
  assert.equal(cell(table, row, "编导提需时间（北京时间）"), "2026-11-19 09:00:00");
  assert.equal(cell(table, row, "编导提需人"), "编导");
  assert.equal(cell(table, row, "剪辑认领时间（北京时间）"), "2026-11-19 10:00:00");
  assert.equal(cell(table, row, "认领剪辑"), "剪辑");
  assert.equal(cell(table, row, "已有素材确认时间（北京时间）"), "2026-11-19 13:00:00");
  assert.equal(cell(table, row, "素材确认人"), "编导");
  assert.equal(cell(table, row, "拍摄及素材交接时间（北京时间）"), "");
  assert.equal(cell(table, row, "剪辑首次交付时间（北京时间）"), "");
  const assistRow = table.rows.find((item) => cell(table, item, "需求编号") === assist.code);
  assert.equal(cell(table, assistRow, "协助时段"), "09:30-12:30");
  assert.equal(formatBeijingTime("2026-11-23T09:49:44.689Z"), "2026-11-23 17:49:44");
  const { csv, count } = exportCsv([video, assist], "2026-11-20", "2026-11-20");
  assert.equal(count, 2);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.split("\r\n").length, 3);
  assert.ok(csv.includes('"\'=风险选题"'));
  assert.equal(exportTable([video], "2026-11-21", "2026-11-22").count, 0);
  assert.throws(() => exportTable([video], "2026-11-22", "2026-11-20"), /结束日期/);
});

test("拍摄交接和多轮修改保留实际完成时间、操作人、审核结果", () => {
  let video = createTask({ title: "多轮", account: "丝丝", level: "S", publishAt: "2026-11-20", needsShoot: true,
    reviewerId: reviewer.id, reviewerName: reviewer.name }, director, templates, at(1));
  const steps = [
    [ACTIONS.CLAIM, editor, {}, 2],
    [ACTIONS.SHOOT_COMPLETE, director, { materialMethod: "现场传输" }, 3],
    [ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间" }, 4],
    [ACTIONS.REJECT, reviewer, {}, 5],
    [ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间" }, 6],
    [ACTIONS.APPROVE, reviewer, {}, 7],
    [ACTIONS.REJECT, director, {}, 8],
    [ACTIONS.SUBMIT_CUT, editor, { cutDeliveryMethod: "剪映云空间" }, 9],
    [ACTIONS.APPROVE, reviewer, {}, 10],
    [ACTIONS.APPROVE, director, {}, 11],
    [ACTIONS.PUBLISH, director, {}, 12]
  ];
  for (const [action, actor, payload, hour] of steps) video = applyAction(video, action, actor, payload, at(hour));
  const table = exportTable([video], "2026-11-20", "2026-11-20");
  const row = table.rows[0];
  assert.equal(row.length, table.columns.length);
  assert.equal(cell(table, row, "拍摄及素材交接时间（北京时间）"), "2026-11-19 11:00:00");
  assert.equal(cell(table, row, "拍摄及素材交接人"), "编导");
  assert.equal(cell(table, row, "已有素材确认时间（北京时间）"), "");
  assert.equal(cell(table, row, "剪辑首次交付时间（北京时间）"), "2026-11-19 12:00:00");
  assert.equal(cell(table, row, "剪辑修改第1次交付时间（北京时间）"), "2026-11-19 14:00:00");
  assert.equal(cell(table, row, "剪辑修改第2次交付时间（北京时间）"), "2026-11-19 17:00:00");
  assert.equal(cell(table, row, "剪辑修改第2次交付人"), "剪辑");
  assert.equal(cell(table, row, "中台初审结果"), "退回修改");
  assert.equal(cell(table, row, "中台初审第2次结果"), "通过");
  assert.equal(cell(table, row, "编导审核第2次结果"), "退回修改");
  assert.equal(cell(table, row, "编导审核第3次时间（北京时间）"), "2026-11-19 19:00:00");
  assert.equal(cell(table, row, "编导审核第3次人"), "编导");
  assert.equal(cell(table, row, "编导审核第3次结果"), "通过");
  assert.equal(cell(table, row, "视频发布时间（北京时间）"), "2026-11-19 20:00:00");
  assert.equal(cell(table, row, "发布确认人"), "编导");
});

test("改期不算节点完成；协助完成记录下发人", () => {
  let video = createTask({ title: "改期", account: "万万", level: "B", publishAt: "2026-11-20", needsShoot: false }, director, templates, at(1));
  video = applyAction(video, ACTIONS.RESCHEDULE, director, { publishAt: "2026-11-21", note: "延期", templates }, at(2));
  const table = exportTable([video], "2026-11-21", "2026-11-21");
  assert.equal(cell(table, table.rows[0], "剪辑认领时间（北京时间）"), "");
  assert.equal(cell(table, table.rows[0], "已有素材确认时间（北京时间）"), "");
  let assist = createAssistanceTask({ requestType: "shooting", account: "万万", serviceDate: "2026-11-20",
    timeSlots: ["09:30-12:30", "12:30-15:30"] }, director, at(1));
  assist = applyAction(assist, ACTIONS.CLAIM, editor, {}, at(2));
  assist = applyAction(assist, ACTIONS.COMPLETE_ASSIST, director, {}, at(4));
  const assistTable = exportTable([assist], "2026-11-20", "2026-11-20");
  const row = assistTable.rows[0];
  assert.equal(cell(assistTable, row, "承接剪辑 / 协助人"), "剪辑");
  assert.equal(cell(assistTable, row, "协助时段"), "09:30-12:30、12:30-15:30");
  assert.equal(cell(assistTable, row, "协助完成时间（北京时间）"), "2026-11-19 12:00:00");
  assert.equal(cell(assistTable, row, "协助完成确认人"), "编导");
});

test("旧任务缺少交付事件时由版本回填，不推断缺失的发布操作人", () => {
  const task = createTask({ title: "旧任务", account: "万万", level: "B", publishAt: "2026-11-20", needsShoot: false }, director, templates, at(1));
  task.versions.push({ submittedAt: at(4).toISOString(), submittedBy: "旧剪辑" });
  task.currentStage = STAGES.PUBLISHED;
  task.completedAt = at(10).toISOString();
  const table = exportTable([task], "2026-11-20", "2026-11-20");
  const row = table.rows[0];
  assert.equal(cell(table, row, "剪辑首次交付时间（北京时间）"), "2026-11-19 12:00:00");
  assert.equal(cell(table, row, "剪辑首次交付人"), "旧剪辑");
  assert.equal(cell(table, row, "视频发布时间（北京时间）"), "2026-11-19 18:00:00");
  assert.equal(cell(table, row, "发布确认人"), "");
});
