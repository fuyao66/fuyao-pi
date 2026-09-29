# Pi SSH Remote — Pi + billion-context-pi 专用版

这是 [fuyao-pi](../../README.zh-CN.md) 的自研 remote-ssh 插件，只服务于当前 Pi agent 的固定组合，不做任意插件的兼容框架。

适配基线：**Pi 0.87.1 + billion-context-pi 0.1.82（`billion-context-pi:dist`）**。Pi 构建依赖锁定版本，主机与 worker 的版本和 schema 必须一致；升级后需重新构建和验证。BCP 由本地 agent 加载，不进入远端 worker。

## 执行边界

- **远端**：Pi 原生 `read / write / edit / bash / grep / find / ls`。
- **本地**：模型请求、凭据、UI、会话、BCP 压缩/解压/上下文管理，以及 delegate 编排。
- **RPIV `ask_user_question / todo`**：本地问答 UI / 本地会话任务状态，不进入远端 worker。
- **Delegate**：Pi 子进程仍在本地运行，但自动加载桥接扩展，独立连接同一个 SSH 工作区。保留角色的工具白名单。
- **BCP 结果文件**：`read` 对 `$TMPDIR/acp-delegate/`、`~/.cache/pi/acp-decompress/` 和当前桥接扩展观测到的成功 `decompress` 显式导出文件进行本地读取。不会把整个 `/tmp` 或用户缓存目录认作本地。
- **远端模式的 `! / !!` 和 PowerShell**：明确阻止，不允许悄悄在本地执行。

普通绝对路径，包括远端 bash 产生的 `/tmp` 输出文件，均指向远端。读取 BCP 本地文件请使用 `read`，不要使用远端 `bash`。

调用 delegate 时省略 `cwd`。传入与当前远端 cwd 相同的值也可以，桥接扩展会保留本地子进程 cwd；不允许通过 delegate cwd 切换到另一个工作区。桥接使用 BCP 的 `PI_CLI_PATH` 启动入口。首次连接后，dispatcher 会保留到当前 Pi 进程结束：因为 BCP 在排队任务真正启动时才解析 CLI，提前恢复会使已排队的远端任务绕过桥接。退出后新建的本地 delegate 透传到原 CLI，已排队的远端任务继续使用提交时的连接快照，`/reload` 保留这一行为。

## 本地 RPIV 附加插件

已验证与 `@juicesharp/rpiv-ask-user-question@2.11.0`、`@juicesharp/rpiv-todo@2.11.0` 同时加载。无需远端 adapter、worker 依赖，也不修改这些插件源码：

- `ask_user_question` 留在客户端：交互 Pi 使用终端弹窗，兼容的 RPC UI 使用 select/input 对话框。无 UI 的 delegate 不能交互提问；插件在回合开始前隐藏工具，直接调用也返回无 UI 错误。可选的外部编辑器同样在本地运行，使用本地配置和临时文件。
- `todo` 属于 Pi 会话，而非某个服务器目录。连接、切换服务器、退出远端不会另建任务列表；reload 从本地会话的工具结果历史恢复状态，子会话有各自的列表。
- 两者配置均保留本地，工具不会被远端 worker 接纳。这是针对当前两个附加插件的验证，不代表支持任意直接操作工作区的扩展。

## 构建与加载

客户端需要 Bun（构建）、适配当前 Pi 的 Node、OpenSSH `ssh/scp`。远端支持 Linux x64/arm64，需要 Bash。建议在远端 PATH 安装 `rg` 和 `fd`；否则沿用 Pi 原生搜索工具的查找/下载行为。

以下命令在 **fuyao-pi 仓库根目录**执行：

```sh
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
bun run smoke:pi
```

Smoke 使用真实编译 worker 和受限工具集的 Pi SDK 会话，通过 **SSH 进程替身**运行，不等同于真实服务器、模型或完整 BCP delegate 端到端测试。ARM64 产物需在对应机器另行验证。

保留现有 BCP 安装，再加载此扩展：

```sh
ACP_AUTO_UPDATE=0 pi -e /绝对路径/fuyao-pi/packages/remote-ssh/dist/pi-extension.js
```

自建 Pi agent 应把同一个构建入口加入 `DefaultResourceLoader.additionalExtensionPaths`，不要直接加载 `host-extension.ts`，否则没有 BCP 继承启动配置。若已自定义 `PI_CLI_PATH`，该绝对路径入口需要兼容 Pi 的 `--extension` 参数并加载现有 BCP 配置。

旧 AFT / FFF / RTK / Tintin managed entry 和按插件组合构建 worker 的方式已移除。构建过程不修改全局 Pi 配置，不自动安装扩展。建议本配置禁用 BCP 自动更新；升级 BCP 后重新验证。

## 使用

```text
/remote-connect user@host /远端绝对路径
/remote-status
/remote-exit
```

支持 SSH alias 及 `--identity / --port / --known-hosts / --worker` 参数。主机密钥需提前信任，禁用密码交互和 agent forwarding。模型控制工具为 `remote_connect / remote_workspace_status / remote_exit`。

Worker 和 Photon 图片处理 WASM 伴随资源均按内容哈希部署、复用缓存。保留原项目 SSH/缓存基础命名，固定 core runtime 使用 `pi-bcp-v1` 命名空间。断线后阻止工作区调用，绝不自动回退本地。退出等待当前执行空闲，再 reload 恢复本地工具；恢复失败仍保持阻止状态。

本地配置、skills 和项目指令**不会自动同步到远端**。提示词明确标识远端工作区并要求检查远端 `AGENTS.md`，但不会替换 Pi 本地资源发现机制，也不是任意自定义插件的安全沙箱。

[English](README.md) · [MIT](LICENSE)
