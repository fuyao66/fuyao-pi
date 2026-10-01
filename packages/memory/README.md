# BCP 增强记忆插件

这是 [fuyao-pi 个人 Agent 环境](../../README.zh-CN.md) 的一项能力，不是独立发行的 Agent。
本文是当前本地派生版本的使用契约；来源见 [UPSTREAM.md](UPSTREAM.md)，整体边界见[架构](../../docs/architecture.md)。

基于 [`pi-billion-memory@0.5.3`](UPSTREAM.md) 的个人派生插件：从允许的 ACP
压缩摘要中检索历史记忆，保留 FTS5 trigram / LIKE，增加可选的 Embedding 混合检索。
不改变 BCP 的压缩机制，不自动恢复或重放完整对话。

## 检索流程

```text
允许的摘要来源 → 本地 SQLite / 关键词索引
                         └→ 后台自动 / 手动 backfill → 摘要向量
查询 → 关键词排名 + 查询向量 / 余弦排名 → RRF 合并 → 有界摘要预览
```

- `memory_search`：`query`、可选 `scope`（默认 `current`，明确跨项目/旧历史用 `all`）、`project` 展示名过滤、`limit`（最多 20）。`memory_expand` 同样默认当前工作区，可显式指定 `scope: "all"`。
- 项目过滤在关键词和语义两路都生效；向量余弦相似度门槛可配置。
- RRF 使用 `1/(60 + rank)` 合并两路排名，不把 FTS 分值当作余弦分值。
- 未启用、没有向量、服务失败时仍可用关键词搜索；返回会标明回退原因与覆盖率。
- 启用后，有有效向量才会发送查询 Embedding 请求；不会在搜索时上传整库摘要。
- 摘要只取 `topic + summary`，再次脱敏并去除绝对路径，按 UTF-8 字符边界截取前缀。
  默认上限 6000 字节。长摘要尾部不会参与语义检索；完整已存摘要仍参与关键词检索。
- 向量以规范化 float32 little-endian 存入现有数据库，按服务地址、模型、维度、
  revision 与输入处理策略隔离。换模型需要重新补建，不会混用旧模型向量。

## 本地配置

已有数据库和允许列表继续使用：

```text
~/.pi/pi-billion-memory.json
~/.pi/pi-billion-memory.sources.jsonl
~/.pi/pi-billion-memory.db
```

另外创建 `~/.pi/fuyao-memory-embedding.json`（不提交到 Git）：

```json
{
  "enabled": true,
  "autoBackfill": true,
  "baseUrl": "https://your-embedding-service.example/v1",
  "model": "text-embedding-3-large",
  "dimensions": 3072,
  "apiKeyEnv": "FUYAO_MEMORY_EMBEDDING_KEY",
  "apiKeyFile": "~/.pi/fuyao-memory-embedding.key",
  "revision": "1",
  "timeoutMs": 10000,
  "maxInputBytes": 6000,
  "maxBlocks": 10000,
  "minSimilarity": 0.15
}
```

环境变量优先于密钥文件。密钥文件只存 key 文本，建议配置及 key 均为 `chmod 600`。
公开默认 `enabled:false`、`autoBackfill:false`；只有两者都开启才自动上传摘要。只接受 HTTPS，禁止带用户名、密码、查询参数或 fragment 的
服务地址，不跟随重定向。模型名与维度必须匹配服务实际返回；这里的模型是初始选择，
不是所有数据集上的最佳模型保证。更改配置后重启 Pi。

每次请求最多 8 条输入，超时默认 10 秒，响应上限 4 MiB；模型错误信息和返回正文
不透传。服务商会收到查询与手动确认或自动授权补建的摘要，它们仍可能包含敏感信息；脱敏只是尽力而为。

## 自动活动卡片与统一入口

正常使用只需 `/memory`，在交互菜单中选择“Browse memories”“Session activity”、刷新扫描、
补齐向量、查看来源或清理旧记忆。菜单顶部显示摘要数、向量覆盖率及自动状态。

“浏览已存记忆”显示最近 50 条标题列表，不再把十条正文拼成通知。↑↓ 选择，底部显示
选中项的项目/块 ID/日期/当前模型向量状态；Enter 按需读取完整已存摘要，保留段落并按终端
宽度折行，↑↓ 或 PgUp/PgDn 滚动，Home/End 到首尾，Esc 返回列表，再 Esc 关闭。
“本次活动”单独展示本次运行最近 80 条记录，详情明确标注为有界预览而非完整审计日志。
标题和正文保留来源原文，不自动翻译或改写。缩小窗口会重排，过矮时提示增高窗口。
非 TUI 只给简短提示，不退化为长通知。关闭/切换会话会关闭浏览器。
清理会先显示预计删除数量并要求确认，固定确认时的时间边界和最大记录 ID，
不会顺带删除确认期间新入库的摘要；持久删除标记阻止扫描恢复已删除记录。

Memory 在 **聊天区** 只输出一行英文提示，不显示边框、主题列表、模型或正文：

```text
Memory · Indexed 2 summaries · Saved 2 vectors
```

