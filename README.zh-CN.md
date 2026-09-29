# Pi SSH Remote

从 `omp-ssh-remote` 拆出的独立 Pi 适配快照。保留现有 Pi core、FFF、AFT、RTK 和可选 Tintin 集成，不承诺任意插件透明兼容。后续面向专门构建的 Pi Agent 体系演进，本次不重设计运行机制。

本仓库独立维护依赖锁、SSH 传输、构建和测试，不依赖 OMP 仓库。远端缓存命名保持原样，避免破坏已有部署。

## 构建

```sh
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
```

默认构建需要按包文档提供 AFT 原生文件。可用 `PI_WORKER_PLUGINS=none` 或 `PI_WORKER_PLUGINS=fff,rtk` 选择组件。生成 worker 不提交 Git。

构建不会全局安装 Pi，也不会启用用户插件。安装前请阅读托管插件加载顺序要求。

[完整使用说明](packages/pi/README.zh-CN.md) · [English](README.md)

[MIT](LICENSE)
