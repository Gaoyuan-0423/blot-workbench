/** Interface and system-message catalog. Keys are stable Chinese source messages. */
export const messages: Record<string, string> = {
  "8/16-bit TIFF（64 MB）· 8-bit PNG / JPG（15 MB）":
    "8/16-bit TIFF (64 MB) · 8-bit PNG / JPG (15 MB)",
  "原始位深像素估计 · 自动取样待核对 · 未做内参归一化":
    "Original-depth pixel estimate · Review automatic regions · No reference normalization",
  "Blot Workbench · 原始位深像素估计 · 自动草稿，取样框待核对":
    "Blot Workbench · Original-depth pixel estimate · Automatic draft; review sampling regions",
  "原始位深像素估计 · 自动取样需核对 · TIFF 保留 8/16-bit 测量值":
    "Original-depth pixel estimate · Review automatic regions · TIFF retains 8/16-bit measurement values",
  "请选择有效的 8/16-bit TIFF 或 8-bit PNG/JPEG 图片。":
    "Choose a valid 8/16-bit TIFF or 8-bit PNG/JPEG image.",
  "TIFF 超过 64 MB，请先裁出需要分析的条带。":
    "TIFF exceeds 64 MB. Crop to the strip you need to analyze.",
  "文件扩展名与 TIFF 内容不一致。":
    "The file extension does not match TIFF contents.",
  "像素位深无效。": "Invalid pixel bit depth.",
  "像素值超出原始位深范围。": "Pixel values exceed the source bit-depth range.",

  "阿里云百炼 DashScope（国内）": "Alibaba Cloud DashScope (China)",
  "DashScope（国际）": "DashScope (International)",
  "硅基流动 SiliconFlow": "SiliconFlow",
  "服务响应超过大小限制。": "Provider response exceeded the size limit.",
  "服务响应没有内容。": "Provider response has no body.",
  "不允许服务重定向。": "Provider redirects are not allowed.",
  "服务响应必须包含一个候选结果。": "Provider response has no single choice.",
  "服务响应中的候选结果无效。": "Provider response choice is invalid.",
  "服务未返回可用内容。": "Provider did not return usable content.",
  "服务内容不是有效的 JSON。": "Provider content is not valid JSON.",
  "服务返回的条带候选未通过验证（泳道、范围或重复项）。":
    "Provider band candidates failed validation (lanes, bounds, or duplicates).",
  "服务返回了超出声明数量的泳道。":
    "Provider returned a lane beyond the declared count.",
  "组合图版需要包含图像数据的 URL。":
    "The composed figure needs a self-contained image data URL.",
  "滚动球半径须为 10–200。": "Rolling-ball radius must be 10-200.",
  "滚动球背景与图像尺寸不一致。":
    "Rolling-ball background does not match the raster dimensions.",
  "项目包不是有效的 ZIP 文件。": "invalid zip data",

  "第 {0} 排": "Row {0}",
  "有 {0} 项取样提示": "{0} sampling notices",
  "仍显示上一张图片。": "The previous image is still displayed.",
  "单条带识别-结果.csv": "single-strip-results.csv",
  "浏览器无法导出图片，请导出 CSV。":
    "This browser cannot export the image. Export CSV instead.",
  "图片导出失败，请导出 CSV。": "Image export failed. Export CSV instead.",
  "单条带识别-结果.png": "single-strip-results.png",
  返回工作台: "Back to workbench",
  单条带识别: "Single-strip analysis",
  "本机分析 · 本地项目保存": "Local analysis · Local project files",
  "一个栏目，一张条带图": "One workspace. One strip.",
  "导入一张裁好的条带图，自动识别，直接看结果。":
    "Import a cropped strip, detect bands automatically, and see the results immediately.",
  导入单排条带图片: "Import a single-strip image",
  关闭提示: "Dismiss message",
  "正在识别条带…": "Detecting bands…",
  拖入你的条带图片: "Drop your strip image here",
  "也可以粘贴截图，或从电脑中选择":
    "You can also paste a screenshot or choose a file",
  导入图片: "Import image",
  "8-bit PNG / JPG · 单排条带 · 最大 15 MB":
    "8-bit PNG / JPG · Single strip · Up to 15 MB",
  先看看效果: "See how it works",
  试用示例: "Try example",
  更换图片: "Replace image",
  条带图片: "Strip image",
  等待调整: "Awaiting adjustment",
  单排条带取样预览: "Single-strip sampling preview",
  条带框: "Band region",
  背景框: "Background region",
  拖动框可微调: "Drag regions to adjust",
  "识别不准？调整取样": "Need a correction? Adjust sampling",
  图像类型: "Image type",
  "自动判断（": "Automatic (",
  浅底深带: "Dark bands on light background",
  深底浅带: "Light bands on dark background",
  浅底深色条带: "Dark bands on light background",
  深底浅色条带: "Light bands on dark background",
  泳道数量: "Lane count",
  重新识别: "Detect again",
  选择取样框: "Select region",
  编辑泳道: "Edit lane",
  泳道: "Lane",
  取样区域: "Sampling region",
  编辑取样类型: "Edit region type",
  对照泳道: "Control lane",
  宽: "Width",
  高: "Height",
  添加背景框: "Add background region",
  识别结果: "Detection results",
  自动生成: "Generated automatically",
  尚无有效结果: "No valid results yet",
  单条带相对强度: "Single-strip relative intensity",
  "扣背景后的相对强度 · 泳道": "Background-corrected relative intensity · Lane",
  "8-bit 像素估计 · 自动取样待核对 · 未做内参归一化":
    "8-bit pixel estimate · Review automatic regions · No reference normalization",
  导出结果图: "Export result chart",
  "导出 CSV": "Export CSV",
  查看数值明细: "View measurements",
  单条带数值明细: "Single-strip measurements",
  净信号: "Net signal",
  相对值: "Relative value",
  "识别到条带后，结果会直接显示在这里。":
    "Results will appear here when bands are detected.",
  "请保留条带上下和两侧的空白背景。":
    "Keep blank background above, below and beside the bands.",
  "本地处理 · 自动取样需核对 · 刷新前请导出":
    "Local processing · Review automatic regions · Export before refreshing",
  "多排 / 内参分析": "Multiple rows / reference analysis",
  条带相对强度柱状图: "Relative band intensity bar chart",
  内参归一化后相对强度: "Reference-normalized relative intensity",
  扣背景后的相对强度: "Background-corrected relative intensity",
  "· 对照 = 1": "· Control = 1",
  待调整: "Needs adjustment",
  对照: "Control",
  "Blot Workbench · 8-bit 像素估计 · 自动草稿，取样框待核对":
    "Blot Workbench · 8-bit pixel estimate · Automatic draft; review sampling regions",
  "浏览器无法导出图表。": "This browser cannot export the chart.",
  "PNG 导出失败，请导出 SVG。": "PNG export failed. Export SVG instead.",
  "内参与目标的泳道数量不同。请调整取样框，数量一致后才计算归一化结果。":
    "Reference and target lane counts differ. Adjust the regions; normalization requires matching lane counts.",
  印迹工作台: "Western blot workbench",
  简易版: "Simple mode",
  模式: "Mode",
  快速定量: "Quick quantification",
  项目演示: "Project demo",
  "条带与结果，一眼对上。": "Your bands and results, side by side.",
  "导入条带，直接看结果": "Import bands. See results.",
  "自动取样、扣除背景、生成图表。检查框的位置，修改后结果随即更新。":
    "Sample regions, subtract background and generate charts automatically. Review the regions; results update as you adjust them.",
  "放入一张 WB 图片，自动取样、扣背景、出图。单排条带和多排膜图都可以。":
    "Import a WB image for automatic sampling, background subtraction and charts. Supports single strips and multiple rows.",
  图片留在你的浏览器: "Images stay in your browser",
  "无需账号 · 无需配置 API": "No account or API setup required",
  导入条带图片: "Import band image",
  添加内参图片: "Add reference image",
  "正在读取图片并生成结果…": "Reading image and calculating results…",
  内参取样: "Reference sampling",
  "排 ·": "rows ·",
  条: "bands",
  换一张: "Replace image",
  把条带拖到这里: "Drop your bands here",
  或直接粘贴截图: "Or paste a screenshot",
  选择条带图片: "Choose band image",
  "8-bit PNG / JPG · 最大 15 MB": "8-bit PNG / JPG · Up to 15 MB",
  "还没有准备好图片？": "No image ready yet?",
  "合成条带，仅用于体验": "Synthetic bands for demonstration only",
  选择蛋白行: "Select protein row",
  第: "Row",
  排: "row",
  原图与取样框: "Original image and sampling regions",
  条带取样: "Band sampling",
  背景取样: "Background sampling",
  显示取样框: "Show sampling regions",
  "浅底 · 深色条带": "Light background · Dark bands",
  "深底 · 浅色条带": "Dark background · Light bands",
  调整取样框: "Adjust sampling regions",
  按数量重新取样: "Resample with this count",
  恢复自动取样: "Restore automatic sampling",
  "数量不对时重新取样；拖动绿色框可微调位置，方向键移动 1 像素。":
    "Resample if the count is incorrect. Drag green regions to adjust; arrow keys move them by 1 pixel.",
  "添加背景框，再调整位置": "Add a background region, then adjust its position",
  有: "There are",
  项取样提示: "sampling notices",
  "需要内参归一化？": "Need reference normalization?",
  "添加同一膜、相同泳道顺序的内参图片":
    "Add a reference image from the same membrane with matching lane order",
  添加内参: "Add reference",
  "内参文件：": "Reference file:",
  返回目标条带: "Back to target bands",
  调整内参取样: "Adjust reference sampling",
  已导入的内参图片: "Imported reference image",
  移除内参图片: "Remove reference image",
  定量结果: "Quantification results",
  "已生成 · 待核对": "Generated · Review required",
  等待调整取样: "Awaiting sampling adjustment",
  导入后自动生成: "Generated after import",
  "你的结果，就在这里": "Your results appear here",
  "图片与图表并排，变化一眼可见。":
    "Image and chart side by side, so changes are easy to see.",
  "无需翻页，也不用逐步点击分析。":
    "No extra pages or step-by-step analysis buttons.",
  自动扣背景: "Automatic background correction",
  对照倍数: "Fold change vs control",
  "图表与 CSV": "Chart & CSV",
  蛋白名称: "Protein name",
  "对照 = 1": "Control = 1",
  "（默认）": "(default)",
  内参: "Reference",
  内参条带: "Reference bands",
  不使用内参: "No reference",
  "内参文件 ·": "Reference file ·",
  "当前为扣背景后的相对灰度，未做内参归一化。":
    "Relative background-corrected intensity; no reference normalization.",
  "目标 / 内参，按从左到右配对后相对对照。请核对样本对应关系。":
    "Target / reference, paired left to right and relative to control. Verify the sample pairing.",
  条带: "Bands",
  还没有找到清晰条带: "No distinct bands found yet",
  "检查图像类型，或在左侧“调整取样框”中指定泳道数量。尽量使用裁去标签和边框的 WB 图片。":
    "Check the image type or specify a lane count under “Adjust sampling regions”. Use a WB image cropped to exclude labels and borders.",
  "暂时无法计算相对值，请检查取样背景、对照和内参。无效值显示为“—”。":
    "Relative values are unavailable. Check the background, control and reference. Invalid values appear as “—”.",
  "导出 PNG": "Export PNG",
  "导出 SVG": "Export SVG",
  条带定量结果: "Band quantification results",
  "泳道 / 样本": "Lane / sample",
  内参净信号: "Reference net signal",
  "净信号 = 条带积分 − 背景均值 × 取样面积。每根柱代表一条泳道，不自动推断生物学重复或显著性。":
    "Net signal = integrated band intensity − mean background × sampling area. Each bar represents one lane; biological replicates and significance are not inferred.",
  "本机计算。刷新前请下载项目文件或导出结果。":
    "Computed locally. Download a project file or export results before refreshing.",
  "8-bit 像素估计 · 自动取样需核对 · 原始 TIFF / 16-bit 请保留原始定量流程":
    "8-bit pixel estimate · Review automatic regions · Keep your original quantification workflow for TIFF / 16-bit data",
  多批次项目演示: "Multi-batch project demo",
  "图片尺寸与像素不一致。": "Image dimensions do not match the pixel data.",
  "请选择深色或浅色条带。": "Choose dark or light bands.",
  "仅支持 0–255 灰度像素。":
    "Only grayscale values from 0 to 255 are supported.",
  "未能可靠分开蛋白行，请裁剪到单排条带，保留上下空白背景。":
    "Protein rows could not be reliably separated. Crop to one strip and keep blank background above and below it.",
  "按水平信号自动分行，请核对每排是否对应同一蛋白；文字和边框也可能产生信号。":
    "Rows were detected from horizontal signals. Check that each row contains one protein; labels and borders may also create signals.",
  "泳道数量须为 1–32，且每个泳道至少有 3 像素宽。":
    "Use 1–32 lanes, with at least 3 pixels of width per lane.",
  "图片过小，请导入清晰的单排条带图。":
    "The image is too small. Import a clear single-strip image.",
  "未找到明确条带，请检查深浅色模式，或裁剪到单排条带并保留空白背景。":
    "No distinct bands found. Check the dark/light mode or crop to one strip with blank background.",
  "检测到多排信号，请启用多排自动分行，或裁剪到单排条带。":
    "Multiple rows detected. Use multi-row analysis or crop to one strip.",
  "条带或边框触及图片上下边缘，请保留完整条带和上下背景后重新导入。":
    "Bands or borders touch the top or bottom edge. Reimport with complete bands and background above and below them.",
  "条带或边框触及图片左右边缘，请保留完整条带及两侧空白后重新导入。":
    "Bands or borders touch the left or right edge. Reimport with complete bands and blank space on both sides.",
  "未能分开泳道，请手动指定泳道数，或裁剪掉文字与边框后重试。":
    "Lanes could not be separated. Specify the lane count or crop out labels and borders, then retry.",
  "已按整张图片等宽分配泳道，请核对框的位置；空泳道不会生成有效结果。":
    "Lanes were spaced equally across the image. Review the regions; empty lanes do not produce valid results.",
  "条带间距或宽度差异较大，无法放置同尺寸取样框；请指定泳道数并检查框的位置。":
    "Band spacing or widths vary too much for equal-sized regions. Specify the lane count and review region positions.",
  "泳道间距不均，可能漏掉弱条带或空泳道；请核对数量，必要时手动指定泳道数。":
    "Uneven spacing may hide weak or empty lanes. Check the count and specify it manually if needed.",
  "部分条带周围没有足够空白背景，将不计算其净信号；请扩大裁剪范围。":
    "Some bands lack enough blank background, so their net signal is unavailable. Include more background in the crop.",
  "条带 ID 重复。": "Duplicate band ID.",
  "条带取样框越界或坐标不是整数。":
    "Band regions exceed image bounds or use non-integer coordinates.",
  "条带取样框重叠，请调整泳道数或重新裁剪。":
    "Band regions overlap. Adjust the lane count or crop again.",
  "缺少有效背景，无法计算净信号。":
    "No valid background; net signal cannot be calculated.",
  "背景框与条带重叠，无法计算净信号。":
    "Background overlaps a band; net signal cannot be calculated.",
  "背景面积不足，无法计算净信号。":
    "Insufficient background area; net signal cannot be calculated.",
  "背景变化较大，可能包含其他条带、文字或边框，请重新裁剪。":
    "Background varies substantially and may contain other bands, text or borders. Crop again.",
  "扣背景后信号不大于零，请检查空泳道、取样框或深浅色模式。":
    "Background-corrected signal is not positive. Check empty lanes, regions and dark/light mode.",
  "存在接近饱和的像素，定量可能低估真实差异；请检查原始曝光。":
    "Near-saturated pixels may underestimate differences. Check the original exposure.",
  "图片尺寸无效，请重新导出图片。":
    "Invalid image dimensions. Export the image again.",
  "图片过大：最多 2000 万像素、单边 16000 像素，请先裁出需要分析的条带。":
    "Image too large: up to 20 million pixels and 16,000 pixels per side. Crop to the required bands first.",
  "JPEG EXIF 方向信息无效，请按需要的方向另存为 PNG 后导入。":
    "Invalid JPEG EXIF orientation. Save as PNG in the intended orientation, then import.",
  "JPEG 含旋转或翻转方向信息，请按需要的方向另存为 PNG 后导入。":
    "JPEG contains rotation or flip metadata. Save as PNG in the intended orientation, then import.",
  "PNG 文件头不完整。": "Incomplete PNG header.",
  "PNG 文件头无效。": "Invalid PNG header.",
  "PNG 编码格式无效或不受支持。": "Invalid or unsupported PNG encoding.",
  "PNG 文件不完整。": "Incomplete PNG file.",
  "请导入静态 PNG，暂不支持动画 PNG。":
    "Import a static PNG. Animated PNG is not supported.",
  "PNG 缺少有效的像素数据。": "PNG contains no valid pixel data.",
  "JPEG 段结构无效。": "Invalid JPEG segment structure.",
  "JPEG 文件不完整。": "Incomplete JPEG file.",
  "JPEG 段长度无效。": "Invalid JPEG segment length.",
  "JPEG 尺寸信息无效。": "Invalid JPEG dimensions.",
  "此简易模式仅支持 8-bit JPEG，请使用 8-bit 副本并保留原图。":
    "Simple mode supports only 8-bit JPEG. Use an 8-bit copy and keep the original.",
  "此 JPEG 编码暂不支持，请另存为 8-bit PNG 后导入。":
    "This JPEG encoding is not supported. Save as 8-bit PNG, then import.",
  "JPEG 颜色通道信息无效。": "Invalid JPEG color channels.",
  "JPEG 缺少完整的尺寸或像素信息。":
    "JPEG dimensions or pixel data are incomplete.",
  "图片超过 15 MB，请先裁出需要分析的条带。":
    "Image exceeds 15 MB. Crop to the required bands first.",
  "此简易模式暂不支持 TIFF，请导出 8-bit PNG 副本并保留原始 TIFF。":
    "Simple mode does not support TIFF. Export an 8-bit PNG copy and keep the original TIFF.",
  "请选择有效的 8-bit PNG 或 JPEG 图片。":
    "Choose a valid 8-bit PNG or JPEG image.",
  "无法读取图片文件，请重新选择。":
    "Cannot read the image file. Select it again.",
  "图片解码失败，文件可能已损坏，请重新导出 PNG 或 JPEG。":
    "Image decoding failed; the file may be damaged. Export PNG or JPEG again.",
  "浏览器解码尺寸与原图不符，请按需要的方向另存为 PNG 后导入。":
    "Browser-decoded dimensions differ from the original. Save as PNG in the intended orientation, then import.",
  "当前浏览器无法读取图片像素。": "This browser cannot read image pixels.",
  "浏览器无法生成图片预览，请缩小图片后重试。":
    "This browser cannot create a preview. Reduce the image size and retry.",
  导入条带: "Imported strip",
  "合成示例内参（非实验数据）.png": "synthetic-reference-not-experimental.png",
  "合成示例目标条带（非实验数据）.png": "synthetic-target-not-experimental.png",
  "请选择自动、深色条带或浅色条带。":
    "Choose automatic, dark bands or light bands.",
  "检测到多排条带，请先裁成单排条带后导入。":
    "Multiple band rows detected. Crop to one strip before importing.",
  "泳道 {0}": "Lane {0}",
  "泳道 {0} 取样框": "Lane {0} sampling region",
  "泳道 {0} 名称": "Lane {0} name",
  "取样框 {0}": "Sampling region {0}",
  "识别到 {0} 条": "{0} bands detected",
  "蛋白 {0}": "Protein {0}",
  "{0}-相对强度.svg": "{0}-relative-intensity.svg",
  "{0}-相对强度.png": "{0}-relative-intensity.png",
  "{0}-结果.csv": "{0}-results.csv",
  "泳道 {0}：{1}": "Lane {0}: {1}",
  "内参泳道 {0}：{1}": "Reference lane {0}: {1}",
  "内参：{0}": "Reference: {0}",
  "导入失败：{0}{1}": "Import failed: {0}{1}",
  "此简易模式仅支持 8-bit PNG；当前为 {0}-bit。请使用 8-bit 副本，保留高位深原图。":
    "Simple mode supports only 8-bit PNG; this image is {0}-bit. Use an 8-bit copy and keep the high-bit-depth original.",
  "← 工作台首页": "← Workbench home",
  "单条带识别 →": "Single-strip analysis →",
  "校直点须位于原图范围内。":
    "Straightening points must be within the original image.",
  "校直后的图片过大，请先使用较小的条带图片。":
    "The straightened image is too large. Use a smaller strip image.",
  "整体校直需要两个不同的点。":
    "Overall straightening requires two different points.",
  "弯曲校直需要 3–8 个基线点。":
    "Curved straightening requires 3\u20138 baseline points.",
  "弯曲基线点须从左到右分开，不能位于同一列。":
    "Curve points must be separated from left to right, not in the same column.",
  "裁剪范围须位于校直后的完整图片内，且坐标为整数。":
    "The crop must be inside the full corrected image and use integer coordinates.",
  "取样框包含校直后空白区域，请将框移回原图范围内。":
    "A sampling region includes padding from straightening. Move it inside the original image area.",
  "背景框包含校直后空白区域，请将框移回原图范围内。":
    "A background region includes padding from straightening. Move it inside the original image area.",
};
