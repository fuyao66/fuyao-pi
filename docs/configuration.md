# 配置、安装与迁移

[文档导航](README.md) · [系统架构](architecture.md) · [维护指南](maintenance.md)

快速开始见[根 README](../README.zh-CN.md)。

## 安装产物与步骤

| 步骤 | 实际作用 |
| --- | --- |
| 安装固定版本 Pi CLI | 安装上游 `pi` 命令 |
| `bun install --frozen-lockfile` | 安装本仓库工作区依赖 |
| `bun run check` | 类型检查、构建本地 SSH 扩展与测试；不编译远端 worker |
| `bun run setup` / `--apply` | 预览或备份合并 Pi 包声明和公开默认值 |
| `pi install <清单中的固定来源>` | 安装/校准配套上游扩展，不更新本地派生源码 |
| `bun run build:pi-worker:all` | 首次 SSH 使用前生成 Linux x64/arm64 worker |
| `bun run smoke:pi` | 验证进程替身下的 SSH 桥接；不是真实 SSH 连接 |
| 重启 `pi` | 加载已验证版本的新扩展/配置；setup 已关闭 BCP 自动更新 |

模型认证另行在本地 Pi 配置。所有根命令从仓库根目录执行。

## 配置分层

1. `config/settings.json`：公开的个人默认偏好，不包含私有模型/provider。
2. `config/plugins.json`：第三方包来源与版本；setup 分别注册 `packages/remote-ssh`、`packages/advisor`、`packages/memory` 、`packages/statusline` 和 `packages/gpt-fast-mode`；`themes/fuyao-soft.json` 作为独立主题资源加载，根包不加载扩展。
3. `~/.pi/agent/settings.json`：实际运行配置。setup **只填补缺失的顶层默认项**，不会强制重置已有偏好；受管理插件替换为固定版本，保留第三方包对象的资源过滤字段。旧的外部 Sakura 和本地 UI 包声明会移除，已移除的 `sakura-macaron` 主题迁移为独立的 `fuyao-soft` 配色；旧的 `npm:@juicesharp/rpiv-advisor` 和独立 `packages/advisor` 包声明也会被仓库内 Advisor 替代；上游 `pi-billion-memory` Git/npm 及独立 Memory 包声明由 `packages/memory` 替代。明确指向当前或同级旧仓库 `packages/ui/` 的直接扩展/主题路径也会移除；其他手动旧入口需自行检查。其余插件保持原样。
4. `~/.pi/acp.json`：BCP 的用户级配置。`setup --apply` 将 `autoUpdate` 设为 `false`，保留其他 ACP 设置并为已有文件备份。
5. 模型、密钥和插件私密配置：继续留在本地，不导出到本仓库。

必须执行 setup 并让 Pi 校准依赖。加载顺序为 BCP → 本地 Remote SSH / Advisor / Memory / Statusline / GPT Fast → 其他 companion 包。

从旧整包加载迁移时，setup 将根条目的资源过滤规则转换到子包，保留已禁用的扩展。空的根资源包条目会移除；之后可用 `pi config` 分别管理子包。`pi list` 的 `(filtered)` 表示存在资源筛选，不是错误。

## 主题

`themes/fuyao-soft.json` 是独立的深色配色，不包含扩展代码、布局或按键补丁。
setup 注册主题资源；在 `/settings` 中选择 `fuyao-soft`，也可使用 Pi 内置的
`system`、`dark`、`light`。主题只改变颜色，不改变整个终端的默认背景。
修改仓库中的主题后运行 `/reload`。已有自选主题和 `tuiMode` 均保留，只有已移除的
`sakura-macaron` 会迁移。将文件复制到 `<agent-dir>/themes/fuyao-soft.json` 后可直接
使用原生热更新，但不要同时注册两份同名主题。

## Statusline

setup 将上游 `npm:@narumitw/pi-statusline` 替换为本地派生包，避免重复加载。
`<agent-dir>/pi-statusline.json` 和 `/statusline` 配置入口保留；现有配色和字段顺序不变。
上下文显示百分比与已用/窗口，缓存显示会话累计加权命中率；窄屏优先两行，极窄时
允许更多行而不是删字段。数据口径和边界见 [Statusline](../packages/statusline/README.md)。

## GPT Fast

本地 `packages/gpt-fast-mode` 提供 `/fast`，默认关闭，只对用户 CPA GPT 名单添加
`service_tier: "priority"`。不替换 provider，也不探测上游。名单可在
`<agent-dir>/settings.json` 的 `pi-gpt-fast-mode.models` 中明确替换；详情见
[GPT Fast](../packages/gpt-fast-mode/README.md)。不要同时加载其他 `/fast` 插件。

## Memory 本地配置

