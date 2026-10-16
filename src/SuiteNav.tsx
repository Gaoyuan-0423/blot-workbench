const suiteHost = window.location.hostname.toLowerCase();
const isWispLab =
  suiteHost === "wisplab.top" || suiteHost.endsWith(".wisplab.top");
const suiteLinks = {
  wb: isWispLab
    ? "https://wb.wisplab.top/"
    : "https://gaoyuan-0423.github.io/blot-workbench/",
  pathology: isWispLab
    ? "https://pathology.wisplab.top/"
    : "https://gaoyuan-0423.github.io/pathology-workbench/",
  pcr: isWispLab
    ? "https://pcr.wisplab.top/"
    : "https://gaoyuan-0423.github.io/pcr-workbench/",
};

export default function SuiteNav() {
  return (
    <nav
      className={`suite-nav${isWispLab ? " suite-with-home" : ""}`}
      aria-label="实验工作台导航"
    >
      {isWispLab && <a href="https://wisplab.top/">总首页</a>}
      <a href={suiteLinks.wb} aria-current="page">
        WB
      </a>
      <a href={suiteLinks.pathology}>病理</a>
      <a href={suiteLinks.pcr}>PCR</a>
    </nav>
  );
}
