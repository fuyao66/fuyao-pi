# Documentation map / 文档导航

## Current environment / 当前体系

| Document | Purpose |
| --- | --- |
| [Root README](../README.md) / [中文入口](../README.zh-CN.md) | 定位、能力、快速开始、目录职责 |
| [Architecture](architecture.md) | 上游底座、本地扩展、环境组合与私密状态的边界 |
| [Configuration](configuration.md) | 安装、配置优先级、备份回滚、自定义 agent 目录、旧仓库迁移 |
| [Plugin inventory](plugins.md) | 自研/派生/引用归属，以及固定版本清单 |
| [Maintenance](maintenance.md) | 新增扩展、测试、升级与提交原则 |
| [BCP compatibility](bcp-compatibility.md) | 版本变化、兼容验证及已知边界 |

## Capability contracts / 能力文档

| Capability | Current reference |
| --- | --- |
| UI | [Local provenance and customization](../packages/ui/UPSTREAM.md); child README is retained upstream reference |
| Advisor | [Fork contract and limits](../packages/advisor/UPSTREAM.md); child README is retained upstream reference |
| Memory | [Usage and current behavior](../packages/memory/README.md), [provenance](../packages/memory/UPSTREAM.md) |
| Remote SSH | [English](../packages/remote-ssh/README.md) / [中文](../packages/remote-ssh/README.zh-CN.md) |

插件细节以本地派生版本的契约为准。保留的上游安装说明不等于整套 fuyao-pi 的安装步骤。

## Design records / 设计记录

| Record | Status |
| --- | --- |
| [Memory audit](memory-audit.md) | Historical baseline findings; several defects were subsequently fixed |
| [Memory design](memory-design.md) | Historical broader proposal; curated/global facts and automatic injection are not implemented |
| [Memory roadmap](memory-roadmap.md) | Minimum-version delivery record; curated memory remains deferred |
| [Upstream Memory validation](../packages/memory/VALIDATION.md) | Retained upstream evidence, not an attestation of every local fork feature |
