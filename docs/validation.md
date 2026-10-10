# 验证记录与验收清单

适用版本：`0.1.0-alpha.1`。

**记录原则：未附运行证据的项目一律为待验证。** 测试文件、CI 配置、在线截图或开发者机器上能启动，都不能单独证明特定平台通过。以下区分实际运行记录与仍需验证的研究问题。

## 运行证据

记录日期：**2026-10-10（Asia/Shanghai）**。已合并应用版本对应提交 [`7ea215419f51df283962d62b8ead768a6758caba`](https://github.com/Gaoyuan-0423/blot-workbench/commit/7ea215419f51df283962d62b8ead768a6758caba)。该提交的 [main CI 38060883807](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38060883807) 与 [Pages 部署 38061081294](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38061081294) 均成功。发布标签包含后续文档归档，最终标签提交、CI 与部署运行链接以 [Release](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1) 的固定记录为准，不将历史运行冒充标签提交的验证。

| 项目 | 状态与证据 |
| --- | --- |
| 核心与持久化测试 | main CI 通过 18/18 项 |
| 发布、指标与打包脚本测试 | main CI 通过 12/12 项 |
| 生产构建 | main CI 中 TypeScript 与 Vite 构建成功；保存 `web-dist` 构建附件 |
| Windows Chrome / Edge | main CI 两个实际浏览器作业分别通过 7/7 E2E |
| macOS Chrome / Edge | main CI 两个实际浏览器作业分别通过 7/7 E2E |
| 已部署页面冒烟检查 | 在实际 [Pages 子路径](https://gaoyuan-0423.github.io/blot-workbench/) 显示 8 图、2 批次、6 实验单位；进入分析、ROI X 从 48 改为 49 后结果失效且禁止确认；刷新保留该状态；恢复示例与中英文切换正常；所检查过程未见浏览器控制台错误 |
| 项目迁移 | E2E 在隔离的新浏览器上下文重新导入导出包并核对；不是两台物理计算机的人工迁移试验 |
| 数据外发检查 | E2E 覆盖的载入后分析、编辑 ROI、恢复、确认、结果与保存操作无新增 HTTP 请求；不代表任意操作的完整网络审计 |
| 示例文件一致性 | 8 PNG 与清单/项目包 SHA-256 一致，包内 9 项；CSV 18 数据行，全部标为 `TRUE_SYNTHETIC_PRESET` |
| 实验图像算法可靠性 | 未实施；不能从工作流测试推导科研有效性 |

远端操作系统、Node 和浏览器的实际版本以固定 CI 日志为准。本地保存修复对应源码 `1d1e0d0bb6d076c7834d42ec62ff3db0998adb91`，在 macOS 27.0.1、Node.js 22.22.0、Chrome 155.0.8059.39 和 Edge 155.0.4283.45 上分别通过 7/7 E2E。本地与远端证据分开记录。

七个 E2E 用例覆盖示例与中英切换、显示与计算分离、ROI 失效和刷新恢复、模板版本及批量应用、目标/内参双确认后的 CSV 导出与项目迁移、损坏项目保护及空项目往返、所列操作的请求检查，以及未失焦备注与样本名保存后直接刷新恢复。合法导入先确认替换工作区。它们不覆盖全部手工无障碍操作或真实图像定量。

## 本版本功能验收

- [x] 内置示例正确显示 8 图、2 批次、6 个样本与 6 个实验单位。
- [x] 界面明确把弱带、背景与饱和标签标为预设场景，而非自动诊断；用户理解程度尚待易用性研究。
- [x] ROI 或内参配对修改使相应预置结果失效，结果展示/导出不冒充新测量。
- [x] 模板更新保持旧分析快照；显式重新应用后的修订可区分。
- [x] 排除状态阻止有效结果导出；备注保存后可刷新恢复。
- [x] 项目包往返保存图像、ROI、样本关系、状态和版本；关键字段可对照。
- [x] 已保存状态在刷新后恢复，存储写入串行并覆盖失败处理；无痕模式、配额耗尽和长期清理仍须扩展实机测试。
- [x] 损坏、超限或不兼容项目包得到明确错误，不悄悄覆盖当前项目。
- [ ] 中英切换覆盖核心操作与错误；键盘操作和可读焦点通过人工检查。
- [x] CSV 保留 DEMO 标识与追溯字段，且只导出目标和内参均确认、参数有效的记录。
- [x] 本机生产预览与实际远端子路径部署可用；下载包完整性与最终发布证据另记录在 Release。

## 后续算法验证

1. **真值正确性**：另建有明确像素和已知积分的测试图，覆盖位深、信号极性、ROI 边界、背景梯度、饱和、非正分母与缺失配对。当前视觉演示图不代替真值集。
2. **真实图像**：经授权收集不同仪器、曝光和背景场景，分离开发集与留出验证集，记录失败模式与人工修正。
3. **方法一致性**：固定版本、ROI、背景和转换的 ImageJ 流程；报告偏差和一致性区间，不只报告相关系数。与不同算法的工具比较时说明定义差异。
4. **研究设计**：保留实验单位与技术重复层级；不把泳道或多次曝光直接当独立样本。

## 易用性研究

比较单张与批量任务的完成时间、操作次数、配对/样本错误、需要帮助的次数，以及项目恢复成功率。任务、教学时长和顺序应受控，保留失败个案。间隔数周后重复任务，测量恢复上下文的时间、独立完成率和求助次数。

这些是研究计划，不是已经取得的效果。样本量、预设主要终点和比较工具应在实际研究前确定；不在此编造提高百分比或发表保证。

## English summary

Main commit `7ea215419f51df283962d62b8ead768a6758caba` passed 18 core tests, 12 release/metrics/package tests, and 7 E2E tests in each of four Windows/macOS × Chrome/Edge jobs. Its Pages deployment succeeded and the live subpath passed the documented manual smoke check. The final release notes separately identify the tag commit and its own CI/deployment evidence. Migration tests use isolated browser contexts, not a manual two-computer study. Workflow checks do not validate experimental-image quantification or establish comprehensive accessibility/network audits.

生产依赖审查：2026-10-10 使用官方 npm registry 的 `npm audit --omit=dev --audit-level=high` 返回 0 条已知漏洞。此结果只反映当时的依赖通报，不构成全面安全审计。锁文件保留精确版本与 integrity，下载地址使用官方 npm registry。
