import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  FlaskConical,
  Layers,
  Microscope,
  ScanLine,
  ShieldCheck,
  Upload,
} from "lucide-react";
import SuiteNav from "./SuiteNav";
import "./home.css";

type Language = "zh" | "en";
const LANGUAGE_KEY = "blot-workbench-home-language";

const cards = [
  {
    href: "?mode=quick",
    icon: Layers,
    zhTitle: "多排与内参",
    enTitle: "Multiple rows & reference",
    zhText:
      "分析多排条带，或添加内参图片。核对取样与泳道配对，再导出相对强度。",
    enText:
      "Analyze multiple rows or add a reference image. Review the regions and lane pairing, then export relative intensity.",
    zhCta: "进入快速分析",
    enCta: "Open quick analysis",
  },
  {
    href: "#real",
    icon: Microscope,
    zhTitle: "完整 WB 分析",
    enTitle: "Full WB analysis",
    zhText:
      "从原始 TIFF / PNG 开始，完成背景扣除、候选复核、归一化、统计与图版导出。",
    enText:
      "Start with original TIFF or PNG files. Review bands, correct background, normalize, run statistics, and compose figures.",
    zhCta: "打开完整工作区",
    enCta: "Open full workspace",
  },
  {
    href: "#demo",
    icon: FlaskConical,
    zhTitle: "合成示例演示",
    enTitle: "Synthetic demo",
    zhText:
      "先熟悉项目整理与复核流程。使用固定合成图像和预设数值，数值不随操作重新计算。",
    enText:
      "Explore project and review workflows with synthetic images and preset values. The demo values do not recompute.",
    zhCta: "浏览演示",
    enCta: "Explore the demo",
  },
] as const;

