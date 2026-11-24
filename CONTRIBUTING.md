# 参与开发

[English summary](#english-summary)

感谢参与开源文明 BCI-001。动手之前，请先读 [产品原则](docs/product-principles.md)：界面叫法、文案规范和已经确定的方向都写在那里。

## 先讨论，再写代码

| 改动类型 | 怎么做 |
|---|---|
| bug 修复、测试、性能、构建、平台适配 | 直接提 PR |
| 用户能看到的变化：界面、文案、流程、新增步骤或页面 | 先开 issue，附截图或 HTML 草图讨论，确认后再写代码 |
| 新功能、改动数据格式或开发接口 | 先开 issue 说明目的和方案 |

体验类改动由产品负责人确认。没有讨论过就提交的大范围界面改动，可能只会被部分采纳。

## PR 要求

- **一个 PR 只做一件事。** bug 修复和体验改动分开提；改动超过约 300 行时，先开 issue 对齐。
- **说明写清楚**：解决什么问题、怎么验证的、还有哪些没验证（例如真机）。
- **界面改动附截图**：改前、改后各一张；涉及窗口尺寸的，附小屏截图。
- **不破坏另一个平台。** 平台相关的代码用 `process.platform` 隔离，Windows 和 macOS 都要能运行。
- **测试**：修改时运行 `npm run test:changed`；提交前运行 `npm test`。新增界面测试要登记到 `scripts/run-tests.cjs` 的 `AREAS`。
- **格式**：`npm run format:check` 通过。
- **提交信息**：说明改了什么、为什么，中英文均可。

## 分支

- `master` 是唯一主线，只通过 PR 合并。
- 分支名用 `类型/简述`，例如 `fix/record-start`、`feat/macos-dmg`、`docs/glossary-alpha`。

## 不能做的事

以下属于产品底线，相关 PR 不会被合并：

- 上传、同步或收集用户的脑电和使用数据；加入遥测或云端依赖。
- 在界面、文档中出现诊断、治疗、健康评估、改善睡眠或专注等医疗、保健表述。
- 加入任何电刺激功能。
- 在概念手册中出现其他品牌或厂商名称。

## 环境与构建

见 [README · 开发环境](README.md#开发环境)。

## 概念手册

只改内容不需要写代码，见 [content/glossary/README.md](content/glossary/README.md)，提交前运行 `npm run check:glossary`。

## 许可

提交的代码以 [MIT](LICENSE) 许可发布。

---

## English summary

- Read [docs/product-principles.md](docs/product-principles.md) first (Chinese).
- Bug fixes, tests, build and platform work: open a PR directly. Anything users can see (screens, copy, flows) or new features: open an issue with a sketch first.
- One topic per PR; include before/after screenshots for UI changes; keep Windows and macOS both working; run `npm run test:changed` while working and `npm test` before submitting.
- Never add data upload, telemetry, medical or wellness claims, or electrical stimulation.
