# 配置、安装与迁移

## 配置分层

1. `config/settings.json`：公开的个人默认偏好，不包含私有模型/provider。
2. `config/plugins.json`：第三方包来源与版本；本仓库作为一个本地 Pi 包加载自研插件、仓库内 UI / Advisor / Memory 派生源码及资源。
3. `~/.pi/agent/settings.json`：实际运行配置。setup **只填补缺失的顶层默认项**，不会强制重置已有偏好；受管理插件替换为固定版本，保留第三方包对象的资源过滤字段。旧的外部 Sakura UI 包声明会被删除，由仓库内 `packages/ui` 替代（不保留旧声明的资源过滤，默认加载该 UI 的五个入口和主题）；旧的 `npm:@juicesharp/rpiv-advisor` 和独立 `packages/advisor` 包声明也会被仓库内 Advisor 替代；上游 `pi-billion-memory` Git/npm 及独立 Memory 包声明由 `packages/memory` 替代。显式写在 `extensions` 中的旧入口需手工移除。其余插件保持原样。
4. 模型、密钥和插件私密配置：继续留在本地，不导出到本仓库。

root manifest 不会自动安装清单里的第三方 Pi 插件，必须执行 setup 并让 Pi 校准依赖。加载顺序为 BCP → 本仓库（自研插件 + UI + Advisor + Memory）→ 其他 companion 包。

## Memory 本地配置

原 `~/.pi/pi-billion-memory.json`、允许列表与数据库保持兼容。新的 `~/.pi/fuyao-memory-embedding.json` 只在本地配置，公开默认关闭。服务地址与密钥文件不入库，setup 不读取或迁移这些私密配置。开启后有向量的搜索发送脱敏查询，历史摘要需要 `/memory embed backfill` 明确确认；详见 [Memory 配置](../packages/memory/README.md)。

## setup 行为

```sh
bun run setup                             # 只预览受管理来源，不打印私有设置
bun run setup --apply                     # 备份、合并、原子写入
bun run setup --agent-dir /tmp/pi-profile # 预览另一个配置目录
```

`--apply` 要求已构建 `packages/remote-ssh/dist/pi-extension.js`。settings 与备份权限为 `0600`。没有变化时不重复写入或生成备份。不会安装插件、调用模型、修改 shell profile，也不会读取 auth/models/web-search 文件。

备份路径形如 `settings.json.bak-fuyao-pi-<uuid>`，位于目标 agent 目录。回滚时退出 Pi，将对应备份复制回 `settings.json`，再重启。新配置目录没有旧文件时不生成备份。

应用声明后运行 `pi update --extensions` 下载或校准第三方包。若使用自定义 agent 目录，该命令与启动 Pi 时均设置同一个 `PI_CODING_AGENT_DIR`。第三方包可能带安装脚本与可执行扩展，先审核上游再加载。

## 原仓库迁移

| 原位置 | 新位置 |
| --- | --- |
| GitHub `fuyao66/pi-ssh-remote` | `fuyao66/fuyao-pi` |
| `src/` | `packages/remote-ssh/src/` |
| `test/`（SSH 测试） | `packages/remote-ssh/test/` |
| `scripts/`（SSH 构建与验证） | `packages/remote-ssh/scripts/` |
| `packages/pi/dist/` | `packages/remote-ssh/dist/` |
| 根 SSH README | `packages/remote-ssh/README*.md` |
| 外部 Sakura Cyberdeck 包 | `packages/ui/`（源码派生版本，保留许可证） |

根命令 `build:pi`、`build:pi-worker:*`、`smoke:pi`、`benchmark:pi` 继续可用。内部包名 `pi-ssh-remote`、runtime Symbol 与远端缓存命名保留，不因仓库更名而变更协议。

setup 识别同级旧 `pi-ssh-remote` 工作副本及其 `packages/pi` 路径声明，替换为本仓库根路径，避免重复加载。其他目录下的旧副本、手动 `extensions` 文件路径、项目 `.pi/settings.json` 或 shell 启动参数不会被猜测修改，需手动更新；不要同时加载根包和 remote-ssh 子包。工作目录更名也不会搬迁 Pi 的历史会话索引，需要时用 `pi --session <旧会话文件>` 打开。

## 私密配置

- `auth.json`、`models.json`、`models-store.json`：本地保留。
- `web-search.json`、`acp.json` 等插件配置：本地保留，公开模板如有需要须单独脱敏制作。
- SSH hosts、私钥、known_hosts：由本地 OpenSSH 管理，不提交。
- BCP / memory 数据库、会话、缓存：运行数据，不属于源代码。
- 可将个人未公开文件放在被忽略的 `local/`，但 Pi 不会自动加载该目录，需在本地配置显式引用。

`.gitignore` 只是防误提交，不是秘密扫描器。不要运行 `git add -f` 强行加入这些数据。脚本备份也可能包含私人设置，不应共享。
