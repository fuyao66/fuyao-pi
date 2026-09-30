# 配置、安装与迁移

[文档导航](README.md) · [系统架构](architecture.md) · [维护指南](maintenance.md)

本页管理的是整套个人 Pi Agent 环境，而不是单独安装 remote-ssh。快速开始见[根 README](../README.zh-CN.md)。

## 安装产物与步骤

| 步骤 | 实际作用 |
| --- | --- |
| 安装固定版本 Pi CLI | 获得上游 `pi` 命令，不生成 `fuyao-pi` 命令 |
| `bun install --frozen-lockfile` | 安装本仓库工作区依赖 |
| `bun run check` | 类型检查、构建本地 SSH 扩展、UI 静态检查与测试；不编译远端 worker |
| `bun run setup` / `--apply` | 预览或备份合并 Pi 包声明和公开默认值 |
| `pi update --extensions` | 安装/校准配套上游扩展，不更新本地派生源码 |
| `bun run build:pi-worker:all` | 首次 SSH 使用前生成 Linux x64/arm64 worker |
| `bun run smoke:pi` | 验证进程替身下的 SSH 桥接；不是真实 SSH 连接 |
| 重启 `ACP_AUTO_UPDATE=0 pi` | 以固定 BCP 基线加载新扩展/配置 |

模型认证另行在本地 Pi 配置。所有根命令从仓库根目录执行。

## 配置分层

1. `config/settings.json`：公开的个人默认偏好，不包含私有模型/provider。
2. `config/plugins.json`：第三方包来源与版本；本仓库作为一个本地 Pi 包加载自研插件、仓库内 UI / Advisor / Memory 派生源码及资源。
3. `~/.pi/agent/settings.json`：实际运行配置。setup **只填补缺失的顶层默认项**，不会强制重置已有偏好；受管理插件替换为固定版本，保留第三方包对象的资源过滤字段。旧的外部 Sakura UI 包声明会被删除，由仓库内 `packages/ui` 替代（不保留旧声明的资源过滤，默认加载该 UI 的五个入口和主题）；旧的 `npm:@juicesharp/rpiv-advisor` 和独立 `packages/advisor` 包声明也会被仓库内 Advisor 替代；上游 `pi-billion-memory` Git/npm 及独立 Memory 包声明由 `packages/memory` 替代。显式写在 `extensions` 中的旧入口需手工移除。其余插件保持原样。
4. 模型、密钥和插件私密配置：继续留在本地，不导出到本仓库。

root manifest 不会自动安装清单里的第三方 Pi 插件，必须执行 setup 并让 Pi 校准依赖。加载顺序为 BCP → 本仓库（自研插件 + UI + Advisor + Memory）→ 其他 companion 包。

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

应用声明后运行 `pi update --extensions` 下载或校准第三方包。若使用自定义 agent 目录，该命令与启动 Pi 时均设置同一个 `PI_CODING_AGENT_DIR`。第三方包可能带安装脚本与可执行扩展，先审核上游再加载。

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
| 外部 Sakura Cyberdeck 包 | `packages/ui/`（源码派生版本，保留许可证） |
| 外部 RPIV Advisor | `packages/advisor/`（BCP 兼容派生版本） |
| 外部 pi-billion-memory | `packages/memory/`（记忆增强；旧数据库路径保留） |

根命令 `build:pi`、`build:pi-worker:*`、`smoke:pi`、`benchmark:pi` 继续可用。内部包名 `pi-ssh-remote`、runtime Symbol 与远端缓存命名保留，不因仓库更名而变更协议。

setup 识别同级旧 `pi-ssh-remote` 工作副本及其 `packages/pi` 路径声明，替换为本仓库根路径，避免重复加载。其他目录下的旧副本、手动 `extensions` 文件路径、项目 `.pi/settings.json` 或 shell 启动参数不会被猜测修改，需手动更新；不要同时加载根包和 remote-ssh 子包。工作目录更名也不会搬迁 Pi 的历史会话索引，需要时用 `pi --session <旧会话文件>` 打开。

## 自定义配置目录的边界

`PI_CODING_AGENT_DIR` 选择 Pi agent 目录，不代表所有插件都使用相对路径。Memory 默认数据库/允许列表和 Embedding 配置位于 `~/.pi`，Advisor 选择位于 `~/.config/rpiv-advisor`；部分 UI 状态也保留上游固定路径。需要多套完全隔离的数据时，必须逐个核对插件配置，不能只换一个环境变量就宣称已经隔离。

公开默认 `compaction.enabled=false` 适用于 BCP；移除 BCP 时重新评估原生压缩。`retry.maxRetries=20` 可能增加费用和等待时间，已有设置由 setup 保留而非强制覆盖。

## 私密配置

- `auth.json`、`models.json`、`models-store.json`：本地保留。
- `web-search.json`、`acp.json` 等插件配置：本地保留，公开模板如有需要须单独脱敏制作。
- SSH hosts、私钥、known_hosts：由本地 OpenSSH 管理，不提交。
- BCP / memory 数据库、会话、缓存：运行数据，不属于源代码。
- 可将个人未公开文件放在被忽略的 `local/`，但 Pi 不会自动加载该目录，需在本地配置显式引用。

`.gitignore` 只是防误提交，不是秘密扫描器。不要运行 `git add -f` 强行加入这些数据。脚本备份也可能包含私人设置，不应共享。
