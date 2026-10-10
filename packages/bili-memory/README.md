# Billion Memory（bili-memory）

这是 [fuyao-pi 个人 Agent 环境](../../README.zh-CN.md) 的一项能力，不是独立发行的 Agent。
本文是当前本地派生版本的使用契约；来源见 [UPSTREAM.md](UPSTREAM.md)，整体边界见[架构](../../docs/architecture.md)。

基于 [`pi-billion-memory@0.5.3`](UPSTREAM.md) 的个人派生插件，已适配 Billion Context（BC）：从授权的 BC v3 会话和不可变迁移归档中检索历史摘要，保留 FTS5 trigram / LIKE 与可选 Embedding 混合检索。它不修改 BC 压缩算法，不自动向模型注入记忆，也不自动恢复或重放完整对话。旧 BCP 解析器仅用于明确的离线迁移/测试，正常运行不读取旧 sidecar。

## 检索流程

```text
允许的摘要来源 → 本地 SQLite / 关键词索引
                         └→ 授权后的后台补建 → 摘要向量
查询 → 关键词排名 + 查询向量 / 余弦排名 → RRF 合并 → 有界摘要预览
```

- `memory_search`：`query`、可选 `scope`（默认 `current`，明确跨项目/旧历史用 `all`）、`project` 展示名过滤、`limit`（最多 20）。`memory_expand` 同样默认当前工作区，可显式指定 `scope: "all"`。
- 项目过滤在关键词和语义两路都生效；向量余弦相似度门槛可配置。
- RRF 使用 `1/(60 + rank)` 合并两路排名，不把 FTS 分值当作余弦分值。
- 来源与工作区授权在去重之前完成。完整 `topic + summary` 相同的副本合为一条结果，保留最多 8 个其他授权出处；不同正文、主题或修订不强行合并。每条检索路线只给同一内容一次排名贡献，避免迁移副本堆高分数。
- 保存 BC 的 `active` / `directBlockIds`；有其他相关候选时分散直接父子块，只有父子命中时仍保留细节。非活动子块不是垃圾，不因去重而删除。
- 内部候选上限 100，模型结果上限仍为 20。大量同分副本超过候选窗口时可能影响召回；这不是无限全库去重或检索质量保证。
- 未启用、没有向量、服务失败时仍可用关键词搜索；返回会标明回退原因与覆盖率。
- 启用后，有有效向量才会发送查询 Embedding 请求；不会在搜索时上传整库摘要。
- 摘要只取 `topic + summary`，再次脱敏并去除绝对路径，按 UTF-8 字符边界截取前缀。
  默认上限 6000 字节。长摘要尾部不会参与语义检索；完整已存摘要仍参与关键词检索。
- 向量以规范化 float32 little-endian 存入现有数据库，按服务地址、模型、维度、
  revision 与输入处理策略隔离。换模型需要重新补建，不会混用旧模型向量。

## 本地配置

Memory 自有文件与 BC 会话分离，不写入上游会话目录：

```text
~/.pi/bili-memory/config.json
~/.pi/bili-memory/sources.jsonl
~/.pi/bili-memory/memory.sqlite
~/.pi/bili-memory/history/*.json
~/.pi/bili-memory/embedding.json
~/.pi/bili-memory/memory.log
```

原生摘要存储完整的脱敏正文，默认每条最多 1 MiB UTF-8，源文件读取最多 32 MiB；超过预算明确拒绝该次文件修订，不截断正文或推进水位。`config.json` 的 `maxStoredSummaryBytes` / `maxSourceReadBytes` 可分别调节，硬上限 4 MiB / 128 MiB。预览、分页与 Embedding 前缀是独立限制；旧 `maxSummaryChars` 仅用于离线旧格式，不限制新 BC 摘要。

已有索引使用附加元数据表和每来源 parser 水位升级：重读获授权且尚未刷新到新 parser 的 BC 文件，保持内部行 ID、删除墓碑及未变正文的向量；正文改变才使对应向量失效。不清空或重建全库，也不改写 BC 文件。迁移归档保留其原有正文，不伪造已丢失的旧摘要尾部。

BC 会话目录优先 `BILI_SESSIONS_DIR`，否则为 `${XDG_DATA_HOME:-~/.local/share}/billion-context/sessions`。默认来源只接受 `bili-session` 和 `memory-history`。迁移归档须有 SHA256 注册及明确启用状态；通配符本身不会放行未注册或改过内容的文件。旧数据库/配置保留作回滚，不再并行摄取；首次迁移和退役后补迁须独立备份、来源审批及副本演练，不能覆盖正在增长的新索引。

