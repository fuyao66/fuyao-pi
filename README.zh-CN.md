# fuyao-pi

包含自定义扩展与配置的个人 Pi Agent 环境。

[English](README.md) · [文档导航](docs/README.md) · [系统架构](docs/architecture.md) · [维护指南](docs/maintenance.md)

## 插件清单

共 **10 个插件包：1 个自研、3 个本地改装、6 个社区插件**。Pi core 是运行底座，不计入插件数量；UI 的五个扩展入口和主题按一个包计数。

| 插件 | 归属 / 来源 | 作用 |
| --- | --- | --- |
| [Remote SSH](packages/remote-ssh/README.zh-CN.md) | 自研，`pi-ssh-remote` | 通过 SSH 执行核心工作区工具，继承 delegate 的远端连接，控制面留在本地 |
| [UI](packages/ui/UPSTREAM.md) | 改装自 `pi-sakura-cyberdeck@1.1.5` | 终端编辑区、消息与工具输出、页头、配额展示和主题 |
| [Advisor](packages/advisor/UPSTREAM.md) | 改装自 `@juicesharp/rpiv-advisor@2.11.0` | 由另一模型提供第二意见，使用 BCP 处理后的上下文而非重放原始历史 |
| [Memory](packages/memory/UPSTREAM.md) | 改装自 `pi-billion-memory@0.5.3` | BCP 摘要跨会话检索、项目隔离、自动增量同步及可选 Embedding 混合检索 |
| `billion-context-pi`（BCP） | 社区，可直接安装 | 长上下文压缩、摘要恢复、上下文诊断和子代理委托 |
| `@juicesharp/rpiv-ask-user-question` | 社区，可直接安装 | 结构化提问，提供单选、多选及自定义输入 |
| `@juicesharp/rpiv-todo` | 社区，可直接安装 | 管理任务列表、状态及依赖关系 |
| `pi-web-access` | 社区，可直接安装 | 网页搜索、内容抓取和来源核查 |
| `@schovest/pi-goal` | 社区，可直接安装 | 设置会话目标，在限制内自动推进并报告完成或阻塞 |
| `pi-invisible-continue` | 社区，可直接安装 | 自动发送续跑信号，减少手动催促继续 |

四个本地插件通过本仓库构建、setup 加载；六个社区插件保留上游实现。具体版本、上游链接、改装说明和独立安装命令见[完整清单](docs/plugins.md)。

## 快速开始

运行版本：**Pi 0.87.1**。需要 Node.js **22.19+**、Bun 和 Git；SSH 工作流另需 OpenSSH。远端 worker 面向 Linux x64/arm64。向已有 Pi 环境应用前，请先看[配置说明](docs/configuration.md)。

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

**支持的安装方式是 clone 后构建。** 直接 `pi install git:github.com/fuyao66/fuyao-pi` 不会编译 worker 或安装配套插件清单。setup 将 UI、Advisor、Memory 和 Remote SSH 注册为独立本地包，`pi list` 可分别查看。不要再安装这些本地插件的上游版本。

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
