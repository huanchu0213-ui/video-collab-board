# 达人视频协作看板

面向编导、剪辑与中台审核人的独立可运行版本。当前实现以浏览器本地数据作为演示存储，完整覆盖任务状态机、角色待办、团队看板、倒排模板、提醒判定和旧数据映射。

## 本地运行

```bash
cd /Users/osaka/Documents/女团/video-collab-board
python3 -m http.server 4173 --directory dist
```

打开 `http://127.0.0.1:4173`。页面右下身份区在演示环境支持切换角色；生产环境应由飞书 SSO 注入身份。

## 已实现

- 四项快速提需，按已确认等级模板自动生成节点时间。
- “我的待办”和九列团队看板，支持角色、等级、风险和关键词筛选。
- 专用状态动作：认领、拍摄完成、素材就绪、提交成片、初审、终审、修改和发布。
- S/A 自动进入中台初审，B/C 自动跳过；已有素材任务跳过拍摄。
- 成片版本保留、审核意见时间轴、暂停、恢复、取消、改期和转交。
- 临期、到期、超期升级、每日汇总判定与提醒去重。
- 历史已发布任务只读归档，进行中任务按现有字段映射。
- 电脑完整操作和手机快捷操作布局。

## 生产接入边界

当前工作区没有原生产看板源码、数据库结构或飞书应用凭据，因此以下适配器已留出接口，但未伪造线上连接：

1. **飞书身份**：服务端完成 OAuth/SSO 后，在页面加载前注入：

   ```js
   window.__VIDEO_BOARD_CONFIG__ = {
     currentUser: { id: "ou_xxx", name: "用户姓名", role: "director" }
   };
   ```

2. **提醒服务**：配置 `reminderEndpoint`，接收 `{ reminders: ReminderRecord[] }`。服务端负责飞书卡片消息、私聊/群聊路由和发送结果回写。
3. **持久化与并发**：生产环境必须把 `localStorage` 替换为服务端数据库；认领接口使用事务或版本号条件更新，保证多人认领只有一人成功。
4. **附件**：当前保存链接；生产环境建议接飞书云盘链接或对象存储，不在浏览器中直接保存大视频。

## 推荐服务端动作接口

不要提供通用的 `PATCH status`。按业务动作提供幂等接口：

- `POST /api/tasks`
- `POST /api/tasks/:id/claim`
- `POST /api/tasks/:id/shoot-complete`
- `POST /api/tasks/:id/material-ready`
- `POST /api/tasks/:id/cuts`
- `POST /api/tasks/:id/reviews`
- `POST /api/tasks/:id/publish`
- `POST /api/tasks/:id/pause|resume|cancel|reschedule|transfer`

每次请求携带任务版本号，成功时在同一事务内写入任务状态、节点完成时间与 `TaskEvent`。

## 测试

```bash
npm test
npm run check
```

测试覆盖流程分支、版本保留、暂停恢复、提醒去重、超期升级和历史归档。
