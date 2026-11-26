import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, STAGES, applyAction, createAssistanceTask, createTask } from "../dist/domain.js";
import { EXPORT_COLUMNS, exportCsv, exportRows } from "../dist/export.js";

const director = { id: "d", name: "编导", role: "director" };
const editor = { id: "e", name: "剪辑", role: "editor" };
const template = [{ level: "B", name: "B级视频", enabled: true, confirmed: true, includeInitialReview: false,
  intervals: { waiting_material: 2, editing: 3, director_review: 2, ready_publish: 2 } }];
const createdAt = new Date("2026-11-19T01:00:00Z");

test("按计划发布日期和协助服务日期筛选，导出每个节点的历史截止与负责人", () => {
  let video = createTask({ title: "=风险选题", account: "万万", level: "B", publishAt: "2026-11-20", needsShoot: false }, director, template, createdAt);
  video = applyAction(video, ACTIONS.CLAIM, editor, {}, new Date("2026-11-19T02:00:00Z"));
  video = applyAction(video, ACTIONS.MATERIAL_READY, director, { materialMethod: "飞书" }, new Date("2026-11-19T05:00:00Z"));
  const assist = createAssistanceTask({ requestType: "acting", account: "万万", serviceDate: "2026-11-20", timeSlots: ["09:30-12:30"] }, director, createdAt);
  const rows = exportRows([video, assist], "2026-11-20", "2026-11-20");
  assert.ok(rows.every((row) => row.length === EXPORT_COLUMNS.length));
  assert.equal(new Set(rows.map((row) => row[1])).size, 2);
  const handoff = rows.find((row) => row[1] === video.code && row[15] === "确认素材就绪");
  assert.equal(handoff[10], "待素材");
  assert.equal(handoff[11], "编导");
  assert.equal(handoff[12], "2026-11-19T04:00:00.000Z");
  assert.equal(handoff[13], "2026-11-19T05:00:00.000Z");
  assert.equal(handoff[17], "1.00");
  assert.ok(rows.some((row) => row[1] === assist.code && row[6] === "09:30-12:30" && row[10] === "待认领"));
  const { csv, count } = exportCsv([video, assist], "2026-11-20", "2026-11-20");
  assert.equal(count, 2);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=风险选题"'));
  assert.ok(csv.includes(EXPORT_COLUMNS[12]));
  assert.deepEqual(exportRows([video], "2026-11-21", "2026-11-22"), []);
  assert.throws(() => exportRows([video], "2026-11-22", "2026-11-20"), /结束日期/);
});

test("改期操作不会被导出为节点完成时间", () => {
  let video = createTask({ title: "改期", account: "万万", level: "B", publishAt: "2026-11-20", needsShoot: false }, director, template, createdAt);
  video = applyAction(video, ACTIONS.RESCHEDULE, director, { publishAt: "2026-11-21", note: "拍摄延期", templates: template }, new Date("2026-11-19T02:00:00Z"));
  const row = exportRows([video], "2026-11-21", "2026-11-21").find((item) => item[15] === "调整发布时间");
  assert.equal(row[13], "");
  assert.equal(row[18], "2026-11-19T02:00:00.000Z");
});

test("协助完成导出下发人作为节点负责人，保留承接剪辑", () => {
  let assist = createAssistanceTask({ requestType: "shooting", account: "万万", serviceDate: "2026-11-20", timeSlots: ["09:30-12:30"] }, director, createdAt);
  assist = applyAction(assist, ACTIONS.CLAIM, editor, {}, createdAt);
  assist = applyAction(assist, ACTIONS.COMPLETE_ASSIST, director, {}, new Date("2026-11-20T04:00:00Z"));
  const row = exportRows([assist], "2026-11-20", "2026-11-20").find((item) => item[15] === "确认协助完成");
  assert.equal(row[8], editor.name);
  assert.equal(row[11], director.name);
  assert.equal(row[14], director.name);
  assert.equal(row[19], "需求下发人");
});
