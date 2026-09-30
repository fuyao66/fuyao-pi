# BCP 增强记忆插件

基于 [`pi-billion-memory@0.5.3`](UPSTREAM.md) 的个人派生插件：从允许的 ACP
压缩摘要中检索历史记忆，保留 FTS5 trigram / LIKE，增加可选的 Embedding 混合检索。
不改变 BCP 的压缩机制，不自动恢复或重放完整对话。

## 检索流程

```text
允许的摘要来源 → 本地 SQLite / 关键词索引
                         └→ 显式 backfill → 摘要向量
查询 → 关键词排名 + 查询向量 / 余弦排名 → RRF 合并 → 有界摘要预览
```

- `memory_search` 参数保持不变：`query`、可选 `project`、`limit`（最多 20）。
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
公开默认 `enabled:false`。只接受 HTTPS，禁止带用户名、密码、查询参数或 fragment 的
服务地址，不跟随重定向。模型名与维度必须匹配服务实际返回；这里的模型是初始选择，
不是所有数据集上的最佳模型保证。更改配置后重启 Pi。

每次请求最多 8 条输入，超时默认 10 秒，响应上限 4 MiB；模型错误信息和返回正文
不透传。服务商会收到查询与确认补建的摘要，它们仍可能包含敏感信息；脱敏只是尽力而为。

## 命令

```text
/memory                      数据库状态
/memory sources              来源允许列表
/memory rescan               扫描摘要，不生成向量
/memory embed status         当前模型向量覆盖率
/memory embed backfill       确认后补建最多 20 条摘要
/memory embed backfill 100   确认后补建最多 100 条摘要
/memory prune <days>         沿用上游的持久删除语义，相关向量同步删除
```

补建必须在交互 UI 中明确确认，不能靠模型工具自动触发。多次执行增量续建，已有有效向量
不重复请求；失败的摘要保持待补建。启动与扫描不会隐式补建。数据库删除或会话关闭期间
返回的请求不会恢复已删除记录或重开数据库。无需向量库服务。

当前实现使用 JS 精确余弦遍历：流式读取 float32，只保留语义前 20 名，每 32 块
让出事件循环；每个实例同时只进行一次语义查询，其余调用走关键词回退。
补建只处理按数据库 id 排序最早的 `maxBlocks` 块，
默认/硬上限为 10000；后续块不会因重复 backfill 自动进入这一区间。项目过滤搜索时也只
扫描该项目最早的 `maxBlocks` 块。超过上限会显示覆盖率截断，需清理旧记录或后续升级
分页索引。这是初版明确的容量限制，不是无限增量索引或百万记录 ANN 系统。

## 项目集成与验证

根 `fuyao-pi` manifest 加载 `packages/memory/src/index.ts`；setup 替换外部 memory 包。
不要同时安装原插件。Node >=22.19（`node:sqlite`）为必需；Bun 用于仓库构建，
记忆测试使用 Node：`bun run test:memory`。`bun run check` 会包含全部记忆测试。

保留上游 MIT 许可证与来源；自有增强集中在 Embedding、向量存储和融合排序模块，
便于人工合并上游修复。审核、UI、SSH 插件各自位于独立的 `packages/` 子目录。
