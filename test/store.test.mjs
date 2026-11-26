import test from "node:test";
import assert from "node:assert/strict";

import { currentUser, defaultState, loadState } from "../dist/store.js";
import { ACTIONS, applyAction, createAssistanceTask } from "../dist/domain.js";

test("defaultState 为默认成员补齐启用状态和页面权限", () => {
  const state = defaultState();
  assert.ok(state.users.length > 0);
  assert.ok(state.users.every((user) => user.enabled === true));
  assert.ok(state.users.every((user) => user.permissions.includes("todo")));
  assert.deepEqual(state.users.find((user) => user.role === "admin")?.permissions, ["todo", "board", "admin"]);
});

test("currentUser 从动态成员配置读取当前身份", () => {
  const custom = { id: "custom", name: "自定义成员", role: "editor", avatar: "自", enabled: true, permissions: ["board"] };
  assert.equal(currentUser({ users: [custom], currentUserId: custom.id }), custom);
});

test("当前身份停用时回退到其他启用身份", () => {
  const disabled = { id: "disabled", name: "已停用", role: "director", enabled: false, permissions: ["todo"] };
  const active = { id: "active", name: "仍启用", role: "admin", enabled: true, permissions: ["todo", "board", "admin"] };
  assert.equal(currentUser({ users: [disabled, active], currentUserId: disabled.id }), active);
});

test("旧数据中拍摄后待素材任务自动并入剪辑中", () => {
  const state = defaultState();
  state.tasks[0] = { ...state.tasks[0], needsShoot: true, currentStage: "waiting_material", previousStage: "waiting_shoot" };
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify(state) };
  try {
    const loaded = loadState();
    assert.equal(loaded.tasks[0].currentStage, "editing");
    assert.equal(loaded.tasks[0].previousStage, "waiting_shoot");
    assert.equal(loaded.tasks[0].events.at(-1).action, "merge_shoot_material");
    assert.equal(loaded.tasks[0].events.at(-1).toStage, "editing");
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("旧版同日拆开的协助时段在加载时归为一条，保留已认领剪辑", () => {
  const state = defaultState();
  const director = state.users.find((user) => user.role === "director");
  const editor = state.users.find((user) => user.role === "editor");
  const now = new Date("2026-11-26T03:00:00Z");
  const first = createAssistanceTask({ requestType: "acting", account: "丝丝", serviceDate: "2026-12-01", timeSlots: ["09:30-12:30"] }, director, now);
  const second = createAssistanceTask({ requestType: "acting", account: "丝丝", serviceDate: "2026-12-01", timeSlots: ["12:30-15:30"] }, director, now);
  state.tasks = [{ ...applyAction(first, ACTIONS.CLAIM, editor, {}, now), timeSlots: undefined }, { ...second, timeSlots: undefined }];
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify(state) };
  try {
    const loaded = loadState();
    assert.equal(loaded.tasks.length, 1);
    assert.deepEqual(loaded.tasks[0].timeSlots, ["09:30-12:30", "12:30-15:30"]);
    assert.equal(loaded.tasks[0].editorId, editor.id);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});
