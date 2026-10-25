import { languageUrl } from "../i18n";
import {
  ArrowRight,
  Check,
  CircleHelp,
  FileArchive,
  FlaskConical,
  FolderOpen,
  History,
  Layers,
  Plus,
  ScanLine,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import "./user-guide.css";

type GuideView = "overview" | "analysis" | "samples" | "results";

export interface UserGuideProps {
  language: "zh" | "en";
  onNavigate: (view: GuideView) => void;
  onExample: () => void;
  onVision: () => void;
}

export default function UserGuide({
  language,
  onNavigate,
  onExample,
  onVision,
}: UserGuideProps) {
  const t = (zh: string, en: string) => (language === "zh" ? zh : en);
  const steps: {
    title: string;
    icon: typeof FolderOpen;
    paragraphs: string[];
    checkpoint: string;
    view: GuideView;
    action: string;
  }[] = [
    {
      title: t("认识项目与批次", "Get to know the project"),
      icon: FolderOpen,
      paragraphs: [
        t(
          "在“项目总览”查看说明、批次和图像。一个项目可以跨日期、批次与蛋白；示例中的 8 张图和 2 个批次属于同一项目。",
          "Open Overview to inspect the description, batches, and images. A project can span dates, batches, and proteins. All 8 example images and both batches belong to one project.",
        ),
        t(
          "先选一张目标图，再核对膜、蛋白和曝光。首次练习可从 Demo A · target · 1s 开始；新建空项目后，当前还不能添加真实图像。",
          "Choose a target image and check its membrane, protein, and exposure. Start with Demo A · target · 1s for this walkthrough. An empty new project cannot yet accept real images.",
        ),
      ],
      checkpoint: t(
        "知道当前查看的是哪个批次和曝光。",
        "Know which batch and exposure you are reviewing.",
      ),
      view: "overview",
      action: t("打开项目总览", "Open Overview"),
    },
    {
      title: t("核对样本与分组", "Check samples and groups"),
      icon: Users,
      paragraphs: [
        t(
          "在“样本与分组”逐泳道核对样本名称、分组、独立实验单位与技术重复集合。样本名可编辑；输入停顿后会自动保存。",
          "In Samples, check each lane's sample name, group, experimental unit, and technical replicate set. Sample names are editable and save after a pause in typing.",
        ),
        t(
          "两个示例批次复测的是同一组 6 个样本。更多曝光、图像或结果行不会增加独立样本数；分组标签也不会自动决定统计检验。",
          "Both example batches measure the same 6 samples. More exposures, images, or result rows do not add independent samples. Group labels do not select a statistical test.",
        ),
      ],
      checkpoint: t(
        "能把泳道对应回样本，而不把图像数当作 n。",
        "Trace lanes to samples without treating image count as n.",
      ),
      view: "samples",
      action: t("打开样本与分组", "Open Samples"),
    },
    {
      title: t("检查条带与背景区域", "Inspect bands and background"),
      icon: ScanLine,
      paragraphs: [
        t(
          "在“条带分析”点击条带或背景 ROI（分析区域），可拖动、用方向键微调，或编辑坐标与大小。显示对比度只改变预览，不改变示例数值。",
          "In Band analysis, select a band or background ROI (region of interest). Drag it, use arrow keys, or edit its coordinates and size. Display contrast changes the preview only, not the example values.",
        ),
        t(
          "试改一个区域后，分析会变为“待重算”，旧示例数值失效。当前没有实时定量；点击“恢复示例参数”可返回预设配置，继续后面的练习。",
          "Edit a region to see Needs recalculation: the previous example values become stale. There is no live quantification yet. Choose Restore example to return to the preset settings and continue this walkthrough.",
        ),
      ],
      checkpoint: t(
        "条带框、背景框和待复核状态都已看过。",
        "Inspect both ROI types and the review status.",
      ),
      view: "analysis",
      action: t("打开条带分析", "Open Band analysis"),
    },
    {
      title: t("检查内参，理解模板版本", "Check pairing and template versions"),
      icon: Layers,
      paragraphs: [
        t(
          "在“内参配对”检查参考图像的样本、膜、批次和曝光条件。相同泳道编号不能单独证明配对正确；不确定时保留未确认状态，并写下复核备注。",
          "Check the reference image's samples, membrane, batch, and acquisition conditions under Reference pairing. Matching lane numbers alone do not establish a valid pairing. Leave uncertain analyses unconfirmed and add review notes.",
        ),
        t(
          "“编辑新版本”只更新项目模板，当前图像保留自己的旧快照。点击“应用到当前图像”或应用到选中图像，才会明确修改分析；变更后仍需逐图检查。",
          "Edit new version updates the project template while each image retains its existing snapshot. Apply to current image, or to selected images, explicitly changes the analyses. Review each affected image afterward.",
        ),
      ],
      checkpoint: t(
        "区分项目模板版本与当前图像快照。",
        "Distinguish the project template from an image's snapshot.",
      ),
      view: "analysis",
      action: t("检查内参与模板", "Review pairing & templates"),
    },
    {
      title: t(
        "确认一对图像，再导出结果",
        "Confirm a pair, then export results",
      ),
      icon: Check,
      paragraphs: [
        t(
          "检查 Demo A · target · 1s 及配对的 Demo A · reference · 1s，分别点击“确认复核”。若之前试改过参数，先恢复对应图像的示例参数。",
          "Review Demo A · target · 1s and its paired Demo A · reference · 1s, then choose Confirm review for each. If you changed their settings earlier, restore the example settings first.",
        ),
        t(
          "到“结果与记录”查看计算流程、净信号、目标/内参比值和相对值，再点“导出示例 CSV”查看积分与背景字段。这些是合成图预设演示值；确认操作不代表科研验证，也不产生显著性检验。",
          "Open Results & history to inspect the calculation workflow, net signals, target/reference ratios, and relative values. Select Export demo CSV for the band-sum and background fields. These are preset synthetic values. Confirmation is a workflow review, not scientific validation or a significance test.",
        ),
      ],
      checkpoint: t(
        "目标和内参均已确认，且没有失效或排除。",
        "Both target and reference are confirmed, current, and not excluded.",
      ),
      view: "results",
      action: t("打开结果与记录", "Open Results & history"),
    },
    {
      title: t("备份项目，之后继续", "Back up and return later"),
      icon: FileArchive,
      paragraphs: [
        t(
          "看到顶部“已保存到本机”后再离开。点击“导出项目”保存 .wbproj.zip，保留图像、ROI、配对、备注和参数快照；CSV 不能替代项目包。",
          "Wait for Saved locally before leaving. Use Export project to save a .wbproj.zip containing images, ROIs, pairings, notes, and parameter snapshots. A CSV is not a substitute for this archive.",
        ),
        t(
          "几周后回到同一浏览器、同一地址，检查恢复的项目；也可用“打开项目”导入备份并确认替换。先看待复核、待重算条目与备注，再接着处理。",
          "Return to the same address in the same browser to inspect the restored project, or use Open project to import your backup and confirm replacement. Read review notes and check outstanding or stale analyses before continuing.",
        ),
      ],
      checkpoint: t(
        "有一份保存在浏览器之外的项目包。",
        "Keep a project archive outside browser storage.",
      ),
      view: "overview",
      action: t("回到项目，检查保存", "Return to the project"),
    },
  ];

  const faqs = [
    {
      question: t(
        "为什么合成示例不能拖入真实 TIFF 或 PNG？",
        "Why can't I drop real TIFF or PNG images into the synthetic demo?",
      ),
      answer: t(
        "这个旧入口只演示固定合成图像和预设结果。单排条带或多排/内参测量可从首页进入“单条带识别”或“多排与内参”，支持 8/16 位 TIFF 与 8 位 PNG/JPEG。批量原图、实验配对与统计请进入“真实图像分析”：导入 TIFF/PNG、设置泳道、复核候选并导出统计图。自动取样需要人工复核，各工作区的项目包与合成示例分开。",
        "This legacy entry demonstrates fixed synthetic images and preset results. For a single strip or multiple rows with a reference, open Single-strip analysis or Multiple rows & reference from the homepage; both support 8/16-bit TIFF and 8-bit PNG/JPEG. For original-image batches, experimental pairing, and statistics, choose Analyze real images: import TIFF/PNG, map lanes, review proposals, and export plots. Review automatic regions manually. These workspaces use archives separate from the synthetic demo.",
      ),
    },
    {
      question: t(
        "移动 ROI 后为什么没有新数值？",
        "Why do ROI edits produce no new measurements?",
      ),
      answer: t(
        "示例数值只对应固定合成图的预设区域。改变 ROI、配对或相关参数后，旧数值失效，界面会显示“待重算”；当前版本不会运行重新定量。可以保留修改来讨论流程，或用“恢复示例参数”继续演示。",
        "Example values correspond to preset regions on fixed synthetic images. Editing ROIs, pairing, or related settings invalidates them and shows Needs recalculation. This version does not recompute measurements. Keep your edits to discuss the workflow, or choose Restore example to continue the demo.",
      ),
    },
    {
      question: t(
        "为什么 CSV 导不出来，或少了几行？",
        "Why is CSV export unavailable, or missing rows?",
      ),
      answer: t(
        "目标图及配对内参必须分别“确认复核”，参数仍匹配示例，并且未被排除。修改内参也会影响目标结果。饱和示例 Demo A · target · 4s 始终无有效结果，即使取消排除也不能确认。先从一对 1s 图像完成复核。",
        "Both the target and its paired reference must be confirmed, still match the fixture, and not be excluded. Reference edits also affect the target. The saturated Demo A · target · 4s never has a valid result, even if you clear its exclusion flag. Start by reviewing a pair of 1s images.",
      ),
    },
    {
      question: t(
        "换了浏览器或地址，为什么项目不见了？",
        "Why is my project missing in another browser or address?",
      ),
      answer: t(
        "自动保存属于当前浏览器与站点地址。在线演示、本机地址和不同端口各用自己的存储；localhost 与 127.0.0.1 也不相同。它们不会自动同步。无痕窗口、清除站点数据也可能让内容不可用，迁移请使用项目包。",
        "Autosave belongs to a browser and site origin. The hosted demo, local addresses, and different ports use separate storage; localhost and 127.0.0.1 differ too. They do not synchronize. Private browsing or clearing site data can also make work unavailable. Transfer projects with an archive.",
      ),
    },
    {
      question: t(
        "载入示例会覆盖我当前的修改吗？",
        "Will loading the example replace my edits?",
      ),
      answer: t(
        "浏览器只保存一个当前工作区。教程的“打开合成示例”先打开确认对话框；需要保留修改时，先导出当前项目，再选择载入。新建项目和导入另一个项目也会替换工作区，自动保存不是独立备份。",
        "The browser keeps one current workspace. Open synthetic example in this guide first opens a confirmation dialog. Export your project before choosing to load the example. Creating or importing another project also replaces the workspace; autosave is not an independent backup.",
      ),
    },
    {
      question: t(
        "API 测试返回 6 个条带，就能用于科研了吗？",
        "Does an API response with 6 bands establish scientific validity?",
      ),
      answer: t(
        "不能。测试只检查服务能否接收内置合成图并返回合法候选矩形，数量吻合不证明定位准确。当前测试不分析你的图像，也不计算灰度或统计结果；真实图像性能与定量可靠性需要另行验证。",
        "No. The test only checks that a service can receive the built-in synthetic image and return valid candidate rectangles. A matching count does not establish correct localization. It neither analyzes your images nor calculates intensity or statistics. Real-image performance and quantitative reliability need separate validation.",
      ),
    },
  ];

  return (
    <div className="user-guide" lang={language === "zh" ? "zh-CN" : "en"}>
      <section className="guide-welcome" aria-labelledby="guide-start-title">
        <div className="guide-stage">
          <ShieldCheck size={16} aria-hidden="true" />
          {t(
            "使用教程 · 真实图像预览与合成示例",
            "USER GUIDE · REAL-IMAGE PREVIEW & SYNTHETIC EXAMPLE",
          )}
        </div>
        <h2 id="guide-start-title">
          {t(
            "第一次练习，或从上次的位置继续。",
            "Start a walkthrough, or pick up where you left off.",
          )}
        </h2>
        <p>
          {t(
            "真实图像分析已有独立入口；下方六步教程介绍旧合成示例，示例数值固定。两种项目分别保存。真实定量仍需核对图像、实验设计和质量提示。",
            "Real-image analysis has a separate entry. The six-step walkthrough below describes the legacy synthetic example with fixed values. The two projects save separately. Real measurements require image, design, and quality review.",
          )}
        </p>
        <div
          className="guide-quick-actions"
          aria-label={t("快速入口", "Quick actions")}
        >
          <a
            className="guide-button guide-button-primary"
            href={languageUrl("#real")}
          >
            <ScanLine size={17} aria-hidden="true" />
            {t("开始真实图像分析", "Start real-image analysis")}
          </a>
          <button
            type="button"
            className="guide-button guide-button-primary"
            onClick={onExample}
          >
            <FolderOpen size={17} aria-hidden="true" />
            {t("打开合成示例", "Open synthetic example")}
          </button>
          <button
            type="button"
            className="guide-button"
            onClick={() => onNavigate("analysis")}
          >
            <History size={17} aria-hidden="true" />
            {t("继续当前项目", "Continue current project")}
          </button>
          <button
            type="button"
            className="guide-button"
            onClick={() => onNavigate("results")}
          >
            {t("查看结果与记录", "View results & history")}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="guide-welcome-note">
          {t(
            "示例入口会先询问是否替换工作区。回来继续时，先核对项目名称，再看未确认项、失效项和复核备注。",
            "The example button opens a workspace-replacement dialog first. When returning to work, check the project name, outstanding reviews, stale items, and notes.",
          )}
        </p>
      </section>

      <section
        className="guide-walkthrough"
        aria-labelledby="guide-steps-title"
      >
        <div className="guide-section-heading">
          <span className="guide-section-number" aria-hidden="true">
            01
          </span>
          <div>
            <h2 id="guide-steps-title">
              {t("用 6 步走完示例", "Walk through the example in 6 steps")}
            </h2>
            <p>
              {t(
                "随时从对应入口回到实际工作区。",
                "Each step links directly to the relevant workspace view.",
              )}
            </p>
          </div>
        </div>
        <ol className="guide-step-grid">
          {steps.map((step, index) => (
            <li className="guide-step" key={index}>
              <div className="guide-step-heading">
                <span
                  className="guide-step-number"
                  aria-label={t(`第 ${index + 1} 步`, `Step ${index + 1}`)}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <step.icon size={19} aria-hidden="true" />
                <h3>{step.title}</h3>
              </div>
              <div className="guide-step-copy">
                {step.paragraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
              <div className="guide-checkpoint">
                <Check size={15} aria-hidden="true" />
                <span>{step.checkpoint}</span>
              </div>
              <button
                type="button"
                className="guide-text-button"
                onClick={() => onNavigate(step.view)}
              >
                {step.action}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-real" aria-labelledby="guide-real-title">
        <div className="guide-section-heading">
          <span className="guide-section-number" aria-hidden="true">
            02
          </span>
          <div>
            <h2 id="guide-real-title">
              {t(
                "真实图像工作台：从示例到出报告",
                "Real-image workbench: from the example to a report",
              )}
            </h2>
            <p>
              {t(
                "真实工作区从原始像素计算，全部在本机浏览器完成；以下七步用内置合成示例走通全流程。",
                "The real workspace measures original pixels entirely in your browser. The seven steps below walk the built-in synthetic example through the whole flow.",
              )}
            </p>
          </div>
          <ScanLine size={25} aria-hidden="true" />
        </div>
        <ol className="guide-step-grid">
          {[
            {
              title: t("载入内置示例", "Load the built-in example"),
              paragraphs: [
                t(
                  "打开 #real，点「载入内置示例」并确认导入。示例是脚本合成的三组目标/内参图对（NC 与 Treatment），不含任何真实实验数据。",
                  'Open #real, click "Load the built-in example", and confirm the import. The example is a script-generated set of three target/reference pairs (NC and Treatment) with no real experimental data.',
                ),
              ],
            },
            {
              title: t("一键分析并体检", "Run all & report"),
              paragraphs: [
                t(
                  "点「一键分析并体检」：程序提出条带与背景候选、读取原始像素、按共同基准归一化，并给出分级问题清单与按优先级的优化建议。示例的预期 Treatment fold 为 0.5 / 0.75 / 1。",
                  'Click "Run all & report": the app drafts band/background candidates, reads original pixels, normalizes against a common baseline, and produces graded issues plus prioritized recommendations. The expected example folds are 0.5 / 0.75 / 1.',
                ),
              ],
            },
            {
              title: t("逐图复核候选", "Review candidates per image"),
              paragraphs: [
                t(
                  "在「图片分析」里逐图核对条带与背景框（可拖动、缩放、精确调坐标），确认后勾选「已人工检查此图」。手动修改会重置该图复核。",
                  'In the analysis view, check each band/background box (drag, scale, or edit coordinates), then tick "I reviewed this image". Manual edits reset that image\'s review.',
                ),
              ],
            },
            {
              title: t(
                "需要时配置自己的视觉 API",
                "Optionally configure your own vision API",
              ),
              paragraphs: [
                t(
                  "想用视觉模型提候选：在「视觉服务（自带 API）」里填服务地址、模型与 API Key（预置 OpenAI / DashScope / 硅基流动 / DeepSeek，也支持自定义 https 地址）。密钥默认仅存页面内存，勾选记住才写入本设备；可先「发送合成图测试」。候选仍需人工复核，像素测量始终在本机。",
                  'To draft candidates with a vision model, fill the base URL, model, and API key in the vision panel (presets for OpenAI / DashScope / SiliconFlow / DeepSeek, plus custom https URLs). The key stays in page memory unless you check "remember"; run the synthetic test first. Candidates still need manual review, and pixel measurement stays local.',
                ),
              ],
            },
            {
              title: t("选择背景方法", "Choose a background method"),
              paragraphs: [
                t(
                  "默认局部背景取样框；也可切换 rolling ball（与 ImageJ「Subtract Background」逐像素一致，半径可调）。切换会使复核失效，结果与 CSV 记录所用方法。",
                  "Local background ROIs are the default; you can switch to the rolling ball (pixel-compatible with ImageJ's Subtract Background, adjustable radius). Switching invalidates review states; results and CSV record the method.",
                ),
              ],
            },
            {
              title: t("归一化与统计", "Normalize and test"),
              paragraphs: [
                t(
                  "选归一化基准（共同基准 = 指定一个对照为 1；其他对照保留真实变异），需要 P 值时明确勾选配对 t 检验。",
                  "Pick the normalization baseline (a common baseline sets one control to 1; other controls keep their variation) and explicitly enable the paired t-test when you need P values.",
                ),
              ],
            },
            {
              title: t("导出与报告", "Export and report"),
              paragraphs: [
                t(
                  "导出 CSV（含审计列）、统计 CSV、SVG/PNG/TIFF 图形、组合图版（原图+图表+方法说明）与项目包；报告 JSON 汇总问题与建议。",
                  "Export CSV (with audit columns), statistics CSV, SVG/PNG/TIFF figures, the composed figure (original + chart + method footer), and the project package; the report JSON summarizes issues and recommendations.",
                ),
              ],
            },
          ].map((step, index) => (
            <li className="guide-step" key={`real-${index}`}>
              <div className="guide-step-heading">
                <span
                  className="guide-step-number"
                  aria-label={t(`第 ${index + 1} 步`, `Step ${index + 1}`)}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{step.title}</h3>
              </div>
              <div className="guide-step-copy">
                {step.paragraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <p>
          {t(
            "核心分析在本机完成。下载项目包作本地备份，也可在另一台电脑打开继续分析；公共演示不包含你的私人图像。",
            "Core analysis runs locally. Download a project archive as a local backup or open it on another computer to continue. Public demos never contain your private images.",
          )}
        </p>
      </section>

      <section className="guide-api" aria-labelledby="guide-api-title">
        <div className="guide-section-heading">
          <span className="guide-section-number" aria-hidden="true">
            02
          </span>
          <div>
            <h2 id="guide-api-title">
              {t("可选：连接视觉 API", "Optional: connect a vision API")}
            </h2>
            <p>
              {t(
                "这是独立的接口测试；示例检查无需配置 API。",
                "This is a separate interface check. The example workflow needs no API.",
              )}
            </p>
          </div>
          <FlaskConical
            size={25}
            className="guide-api-icon"
            aria-hidden="true"
          />
        </div>
        <div className="guide-api-grid">
          <div className="guide-local-start">
            <h3>{t("先从本机服务打开", "Start the local service")}</h3>
            <p>
              {t(
                "在项目目录中，使用 Node.js 22.12 或更新的兼容版本执行：",
                "In the project directory, with Node.js 22.12 or a newer compatible version, run:",
              )}
            </p>
            <pre aria-label={t("本机启动命令", "Local startup commands")}>
              <code>{"npm ci\nnpm run local"}</code>
            </pre>
            <p>
              {t(
                "打开终端显示的本机地址。在线演示只显示启动说明；npm run dev 不包含 API 后端。",
                "Open the local address printed in the terminal. The hosted demo shows startup guidance only; npm run dev does not include the API backend.",
              )}
            </p>
          </div>
          <ol className="guide-api-steps">
            <li>
              <strong>{t("填写并保存", "Configure and save")}</strong>
              <p>
                {t(
                  "打开“视觉 API 设置”，填写 Base URL、支持图像的模型 ID 和所需的 API Key。使用兼容 Chat Completions 的服务；地址不含 /chat/completions。保存只更新本机内存，不发送图像。",
                  "Open Vision API settings and enter a Base URL, an image-capable model ID, and an API Key if needed. Use a Chat Completions-compatible service; omit /chat/completions from the base URL. Saving updates local memory without sending an image.",
                )}
              </p>
            </li>
            <li>
              <strong>
                {t("核对目的服务，再测试", "Check the destination, then test")}
              </strong>
              <p>
                {t(
                  "点击“发送合成图并测试”只发送内置 6 泳道 PNG 与固定提示词，不发送当前项目、样本名或图像。提供商可能收费；返回 6 个候选不代表定位或定量准确。",
                  "Send synthetic image & test sends only the built-in six-lane PNG and fixed prompt, not your project, sample names, or images. The provider may charge for the request. Six returned candidates do not prove correct localization or quantification.",
                )}
              </p>
            </li>
            <li>
              <strong>
                {t("管理配置与密钥", "Manage settings and the key")}
              </strong>
              <p>
                {t(
                  "密钥不回显、不写入浏览器存储或项目包。更换服务来源不沿用旧密钥；重启服务会清空配置。可取消等待或清除配置，但取消不能撤回服务已收到的请求。",
                  "The key is not returned, saved in browser storage, or included in project archives. Changing service origin drops the old key; restarting the service clears configuration. You can cancel waiting or clear settings, but cancellation cannot recall a request already received by the provider.",
                )}
              </p>
            </li>
          </ol>
        </div>
        <button
          type="button"
          className="guide-button guide-button-primary"
          onClick={onVision}
        >
          <Settings2 size={16} aria-hidden="true" />
          {t("打开视觉 API 设置", "Open Vision API settings")}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </section>

      <section className="guide-faq" aria-labelledby="guide-faq-title">
        <div className="guide-section-heading">
          <span className="guide-section-number" aria-hidden="true">
            03
          </span>
          <div>
            <h2 id="guide-faq-title">
              {t("遇到问题时", "When something is unclear")}
            </h2>
            <p>
              {t(
                "展开一个问题，找到下一步。",
                "Expand a question to find the next step.",
              )}
            </p>
          </div>
          <CircleHelp size={23} className="guide-api-icon" aria-hidden="true" />
        </div>
        <div className="guide-faq-list">
          {faqs.map((faq, index) => (
            <details key={index}>
              <summary>
                <span>{faq.question}</span>
                <Plus size={17} aria-hidden="true" />
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
