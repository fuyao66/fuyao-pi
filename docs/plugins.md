# 插件清单

[文档导航](README.md) · [维护指南](maintenance.md)

本仓库的插件分为两类。本文说明归属和职责；社区插件的当前版本只以 [`config/plugins.json`](../config/plugins.json) 为准，其他文档不重复维护版本号。

## 本地维护插件

这些插件从 `packages/` 加载，实际运行源码和稳定版本由本仓库 Git 历史决定。

| 插件 | 作用 | 来源说明 |
| --- | --- | --- |
| Remote SSH | 远端工作区工具、继承 delegate 连接和本地编排 | [`packages/remote-ssh`](../packages/remote-ssh/README.zh-CN.md) |
| Advisor（禁用） | 保留历史审核派生源码，暂不认证 BC 代理兼容性 | [`packages/advisor/UPSTREAM.md`](../packages/advisor/UPSTREAM.md) |
| Billion Memory | BC 与授权迁移摘要的跨会话索引、工作区证据、同步和可选混合检索 | [`packages/bili-memory/UPSTREAM.md`](../packages/bili-memory/UPSTREAM.md) |
| Statusline | 原生底栏、累计缓存率、自适应换行 | [`packages/statusline/UPSTREAM.md`](../packages/statusline/UPSTREAM.md) |
| GPT Fast | 按用户模型名单切换 priority 请求字段 | [`packages/gpt-fast-mode/UPSTREAM.md`](../packages/gpt-fast-mode/UPSTREAM.md) |

派生插件保留上游许可证和来源记录，但仓库中的源码才是实际运行版本。不要同时安装对应的上游包，避免工具或命令重复加载。外观使用 Pi 原生主题系统和设置，支持独立配色文件，底栏由独立 Statusline 提供，不修改编辑器或消息组件。

## 直接使用的社区插件

这些插件保留上游实现，精确来源和版本只声明在 [`config/plugins.json`](../config/plugins.json)；Pi 的插件安装目录保存实际安装结果。

| 插件 | 作用 | 上游 |
| --- | --- | --- |
| `billion-context`（BC） | Pi 原生入口 + 本地代理，负责上下文压缩、恢复、诊断和委托 | [billion-context](https://github.com/ranxianglei/billion-context) |
| `@juicesharp/rpiv-ask-user-question` | 结构化单选、多选和自定义输入 | [rpiv-mono](https://github.com/juicesharp/rpiv-mono) |
| `@juicesharp/rpiv-todo` | 任务列表、状态和依赖管理 | [rpiv-mono](https://github.com/juicesharp/rpiv-mono) |
| `pi-web-access` | 网页搜索、内容抓取和来源核查 | [pi-web-access](https://github.com/nicobailon/pi-web-access) |
| `@narumitw/pi-goal` | 有边界的会话目标和完成/阻塞报告 | [pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal) |
| `pi-invisible-continue` | 自动续跑提示 | [pi-invisible-continue](https://github.com/monotykamary/pi-invisible-continue) |

## Goal

Goal 是会话级单目标，不跨会话共享。恢复目标用 `/goal resume`，
`/continue` 不是它的恢复入口。不要同时加载 Schovest 和 Narumitw 两个 Goal；
setup 会替换旧包声明，保留已有显式资源过滤。Goal 控制与状态留在本地 Pi，
Remote SSH 只路由工作区工具；普通委托不会因为继承 SSH 就继承父会话目标。
默认自动响应与无进展保护保持启用，不默认开放扩展间 RPC。

## 更新方式

一次更新一个完整的配置批次，不在运行目录里直接替换单个包：

1. 阅读上游发布说明，决定要采用的社区版本。
2. 只修改 `config/plugins.json` 中对应的版本，并在需要时刷新依赖锁。
3. 本地派生插件需要人工合并上游改动，同时更新对应的 `UPSTREAM.md`。
4. 运行 `bun run check`；如果涉及 BC、Billion Memory 或 Remote SSH，执行相应的兼容性和 worker 验证。
5. 运行 `bun run setup --apply`，再用相同的 agent 目录对改动的固定条目执行 `pi install <source>`，最后重启 Pi。

社区插件通常固定版本。BC 另有自身更新策略：`setup --apply` 在其 `billion-context.json` 中设置 `autoUpdate: false`、`advisoryCheck: true`，保留其他字段。普通升级须审查，严重缺陷自动修复保留，可能改变实际版本，故仍需核对运行代理与磁盘安装。`ACP_AUTO_UPDATE` / `BILI_ADVISORY_CHECK` 环境覆盖优先于文件，不作为日常启动命令的一部分。当前验收见[迁移记录](billion-context-migration.md)。

项目不再维护第二份策略文件或重复的版本表：社区包的版本看 `config/plugins.json`，本地派生源码看 Git 和各自的 `UPSTREAM.md`。