原 `~/.pi/pi-billion-memory.json`、允许列表与数据库保持兼容。新的 `~/.pi/fuyao-memory-embedding.json` 只在本地配置，公开默认关闭。服务地址与密钥文件不入库，setup 不读取或迁移这些私密配置。开启后有向量的搜索发送脱敏查询，历史摘要由 `/memory` 菜单确认上传，或由本地明确开启的 `autoBackfill` 自动补建；详见 [Memory 配置](../packages/memory/README.md)。

## setup 行为

```sh
bun run setup                             # 只预览受管理来源，不打印私有设置
bun run setup --apply                     # 备份、合并、原子写入
bun run setup --agent-dir /tmp/pi-profile # 预览另一个配置目录
```

`--apply` 要求已构建 `packages/remote-ssh/dist/pi-extension.js`。settings 与备份权限为 `0600`。没有变化时不重复写入或生成备份。不会安装插件、调用模型、修改 shell profile，也不会读取 auth/models/web-search 文件。

备份路径形如 `settings.json.bak-fuyao-pi-<uuid>`，位于目标 agent 目录。回滚时退出 Pi，将对应备份复制回 `settings.json`，再重启。新配置目录没有旧文件时不生成备份。

应用声明后，对更改的清单条目运行 `pi install <固定来源>`；新环境可用根 README 的循环安装整份清单。`pi update --extensions` 会跳过精确锁定的 npm 包，不能用于落实改过的版本号。安装后核对实际版本。若使用自定义 agent 目录，安装与启动 Pi 时均设置同一个 `PI_CODING_AGENT_DIR`。`setup --apply` 同时关闭 BCP 的官方自动更新；第三方包可能带安装脚本与可执行扩展，先审核上游再加载。

## 历史迁移：从 SSH 插件仓库到环境仓库

以下仅供旧安装迁移；新用户无需经历这些旧目录。仓库职责已改变，但子包的协议身份不因此变化。

| 原位置 | 新位置 |
| --- | --- |
| GitHub `fuyao66/pi-ssh-remote` | `fuyao66/fuyao-pi` |
| `src/` | `packages/remote-ssh/src/` |
| `test/`（SSH 测试） | `packages/remote-ssh/test/` |
| `scripts/`（SSH 构建与验证） | `packages/remote-ssh/scripts/` |
| `packages/pi/dist/` | `packages/remote-ssh/dist/` |
| 根 SSH README | `packages/remote-ssh/README*.md` |
| 外部 Sakura / 本地 UI 包 | 不再加载；外观通过原生主题与设置调整 |
| 外部 RPIV Advisor | `packages/advisor/`（BCP 兼容派生版本） |
| 外部 pi-billion-memory | `packages/memory/`（记忆增强；旧数据库路径保留） |

根命令 `build:pi`、`build:pi-worker:*`、`smoke:pi`、`benchmark:pi` 继续可用。内部包名 `pi-ssh-remote`、runtime Symbol 与远端缓存命名保留，不因仓库更名而变更协议。

setup 识别同级旧 `pi-ssh-remote` 工作副本及其 `packages/pi` 路径声明，迁移为本仓库的分包加载声明，避免重复加载。其他目录下的旧副本、手动 `extensions` 文件路径、项目 `.pi/settings.json` 或 shell 启动参数不会被猜测修改，需手动更新；不要额外加载旧副本。工作目录更名也不会搬迁 Pi 的历史会话索引，需要时用 `pi --session <旧会话文件>` 打开。

## 自定义配置目录的边界

`PI_CODING_AGENT_DIR` 选择 Pi agent 目录，不代表所有插件都使用相对路径。Memory 默认数据库/允许列表和 Embedding 配置位于 `~/.pi`，Advisor 选择位于 `~/.config/rpiv-advisor`。需要多套完全隔离的数据时，必须逐个核对插件配置，不能只换一个环境变量就宣称已经隔离。

公开默认 `compaction.enabled=false` 适用于 BCP；移除 BCP 时重新评估原生压缩。`retry.maxRetries=20` 可能增加费用和等待时间，已有设置由 setup 保留而非强制覆盖。

## 私密配置

- `auth.json`、`models.json`、`models-store.json`：本地保留。
- `web-search.json`、`acp.json` 等插件配置：本地保留；setup 只维护 `acp.json` 的 `autoUpdate` 开关，其他内容不入库。
- SSH hosts、私钥、known_hosts：由本地 OpenSSH 管理，不提交。
- BCP / memory 数据库、会话、缓存：运行数据，不属于源代码。
- 可将个人未公开文件放在被忽略的 `local/`，但 Pi 不会自动加载该目录，需在本地配置显式引用。

`.gitignore` 只是防误提交，不是秘密扫描器。不要运行 `git add -f` 强行加入这些数据。脚本备份也可能包含私人设置，不应共享。
