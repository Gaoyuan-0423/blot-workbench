# 第一轮 P0 实现与验证记录

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `p0-implementation/IMPLEMENTATION.md`; 原件与导出件 SHA-256 见 [export-map.json](../../export-map.json). 未分发材料见 [说明 / omissions](../../NOT-DISTRIBUTED.md).

日期：2026-11-08。范围：D01/D02 的 qPCR 实验单位与分组；D03 的病理工作台当前结果有效性；配套 UI、导出和 CLI/MCP；D09 的部分报告来源保护。

本轮是软件开发回归，没有新增真实实验数据、独立外部留出或使用者研究。各测试分母不合并为科学验证通过率。正式提交稿、历史数值基准与原始数据保留原位。

## 已实现行为

### qPCR

- 实验设计表按原始板号与样本确认独立单位、组别和对照组。名称建议不会自动确认独立性；修改设计即取消确认。
- 技术孔在确认的单位内部聚合，每单位贡献一个 ΔCt，对照单位等权。组表分别报告 nBio/nTech；技术孔复制不增加 nBio 或改变该单位的权重。
- 两个总组使用 Welch；三个及以上总组包含对照做 ANOVA，并报告 Dunnett 对照比较。样本行不承载组间 p 值。未确认、冲突、配对/重复测量不产生独立组推断；后两类目前明确不支持。
- 独立设计中的同单位跨组、来源组别冲突、跨组配对 ID、缺选定内参和独立重复不足都有可定位的提示。跨板同名来源分别做 QC，只有显式映射才合并为同一单位。
- 图表按组展示单位 FC 的算术均值和 SD/SEM；这与组均值 ΔCt 转换的 FC 分开标注。未确认时只展示技术变化，不显示组间 p。缺失 FC 不画成零值柱。
- Excel 保存设计、样本描述与组表；Prism 分离技术 Cq、描述 FC、技术 SD 和单位级 ΔCt/FC。缺失 FC 留空并解释；身份错配不猜测单位。仅完成 XML/浏览器下载检查，未在 GraphPad Prism 桌面软件实际导入。
- 旧项目不自动获确认；新设计可在项目包中往返。主质量报告按当前数据/设置重算；导入时标准曲线、RDML 等信息另列为历史记录。AI 解读绑定当前分析及模型选择，变更后旧卡片卸载并中止请求，不自动追加模型调用。
- CLI/MCP 传递显式设计，旧引擎缺契约时只返回描述。带设计的 CLI 暂接受一个输入文件（表内可含多板），不隐式组合多个文件。HTTP 自动分析端点仍只描述。

### IHC / IF / H&E / Masson 共用的病理工作台

显示、overlay、窗口 API、报告、Methods、样本保存和项目导出共用当前结果检查。输入、ROI、参数、AI 开关或模型内容改变后，旧结果立即失效；迟到结果/失败不得覆盖新请求，失败可重试。AI 模型按内容 SHA-256 识别；异步 worker 请求串行避免共享会话换模型。旧项目结果只作为历史，不补造有效身份，未重算不能重新包装为当前结果。

IF Methods 明确现阶段使用 RGB 整图和当前通道/阈值；本轮未增加 IF ROI 或原始多通道计算。病理图像解码和测量公式未改，未重跑历史 35 图精度基准。详见 `pathology-validation.md`。

## 实际验证

| 范围 | 实际命令 / 证据 | 最终结果 |
|---|---|---|
| qPCR 全部单元测试 | pcr-workbench 内 `npm test` | 23 文件、194 tests 通过 |
| qPCR 生产构建 | `npm run build` | TypeScript 与 Vite 通过 |
| qPCR 全部浏览器检查 | `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=5188 npx playwright test` | 28/28 通过 |
| CLI 全部单元测试及语法检查 | wisplab-cli 内 `npm run check && npm test` | 47/47 通过 |
| 病理单元测试与构建 | pathology-workbench 内 `npm test`、`npm run build` | 19 文件、163 tests 通过；构建通过 |
| 病理浏览器检查 | `pathology-validation.md` 中的命令 | 4/4 通过，其中 2 条新有效性检查、2 条现有真实 worker smoke |
| 独立数值参考 | `compare-qpcr-scipy.py`、`independent-qpcr-numerics-2026-11-08.json` | 3 个固定合成场景、306 个字段/不变性检查通过；不代表 306 个实验 |
| 原始材料完整性 | `python3 check_framework.py --output inventory-audit-after-p0.json` | 90 个哈希匹配、0 errors、5 既有 warnings |

独立参考用 Python/SciPy 从固定原始孔值重新计算单位汇总、等权对照、Welch、ANOVA 和 Dunnett。Welch p 为 0.04191451747145414（SciPy 0.0419145174714541）；包含对照的三组 ANOVA p 为 0.010518015685796134（SciPy 0.010518015685796127）。Dunnett 的 SciPy 随机积分对照使用固定 seeds 和预设绝对容差 0.0005；本轮误差小于该容差，不替代已有深尾部回归。

病理 AI 缓存与异步行为使用受控 worker / mock session；没有使用真实 ONNX 权重评价分割准确性。浏览器使用已安装 Chrome 的独立 headless 进程；默认 Playwright 自带 Chromium 缺失的首次启动失败保留在工作记录中，随后用 Chrome 完成检查。

首次全套 qPCR 浏览器检查为 22/28：发现重算报告遗漏导入记录，以及旧测试仍假定自动合并跨板身份、自动推断和 Mean/SD 重复表。补回明确标注的历史记录，跨板用例增加显式单位映射，导出/推断断言改为新契约后，最终全套 28/28。未降低数值精度或跳过失败测试。

qPCR lint exit 0，仍有 23 条 React/正则等 warnings；病理 lint exit 0，仍有 11 条 warnings。两者构建仍有打包体积提示，qPCR 另有重复静态/动态导入提示；本轮未做性能优化或性能基准。

## 版本与可复核性

三个仓库均在本地 `codex/validation-p0-20261108`，未提交、推送或部署。基线 HEAD 不是本轮代码版本；具体更改文件和字节哈希见 `source-state.json`。该清单便于核对本次未提交工作树，不是签名或永久归档。

- qPCR 基线：`a0642a7b5eee6f576e3257f5c61efaabae1741ed`。
- 病理基线：`bb9c45c0fc81fe7ea0c449d209e9d63e6eb66a2e`。
- CLI 基线：`714197daae7a99eac20c68871e9928f837e4ab66`。

## 尚未完成

D04 的动物/患者/培养批次—切片—视野关系与病理组统计仍待实现；当前病理样本条目不能因此被解释为已验证的生物学独立单位。D07 IF ROI、D11 原始多通道/高位深、WB 项目与 CLI 固定配置重放及各指标独立真值验证仍在原计划中。

D09 标为部分实现：当前数值报告与解读失效保护已加入，但还需单独的延迟模型响应端到端验收和更完整的报告来源归档。未连接外部模型运行真实 AI 解读测试。

C01–C04 有对应开发回归证据；原预设 challenge 的独立裁定、冻结任务和盲评尚未开始，不能据此报告错误检出率、误阻断率或真实用户收益。其余案例不因本次单元测试通过而自动完成。现有数据仍全部属于 development_regression，external_holdout=0。

这些结果支持“具体规则已实现、规定软件场景可复现”。它们不证明每个实验设计被正确填写、分割等于生物学真值，或生物学结论有效；也不构成 Nature Methods 录用把握的证据。
