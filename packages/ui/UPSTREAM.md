# Fuyao Pi UI：本地维护的上游派生版本

此目录是用户明确指定的第三方源码例外，用于后续个人 UI 定制，不宣称为原创实现。

- 上游：https://github.com/beautifulrem/pi-sakura-cyberdeck
- 导入版本：1.1.5
- 导入提交：`16c065c48d2450cd4934b2068784be4b788bbca2`
- 许可证：MIT，保留 `LICENSE`、`NOTICE` 和 `licenses/pi-zentui-MIT.txt`。
- 导入方式：从当前已安装 checkout 复制 Git 跟踪文件；当时没有受跟踪源码改动。不复制 `.git`、`node_modules`、安装生成的 `package-lock.json` 或运行配置。
- 导入时调整：标为 private workspace，指向本仓库，补充直接使用的 pi-ai peer 声明，清理一个文件末尾空行；导入当时保留原视觉/交互逻辑。这不是对当前版本仍与上游相同的承诺，后续定制以本仓库源码、提交记录和测试为准。

保留包名与主题名以维持现有配置兼容性，不向 npm 发布同名包。`README.md` 是上游使用说明，其中上游安装命令不是 fuyao-pi 的安装方式。

## 在本仓库中加载

根 `package.json` 的 `pi` manifest 直接声明本目录的五个扩展入口和主题。`bun run setup --apply` 会移除受识别的外部 Sakura UI 包声明，避免重复注册 UI 原型补丁与主题。不要再单独安装上游 Git/npm 包，也不要同时安装 `packages/ui` 和根包。

## 定制入口

- `extensions/header/index.ts`：页头。
- `extensions/matrix/index.ts`：矩阵动画。
- `extensions/zentui/`：编辑区、消息、工具输出、footer 等 UI。
- `extensions/dual-quota/`：配额展示。
- `extensions/claude-shimmer/`：思考/生成状态视觉反馈。
- `themes/sakura-macaron.json`：主题色。

`bun run check:ui` 运行导入版本自带的清单、主题及静态回归检查。它不是完整类型检查或终端交互测试；实际视觉变更需在 regular/fullscreen、窄屏、缩放、中文输入场景手动验证。上游 UI 内部 API 适配风险仍然存在。

本次不搬运个人 UI 运行配置，旧配置仍留在 Pi agent 目录。上游 matrix 配置当前使用固定 `~/.pi/agent` 路径；自定义 agent 目录时不要假设所有 UI 状态完全隔离。
