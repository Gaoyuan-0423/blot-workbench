import { useLanguage } from "./i18n";
const suiteHost = window.location.hostname.toLowerCase();
const desktop = window.location.protocol === "app:";
const isWispLab =
  suiteHost === "wisplab.top" || suiteHost.endsWith(".wisplab.top");
const suiteLinks = {
  wb: desktop ? "app://wisplab/wb/" : isWispLab
    ? "https://wb.wisplab.top/"
    : "https://gaoyuan-0423.github.io/blot-workbench/",
  pathology: desktop ? "app://wisplab/pathology/" : isWispLab
    ? "https://pathology.wisplab.top/"
    : "https://gaoyuan-0423.github.io/pathology-workbench/",
  pcr: desktop ? "app://wisplab/pcr/" : isWispLab
    ? "https://pcr.wisplab.top/"
    : "https://gaoyuan-0423.github.io/pcr-workbench/",
};

export default function SuiteNav() {
  const { t, href } = useLanguage();
  return (
    <nav
      className={`suite-nav${(isWispLab || desktop) ? " suite-with-home" : ""}`}
      aria-label={t("实验工作台导航", "Laboratory workbench navigation")}
    >
      {(isWispLab || desktop) && (
        <a href={href(desktop ? "app://wisplab/" : "https://wisplab.top/")}>{t("总首页", "Home")}</a>
      )}
      <a href={href(suiteLinks.wb)} aria-current="page">
        WB
      </a>
      <a href={href(suiteLinks.pathology)}>{t("病理", "Pathology")}</a>
      <a href={href(suiteLinks.pcr)}>PCR</a>
    </nav>
  );
}
