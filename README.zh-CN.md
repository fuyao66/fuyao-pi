# fuyao-pi

包含自定义扩展与配置的个人 Pi Agent 环境。

[English](README.md) · [文档导航](docs/README.md) · [系统架构](docs/architecture.md) · [维护指南](docs/maintenance.md)

## 这套环境包含什么

| 能力 | 实现位置 | 职责 |
| --- | --- | --- |
| Agent 运行底座 | 上游 Pi core | 模型接入、会话、工具与扩展生命周期 |
| 上下文管理 | 固定版本 billion-context-pi（BCP） | 压缩、恢复和委托任务 |
| 终端体验 | [`packages/ui`](packages/ui/UPSTREAM.md) | 本地维护的 Sakura 派生界面与主题 |
| 第二意见 | [`packages/advisor`](packages/advisor/UPSTREAM.md) | 根据 BCP 处理后的上下文进行无工具审核 |
| 项目记忆 | [`packages/memory`](packages/memory/README.md) | 跨会话摘要检索、工作区范围及可选向量索引 |
| 远程工作区 | [`packages/remote-ssh`](packages/remote-ssh/README.zh-CN.md) | 核心工作区工具通过 SSH 执行，编排留在本地 |
| 配套工具 | [`config/plugins.json`](config/plugins.json) | 固定版本的提问、任务、联网、目标和续跑插件 |

## 快速开始

基线：**Pi 0.87.1 + BCP 0.1.82**。需要 Node.js **22.19+**、Bun 和 Git；SSH 工作流另需 OpenSSH。远端 worker 面向 Linux x64/arm64。向已有 Pi 环境应用前，请先看[配置说明](docs/configuration.md)。

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
git clone https://github.com/fuyao66/fuyao-pi.git
cd fuyao-pi
bun install --frozen-lockfile
bun run check

# 先预览，再备份并合并公开配置
bun run setup
bun run setup --apply
# 下载、加载前先审查配套插件
pi update --extensions
ACP_AUTO_UPDATE=0 pi
```

`check` 会构建本地 remote-ssh 扩展入口，**不会编译远端 worker**。首次使用 SSH 前再执行：

```sh
bun run build:pi-worker:all
bun run smoke:pi
```

模型访问权限在本地 Pi 中单独配置；仓库不提供 Advisor 审核模型选择或 Memory Embedding 服务凭证。使用自定义 agent 目录时，setup、update 和启动需使用相同的 `PI_CODING_AGENT_DIR`；个别插件状态仍使用固定的 home 路径。

**支持的安装方式是 clone 后构建。** 直接 `pi install git:github.com/fuyao66/fuyao-pi` 不会编译 worker 或安装配套插件清单。根包只加载一次，不要同时逐个加载子包。

## 日常入口

- **`/memory`**：浏览摘要、查看来源和向量状态、执行维护。模型检索默认当前工作区；跨项目或旧历史/未知归属需显式 `scope: "all"`。
- **`/advisor`**：选择审核模型；咨询单独计费，必须单独调用并使用新鲜的压缩后上下文快照。
- **`/remote-connect`**、**`/remote-status`**、**`/remote-exit`**：进入、检查和退出 SSH 工作区。
- 压缩、委托及配套插件命令由各自上游负责，见[插件清单](docs/plugins.md)。

Memory Embedding 需明确启用，会向外部服务发送脱敏后的摘要前缀和查询。脱敏不能保证移除一切敏感内容；启用前请阅读 [Memory 配置与限制](packages/memory/README.md)。

## 项目结构

```text
package.json / bun.lock  整体组合入口、运行基线与依赖锁
packages/
  ui/                    本地维护的终端 UI 派生扩展
  advisor/               本地维护的 BCP 兼容审核扩展
  memory/                本地维护的 BCP 记忆增强扩展
  remote-ssh/            自研远程执行扩展与 worker
config/                  公开默认配置、固定版本配套插件来源
scripts/                 环境安装与集成脚本
test/                    跨包/配置回归测试
docs/                    架构、安装、维护及设计记录
skills/ prompts/ themes/ 个人资源预留目录，目前仅占位
```

各插件包含自己的源码、测试和来源说明。当前 UI 主题位于 `packages/ui/themes`。

## 边界与维护原则

- Pi core 跟随上游；派生扩展保留许可证和归属，升级须人工审查，不盲目覆盖本地修改。
- 模型、会话、UI、Advisor、Memory 和 BCP 编排留在本地；只有受支持的工作区操作远程执行。其他插件**不会自动获得 SSH 兼容性**。
- 公开默认关闭 Pi 原生自动压缩，以配合 BCP；重试上限为 20 次。已有设置优先，请根据费用与延迟调整。验证固定 BCP 基线时保持 `ACP_AUTO_UPDATE=0`。
- 凭证、私有服务地址、主机信息、会话及数据库不入库。setup 只合并声明和默认值，不安装模型、不复制插件私密状态。
- `bun run check` 包含 Memory 的 Node SQLite 测试。SSH smoke 使用进程替身，不是真实 SSH 服务；真实终端视觉、供应商请求及 ARM64 运行需另行验证。

新增扩展和升级流程见[维护指南](docs/maintenance.md)。当前契约与历史提案的区分见[文档导航](docs/README.md)。

[MIT](LICENSE)。导入组件保留各自许可证和所有权。
