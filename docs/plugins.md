# 插件清单

以当前个人环境为起点。可执行的版本清单在 [`config/plugins.json`](../config/plugins.json)，不是复制来的第三方源码目录；UI 定制、Advisor 的 BCP 适配与 Memory 增强是源码例外。

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

[`packages/memory`](../packages/memory/UPSTREAM.md) 从 `pi-billion-memory@0.5.3` / `52e5a01` 导入，保留 MIT 来源。自有增强为远端 Embedding、SQLite float32 向量、余弦 + RRF 混合检索和显式补建；保留原数据库与关键词回退。根 manifest 加载，setup 替换原外部 Git 包。公开默认不联网，启用后查询会发往配置的服务商；摘要经 `/memory` 菜单确认后分批上传，或由本地明确开启的 `autoBackfill` 自动增量上传；来源、块及修订校验统一适用于搜索、展开和上传。

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

- 自研插件：新增 `packages/<name>/`，写源码与测试，在根 Pi manifest 声明构建后的入口；需要构建时加入根构建命令。
- UI 定制：修改 `packages/ui`，保留许可证和 `UPSTREAM.md`，运行静态检查并做终端交互验证；上游升级需人工审阅合并，不能靠 `pi update` 覆盖。
- Advisor 适配：修改 `packages/advisor`，保留来源与许可证，运行含真实 BCP 压缩的回归测试；不自动覆盖上游源码。
- Memory 增强：修改 `packages/memory`，保留来源与数据库兼容；用 Node 运行上游和混合检索测试，不用 Bun 的 `node:sqlite` 替代。
- 其他第三方插件：只更改 `config/plugins.json`，记录上游来源、版本和必要配置说明。
- skills / prompts / themes：自己的内容放到对应资源目录；第三方内容继续通过包引用加载。
- 修改后运行 `bun run check`，预览 `bun run setup` 再应用，使用 `pi update --extensions` 校准安装。
- 升级 Pi / BCP 必须同步适配版本约束并重建 worker、运行 smoke；不要只更新依赖清单。