可选创建 `~/.pi/bili-memory/embedding.json`（不提交到 Git）：

```json
{
  "enabled": true,
  "autoBackfill": true,
  "baseUrl": "https://your-embedding-service.example/v1",
  "model": "text-embedding-3-large",
  "dimensions": 3072,
  "apiKeyEnv": "FUYAO_MEMORY_EMBEDDING_KEY",
  "apiKeyFile": "~/.pi/bili-memory/embedding.key",
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
不透传。服务商会收到查询与明确授权自动补建的摘要，它们仍可能包含敏感信息；脱敏只是尽力而为。

## 自动活动卡片与统一入口

用户入口为 `/bili-memory`，不保留 `/memory` 别名，也不接受子命令参数。菜单只保留三个核心选项：

- **Browse memories**：浏览最近 50 条记忆，Enter 阅读完整已存摘要。
- **View status**：查看已存数量、语义搜索准备情况与后台状态。
- **Refresh memories**：增量检查授权来源。不会删除记忆、修改配置或授予新的上传权限；只有原本已启用 `autoBackfill` 才会触发后台补建。

浏览标题优先使用来源 `topic`；空标题从正文开头提取 Markdown 标题或首条有效文本，最后才用块编号。这个兜底仅用于显示，不改 BC 原文或数据库，不调用模型。
↑↓ 选择，底部保留项目/块 ID/日期/搜索准备状态；Enter 按需读取完整摘要，保留段落并按终端宽度折行。
详情中 ↑↓ 或 PgUp/PgDn 滚动，Home/End 到首尾，Esc 返回列表，再 Esc 关闭。
缩小窗口会重排，过矮时提示增高窗口。非 TUI 只给简短状态，不退化为长通知；关闭/切换会话会关闭浏览器。

用户菜单不再提供活动记录、来源配置、手动向量批次或删除入口。Agent 继续通过 `memory_search` 与可选的 `memory_expand` 完成检索、摘要分页和精确原文追溯；这些工具没有新增删除、配置或上传权限。

Bili-Memory 在 **聊天区** 只输出一行英文提示，保留“记忆更新”和“Embedding 异常”两类，不显示边框、主题列表、模型或正文：

```text
Bili-Memory · Updated 2 memories
Bili-Memory · Embedding failed; retrying
Bili-Memory · Embedding failed; check /bili-memory
```

后两行分别表示会自动重试／不会自动重试，不表示整个语义搜索不可用。

成功的 BC `compress` 工具完成事件触发后台当前会话扫描，不等整个任务结束。BC 工具成功与 v3 会话文件落盘并非同一时刻；收集器用公开 status 的精确 conversation/session 映射定位授权的 v3 文件，不猜测“最新文件”，也不接受 latest fallback。图片或不透明内容导致 fork 快照不可用时，摘要仍可收录；项目证据不能由 status 代替。
定位器只缓存文件身份与 session ID，不缓存原始会话；每次刷新列表、权限及完整 stat 身份，重复 session ID、列表不完整或读取预算不足均拒绝定位。未变化文件不再反复读正文。普通 `message_end` 只观察项目证据，不扫描目录、入库、补向量或刷提示。
扫描延迟 250ms，最多执行三次跟进以覆盖短暂落盘延迟；连续事件合并，扫描中收到事件不会丢失。
超出该窗口的落盘失败仍由启动/轮末/搜索扫描兜底，不是永久文件监听。不会阻塞工具回调或修改编辑器/页脚。
开启自动补建时，入库反馈等待下一批补建结束，不再由 750ms 定时器抢先输出。每批最多补建 20 条；
入库与向量提交是独立事件，`Updated` 只统计新增或修订后已提交的摘要，不承诺对应向量全部完成或属于当前项目。
仅补向量成功、后台恢复以及无变化批次均不输出；补建详情放在 `/bili-memory → View status`。
请求期间新入库的摘要留给下一批；失败时保留已提交的记忆数量，可在同一行附加一次 Embedding 异常。
连续失败不反复提醒，退避期间新入库内容仍可单独提示，不无限等待服务恢复；正常批次结束后再次失败才重新提醒。
关闭自动补建时仍用 750ms 合并入库反馈。
默认和展开状态均保持一行，窄窗口截断而不折成多行；数量仅在事务提交成功后显示。
卡片为 Pi `custom` entry，存入会话供用户回看，**不进入模型上下文、不触发续答**。
非 TUI 和 BC 子代理不输出自动卡片；关闭/切换会话会丢弃旧的延迟显示任务。

`autoBackfill:true` 是对自动摘要上传的明确授权：启动扫描完成后，后台每批补建最多 20 条，
批间至少等待 1 秒，不阻塞聊天。之后 `compress` 完成扫描、`agent_settled` 兜底扫描、搜索前扫描和 rescan
会通知同一后台任务，已有有效向量跳过。失败指数退避 30 秒至 5 分钟，触发事件不绕过退避；
无进展批次暂停直到下一次触发；期间到达的新摘要信号会再尝试一轮，避免丢失补建机会。`/bili-memory` 的 “View status” 显示任务状态。
BC 子代理（上游保留标记 `PI_ACP_DELEGATE_DEPTH>0`）不启动自动任务。自动上传每个网络批次前会
重读来源允许列表并列出当前允许的文件，禁用/删除来源、被排除目录和已消失文件不自动上传。
空白输入前缀跳过，不阻塞后面的摘要；因此这类条目可一直显示为 pending，但不会忙重试。

关闭自动模式时不会上传摘要；用户菜单不再提供手动 backfill。单进程合并触发，
多 Pi 进程的补建共享带 120 秒过期时间的 SQLite lease，各网络批次前后续约；不跨 HTTP 持有事务。
一次补建操作内最多复用 100 个相同的处理后输入向量，减少副本的重复请求；每个目标行仍独立校验来源、正文和提交权限，不继承另一个副本的授权。不是跨进程永久缓存或计费 exactly-once。
正常竞争会退让，进程崩溃后 lease 自动过期。这减少重复请求，但不保证网络层 exactly-once。
会话切换/关闭会停止定时器并取消请求；返回请求不会恢复已删除记录或重开数据库。
无需向量库服务。

当前实现使用 JS 精确余弦遍历：流式读取 float32，只保留最多 100 个不同内容候选，每 32 块
让出事件循环；每个实例同时只进行一次语义查询，其余调用走关键词回退。查询向量门槛及无向量覆盖统计也分批让出、支持取消；上传前重新校验授权，返回前逐出处验证完整正文与当前向量。管理界面的全局状态和补建结果状态仍为有界同步计算，大规模下可能暂停界面；实际测量见 [VALIDATION.md](VALIDATION.md)。
补建只处理通过来源校验后按数据库 id 排序最早的 `maxBlocks` 块，
默认/硬上限为 10000；后续块不会因重复 backfill 自动进入这一区间。项目过滤搜索时也只
扫描该项目最早的 `maxBlocks` 块。超过上限会显示当前授权范围的覆盖率与未扫描数量；扩容需要后续升级
分页索引，不建议靠删除仍有价值的旧记忆腾位置。这是初版明确的容量限制，不是无限增量索引或百万记录 ANN 系统。

## Workspace scope and source policy

Local scope is the normalized current working directory (realpath when available).
SSH scope adds the target, port and remote working directory, via a small read-only
remote-ssh event. Different aliases, clones and subdirectories are not automatically
merged. An unavailable remote is never treated as the local workspace.

Ingestion needs an exact public status session mapping and an authorized, unambiguous persisted v3 file; it does not need a fork-safe snapshot. Attribution separately requires an exact snapshot with matching conversation/session revision and unique ordered message identities. The initial/resumed snapshot is a baseline, not proof of historical ownership. Only continuous same-workspace ordered-prefix additions receive evidence; order/ref/hash changes, unavailable snapshots and workspace transitions leave uncertain messages unassigned. Without snapshot proof, new or revised blocks cannot reuse stale raw-ID ownership; summaries remain available through explicitly wider scope. Pending verified evidence survives an exact same-scope retry, but a workspace transition invalidates it, including A→B→A transitions.

Reliable per-message evidence produces many-to-many block/project links even when part of a summary remains unknown. Completeness stays known/mixed/unknown; a capped reference list is incomplete. Tool-call suffixes resolve to parent IDs only for project attribution. Current-scope retrieval ranks proven associations first via hybrid search, then may add separately labelled session-directory clues using keyword-only fallback. A directory clue is not remote-workspace ownership proof. Use `scope: "all"` deliberately for wider history. No old row is relabelled from the latest cwd, and project display names are not identity keys. This is conservative retrieval isolation, not a sandbox.

Search, summary/raw expansion and embedding backfills all validate enabled sources,
file format, block presence and the stored content/reference revision. Inactive BC
child blocks remain valid if still present. Revoked, missing, unreadable, absent or stale
records stay in the database but are excluded from tools/uploads; the management browser
shows the policy and attribution status. Validation is an operation snapshot, not an
atomic filesystem lock: revocation cannot recall an already dispatched HTTP request.
Version checks occur before result limits and each embedding network chunk; expansion
revalidates after reading. Keyword search remains available with embeddings disabled.
Semantic results report coverage for the authorized workspace: valid vectors, scanned
pending blocks and unscanned blocks when capped. No valid vector in that scope means
no query embedding request. Concurrent store changes can suppress coverage rather than
claim a misleading ratio. Global `/bili-memory` status includes retained excluded rows.

Authorization uses an indexed, operation-local SQLite temporary relation, not repeated
JSON-array scans. Parsed source documents use a bounded metadata-validated cache;
source rules and file listing are still refreshed, including around network requests.
Normal ingestion supports BC v3 envelopes and registered `bili-memory-history` v1 archives only. Legacy adapters are gated behind explicit offline migration/tests. Unknown versions are skipped and logged without advancing ingestion watermarks. Source patterns must be
relative and cannot contain `.`/`..`; literal directory prefixes must be real directories,
not symlinks. These checks do not provide an atomic filesystem security boundary.

Search previews are bounded to about 600 characters and prefer an exact query term's
neighborhood, so a match near the summary tail is readable. Semantic-only matches with
no literal query term still show the opening preview. Full summaries are available
in `/bili-memory` and through the optional `memory_expand` tool's `summary` mode.

### Agent guidance

Active Memory tools provide `promptSnippet` and `promptGuidelines` through Pi's native
system-prompt builder, alongside their tool descriptions and parameter schemas. The
rules cover when to search, current-workspace scope, historical evidence versus current
instructions, summary paging after insufficient previews, and narrow raw expansion only
when exact wording matters. Stored memories are not injected into the system prompt;
Memory does not replace the prompt, install compression context hooks or inspect a guessed proxy session. A real Pi SDK regression
checks that these rules appear in the generated default system prompt. A forced/custom
system prompt can override native sections; guidance cannot guarantee model compliance.

### Read a stored summary

When `expandEnabled: true` is set in the local Memory configuration, use the existing
tool without opening raw session logs:

```text
memory_expand({ block: "b1", source: "session-label", mode: "summary", chars: 6000 })
```

The tool returns a bounded stored-summary page, `revision` and `nextOffset`. If another
page is needed, keep the same block/source/scope and pass both returned values:

```text
memory_expand({ block: "b1", source: "session-label", mode: "summary", offset: 6000, revision: "<returned revision>" })
```

Use the actual `nextOffset`, not a guessed offset: offsets count UTF-16 units and pages
do not split surrogate pairs. The default content cap is `min(6000, expandMaxChars)`;
explicit `chars` is still capped by `expandMaxChars` (metadata is additional).
Continuations reject changed summary content; restart at offset 0 to read its new version.
This also works for authorized summaries without message references or original logs.
Current workspace is the default; legacy/cross-project records require explicit `scope: "all"`.
Source, revision and workspace are revalidated before return; cancellation returns no page.
`expandEnabled` remains false by default, and `list` remains the default mode. Raw
expansion for new BC sessions uses `list` followed by `full` with explicit `select` and the returned `revision`. Indices are numbered retained-text chunks of up to 4000 characters, not message indices. It reads only upstream-retained `blockContents[blockId].full.text`, redacts before splitting, and never recursively follows placeholders or nested blocks. Missing retained text must use summary mode. Migrated `memory-history` archives expose summaries only: they do not import old raw logs or live fold state. A separate one-time rebuild published 16 retained Pi sessions with native BC state; these are `bili-session` sources, not an added raw-history capability of the archive reader. BC retained-text expansion still follows the same nonrecursive contract, including any upstream nested-parent cache limitation. Summary mode adds no tool and does not call an embedding or chat provider.

The retained internal prune routine removes local index/vectors and records path-based tombstones;
it is not exposed in the user menu or agent tools. It does not erase original sessions,
and copied/renamed sources may be indexed again.

## 项目集成与验证

setup 注册独立的 `packages/bili-memory` 本地包，由其 manifest 加载 `src/index.ts`，并替换外部 memory 包。
不要同时安装原插件。Node >=22.19（`node:sqlite`）为必需；Bun 用于仓库构建，
记忆测试使用 Node：`bun run test:memory`。`bun run check` 会包含全部记忆测试。

保留上游 MIT 许可证与来源；本地增强包含 BC 精确会话映射与独立项目证据、不可变历史归档、修订绑定读取，以及同步/权限、项目范围、后台调度、混合检索和展示模块。生产旧库已全量保留 845 条摘要、704 条原向量；验收与 mock/实测边界见[迁移记录](../../docs/billion-context-migration.md)和 [VALIDATION.md](VALIDATION.md)。
升级上游时需对照这些边界人工合并并运行回归。审核与 SSH 插件各自位于独立的 `packages/` 子目录。
