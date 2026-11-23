import test from "node:test";
import assert from "node:assert/strict";

import { currentUser, defaultState } from "../dist/store.js";

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
