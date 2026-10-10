# 验证记录与验收清单

适用版本：`0.1.0-alpha.1`。

**记录原则：未附运行证据的项目一律为待验证。** 测试文件、CI 配置、在线截图或开发者机器上能启动，都不能单独证明特定平台通过。此文档建立验收方法；发布负责人应补全下方实际运行记录。

## 运行证据

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 数值/项目逻辑单元测试 | 待填实际运行结果 | 待填命令、提交与输出摘要 |
| 生产构建 | 待填实际运行结果 | 待填命令、提交与输出摘要 |
| 本机 macOS 浏览器交互 | 待填实际运行结果 | 待填系统、浏览器版本与步骤 |
| Windows Chrome CI | 已配置，尚无运行证据 | 待填写真实 CI URL 与结果 |
| Windows Edge CI | 已配置，尚无运行证据 | 待填写真实 CI URL 与结果 |
| macOS Chrome CI | 已配置，尚无运行证据 | 待填写真实 CI URL 与结果 |
| macOS Edge CI | 已配置，尚无运行证据 | 待填写真实 CI URL 与结果 |
| 已部署页面冒烟检查 | 待实际部署后核验 | 待填写访问时间、部署提交与结果 |
| 数据外发检查 | 待填实际运行结果 | 待填测试步骤与网络请求范围 |
| 实验图像算法可靠性 | 未实施；不属于此演示的验证结论 | 需要后续研究数据与方案 |

每次有效记录至少包含：应用版本、完整 commit、执行日期、系统/浏览器/Node 版本、命令或手工步骤、预期与实际结果、失败项及日志链接。CI 的 Linux Chromium 结果不能改写成 Windows Chrome 或 Edge 结果。

## 本版本功能验收

- [ ] 内置示例正确显示 8 图、2 批次、6 个样本与 6 个实验单位。
- [ ] 弱带、背景与饱和标签被识别为预设场景，而非自动诊断。
- [ ] ROI 或内参配对修改使相应预置结果失效，结果展示/导出不冒充新测量。
- [ ] 模板更新保持旧分析快照；显式重新应用后的修订可区分。
- [ ] 排除状态和备注保存后可恢复；不能把排除项目当有效值汇总。
- [ ] 项目包往返保存图像、ROI、样本关系、状态和版本；关键字段可对照。
- [ ] 刷新或重开后恢复状态；存储失败明确可见，不显示虚假的成功提示。
- [ ] 损坏、超限或不兼容项目包得到明确错误，不悄悄覆盖当前项目。
- [ ] 中英切换覆盖核心操作与错误；键盘操作和可读焦点通过人工检查。
- [ ] CSV 包含足够的 DEMO/状态与追溯字段，不能脱离模拟性质被误读。
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

Unchecked items and rows without evidence are pending. A test definition is not a passing test. Record exact commits, environments, commands, dates, outcomes, and failures. Linux Chromium results do not establish Windows Chrome/Edge compatibility. Synthetic workflow fixtures do not validate experimental-image quantification. Future validation needs pixel-level truth, authorized experimental data, method-matched comparisons, and separate batch-efficiency and delayed-return usability studies.
