import test from "node:test";
import assert from "node:assert/strict";
import { WEEK_GROUPS, mondayOf, shiftDate, weekSlices } from "../dist/schedule.js";
import { ACTIONS, STAGES } from "../dist/domain.js";

test("自然周从周一到周日，跨年仍按北京时间归周", () => {
  assert.equal(mondayOf("2026-11-25"), "2026-11-23");
  assert.equal(mondayOf("2027-01-03"), "2026-12-28");
  assert.equal(shiftDate("2026-12-28", 6), "2027-01-03");
});

test("同周经历拍摄、交付和发布的任务只出现一次", () => {
  const task = {
    id: "one", needsShoot: true, currentStage: STAGES.PUBLISHED,
    deadlines: { [STAGES.WAITING_SHOOT]: "2026-11-22T17:00:00.000Z" },
    publishAt: "2026-11-29T15:59:00.000Z", completedAt: "2026-11-30T01:00:00.000Z",
    versions: [{ submittedAt: "2026-11-25T08:00:00.000Z" }],
    events: [{ action: ACTIONS.SUBMIT_CUT, at: "2026-11-25T08:00:00.000Z" }]
  };
  const [first, second] = weekSlices([task], "2026-11-23", 2);
  assert.equal(first.tasks.length, 1);
  assert.deepEqual(first.groups.published.map((item) => item.id), ["one"]);
  assert.equal(WEEK_GROUPS.reduce((total, { key }) => total + first.groups[key].length, 0), 1);
  assert.equal(second.tasks.length, 0);
});

test("周内按当前环节互斥分组，含暂停与取消任务", () => {
  const stages = [STAGES.WAITING_CLAIM, STAGES.WAITING_SHOOT, STAGES.EDITING, STAGES.INITIAL_REVIEW, STAGES.PUBLISHED, STAGES.PAUSED, STAGES.CANCELLED];
  const tasks = stages.map((currentStage, index) => ({ id: `task_${index}`, currentStage, publishAt: "2026-11-25T15:59:00.000Z" }));
  const [week] = weekSlices(tasks, "2026-11-23", 1);
  assert.equal(week.tasks.length, tasks.length);
  assert.deepEqual(WEEK_GROUPS.map(({ key }) => week.groups[key].length), [1, 1, 1, 1, 0, 0, 1, 2]);
  assert.equal(new Set(WEEK_GROUPS.flatMap(({ key }) => week.groups[key].map((task) => task.id))).size, tasks.length);
});

test("协助需求按服务日期归周，并按当前状态只归入一个分组", () => {
  const tasks = [
    { id: "assist_1", requestType: "shooting", serviceDate: "2026-11-26", currentStage: STAGES.ASSISTING, publishAt: "2026-11-26T10:30:00Z" },
    { id: "assist_2", requestType: "acting", serviceDate: "2026-11-26", currentStage: STAGES.ASSIST_DONE, publishAt: "2026-11-26T10:30:00Z" }
  ];
  const [week] = weekSlices(tasks, "2026-11-23", 1);
  assert.equal(week.tasks.length, 2);
  assert.deepEqual(week.groups.assisting.map((item) => item.id), ["assist_1"]);
  assert.deepEqual(week.groups.assist_done.map((item) => item.id), ["assist_2"]);
});
