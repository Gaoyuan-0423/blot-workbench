# 验证记录与验收清单

适用版本：`0.1.0-alpha.1`。

**记录原则：未附运行证据的项目一律为待验证。** 测试文件、CI 配置、在线截图或开发者机器上能启动，都不能单独证明特定平台通过。此文档建立验收方法；发布负责人应补全下方实际运行记录。

## 运行证据

本地验证日期为 **2026-10-10（Asia/Shanghai）**，应用版本 `0.1.0-alpha.1`，应用源码提交为 [`729a3ecc2576e9fae7d0af407fadb2632b76e87f`](https://github.com/Gaoyuan-0423/blot-workbench/commit/729a3ecc2576e9fae7d0af407fadb2632b76e87f)。后续文档和截图归档不改变这次验证对应的应用源码。

| 本地环境 | 版本 |
| --- | --- |
| 系统 | macOS 27.0.1 |
| Node.js | 22.22.0 |
| Google Chrome | 155.0.8059.39 |
| Microsoft Edge | 155.0.4283.45 |

远端矩阵证据为 [PR CI run 38059375635](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059375635)。该运行的四组浏览器检查最终均已通过。远端 runner 与浏览器的具体版本以该运行日志为准，不套用本机版本。

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 数值/项目逻辑单元测试 | 本地通过 18/18 项 | 上述源码和本地环境；`npm test`；覆盖核心状态与持久化逻辑 |
| 发布辅助脚本测试 | 本地通过 11/11 项 | 上述源码和本地环境；`node --test scripts/*.check.mjs` |
| 生产构建 | 通过 | 上述源码；`npm run build`，TypeScript 与 Vite 构建成功 |
| 本机 macOS Chrome E2E | 本地通过 6/6 项 | `BROWSER_CHANNEL=chrome npm run test:e2e`；上述 Chrome 版本 |
| 本机 macOS Edge E2E | 本地通过 6/6 项 | `BROWSER_CHANNEL=msedge npm run test:e2e`；上述 Edge 版本 |
| Windows Chrome CI | 已通过 | [同一 PR CI 运行](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059375635)，Windows / Chrome 作业 |
| Windows Edge CI | 已通过 | [同一 PR CI 运行](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059375635)，Windows / Edge 作业 |
| macOS Chrome CI | 已通过 | [同一 PR CI 运行](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059375635)，macOS / Chrome 作业 |
| macOS Edge CI | 已通过 | [同一 PR CI 运行](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059375635)，macOS / Edge 作业 |
| 已部署页面冒烟检查 | 待实际部署后核验 | 待填写访问时间、部署提交与结果 |
| 数据外发检查 | 本地 E2E 所覆盖操作无新增 HTTP 请求 | 载入后进入分析、编辑 ROI、恢复、确认、打开结果并保存；不代表任意操作或未来部署的完整网络审计 |
| 示例文件一致性 | 本地核对通过 | 8 PNG 与清单/项目包 SHA-256 一致，包内 9 项；CSV 18 数据行，全部标为 `TRUE_SYNTHETIC_PRESET` |
| 实验图像算法可靠性 | 未实施；不属于此演示的验证结论 | 需要后续研究数据与方案 |

每次有效记录至少包含：应用版本、完整 commit、执行日期、系统/浏览器/Node 版本、命令或手工步骤、预期与实际结果、失败项及日志链接。CI 的 Linux Chromium 结果不能改写成 Windows Chrome 或 Edge 结果。

本地运行摘要对应上述源码提交；远端结果对应链接中实际被测试的 PR 提交。六个 E2E 用例覆盖示例与中英切换、显示与计算分离、ROI 失效和刷新恢复、模板版本及批量应用、双确认 CSV/项目迁移、损坏项目保护与空项目往返，以及所列操作的请求检查。它们不证明真实实验图像算法有效，也不覆盖所有人工无障碍检查。

## 本版本功能验收

- [x] 内置示例正确显示 8 图、2 批次、6 个样本与 6 个实验单位。
- [ ] 弱带、背景与饱和标签被识别为预设场景，而非自动诊断。
- [x] ROI 或内参配对修改使相应预置结果失效，结果展示/导出不冒充新测量。
- [x] 模板更新保持旧分析快照；显式重新应用后的修订可区分。
- [ ] 排除状态和备注保存后可恢复；不能把排除项目当有效值汇总。
- [x] 项目包往返保存图像、ROI、样本关系、状态和版本；关键字段可对照。
- [ ] 刷新或重开后恢复状态；存储失败明确可见，不显示虚假的成功提示。
- [x] 损坏、超限或不兼容项目包得到明确错误，不悄悄覆盖当前项目。
- [ ] 中英切换覆盖核心操作与错误；键盘操作和可读焦点通过人工检查。
- [x] CSV 保留 DEMO 标识与追溯字段，且只导出目标和内参均确认、参数有效的记录。
- [ ] 本机生产预览资源、示例和下载链接有效；实际远端子路径部署单独检查。

## 后续算法验证

1. **真值正确性**：另建有明确像素和已知积分的测试图，覆盖位深、信号极性、ROI 边界、背景梯度、饱和、非正分母与缺失配对。当前视觉演示图不代替真值集。
2. **真实图像**：经授权收集不同仪器、曝光和背景场景，分离开发集与留出验证集，记录失败模式与人工修正。
3. **方法一致性**：固定版本、ROI、背景和转换的 ImageJ 流程；报告偏差和一致性区间，不只报告相关系数。与不同算法的工具比较时说明定义差异。
4. **研究设计**：保留实验单位与技术重复层级；不把泳道或多次曝光直接当独立样本。

## 易用性研究

比较单张与批量任务的完成时间、操作次数、配对/样本错误、需要帮助的次数，以及项目恢复成功率。任务、教学时长和顺序应受控，保留失败个案。间隔数周后重复任务，测量恢复上下文的时间、独立完成率和求助次数。

这些是研究计划，不是已经取得的效果。样本量、预设主要终点和比较工具应在实际研究前确定；不在此编造提高百分比或发表保证。

## English summary

On 2026-10-10, source commit `729a3ecc2576e9fae7d0af407fadb2632b76e87f` passed 18 core tests, 11 script tests, and 6 E2E tests in each of Chrome 155.0.8059.39 and Edge 155.0.4283.45 on macOS 27.0.1 with Node.js 22.22.0. The linked PR CI run had passed Windows Chrome, macOS Chrome, and macOS Edge when recorded; Windows Edge was still running. Unchecked items remain pending. These workflow checks do not validate experimental-image quantification or establish complete accessibility/network audits. Future scientific validation needs pixel-level truth, authorized experimental data, method-matched comparisons, and separate batch-efficiency and delayed-return studies.

## 保存修复复核（2026-10-10）

源码 `1d1e0d0bb6d076c7834d42ec62ff3db0998adb91` 在上述本地环境的 Chrome 与 Edge 各通过 **7/7** E2E。新增未失焦的备注和样本名自动保存后直接刷新恢复检查；合法导入现在先确认替换工作区。生产构建通过。原六项测试仍保留。

修复前六项测试的[远端 CI](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059375635)最终四组均通过。修复后[远端 CI](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38059973586)执行结果以该固定运行记录为准；未将不同提交的检查混为同一证据。发布部署工作流额外要求待部署提交在 main 上的完整 CI 通过。

生产依赖审查：2026-10-10 使用官方 npm registry 的 `npm audit --omit=dev --audit-level=high` 返回 0 条已知漏洞。此结果只反映当时的依赖通报，不构成全面安全审计。锁文件保留精确版本与 integrity，下载地址使用官方 npm registry。
