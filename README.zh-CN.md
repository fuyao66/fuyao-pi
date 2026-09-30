# fuyao-pi

扶摇个人的 **Pi agent 体系仓库**：管理自研插件、第三方插件依赖和可复用配置。不是 Pi 本体的 fork，也不再仅仅是 SSH 插件仓库。

在原 `pi-ssh-remote` 仓库上演进，保留 Git 历史。**remote-ssh 是这套体系中的一个自研插件**，保留独立包身份与运行协议。第三方插件通常只记录来源和版本；**UI、Advisor 和 Memory 是明确的源码例外**：分别用于 UI 定制、BCP 上下文适配和混合记忆检索，均保留许可证和上游归属。

[English](README.md) · [插件清单](docs/plugins.md) · [配置与迁移](docs/configuration.md)

## 结构

```text
packages/remote-ssh/    自研 SSH 插件：源码、测试、构建脚本
packages/ui/            可定制的 Sakura Cyberdeck 派生源码及许可证
packages/advisor/       RPIV Advisor 派生源码：使用 BCP 处理后的上下文
packages/memory/        BCP 增强记忆：关键词 + 可选 Embedding 混合检索
config/plugins.json    第三方插件来源，固定版本 / Git 提交
config/settings.json   可公开的个人配置，不含模型与凭证
scripts/setup.ts       预览 / 应用个人配置
test/                  配置管理测试
skills/                后续自研技能
prompts/               后续个人提示词模板
themes/                后续新增主题；当前主题在 packages/ui
```

后续自己 vibe 的插件放在 `packages/<名称>/`，入口加入根 `package.json` 的 `pi` 清单。当前 skills/prompts/themes 仅预留目录，不虚构你已有的个人工作流。

## 安装

固定基线：**Pi 0.87.1 + billion-context-pi 0.1.82**。需要 Bun、Node.js 22.19+ 和 OpenSSH；若 Pi 声明更高的 engine 要求，以其为准。远端 worker 支持 Linux x64/arm64。

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
git clone https://github.com/fuyao66/fuyao-pi.git
cd fuyao-pi
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
bun run smoke:pi

# 仅预览，不写入、不下载插件
bun run setup
# 合并配置；已有 settings.json 会先备份
bun run setup --apply
# 由 Pi 安装 / 校准上游依赖，加载前请审查第三方包
pi update --extensions
ACP_AUTO_UPDATE=0 pi
```

安装脚本保留已有偏好、模型选择、资源路径、额外插件和第三方资源过滤规则（被替换的外部 UI / Advisor / Memory 包声明除外）；受管理插件按本仓库版本固定。不会读取或复制 `auth.json`、`models.json`、联网凭证、会话和 SSH 私钥，也不会自动下载依赖。

可用 `--agent-dir /路径` 指定另一套配置，启动时相应设置 `PI_CODING_AGENT_DIR=/路径`。**支持的安装方式是 clone 后构建**；直接 `pi install git:github.com/fuyao66/fuyao-pi` 不会构建 worker，也不会配置第三方插件。根 Pi manifest 暴露自研资源和仓库内 UI / Advisor / Memory，完整组合由 setup 管理。

## 远程工作区

```text
/remote-connect user@host /远端项目绝对路径
/remote-status
/remote-exit
```

核心文件 / shell 工具在远端执行；模型、凭证、会话、UI 和 BCP 编排留在本地。**收录第三方依赖不代表它们全部适配了 SSH 工作区**。详见 [remote-ssh 文档](packages/remote-ssh/README.zh-CN.md)。

## 开发与验证

```sh
bun run check                 # 核心/配置类型检查 + 构建 + UI 静态检查 + 测试
bun run build:pi-worker:all    # Linux 双架构 worker 及伴随资源
bun run smoke:pi              # SSH 进程替身 + 真实 worker / Pi SDK
```

Smoke 不等同于真实 SSH 服务器或模型 API 测试；ARM64 需另行运行验证。升级 Pi / BCP 后必须重建并复验桥接。固定配置请使用 `ACP_AUTO_UPDATE=0` 禁止 BCP 自更新。

## 自定义 UI

直接修改 [`packages/ui/`](packages/ui/UPSTREAM.md)。根包加载其中五个扩展入口和主题；setup 会替换旧的外部 UI 包声明，避免重复加载原型补丁。以后由本仓库维护源码，不自动跟随上游覆盖。本次迁移尚未改变 UI 视觉/交互逻辑；静态检查不能替代终端交互验证。

## Advisor 与 BCP

[`packages/advisor/`](packages/advisor/UPSTREAM.md) 保留 `/advisor` 模型选择器和无参数咨询工具，但不再从日志重建原始历史；读取 BCP 处理后的请求快照。必须单独调用 Advisor，不能和 `compress` 或其他工具同批；压缩后等待下一轮上下文刷新再咨询。没有新鲜快照就报错，绝不回退到原始日志。

重启后用 `/advisor` 选择模型；仓库不预设审核模型，不上传本地选择或凭证。Advisor 无工具，不读取本地或远端文件；咨询单独计费。快照不包含后续 provider 专用请求变换，不保证自动适配更小的审核模型窗口。完整边界见来源文档。

## BCP 增强记忆

[`packages/memory/`](packages/memory/README.md) 基于 pi-billion-memory，保留原数据库、允许列表与 FTS5/LIKE 检索，增加显式启用的远端 Embedding、SQLite 向量和 RRF 融合。不改 BCP 压缩算法、不上传原始对话；启用且存在向量时会向服务商发送脱敏查询。

本地 `autoBackfill:true` 后启动自动分批补齐摘要向量，后续新摘要也后台增量补建，失败退避不阻塞聊天。自动入库和向量保存会在聊天区显示合并的一行提示，不进入模型上下文。只保留 `/memory` 菜单入口，旧子命令不再执行；上传和删除均需确认。工具检索默认当前工作区，旧历史/未知归属需显式 `scope: "all"`；搜索、展开、上传统一校验来源及摘要修订。服务失败自动回退关键词。公开默认关闭，服务地址/密钥留在本地 `~/.pi/fuyao-memory-embedding.json` 与密钥文件。脱敏不是完全去敏保证，详情见插件文档。

记忆测试必须使用 Node `node:sqlite`：`bun run test:memory`；已纳入根 `bun run check`，不要对该目录直接使用 `bun test`。

## 隐私与配置原则

凭证、私有服务地址、服务器清单、数据库和会话不入库。机器专属配置留在本地 Pi 目录，或放入被忽略的 `local/`。公开配置不指定私有 provider/model。

本配置使用 BCP，因此关闭 Pi 原生自动压缩；移除 BCP 时请重新启用。当前个人重试上限为 20 次，可能增加延迟和费用，可在本地调整；已有配置不会被 setup 强制覆盖。

[MIT](LICENSE)。第三方包保留各自的许可证与所有权。
