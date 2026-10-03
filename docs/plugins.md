# 插件清单

[文档导航](README.md) · [维护指南](maintenance.md)

本仓库的插件分为两类。本文说明归属和职责；社区插件的当前版本只以 [`config/plugins.json`](../config/plugins.json) 为准，其他文档不重复维护版本号。

## 本地维护插件

这些插件从 `packages/` 加载，实际运行源码和稳定版本由本仓库 Git 历史决定。

| 插件 | 作用 | 来源说明 |
| --- | --- | --- |
| Remote SSH | 远端工作区工具、继承 delegate 连接和本地编排 | [`packages/remote-ssh`](../packages/remote-ssh/README.zh-CN.md) |
| UI | 终端编辑区、消息、工具输出、页头、配额和主题 | [`packages/ui/UPSTREAM.md`](../packages/ui/UPSTREAM.md) |
| Advisor | 基于 BCP 处理后上下文的第二模型审核 | [`packages/advisor/UPSTREAM.md`](../packages/advisor/UPSTREAM.md) |
| Memory | BCP 摘要跨会话索引、项目范围、同步和可选混合检索 | [`packages/memory/UPSTREAM.md`](../packages/memory/UPSTREAM.md) |

三个派生插件保留上游许可证和来源记录，但仓库中的源码才是实际运行版本。不要同时安装对应的上游包，避免工具、命令或 UI 补丁重复加载。

## 直接使用的社区插件

这些插件保留上游实现，精确来源和版本只声明在 [`config/plugins.json`](../config/plugins.json)；Pi 的插件安装目录保存实际安装结果。

| 插件 | 作用 | 上游 |
| --- | --- | --- |
| `billion-context-pi`（BCP） | 上下文压缩、恢复、诊断和子代理委托 | [billion-context-pi](https://github.com/ranxianglei/billion-context-pi) |
| `@juicesharp/rpiv-ask-user-question` | 结构化单选、多选和自定义输入 | [rpiv-mono](https://github.com/juicesharp/rpiv-mono) |
| `@juicesharp/rpiv-todo` | 任务列表、状态和依赖管理 | [rpiv-mono](https://github.com/juicesharp/rpiv-mono) |
| `pi-web-access` | 网页搜索、内容抓取和来源核查 | [pi-web-access](https://github.com/nicobailon/pi-web-access) |
| `@schovest/pi-goal` | 有边界的会话目标和完成/阻塞报告 | [pi-package-mono](https://github.com/schovest/pi-package-mono) |
| `pi-invisible-continue` | 自动续跑提示 | [pi-invisible-continue](https://github.com/monotykamary/pi-invisible-continue) |

## 更新方式

一次更新一个完整的配置批次，不在运行目录里直接替换单个包：

1. 阅读上游发布说明，决定要采用的社区版本。
2. 只修改 `config/plugins.json` 中对应的版本，并在需要时刷新依赖锁。
3. 本地派生插件需要人工合并上游改动，同时更新对应的 `UPSTREAM.md`。
4. 运行 `bun run check`；如果涉及 BCP、Memory、Advisor 或 Remote SSH，执行相应的兼容性和 worker 验证。
5. 运行 `bun run setup --apply`，再用相同的 agent 目录执行 `pi update --extensions`，最后重启 Pi。

社区插件的固定版本不会自动更新。`setup --apply` 会在用户的 `acp.json` 中关闭 BCP 官方 `autoUpdate`，并保留其他 ACP 配置。`ACP_AUTO_UPDATE=0` 只作为临时诊断覆盖，不作为日常启动命令的一部分。

项目不再维护第二份策略文件或重复的版本表：社区包的版本看 `config/plugins.json`，本地派生源码看 Git 和各自的 `UPSTREAM.md`。