成功的 BCP `compress` 工具完成事件触发后台当前会话扫描，不等整个任务结束。
BCP 0.1.82 正常路径在返回前 await sidecar 原子保存（保存错误可能被内部记录并吞掉）。
扫描延迟 250ms，最多执行三次跟进以覆盖短暂落盘延迟；连续事件合并，扫描中收到事件不会丢失。
超出该窗口的落盘失败仍由启动/轮末/搜索扫描兜底，不是永久文件监听。不会阻塞工具回调或修改编辑器/页脚。
开启自动补建时，入库反馈等待下一批补建结束，摘要入库与向量保存合为一张卡，不再由
750ms 定时器抢先输出。每批最多补建 20 条，启动大量历史补建按批汇报；两个计数独立，
不保证一一对应。请求期间新入库的摘要留给下一批；失败时合并已提交的数量并注明待重试，
退避期间新入库内容可单独提示，不无限等待服务恢复。关闭自动补建时仍用 750ms 合并入库反馈。
默认和展开状态均保持一行，窄窗口截断而不折成多行；详情只在 `/memory` 浏览。
仅事务提交成功后显示数量；
重复扫描无新增不会输出，连续失败只输出一次退避提示，退出退避再提示一次（不等同于服务商恢复证明）。
卡片为 Pi `custom` entry，存入会话供用户回看，**不进入模型上下文、不触发续答**。
非 TUI 和 BCP 子代理不输出自动卡片；关闭/切换会话会丢弃旧的延迟显示任务。

用户入口只有 `/memory`，不再接受任何旧子命令参数。菜单提供浏览、活动、向量状态、
扫描、补建、来源和清理；补建数量通过输入框指定 1–100 条，清理保留天数为 0–36500。
上传和删除均需确认；保留 0 天删除所有带时间戳的摘要，不删除原始会话。
RPC/无终端面板时 `/memory` 返回简短状态；不会创建 TUI 组件。
模型工具 `memory_search` 和可选的 `memory_expand` 保持不变。

`autoBackfill:true` 是对自动摘要上传的明确授权：启动扫描完成后，后台每批补建最多 20 条，
批间至少等待 1 秒，不阻塞聊天。之后 `compress` 完成扫描、`agent_settled` 兜底扫描、搜索前扫描和 rescan
会通知同一后台任务，已有有效向量跳过。失败指数退避 30 秒至 5 分钟，触发事件不绕过退避；
无进展批次暂停直到下一次触发；期间到达的新摘要信号会再尝试一轮，避免丢失补建机会。`/memory` 菜单的向量状态项显示任务状态。
BCP 子代理（`PI_ACP_DELEGATE_DEPTH>0`）不启动自动任务。自动上传每个网络批次前会
重读来源允许列表并列出当前允许的文件，禁用/删除来源、被排除目录和已消失文件不自动上传。
空白输入前缀跳过，不阻塞后面的摘要；因此这类条目可一直显示为 pending，但不会忙重试。

手动 backfill 仍要求 UI 确认，关闭自动模式时可继续手动补建。单进程合并触发，自动/手动及
多 Pi 进程共享带 120 秒过期时间的 SQLite lease，各网络批次前后续约；不跨 HTTP 持有事务。
正常竞争会退让，进程崩溃后 lease 自动过期。这减少重复请求，但不保证网络层 exactly-once。
会话切换/关闭会停止定时器并取消请求；返回请求不会恢复已删除记录或重开数据库。
无需向量库服务。

当前实现使用 JS 精确余弦遍历：流式读取 float32，只保留语义前 20 名，每 32 块
让出事件循环；每个实例同时只进行一次语义查询，其余调用走关键词回退。
补建只处理通过来源校验后按数据库 id 排序最早的 `maxBlocks` 块，
默认/硬上限为 10000；后续块不会因重复 backfill 自动进入这一区间。项目过滤搜索时也只
扫描该项目最早的 `maxBlocks` 块。超过上限会显示覆盖率截断，需清理旧记录或后续升级
分页索引。这是初版明确的容量限制，不是无限增量索引或百万记录 ANN 系统。

## Workspace scope and source policy

Local scope is the normalized current working directory (realpath when available).
SSH scope adds the target, port and remote working directory, via a small read-only
remote-ssh event. Different aliases, clones and subdirectories are not automatically
merged. An unavailable remote is never treated as the local workspace.

New persisted message IDs receive write-once workspace evidence. A BCP block is
assigned only when all retained references have reliable evidence for one workspace.
Old/resumed messages, transitions with uncertain timing, mixed workspaces and capped
reference lists remain unknown/mixed. Tool-call suffixes resolve to parent message IDs
for project attribution only. This is conservative retrieval isolation, not a sandbox.
Use `scope: "all"` deliberately to retrieve legacy history. No old rows are relabeled
from `sources.cwd`; project display names are not identity keys.

Search, raw expansion and automatic/manual embedding all validate enabled sources,
file format, block presence and the stored content/reference revision. Inactive BCP
child blocks remain valid if still present. Revoked, missing, unreadable, absent or stale
records stay in the database but are excluded from tools/uploads; the management browser
shows the policy and attribution status. Validation is an operation snapshot, not an
atomic filesystem lock: revocation cannot recall an already dispatched HTTP request.
Version checks occur before result limits and each embedding network chunk; expansion
revalidates after reading. Keyword search remains available with embeddings disabled.
Policy-filtered semantic results currently omit global vector coverage rather than
misreport an unfiltered total. Global `/memory` coverage includes retained excluded rows.

## 项目集成与验证

setup 注册独立的 `packages/memory` 本地包，由其 manifest 加载 `src/index.ts`，并替换外部 memory 包。
不要同时安装原插件。Node >=22.19（`node:sqlite`）为必需；Bun 用于仓库构建，
记忆测试使用 Node：`bun run test:memory`。`bun run check` 会包含全部记忆测试。

保留上游 MIT 许可证与来源；本地增强包含同步/权限、项目范围、后台调度、混合检索及展示模块。
升级上游时需对照这些边界人工合并并运行回归。审核、UI、SSH 插件各自位于独立的 `packages/` 子目录。
