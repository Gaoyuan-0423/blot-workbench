# 未分发材料 / Materials not distributed

这是有选择的公共文本证据入口，不是完整可复跑的源码、数据或环境归档。原始文件保留原位；导出副本的来源及变换见 [export-map.json](export-map.json)。

This is a curated text evidence entry point, not a complete reproducibility bundle. Original materials remain unchanged. The export map records original and exported byte hashes; hashes are not signatures or scientific validation.

## Local evidence

以下引用在原本机材料中存在或被明确登记为缺失，本仓库不提供下载：

- 原始图像、第三方厂商图像及其衍生图、模型、源码 ZIP/二进制补丁、截图、软著资料、任何凭据。
- 完整本机 `catalog.json` / `inventory.csv`、带全部输入位置的清单检查结果，以及依赖它们的 `check_framework.py`。本仓库只提供 [最终清单摘要](evidence/inventory-summary.json)。
- 完整数值输出、逐例引擎结果、fixture 生成器和执行环境。本仓库给出已有报告的摘要、容差、版本和源码哈希，不声称这些摘录能独立重跑所有结果。
- 交接文件 `02-实现与验证证据.md` 为各原始报告的合并副本；公开入口改为分别链接各轮记录，避免重复且不把历史状态当作当前集成结果。

The excluded set includes all original/vendor images and derived media, model files, source ZIPs/patches, screenshots, credentials and software-copyright paperwork. Full local catalogs, per-case numerical output and runtime dependencies are also excluded. The selected summary fields retain their source hashes and tolerances; no new engine run occurred during export.

原文中的命令及路径均是历史记录。`local-only/...` 和 `validation-evidence/...` 是解释性别名，不是本仓库保证存在的路径。要复跑须取得适用输入、原始报告/脚本、冻结源码与依赖，并使用新输出文件，不覆盖原件。

Historical commands are retained as records, not advertised as runnable from this directory. Obtain the eligible source inputs, complete scripts, frozen application sources and dependencies before reproducing a result. Record later integration checks separately.

### 原文中未随包分发的链接目标 / Referenced local targets

- `d07-implementation/software-checks-final-reviewed/screenshots`
