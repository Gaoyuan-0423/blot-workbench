# WB 图版与原始数据优化方案

日期：2026-10-20。范围：真实原图工作区的图版与原始数据功能。

## 目标与顺序

将现有原始像素分析、结果审计和项目备份连接到可检查的图版与原始数据文档：

1. **来源文档**：纳入项目全部原图，包括未进入图版及排除定量的图片；保留蛋白、实验/膜、曝光、复核状态、原图哈希和原始位深。图片类型与目标/内参分析角色分开记录。
2. **最小条带排版**：从已导入原图添加行，调整顺序、展示裁剪、面板字母、蛋白标签及分子量文字；整行等比例显示。
3. **导出检查**：依据原始裁剪像素与图版实际毫米宽度计算有效 DPI；提示来源分类、复核和标签问题。提示不等于期刊接受或图像真实性认证。
4. **资料交付**：导出图版 SVG/PNG、自包含原始数据 HTML，以及含完整项目包、来源记录和数值 CSV 的 ZIP。

## 数据约定

- `RealProject.publication` 是可选字段，旧项目可以继续载入。
- 图版裁剪使用原图整数像素坐标，与测量 ROI 独立；排版修改不更新图像分析 revision、不取消已完成的测量复核，也不重算数值。
- 项目导入和本机保存均验证引用、坐标、文字长度和条目数量；恢复后仍能编辑。
- 图片类型包含未分类、化学发光、叠加图、白光图、整膜染色及长曝光。未分类不会被静默推断成某个类型。
- SVG/HTML 中的图像是独立显示预览；原始 8/16 位文件随嵌套项目包保留。展示预览不能替代原始像素用于定量。
- 全图文档保留完整视野，再叠加或注明图版的裁剪区域；原图没有被物理裁剪覆盖。
- 资料中保留准备稿状态，用户仍需核对来源、标注及提交要求。

## 用户流程

导入原图并完成分析 → 进入“图版与原始数据” → 确认图片类型 → 添加条带行及标签 → 调整展示裁剪和毫米宽度 → 检查预览与提示 → 导出。

HTML 可离线打开，使用浏览器的打印功能另存为 PDF。首版不提供原生 PDF、PPTX 或 XLSX 导出；结果 CSV 与统计 CSV 沿用现有计算。

## 验收

- 修改图版前后原图字节、ROI、复核状态、分析版本及数值一致。
- 图版设置经过本机保存、页面刷新和项目包恢复后保持一致；旧项目不需要迁移操作。
- HTML 覆盖全部原图，资料包原文件哈希一致；用户输入在 SVG/HTML 中安全转义。
- 低分辨率原图不会因增加栅格化倍数或写入 DPI 元数据而被误判成高分辨率。
- 中文/英文切换保留设置；桌面与窄屏均能操作。
- 运行单元测试、生产构建及新增浏览器流程，另记录实际执行结果。

## 后续独立迭代

跨图配准及 merge/ECL 标注同步需要明确的图像关联和坐标变换；PPTX、XLSX 需要各自的格式与显示验证。这些功能不应通过简单复制同尺寸坐标或更换文件后缀代替。

## 本次验证记录

2026-10-20，本机 macOS：

- `npm run check`：24 个测试文件、224 项单元测试通过，TypeScript 与生产构建通过。
- 新增 `publication.spec.ts` 浏览器流程通过：8-bit TIFF/16-bit PNG 导入、图版编辑/排序、越界输入恢复、中英切换、刷新与项目恢复、PNG 实际图像像素、HTML 文本转义，以及资料 ZIP 内原始文件逐字节一致。
- 原有 `real-images.spec.ts` 与 `real-recognition-guidance.spec.ts` 共 7 项浏览器回归通过。
- 检查 1440px 桌面及 390px 窄屏布局；窄屏无横向页面溢出。
- 合成示例 HTML 经浏览器实际打印为 3 页 A4 PDF：概览一页、两张原图各一页；已检查原图、坐标标示与数据表没有裁切。
- 调整排版后结果 CSV、图像分析记录及原图字节保持一致；rolling-ball 文档不显示未参与计算的局部背景矩形。

截图和打印文件保存在本机 `.release/publication-*`，仅含合成示例。上述是发布前本机的软件行为验证，不是新的定量准确率或跨平台验证；线上发布结果以 `20261020-wb-publication` 的统一发布记录与各站 `/release.json` 为准。

## English

This iteration connects existing measurements and provenance to editable strip figures and complete source-data documents. Presentation crops, labels, row order and image classifications are stored separately from measurement ROIs. Existing projects remain readable; figure edits do not change numerical results or measurement review.

The workflow supports SVG/PNG figures, an offline printable HTML report, and a ZIP with source metadata, result/statistics CSV files and a complete project archive containing the original bytes. Report previews are display images, not quantitative source rasters. Effective DPI is calculated from source crop pixels and physical placement size. Browser printing can save the HTML as PDF; native PDF/PPTX/XLSX and cross-image registration are future work.
