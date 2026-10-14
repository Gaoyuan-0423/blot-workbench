import { useEffect, useState } from "react";
import {
  BookOpen,
  FlaskConical,
  Microscope,
  ScanLine,
} from "lucide-react";

/**
 * Root landing page: explains the two workspaces instead of silently
 * redirecting to either. Deliberately static and dependency-free — it only
 * links to the hash-routed apps.
 */

type Language = "zh" | "en";
const LANGUAGE_KEY = "blot-workbench-home-language";

const cards = [
  {
    href: "#real",
    icon: Microscope,
    zhTitle: "真实 WB 分析工作区",
    enTitle: "Real Western blot workspace",
    zhText:
      "导入仪器原始 TIFF/PNG，本机完成背景扣除、条带候选、归一化与配对统计；可选 rolling ball（与 ImageJ 一致）与自带 API 的视觉候选，一键生成问题报告与出版级图版。数据只在你的浏览器里。",
    enText:
      "Import original TIFF/PNG scans and run background correction, band candidates, normalization, and paired statistics entirely in your browser — with an ImageJ-compatible rolling ball, optional vision candidates via your own API key, one-click reports, and composed figures.",
    primary: true,
    cta: { zh: "打开真实工作区", en: "Open the real workspace" },
  },
  {
    href: "#demo",
    icon: FlaskConical,
    zhTitle: "合成示例演示",
    enTitle: "Synthetic demo",
    zhText:
      "内置固定合成图像的旧演示：走一遍项目整理、复核与导出的交互流程，数值为预设示例，不随操作重新计算。",
    enText:
      "The legacy demo on fixed synthetic images: walk the project/review/export interactions with preset example values that do not recompute.",
    primary: false,
    cta: { zh: "打开演示", en: "Open the demo" },
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
        <div className="home-brand">
          <ScanLine size={24} aria-hidden="true" />
          Blot Workbench
        </div>
        <div className="home-actions">
          <button
            type="button"
            className="home-lang"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
          >
            {language === "zh" ? "EN" : "中文"}
          </button>
        </div>
      </header>
      <main className="home-main">
        <h1>{t("Blot Workbench · 印迹工作台", "Blot Workbench")}</h1>
        <p className="home-tagline">
          {t(
            "面向实验室的 Western blot 图像分析工作台。全部处理在本机浏览器完成，图像不上传。",
            "A Western blot image analysis workbench for the lab. Everything runs locally in your browser; images never leave your device.",
          )}
        </p>
        <div className="home-cards">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <a
                key={card.href}
                className={`home-card ${card.primary ? "home-card-primary" : ""}`}
                href={card.href}
              >
                <div className="home-card-head">
                  <Icon size={22} aria-hidden="true" />
                  <h2>{card.zhTitle}</h2>
                  <span className="home-card-en">{card.enTitle}</span>
                </div>
                <p>{language === "zh" ? card.zhText : card.enText}</p>
                <span className="home-card-cta">
                  {language === "zh" ? card.cta.zh : card.cta.en} →
                </span>
              </a>
            );
          })}
          <a className="home-card home-card-guide" href="#guide">
            <div className="home-card-head">
              <BookOpen size={22} aria-hidden="true" />
              <h2>{t("使用教程", "User guide")}</h2>
              <span className="home-card-en">User guide</span>
            </div>
            <p>
              {t(
                "分步教程：示例数据、导入、泳道说明、候选复核、归一化与导出。",
                "Step-by-step: example data, import, lane description, candidate review, normalization, and export.",
              )}
            </p>
            <span className="home-card-cta">
              {t("阅读教程", "Read the guide")} →
            </span>
          </a>
        </div>
        <p className="home-footer">
          {t(
            "开源（MIT）· ",
            "Open source (MIT) · ",
          )}
          <a href="https://github.com/Gaoyuan-0423/blot-workbench">
            GitHub
          </a>
          {t(
            " · 网站为纯静态页面，不设账号、不存储任何图像到服务器。",
            " · The site is fully static: no accounts, no server-side image storage.",
          )}
        </p>
      </main>
    </div>
  );
}
