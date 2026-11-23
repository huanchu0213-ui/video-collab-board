const assetVersion = new URL(import.meta.url).searchParams.get("v");
const assetSuffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : "";
const { USERS } = await import(`./store.js${assetSuffix}`);

export function createIdentityAdapter(state) {
  const external = globalThis.__VIDEO_BOARD_CONFIG__?.currentUser;
  if (external?.id && external?.name && external?.role) {
    return { mode: "feishu", user: external, users: [external], canSwitch: false };
  }
  return {
    mode: "demo",
    user: USERS.find((item) => item.id === state.currentUserId) || USERS[0],
    users: USERS,
    canSwitch: true
  };
}

export function createReminderAdapter() {
  const endpoint = globalThis.__VIDEO_BOARD_CONFIG__?.reminderEndpoint;
  return {
    mode: endpoint ? "api" : "preview",
    async send(records) {
      if (!endpoint) return records.map((record) => ({ ...record, status: "previewed" }));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reminders: records })
      });
      if (!response.ok) throw new Error(`提醒服务返回 ${response.status}`);
      return response.json();
    }
  };
}

export const integrationContract = Object.freeze({
  identity: "window.__VIDEO_BOARD_CONFIG__.currentUser = { id, name, role }",
  reminder: "POST reminderEndpoint { reminders: ReminderRecord[] }",
  persistence: "生产环境应将任务操作改为带版本号的服务端事务接口"
});