export default function Home() {
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh",
  );
  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);
  const t = (zh: string, en: string) => (language === "zh" ? zh : en);

  return (
    <div className="home" lang={language === "zh" ? "zh-CN" : "en"}>
      <header className="home-topbar">
        <a className="home-brand" href="./" aria-label="Blot Workbench">
          <span className="home-brand-mark">
            <ScanLine size={21} aria-hidden="true" />
          </span>
          <span>
            Blot Workbench
            <small>{t("WB 图像分析工作台", "Western blot analysis")}</small>
          </span>
        </a>
        <div className="home-actions">
          <SuiteNav />
          <button
            type="button"
            className="home-lang"
            aria-label={t("Switch to English", "切换为中文")}
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
          >
            {language === "zh" ? "EN" : "中文"}
          </button>
        </div>
      </header>
      <main className="home-main">
        <div className="home-intro">
          <p className="home-eyebrow">WESTERN BLOT · WORKBENCH</p>
          <p className="home-tagline">
            {t("从一张条带图开始。", "Start with one strip.")}
            <span>
              {t("把分析过程看清楚。", "See every step of your analysis.")}
            </span>
          </p>
        </div>
        <a
          className="home-single"
          href="?mode=single"
          aria-label={t("单条带识别", "Single-strip analysis")}
        >
          <div className="home-single-copy">
            <span className="home-start-label">
              <ScanLine size={14} aria-hidden="true" />
              {t("从这里开始", "START HERE")}
            </span>
            <h1>{t("单条带识别", "Single-strip analysis")}</h1>
            <p className="home-single-description">
              {t(
                "导入裁好的一排条带，自动识别、扣背景。图像与结果同屏，打开就能看明白。",
                "Import a cropped strip. Detect lanes and subtract background automatically, with your image and results side by side.",
              )}
            </p>
            <div className="home-single-features">
              <span>
                <Check size={14} aria-hidden="true" />
                8-bit PNG / JPG
              </span>
              <span>
                <ShieldCheck size={14} aria-hidden="true" />
                {t("本机处理", "On your device")}
              </span>
              <span>
                <Check size={14} aria-hidden="true" />
                {t("图表与 CSV", "Chart & CSV")}
              </span>
            </div>
            <span className="home-primary-cta">
              <Upload size={16} aria-hidden="true" />
              {t("开始单条带识别", "Analyze a strip")}
              <ArrowRight size={17} aria-hidden="true" />
            </span>
            <p className="home-single-note">
              {t(
                "自动取样需核对 · 当前结果未做内参归一化",
                "Review automatic regions · No reference normalization in this mode",
              )}
            </p>
          </div>
          <div className="home-preview" aria-hidden="true">
            <div className="home-preview-heading">
              <span>
                <i />
                {t("图像与结果，同屏呈现", "Image and results, together")}
              </span>
              <span className="home-preview-dots">···</span>
            </div>
            <div className="home-preview-content">
              <div className="home-strip-preview">
                <span className="home-preview-label">
                  {t("条带图", "YOUR STRIP")}
                </span>
                <div className="home-band-image">
                  {[0.42, 0.52, 0.46, 0.74, 0.88, 0.78].map((strength, i) => (
                    <span
                      key={i}
                      style={{ "--strength": strength } as CSSProperties}
                    >
                      <i />
                    </span>
                  ))}
                </div>
                <div className="home-preview-lanes">
                  {[1, 2, 3, 4, 5, 6].map((lane) => (
                    <span key={lane}>{lane}</span>
                  ))}
                </div>
              </div>
              <div className="home-chart-preview">
                <div className="home-chart-heading">
                  <span className="home-preview-label">
                    {t("相对强度", "RELATIVE INTENSITY")}
                  </span>
                  <span>{t("自动生成", "AUTO")}</span>
                </div>
                <div className="home-chart-bars">
                  {[42, 52, 46, 74, 88, 78].map((strength, i) => (
                    <span key={i} style={{ height: `${strength}%` }} />
                  ))}
                </div>
                <div className="home-preview-lanes">
                  {[1, 2, 3, 4, 5, 6].map((lane) => (
                    <span key={lane}>{lane}</span>
                  ))}
                </div>
              </div>
            </div>
            <p className="home-preview-caption">
              {t(
                "流程示意 · 非实验数据",
                "Illustration only · Not experimental data",
              )}
            </p>
          </div>
        </a>
        <section className="home-more" aria-labelledby="home-more-title">
          <div className="home-section-heading">
            <h2 id="home-more-title">
              {t(
                "按分析需要，选择工作区",
                "Choose a workspace for your analysis",
              )}
            </h2>
            <span>{t("更多工具", "MORE TOOLS")}</span>
          </div>
          <div className="home-cards">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <a key={card.href} className="home-card" href={card.href}>
                  <span className="home-card-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <h3>{t(card.zhTitle, card.enTitle)}</h3>
                  <p>{t(card.zhText, card.enText)}</p>
                  <span className="home-card-cta">
                    {t(card.zhCta, card.enCta)}
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                </a>
              );
            })}
          </div>
        </section>
        <a className="home-guide" href="#guide">
          <span className="home-guide-icon">
            <BookOpen size={19} aria-hidden="true" />
          </span>
          <span className="home-guide-copy">
            <strong>{t("第一次使用？", "New here?")}</strong>
            <span>
              {t(
                "从导入、取样复核到结果导出，跟着教程走一遍。",
                "Follow the guide from import and region review to export.",
              )}
            </span>
          </span>
          <span className="home-guide-cta">
            {t("使用教程", "User guide")}
            <ArrowRight size={15} aria-hidden="true" />
          </span>
        </a>
        <footer className="home-footer">
          <span>
            Blot Workbench<i>·</i>
            {t("为实验分析而做", "Made for lab analysis")}
          </span>
          <span>
            {t("开源 MIT", "Open source · MIT")}
            <i>·</i>
            <a href="https://github.com/Gaoyuan-0423/blot-workbench">
              GitHub
              <ArrowRight size={12} aria-hidden="true" />
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
