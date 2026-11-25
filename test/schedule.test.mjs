import test from "node:test";
import assert from "node:assert/strict";
import { mondayOf, shiftDate, weekSlices } from "../dist/schedule.js";
import { ACTIONS, STAGES } from "../dist/domain.js";

test("自然周从周一到周日，跨年仍按北京时间归周", () => {
  assert.equal(mondayOf("2026-11-25"), "2026-11-23");
  assert.equal(mondayOf("2027-01-03"), "2026-12-28");
  assert.equal(shiftDate("2026-12-28", 6), "2027-01-03");
});

test("周切片按排期和实际事件分别统计，交付同一任务只计一次", () => {
  const task = {
    id: "one", needsShoot: true, currentStage: STAGES.PUBLISHED,
    deadlines: { [STAGES.WAITING_SHOOT]: "2026-11-22T17:00:00.000Z" },
    publishAt: "2026-11-29T15:59:00.000Z", completedAt: "2026-11-30T01:00:00.000Z",
    versions: [{ submittedAt: "2026-11-25T08:00:00.000Z" }],
    events: [{ action: ACTIONS.SUBMIT_CUT, at: "2026-11-25T08:00:00.000Z" }]
  };
  const [first, second] = weekSlices([task], "2026-11-23", 2);
  assert.equal(first.shooting.length, 1);
  assert.equal(first.delivered.length, 1);
  assert.equal(first.plannedPublish.length, 1);
  assert.equal(first.published.length, 0);
  assert.equal(second.published.length, 1);
});
