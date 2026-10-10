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
| 重启 `pi` | 加载已验证版本的新扩展/配置；BC 普通自动升级关闭，严重缺陷修复保留 |

模型认证另行在本地 Pi 配置。所有根命令从仓库根目录执行。

## 配置分层

1. `config/settings.json`：公开的个人默认偏好，不包含私有模型/provider。
2. `config/plugins.json`：第三方包来源与版本；setup 分别注册 `packages/remote-ssh`、`packages/bili-memory`、`packages/statusline` 和 `packages/gpt-fast-mode`；Advisor 保留源码但禁用；`themes/fuyao-soft.json` 作为独立主题资源加载，根包不加载扩展。
3. `~/.pi/agent/settings.json`：实际运行配置。setup **只填补缺失的顶层默认项**，不会强制重置已有偏好；受管理插件替换为固定版本，保留第三方包对象的资源过滤字段。旧的外部 Sakura 和本地 UI 包声明会移除，已移除的 `sakura-macaron` 主题迁移为独立的 `fuyao-soft` 配色；旧的 `npm:@juicesharp/rpiv-advisor` 和独立 `packages/advisor` 声明会移除；上游 `pi-billion-memory` Git/npm 及旧 `packages/memory` 声明由 `packages/bili-memory` 替代；旧压缩器声明由唯一的 `billion-context` 替代。明确指向当前或同级旧仓库 `packages/ui/` 的直接扩展/主题路径也会移除；其他手动旧入口需自行检查。其余插件保持原样。
4. BC 配置：优先 `BILI_CONFIG_FILE`，否则 `${XDG_CONFIG_HOME:-~/.config}/billion-context/billion-context.json`。`setup --apply` 设置 `autoUpdate: false`、`advisoryCheck: true`，保留其他字段并备份旧文件；`ACP_AUTO_UPDATE` / `BILI_ADVISORY_CHECK` 环境覆盖优先。旧 `~/.pi/acp.json` 不再是当前 BC 配置。
5. 模型、密钥和插件私密配置：继续留在本地，不导出到本仓库。

必须执行 setup 并让 Pi 校准依赖。加载顺序为 BC Pi 原生入口 → 本地 Remote SSH / Billion Memory / Statusline / GPT Fast → 其他 companion 包。

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

## Billion Memory 本地配置

配置、允许列表、索引、向量配置与日志独立位于 `~/.pi/bili-memory/{config.json,sources.jsonl,memory.sqlite,embedding.json,memory.log}`；归档位于 `history/`。正常来源仅为 BC 会话与已注册的迁移归档，旧路径保留作回滚而非并行摄取。BC 会话目录优先 `BILI_SESSIONS_DIR`，否则 `${XDG_DATA_HOME:-~/.local/share}/billion-context/sessions/`。

服务地址与密钥不入库，公开默认关闭 Embedding，setup 不读取/搬迁这些私密数据。首次迁移须另做备份、副本演练与来源审批，不能把初始准备脚本重跑到活跃目标库上。全部旧库数据已补齐的私人验收见[迁移记录](billion-context-migration.md)。启用后搜索可发送脱敏查询，摘要上传须菜单确认或明确启用 `autoBackfill`。详见 [Billion Memory 配置](../packages/bili-memory/README.md)。

## setup 行为

```sh
bun run setup                             # 只预览受管理来源，不打印私有设置
bun run setup --apply                     # 备份、合并、原子写入
bun run setup --agent-dir /tmp/pi-profile # 预览另一个配置目录
```

`--apply` 要求已构建 `packages/remote-ssh/dist/pi-extension.js`。settings 与备份权限为 `0600`。没有变化时不重复写入或生成备份。不会安装插件、调用模型、修改 shell profile，也不会读取 auth/models/web-search 文件。

备份路径形如 `settings.json.bak-fuyao-pi-<uuid>`，位于目标 agent 目录。回滚时退出 Pi，将对应备份复制回 `settings.json`，再重启。新配置目录没有旧文件时不生成备份。

应用声明后，对更改的清单条目运行 `pi install <固定来源>`；新环境可用根 README 的循环安装整份清单。`pi update --extensions` 会跳过精确锁定的 npm 包，不能用于落实改过的版本号。安装后核对实际版本。若使用自定义 agent 目录，安装与启动 Pi 时均设置同一个 `PI_CODING_AGENT_DIR`。`setup --apply` 设置 BC 普通自动升级关闭、严重缺陷修复开启；后者可能改变实际版本，须核对代理与磁盘版本；第三方包可能带安装脚本与可执行扩展，先审核上游再加载。

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
| 外部 RPIV Advisor | 源码保留在 `packages/advisor/`，当前禁用 |
| 外部 pi-billion-memory / 旧 `packages/memory` | `packages/bili-memory/`；数据须显式离线迁移到独立目录 |
| billion-context-pi（BCP） | billion-context（BC）Pi 原生入口与本地代理；旧实时折叠状态不迁移 |

根命令 `build:pi`、`build:pi-worker:*`、`smoke:pi`、`benchmark:pi` 继续可用。内部包名 `pi-ssh-remote`、runtime Symbol 与远端缓存命名保留，不因仓库更名而变更协议。

setup 识别同级旧 `pi-ssh-remote` 工作副本及其 `packages/pi` 路径声明，迁移为本仓库的分包加载声明，避免重复加载。其他目录下的旧副本、手动 `extensions` 文件路径、项目 `.pi/settings.json` 或 shell 启动参数不会被猜测修改，需手动更新；不要额外加载旧副本。工作目录更名也不会搬迁 Pi 的历史会话索引，需要时用 `pi --session <旧会话文件>` 打开。

## 自定义配置目录的边界

`PI_CODING_AGENT_DIR` 选择 Pi agent 目录，不代表所有插件都使用相对路径。Billion Memory 默认数据位于 `~/.pi/bili-memory`；BC 配置和会话按上述 BILI/XDG 规则解析。禁用的 Advisor 历史选择文件仍可保留。需要多套完全隔离的数据时，必须逐个核对插件配置，不能只换一个环境变量就宣称已经隔离。

公开默认 `compaction.enabled=false` 适用于 BC；移除 BC 时重新评估原生压缩。`retry.maxRetries=20` 可能增加费用和等待时间，已有设置由 setup 保留而非强制覆盖。

## 私密配置

- `auth.json`、`models.json`、`models-store.json`：本地保留。
- `web-search.json`、BC `billion-context.json` 等插件配置：本地保留；setup 只维护 BC 的 `autoUpdate` / `advisoryCheck` 开关，其他内容不入库。
- SSH hosts、私钥、known_hosts：由本地 OpenSSH 管理，不提交。
- BC / Billion Memory 数据库、会话、归档、审批及缓存：私人运行数据，不属于源代码。
- 可将个人未公开文件放在被忽略的 `local/`，但 Pi 不会自动加载该目录，需在本地配置显式引用。

`.gitignore` 只是防误提交，不是秘密扫描器。不要运行 `git add -f` 强行加入这些数据。脚本备份也可能包含私人设置，不应共享。
