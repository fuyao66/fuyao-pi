# 插件清单

[文档导航](README.md) · [维护指南](maintenance.md)

共 **10 个插件包**：1 个自研、3 个本地改装、6 个直接引用的社区包。Pi core 是运行时；根 `fuyao-pi` 注册个人资源，不额外计为插件。UI 内含五个扩展入口和一个主题，按一个插件包计数。

## 自研插件

| 插件 / 包名 | 本地版本 | 作用 | 加载位置 |
| --- | --- | --- | --- |
| Remote SSH / `pi-ssh-remote` | 0.2.0 | 将 read、write、edit、bash、grep、find、ls 工作区工具放到远端执行；支持子代理继承连接，断连时禁止误回落本地 | [`packages/remote-ssh`](../packages/remote-ssh/README.md) |

控制命令为 `/remote-connect`、`/remote-status`、`/remote-exit`。模型、会话和 BCP 控制面留在本地，远端运行无模型 worker。此包是本仓库 private workspace，不从 npm 安装。

## 本地改装的社区插件

| 本地插件 | 社区来源 / 导入版本 | 本地包与版本 | 作用与改装重点 |
| --- | --- | --- | --- |
| UI | [beautifulrem/pi-sakura-cyberdeck](https://github.com/beautifulrem/pi-sakura-cyberdeck)，**1.1.5** | `pi-sakura-cyberdeck@1.1.5`（保留上游标识） | 编辑区、消息、工具输出、页头、配额和主题；源码在本仓库维护，供个人界面定制 |
| Advisor | [juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor)，**@juicesharp/rpiv-advisor@2.11.0** | `@fuyao/pi-advisor@2.11.0-fuyao.1` | `/advisor` 选择审核模型；使用 BCP 处理后的上下文快照，避免把压缩原文重新发给审核模型；审核模型没有工具 |
| Memory | [tjp72/pi-billion-memory](https://github.com/tjp72/pi-billion-memory)，**pi-billion-memory@0.5.3** | `@fuyao/pi-memory@0.5.3-fuyao.1` | `/memory` 管理跨会话摘要；增加压缩后同步、修订一致性、工作区隔离、统一来源政策、可选自动 Embedding 与关键词/向量混合检索 |

导入依据与许可证记录：

- [UI 来源](../packages/ui/UPSTREAM.md)：提交 `16c065c48d2450cd4934b2068784be4b788bbca2`。保留原包名/版本是为了配置兼容，不表示当前代码与原版一致，也不向 npm 发布同名包。
- [Advisor 来源](../packages/advisor/UPSTREAM.md)：npm 2.11.0，gitHead `61904e69e1a50e12585bdf15f0310e633a62ba36`。
- [Memory 来源](../packages/memory/UPSTREAM.md)：提交 `52e5a01c62df4d40421b93da4528c9e969061c46`。

三个派生包保留上游许可证与归属，由本仓库维护改动，不随上游自动覆盖。它们及 Remote SSH 均通过根目录的 clone/build/setup 流程加载，setup 将四个子包分别注册，供 `pi list` 展示。**不要同时安装对应社区原版**，避免工具、命令或 UI 补丁重名。

UI 五个入口分别负责 header、matrix 动画、zentui 编辑区与消息、dual-quota 配额展示、claude-shimmer 状态视觉反馈；主题为 sakura-macaron。

Advisor 咨询单独计费，必须单独调用。Memory 公开默认不联网；启用 Embedding 后会向配置的服务商发送处理后的摘要前缀和查询，脱敏不是绝对隐私保证。详细限制见各插件文档。

## 可直接安装的社区插件

版本以 [`config/plugins.json`](../config/plugins.json) 的当前配置为准。以下包使用上游实现，未复制进本仓库；版本记录不是要求所有人永久停留在这些版本，升级仍需验证兼容性。

| 插件 | 当前配置版本 | 作用 | 上游 |
| --- | --- | --- | --- |
| `billion-context-pi`（BCP） | 0.1.82 | 压缩与恢复上下文、使用量诊断、子代理委托 | [billion-context-pi](https://github.com/ranxianglei/billion-context-pi) |
| `@juicesharp/rpiv-ask-user-question` | 2.11.0 | 结构化提问、单选/多选、自定义回答 | [rpiv-mono](https://github.com/juicesharp/rpiv-mono) |
| `@juicesharp/rpiv-todo` | 2.11.0 | 创建和更新任务、跟踪状态与依赖 | [rpiv-mono](https://github.com/juicesharp/rpiv-mono) |
| `pi-web-access` | 0.33.0 | 多服务商网页搜索、内容抓取、来源核查 | [pi-web-access](https://github.com/nicobailon/pi-web-access) |
| `@schovest/pi-goal` | 0.2.0 | 设置会话目标，受轮数等限制的自动推进，报告完成/阻塞 | [pi-package-mono](https://github.com/schovest/pi-package-mono) |
| `pi-invisible-continue` | 0.3.13 | 自动续跑提示，减少手动要求继续；不是目标或任务管理器 | [pi-invisible-continue](https://github.com/monotykamary/pi-invisible-continue) |

如只想独立使用这些社区插件，可按需安装（使用整套 fuyao-pi setup 流程时不必重复执行）：

```sh
pi install npm:billion-context-pi@0.1.82
pi install npm:@juicesharp/rpiv-ask-user-question@2.11.0
pi install npm:@juicesharp/rpiv-todo@2.11.0
pi install npm:pi-web-access@0.33.0
pi install npm:@schovest/pi-goal@0.2.0
pi install npm:pi-invisible-continue@0.3.13
```

外部模型、联网服务和插件私密配置需另行配置，不随仓库提供。这些插件在本地 Pi 加载，不会自动安装进远端 worker，也不保证所有插件均理解 SSH 工作区。

## 添加与升级

参见[维护指南](maintenance.md)。社区版本更新在 `config/plugins.json` 管理；派生源码升级需对照各 `UPSTREAM.md` 人工合并，保留本地兼容性改动并运行相应测试。
