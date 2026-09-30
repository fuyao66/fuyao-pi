# 插件归属与版本清单

[文档导航](README.md) · [系统架构](architecture.md) · [维护指南](maintenance.md)

这些能力共同组成 fuyao-pi，不存在以 SSH 为主体、其余插件为附件的层级关系。按维护责任区分为：自研源码、本地维护的派生源码、固定版本的上游引用。上游 Pi core 0.87.1 是底座，不计作本仓库自研插件。

配套插件的可执行版本清单是 [`config/plugins.json`](../config/plugins.json)；本地扩展入口由根 [`package.json`](../package.json) 声明。UI、Advisor 和 Memory 的派生源码是为了实际定制/适配而维护，不是复制上游插件合集。

## 自研

| 插件 | 源码 | 职责 |
| --- | --- | --- |
| remote-ssh | [`packages/remote-ssh`](../packages/remote-ssh) | Pi 核心工作区工具远端执行、BCP delegate 连接继承、本地/远端边界 |

`remote-ssh` 目录内保留包名 `pi-ssh-remote`，避免把仓库重命名与包身份、运行时 Symbol、部署缓存命名混为一谈。当前为 private 包，没有自动发布 npm。

## 本地维护的 UI 派生源码

[`packages/ui`](../packages/ui/UPSTREAM.md) 从 `beautifulrem/pi-sakura-cyberdeck` 1.1.5 / `16c065c` 导入，保留原始许可证和上游署名，供个人 UI 定制。根 Pi manifest 加载五个扩展和 sakura-macaron 主题，不再声明外部 Sakura 包。它不是自研原创，源码由本仓库维护。

## 本地维护的 Advisor 派生源码

[`packages/advisor`](../packages/advisor/UPSTREAM.md) 从 `@juicesharp/rpiv-advisor@2.11.0` 导入，保留 MIT 许可证。使用 Pi `context_with_system` 捕获 BCP 处理后的上下文，不从原始日志重建；拒绝与其他工具混合调用，避免压缩并发造成旧快照泄漏。根 manifest 加载入口，setup 替换上游 npm 包声明。运行 `/advisor` 选择模型；本地配置仍在 `~/.config/rpiv-advisor/advisor.json`，不入库。

## BCP 增强记忆派生源码

[`packages/memory`](../packages/memory/UPSTREAM.md) 从 `pi-billion-memory@0.5.3` / `52e5a01` 导入，保留 MIT 来源。本地增强包括压缩后增量同步、修订一致性、保守工作区归属、统一来源策略，以及可选 Embedding、SQLite float32 向量和余弦 + RRF 混合检索；保留原数据库路径与关键词回退。根 manifest 加载，setup 替换原外部 Git 包。公开默认不联网，启用后查询会发往配置的服务商；摘要经 `/memory` 菜单确认后分批上传，或由本地明确开启的 `autoBackfill` 自动增量上传；来源、块及修订校验统一适用于搜索、展开和上传。

## 第三方引用

| 插件 | 固定版本 | 用途 / 上游 |
| --- | --- | --- |
| billion-context-pi | 0.1.82 | [上下文管理与 delegate](https://github.com/ranxianglei/billion-context-pi) |
| @juicesharp/rpiv-ask-user-question | 2.11.0 | [交互提问](https://github.com/juicesharp/rpiv-mono) |
| @juicesharp/rpiv-todo | 2.11.0 | [任务列表](https://github.com/juicesharp/rpiv-mono) |
| pi-web-access | 0.33.0 | [联网检索与抓取](https://github.com/nicobailon/pi-web-access) |
| @schovest/pi-goal | 0.2.0 | [目标管理](https://github.com/schovest/pi-package-mono) |
| pi-invisible-continue | 0.3.13 | [自动续跑](https://github.com/monotykamary/pi-invisible-continue) |

Git 源固定完整提交，npm 源固定已安装版本。版本固定不是安全审计，也不是整套 SSH 兼容性证明。BCP 与 RPIV 的已验证边界见 remote-ssh 文档；其他插件按各自上游行为在本地加载，不往 worker 注入代码。

## 添加与升级

流程集中在[维护指南](maintenance.md)，避免每个页面复制一套步骤。核心原则：可直接使用的第三方功能优先引用；必要派生源码保留归属；本地扩展加入根 manifest；升级 Pi/BCP 要同时验证上下文、记忆和远端桥接边界。根包与上游/独立子包不要重复加载。
