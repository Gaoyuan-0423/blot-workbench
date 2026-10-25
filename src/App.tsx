import { useLanguage, languageUrl, translateMessage } from "./i18n";
import SuiteNav from "./SuiteNav";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  FileArchive,
  FileImage,
  Folder,
  FolderOpen,
  GitBranch as Github,
  Grid2X2,
  History,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  Microscope,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  APP_VERSION,
  type Project,
  type View,
  type Rect,
  type Roi,
  type Analysis,
} from "./core/types";
import {
  createExampleProject,
  createEmptyProject,
  getMeasurements,
  updateRoi,
  updateAnalysis,
  editTemplate,
  applyTemplate,
  restoreExampleAnalysis,
  updateSample,
  exportProject,
  importProject,
  saveProject,
  loadProject,
  exportCsv,
} from "./core";
import VisionSettings from "./vision/VisionSettings";
import UserGuide from "./guide/UserGuide";

const REPO = "https://github.com/Gaoyuan-0423/blot-workbench";
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function App() {
  const [guideOpen, setGuideOpen] = useState(
    () => window.location.hash === "#guide",
  );
  useEffect(() => {
    const syncGuide = () => setGuideOpen(window.location.hash === "#guide");
    window.addEventListener("hashchange", syncGuide);
    window.addEventListener("popstate", syncGuide);
    return () => {
      window.removeEventListener("hashchange", syncGuide);
      window.removeEventListener("popstate", syncGuide);
    };
  }, []);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">(
    "saving",
  );
  const [modal, setModal] = useState<
    "new" | "template" | "help" | "example" | "import" | "vision" | null
  >(null);
  const [name, setName] = useState("");
  const [pendingImport, setPendingImport] = useState<Project | null>(null);
  const [draftFields, setDraftFields] = useState<Set<string>>(new Set());
  const draftDirty = (key: string, dirty: boolean) =>
    setDraftFields((previous) => {
      if (previous.has(key) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  const displayedSaveState = draftFields.size ? "saving" : saveState;
  useEffect(() => {
    if (!project || (saveState === "saved" && !draftFields.size)) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [project, saveState, draftFields.size]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [selectedRoi, setSelectedRoi] = useState("");
  const [showBackground, setShowBackground] = useState(true);
  const [showRois, setShowRois] = useState(true);
  const [contrast, setContrast] = useState(100);
  const [templateForm, setTemplateForm] = useState({
    bandWidth: 72,
    bandHeight: 36,
    backgroundGap: 12,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const saveGeneration = useRef(0);
  const currentProject = useRef<Project | null>(null);
  currentProject.current = project;
  const dialog = useRef<HTMLElement>(null);
  const { language, setLanguage, t } = useLanguage();
  const platformState = useRef({ busy, draftFields, modal, t });
  platformState.current = { busy, draftFields, modal, t };
  useEffect(() => {
    let active = true;
    let importing = false;
    let unregister: (() => void) | undefined;
    const aborted = () =>
      new DOMException("Workspace changed or import cancelled", "AbortError");
    const snapshot = () => {
      const state = platformState.current;
      if (
        !active ||
        importing ||
        state.busy ||
        state.draftFields.size ||
        state.modal ||
        !currentProject.current
      )
        throw aborted();
      return currentProject.current;
    };
    const register = () => {
      const host = window as typeof window & {
        WispLab?: {
          registerProjectAdapter(adapter: {
            tool: string;
            exportProject(): Promise<{
              blob: Blob;
              name: string;
              summary: string;
              summaryTranslations?: { zh: string; en: string };
            }>;
            importProject(
              blob: Blob,
              options?: { isCurrent: () => boolean },
            ): Promise<void>;
          }): () => void;
        };
      };
      if (!host.WispLab) return;
      unregister?.();
      unregister = host.WispLab.registerProjectAdapter({
        tool: "wb-demo",
        async exportProject() {
          const before = snapshot();
          const blob = await exportProject(before);
          if (snapshot() !== before) throw aborted();
          return {
            blob,
            name: `blot-workbench-${before.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}.wbproj.zip`,
            summaryTranslations: {
              zh: "WB 合成示例项目 · " + before.name,
              en: "WB synthetic demo project · " + before.name,
            },
            summary:
              platformState.current.t(
                "WB 合成示例项目 · ",
                "WB synthetic demo project · ",
              ) + before.name,
          };
        },
        async importProject(blob, options) {
          const before = snapshot();
          importing = true;
          try {
            const next = await importProject(blob);
            const unchanged = () =>
              active &&
              (options?.isCurrent() ?? true) &&
              currentProject.current === before &&
              !platformState.current.busy &&
              !platformState.current.draftFields.size &&
              !platformState.current.modal;
            if (!unchanged()) throw aborted();
            if (
              !window.confirm(
                platformState.current.t(
                  "项目包已通过校验。导入将替换当前 WB 示例工作区；需要保留的内容请先导出。确认导入？",
                  "The archive passed validation. Importing replaces the current WB demo workspace. Export anything you need to keep first. Import this project?",
                ),
              )
            )
              throw aborted();
            if (!unchanged()) throw aborted();
            currentProject.current = next;
            setProject(next);
            setSaveState("saving");
            setChecked([]);
            setSelectedRoi("");
            setPendingImport(null);
            setError("");
            setNotice(
              platformState.current.t("项目已导入", "Project imported"),
            );
          } finally {
            importing = false;
          }
        },
      });
    };
    register();
    window.addEventListener("wisplab:ready", register);
    return () => {
      active = false;
      unregister?.();
      window.removeEventListener("wisplab:ready", register);
    };
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const p = await loadProject();
        const next = p ?? (await createExampleProject());
        if (active) setProject(next);
      } catch {
        if (active) {
          setError(
            "无法读取本地保存；已打开新的合成示例。 / Could not restore local storage; opened a new synthetic example.",
          );
          setProject(await createExampleProject());
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!project) return;
    const g = ++saveGeneration.current;
    setSaveState("saving");
    const id = window.setTimeout(() => {
      saveProject(project)
        .then(() => {
          if (saveGeneration.current === g) setSaveState("saved");
        })
        .catch(() => {
          if (saveGeneration.current === g) {
            setSaveState("error");
            setError(
              t(
                "浏览器保存失败，请导出项目包备份。",
                "Browser save failed. Export a project archive to keep your work.",
              ),
            );
          }
        });
    }, 180);
    return () => clearTimeout(id);
  }, [project]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  const mutate = (f: (p: Project) => Project) => {
    if (!currentProject.current) return;
    try {
      const next = f(currentProject.current);
      if (next !== currentProject.current) setSaveState("saving");
      currentProject.current = next;
      setProject(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (!modal) return;
    const prior = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input, a[href], select, textarea",
        ) ?? [],
      );
    focusables()
      .find((el) => el.tagName === "INPUT")
      ?.focus();
    if (!dialog.current?.contains(document.activeElement))
      focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      prior?.focus();
    };
  }, [modal]);
  const ui = (patch: Partial<Project["ui"]>) =>
    mutate((p) => ({ ...p, ui: { ...p.ui, ...patch } }));
  const leaveGuide = () => {
    setGuideOpen(false);
    if (window.location.hash === "#guide")
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  };
  const openGuide = () => {
    setModal(null);
    setGuideOpen(true);
    window.location.hash = "guide";
    window.scrollTo({ top: 0 });
  };
  const changeView = (view: View) => {
    leaveGuide();
    ui({ view });
    window.scrollTo({ top: 0 });
  };
  const openImage = (id: string) => {
    leaveGuide();
    ui({ view: "analysis", selectedImageId: id });
    setSelectedRoi("");
    setContrast(100);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const archive = () =>
    project &&
    run(async () => {
      download(
        await exportProject(project),
        `blot-workbench-${project.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}.wbproj.zip`,
      );
      setNotice(
        t(
          "项目包已导出，包含图片与分析记录。",
          "Project archive exported with images and analysis records.",
        ),
      );
    });
  const loadExample = () =>
    run(async () => {
      const example = await createExampleProject();
      example.ui.language = currentProject.current?.ui.language ?? "zh";
      setProject(example);
      leaveGuide();
      setChecked([]);
      setModal(null);
      setNotice(t("已载入合成示例项目", "Synthetic example loaded"));
    });
  if (!project)
    return (
      <div className="loading">
        <div className="brand-mark">
          <ScanLine size={30} />
        </div>
        <LoaderCircle className="spin" />
        <p>{t("正在打开工作台…", "Opening your workbench…")}</p>
        {error && <p>{translateMessage(error, language)}</p>}
      </div>
    );
  const image =
    project.images.find((i) => i.id === project.ui.selectedImageId) ??
    project.images[0];
  const analysis = project.analyses.find((a) => a.imageId === image?.id);
  const roi =
    analysis?.rois.find((r) => r.id === selectedRoi) ??
    analysis?.rois.find((r) => r.kind === "band");
  const measurements = image ? getMeasurements(project, image.id) : [];
  const confirmed = project.analyses.filter(
    (a) => a.status === "confirmed" && !a.excluded,
  ).length;
  const stale = project.analyses.filter((a) => a.status === "stale").length;
  const units = new Set(project.samples.map((s) => s.experimentalUnitId)).size;
  const filteredImages = project.images.filter(
    (i) =>
      project.ui.batchFilter === "all" || i.batchId === project.ui.batchFilter,
  );
  const activeView = guideOpen ? "guide" : project.ui.view;
  const viewLabel: Record<View | "guide", string> = {
    guide: t("使用教程", "User guide"),
    overview: t("项目总览", "Overview"),
    analysis: t("条带分析", "Band analysis"),
    samples: t("样本与分组", "Samples"),
    results: t("结果与记录", "Results & history"),
  };
  const nav: {
    view: View;
    icon: typeof Folder;
    label: string;
    count?: string;
  }[] = [
    { view: "overview", icon: LayoutDashboard, label: viewLabel.overview },
    {
      view: "analysis",
      icon: ScanLine,
      label: viewLabel.analysis,
      count: String(project.images.length),
    },
    { view: "samples", icon: Table2, label: viewLabel.samples },
    { view: "results", icon: History, label: viewLabel.results },
  ];
  const statusLabel = (a?: Analysis) =>
    !a
      ? t("未配置", "Not configured")
      : a.excluded
        ? t("已排除", "Excluded")
        : a.status === "stale"
          ? t("待重算", "Needs recalculation")
          : a.status === "confirmed"
            ? t("已确认", "Confirmed")
            : t("待复核", "Review needed");
  const qcLabel = (q: string) =>
    q === "weak"
      ? t("弱信号示例", "Weak-signal example")
      : q === "background"
        ? t("背景不均示例", "Uneven-background example")
        : q === "saturated"
          ? t("饱和示例", "Saturation example")
          : t("正常条带示例", "Normal-band example");
  const setAnalysis = (patch: Parameters<typeof updateAnalysis>[2]) =>
    image && mutate((p) => updateAnalysis(p, image.id, patch));
  const resultValid = measurements.length > 0;
  const button = (
    children: ReactNode,
    onClick: () => void,
    cls = "button",
    disabled = false,
  ) => (
    <button className={cls} onClick={onClick} disabled={disabled || busy}>
      {children}
    </button>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href={languageUrl("#")}
          onClick={(e) => {
            e.preventDefault();
            changeView("overview");
          }}
        >
          <span className="brand-mark">
            <ScanLine size={25} />
          </span>
          <span>
            Blot<span className="brand-sub">WORKBENCH</span>
          </span>
        </a>
        <div className="workspace-label">
          {t("个人工作空间", "PERSONAL WORKSPACE")}
        </div>
        <button
          className="project-switch"
          onClick={() => changeView("overview")}
        >
          <span className="project-avatar">WB</span>
          <span>
            <strong>{t("我的研究项目", "Research projects")}</strong>
            <small>{t("本地工作空间", "Local workspace")}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav>
          <a
            className="nav-item single-nav-link"
            href={languageUrl("?mode=single")}
          >
            <ScanLine size={18} />
            <span>{t("单条带识别", "Single-strip recognition")}</span>
            <ArrowRight size={14} />
          </a>
          <a className="nav-item" href={languageUrl("#real")}>
            <FileImage size={18} />
            <span>{t("真实图像分析", "Analyze real images")}</span>
          </a>
          {nav.map((n) => (
            <button
              key={n.view}
              className={`nav-item ${activeView === n.view ? "active" : ""}`}
              onClick={() => changeView(n.view)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.count && <small>{n.count}</small>}
            </button>
          ))}
          <button
            className={`nav-item ${guideOpen ? "active" : ""}`}
            onClick={openGuide}
            aria-current={guideOpen ? "page" : undefined}
          >
            <BookOpen size={17} />
            <span>{t("使用教程", "User guide")}</span>
          </button>
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label row-between">
          {t("当前项目", "CURRENT PROJECT")}
          <button
            className="icon-button"
            aria-label={t("新建项目", "New project")}
            onClick={() => {
              setName("");
              setModal("new");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          className="current-project"
          onClick={() => changeView("overview")}
        >
          <FolderOpen size={16} />
          <span>{project.name}</span>
          <span className="green-dot" />
        </button>
        <div className="sidebar-bottom">
          <SuiteNav />
          <div className="local-note">
            <ShieldCheck size={18} />
            <strong>
              {t(
                "本机分析，本地项目保存",
                "Local analysis, local project files",
              )}
            </strong>
            <p>
              {t(
                "可选 API · 仅主动发送测试图",
                "Optional API · explicit test uploads",
              )}
            </p>
          </div>
          <button className="nav-item" onClick={() => setModal("vision")}>
            <Settings2 size={17} />
            <span>{t("视觉 API 设置", "Vision API settings")}</span>
          </button>
          <a className="nav-item" href={REPO} target="_blank" rel="noreferrer">
            <Github size={17} />
            <span>{t("开源项目", "Open source")}</span>
            <ArrowRight size={14} />
          </a>
          <div className="version-line">
            <span>v{APP_VERSION}</span>
            <span>MIT</span>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            <Folder size={16} />
            <span className="crumb-project">{project.name}</span>
            <ChevronRight size={13} />
            <strong>{viewLabel[activeView]}</strong>
          </div>
          <div className="top-actions">
            <span className={`save-status ${displayedSaveState}`} role="status">
              {displayedSaveState === "saved" ? (
                <Check size={13} />
              ) : displayedSaveState === "saving" ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <TriangleAlert size={13} />
              )}
              <span>
                {displayedSaveState === "saved"
                  ? t("已保存到本机", "Saved locally")
                  : displayedSaveState === "saving"
                    ? t("正在保存", "Saving")
                    : t("保存失败", "Save failed")}
              </span>
            </span>
            <button
              className="language-button"
              onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
              aria-label={t("切换语言", "Switch language")}
            >
              {language === "zh" ? "EN" : "中文"}
            </button>
            <button
              className="icon-button"
              aria-label={t("使用帮助", "Help")}
              onClick={() => setModal("help")}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <div className="demo-banner">
          <span className="demo-pill">{t("演示", "DEMO")}</span>
          <span>
            {t(
              "交互演示 · 所有图片与结果均为合成示例，尚未完成科研定量验证。",
              "Interactive demo · All images and results are synthetic. Not validated for research quantification.",
            )}
          </span>
          <button onClick={() => setModal("help")}>
            {t("了解范围", "See limitations")}
            <ArrowRight size={13} />
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={17} />
            <span>{translateMessage(error, language)}</span>
            <button
              className="icon-button"
              aria-label={t("关闭错误提示", "Dismiss error")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {t(
                  "WESTERN BLOT · 项目工作台",
                  "WESTERN BLOT · PROJECT WORKSPACE",
                )}
              </div>
              <h1>{viewLabel[activeView]}</h1>
              <p>
                {activeView === "guide"
                  ? t(
                      "从示例开始；回来时，知道下一步做什么。",
                      "Start with an example. Know where to resume when you return.",
                    )
                  : activeView === "overview"
                    ? t(
                        "把每一步，留在项目里。",
                        "Every step, kept with your project.",
                      )
                    : activeView === "analysis"
                      ? t(
                          "检查条带和背景，再确认当前分析。",
                          "Review bands and background before confirming the analysis.",
                        )
                      : activeView === "samples"
                        ? t(
                            "先明确样本关系，再解释重复与结果。",
                            "Define sample relationships before interpreting replicates and results.",
                          )
                        : t(
                            "从每一个数值，回到它的来源。",
                            "Trace every value back to its source.",
                          )}
              </p>
            </div>
            <div className="heading-actions">
              {guideOpen ? (
                <button
                  className="button"
                  onClick={() => changeView(project.ui.view)}
                >
                  <ArrowRight size={16} />
                  {t("返回工作区", "Back to workspace")}
                </button>
              ) : (
                <>
                  {button(
                    <>
                      <ArrowUpFromLine size={16} />
                      {t("打开项目", "Open project")}
                    </>,
                    () => fileInput.current?.click(),
                  )}
                  {button(
                    <>
                      <FileArchive size={16} />
                      {t("导出项目", "Export project")}
                    </>,
                    () => {
                      void archive();
                    },
                    "button primary",
                  )}
                </>
              )}
            </div>
          </div>
          <input
            className="visually-hidden"
            type="file"
            accept=".zip"
            ref={fileInput}
            aria-label={t("导入项目包", "Import project archive")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void run(async () => {
                  const next = await importProject(f);
                  setPendingImport(next);
                  setModal("import");
                });
              e.target.value = "";
            }}
          />
          {guideOpen && (
            <UserGuide
              language={language}
              onNavigate={changeView}
              onExample={() => setModal("example")}
              onVision={() => setModal("vision")}
            />
          )}
          {activeView === "overview" && (
            <>
              <div className="overview-grid">
                <section className="welcome-panel">
                  <div className="welcome-content">
                    <div className="welcome-kicker">
                      <span className="pulse-dot" />
                      {t(
                        "一个项目，连接完整实验",
                        "ONE PROJECT. THE WHOLE EXPERIMENT.",
                      )}
                    </div>
                    <h2>
                      {t("分析有进度，", "Keep your progress.")}
                      <br />
                      {t("研究有来处。", "Keep the context.")}
                    </h2>
                    <p>
                      {t(
                        "从原图、样本到分析记录，整理多批次 Western blot，随时接着上一次继续。",
                        "Keep Western blots, samples, and analysis records together across batches. Pick up right where you left off.",
                      )}
                    </p>
                    <button
                      className="button welcome-cta"
                      onClick={() => {
                        const next = project.analyses.find(
                          (a) => a.status !== "confirmed" && !a.excluded,
                        );
                        if (next) openImage(next.imageId);
                        else if (image) openImage(image.id);
                        else setModal("example");
                      }}
                    >
                      {t("继续分析", "Continue analysis")}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="welcome-art" aria-hidden="true">
                    <div className="art-grid" />
                    <div className="art-sheet sheet-back">
                      <span>{t("实验 02", "EXPERIMENT 02")}</span>
                      {[0, 1, 2, 3].map((i) => (
                        <div className="art-lane" key={i} />
                      ))}
                    </div>
                    <div className="art-sheet">
                      <span>WESTERN BLOT</span>
                      <div className="art-bands">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <i key={i} style={{ opacity: 0.3 + i * 0.11 }} />
                        ))}
                      </div>
                      <div className="art-bands second">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <i key={i} />
                        ))}
                      </div>
                      <div className="art-caption">
                        01 — 06 <CheckCheck size={14} />
                      </div>
                    </div>
                    <div className="art-tag">
                      <ShieldCheck size={13} />
                      {t("每一步可追溯", "TRACEABLE BY DESIGN")}
                    </div>
                  </div>
                </section>
                <section className="panel project-card">
                  <div className="panel-title">
                    <h3>{t("项目概况", "Project details")}</h3>
                    <Folder size={18} />
                  </div>
                  <label className="field-label">
                    {t("项目名称", "Project name")}
                    <BufferedField
                      label={t("项目名称", "Project name")}
                      className="project-title-input"
                      value={project.name}
                      maxLength={100}
                      required
                      onDirty={(dirty) => draftDirty("project-name", dirty)}
                      onCommit={(name) =>
                        mutate((p) => ({
                          ...p,
                          name,
                          updatedAt: new Date().toISOString(),
                        }))
                      }
                    />
                  </label>
                  <dl>
                    <div>
                      <dt>{t("项目类型", "Project type")}</dt>
                      <dd>Western blot</dd>
                    </div>
                    <div>
                      <dt>{t("实验批次", "Batches")}</dt>
                      <dd>
                        {project.batches.length} {t("个批次", "batches")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("数据来源", "Data source")}</dt>
                      <dd className="synthetic-label">
                        {t("合成示例", "Synthetic example")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("最新修改", "Last edited")}</dt>
                      <dd>
                        {new Date(project.updatedAt).toLocaleDateString(
                          language === "zh" ? "zh-CN" : "en-US",
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="progress-label">
                    <span>{t("人工复核进度", "Review progress")}</span>
                    <strong>
                      {confirmed} / {project.images.length}
                    </strong>
                  </div>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${project.images.length ? (confirmed / project.images.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </section>
              </div>
              <div className="stats-grid">
                {[
                  {
                    icon: FileImage,
                    label: t("项目图像", "PROJECT IMAGES"),
                    value: project.images.length,
                    detail: t("保留原始来源", "Original sources retained"),
                  },
                  {
                    icon: Layers,
                    label: t("实验批次", "EXPERIMENT BATCHES"),
                    value: project.batches.length,
                    detail: t(
                      "日期不等于独立重复",
                      "Dates do not define replicates",
                    ),
                  },
                  {
                    icon: Table2,
                    label: t("独立实验单位", "EXPERIMENTAL UNITS"),
                    value: units,
                    detail: t(
                      "按明确的样本关系计数",
                      "Counted from sample relationships",
                    ),
                  },
                  {
                    icon: CheckCheck,
                    label: t("已确认分析", "REVIEWED ANALYSES"),
                    value: confirmed,
                    detail: stale
                      ? `${stale} ${t("项修改后待重算", "edited analyses need recalculation")}`
                      : t(
                          "逐图确认，保留记录",
                          "Review each image, retain the record",
                        ),
                  },
                ].map((s) => (
                  <div className="stat" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <s.icon size={18} />
                    </div>
                    <strong>{s.value.toString().padStart(2, "0")}</strong>
                    <p>{s.detail}</p>
                  </div>
                ))}
              </div>
              <section className="panel library-panel">
                <div className="section-top">
                  <div>
                    <h3>
                      {t("项目图库", "Project library")}
                      <span className="count-pill">
                        {project.images.length}
                      </span>
                    </h3>
                    <p>
                      {t(
                        "按实验批次组织，点击图像继续复核。",
                        "Organized by experimental batch. Select an image to review.",
                      )}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <select
                      aria-label={t("筛选批次", "Filter by batch")}
                      value={project.ui.batchFilter}
                      onChange={(e) => ui({ batchFilter: e.target.value })}
                    >
                      <option value="all">
                        {t("全部批次", "All batches")}
                      </option>
                      {project.batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    {button(
                      <>
                        <Plus size={15} />
                        {t("加载 Example", "Load example")}
                      </>,
                      () => setModal("example"),
                    )}
                  </div>
                </div>
                {project.images.length === 0 ? (
                  <Empty t={t} onExample={() => setModal("example")} />
                ) : (
                  <div className="image-grid">
                    {filteredImages.map((img) => {
                      const a = project.analyses.find(
                        (a) => a.imageId === img.id,
                      );
                      return (
                        <button
                          className="image-card"
                          key={img.id}
                          onClick={() => openImage(img.id)}
                        >
                          <div className="image-preview">
                            <img
                              src={img.dataUrl}
                              alt={`${img.protein} synthetic blot`}
                            />
                            <span className="image-source">
                              {t("合成示例", "SYNTHETIC")}
                            </span>
                            {img.qc !== "normal" && (
                              <span className="image-alert">
                                <TriangleAlert size={13} />
                              </span>
                            )}
                          </div>
                          <div className="image-card-content">
                            <div className="row-between">
                              <strong>{img.protein}</strong>
                              <span
                                className={`status-tag ${a?.excluded ? "excluded" : a?.status}`}
                              >
                                {statusLabel(a)}
                              </span>
                            </div>
                            <p>
                              {
                                project.batches.find(
                                  (b) => b.id === img.batchId,
                                )?.label
                              }
                              <span>·</span>
                              {img.exposureMs / 1000}s
                            </p>
                            <small>{img.name}</small>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
              <div className="overview-footnote">
                <BookOpen size={16} />
                <span>
                  {t(
                    "第一次使用？示例项目可帮助你了解条带、背景、配对和进度保存。",
                    "New here? The example introduces bands, background, pairing, and saved progress.",
                  )}
                </span>
                <button onClick={openGuide}>
                  {t("查看快速指南", "Quick start")}
                  <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
          {activeView === "analysis" &&
            (!image || !analysis ? (
              <Empty t={t} onExample={() => setModal("example")} />
            ) : (
              <div className="analysis-layout">
                <aside className="panel filmstrip">
                  <div className="filmstrip-title">
                    <span>
                      {t("图像", "Images")}{" "}
                      <small>{project.images.length}</small>
                    </span>
                    <button
                      className="icon-button"
                      aria-label={t("全选图像", "Select all images")}
                      onClick={() =>
                        setChecked(
                          checked.length === project.images.length
                            ? []
                            : project.images.map((i) => i.id),
                        )
                      }
                    >
                      <CheckCheck size={16} />
                    </button>
                  </div>
                  {project.images.map((img) => (
                    <div
                      className={`film-item ${image.id === img.id ? "selected" : ""}`}
                      key={img.id}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${img.id}`}
                        checked={checked.includes(img.id)}
                        onChange={(e) =>
                          setChecked((v) =>
                            e.target.checked
                              ? [...v, img.id]
                              : v.filter((id) => id !== img.id),
                          )
                        }
                      />
                      <button onClick={() => openImage(img.id)}>
                        <img
                          src={img.dataUrl}
                          alt={`${img.protein} ${img.exposureMs / 1000}s`}
                        />
                        <strong>
                          {img.protein}
                          <span>{img.exposureMs / 1000}s</span>
                        </strong>
                        <small>
                          {
                            project.batches.find((b) => b.id === img.batchId)
                              ?.label
                          }
                        </small>
                      </button>
                    </div>
                  ))}
                </aside>
                <div className="analysis-center">
                  <section className="panel canvas-panel">
                    <div className="canvas-heading">
                      <div>
                        <h3>
                          {image.protein}
                          <span className="count-pill">
                            {image.exposureMs / 1000}s
                          </span>
                        </h3>
                        <p>{image.name}</p>
                      </div>
                      <span
                        className={`status-tag ${analysis.excluded ? "excluded" : analysis.status}`}
                      >
                        {statusLabel(analysis)}
                      </span>
                    </div>
                    <div className="canvas-toolbar">
                      <button
                        className={showRois ? "tool active" : "tool"}
                        onClick={() => setShowRois(!showRois)}
                      >
                        <ScanLine size={16} />
                        {t("条带区域", "Band ROIs")}
                      </button>
                      <button
                        className={showBackground ? "tool active" : "tool"}
                        onClick={() => setShowBackground(!showBackground)}
                      >
                        <Grid2X2 size={16} />
                        {t("背景区域", "Background")}
                      </button>
                      <span className="toolbar-spacer" />
                      <button
                        className="icon-button"
                        title={t("重置显示", "Reset display")}
                        onClick={() => setContrast(100)}
                      >
                        <Maximize2 size={17} />
                      </button>
                    </div>
                    <BlotCanvas
                      image={image}
                      rois={analysis.rois}
                      selected={roi?.id ?? ""}
                      showRois={showRois}
                      showBackground={showBackground}
                      contrast={contrast}
                      onSelect={setSelectedRoi}
                      onMove={(id, rect) =>
                        mutate((p) => updateRoi(p, image.id, id, rect))
                      }
                    />
                    <div className="canvas-caption">
                      <span>
                        <i className="legend-band" />
                        {t("条带", "Band")}
                        <i className="legend-bg" />
                        {t("背景", "Background")}
                      </span>
                      <span>
                        {image.width} × {image.height} px <b>·</b>{" "}
                        {t("合成预览", "SYNTHETIC PREVIEW")}
                      </span>
                    </div>
                    <div className="display-row">
                      <span>
                        <SlidersHorizontal size={15} />
                        {t("显示对比度", "Display contrast")}
                      </span>
                      <input
                        aria-label={t("显示对比度", "Display contrast")}
                        type="range"
                        min="60"
                        max="180"
                        value={contrast}
                        onChange={(e) => setContrast(Number(e.target.value))}
                      />
                      <span>{contrast}%</span>
                      <small>{t("仅改变显示", "Display only")}</small>
                    </div>
                  </section>
                  <section className="panel review-panel">
                    <div className="review-head">
                      <div>
                        <h3>{t("复核当前图像", "Review this image")}</h3>
                        <p>
                          {t(
                            "示例质量提示为预设，不代表自动检测。",
                            "Quality flags are preset examples, not automatic detections.",
                          )}
                        </p>
                      </div>
                      <span
                        className={`qc-label ${image.qc === "normal" ? "normal" : ""}`}
                      >
                        <TriangleAlert size={14} />
                        {qcLabel(image.qc)}
                      </span>
                    </div>
                    {analysis.status === "stale" && (
                      <div className="stale-note">
                        <TriangleAlert size={16} />
                        {t(
                          "参数已改变，旧示例结果失效。此版本未接入定量引擎，可恢复示例参数继续演示。",
                          "Parameters changed; previous example results are stale. Restore the example settings to continue; this version has no quantification engine.",
                        )}
                      </div>
                    )}
                    <BufferedField
                      multiline
                      maxLength={10000}
                      onDirty={(dirty) => draftDirty(`note-${image.id}`, dirty)}
                      key={image.id}
                      value={analysis.note}
                      label={t("复核备注", "Review notes")}
                      placeholder={t(
                        "记录条带、背景或排除原因…",
                        "Note band/background observations or exclusion reasons…",
                      )}
                      onCommit={(note) => setAnalysis({ note })}
                    />
                    <div className="review-actions">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={analysis.excluded}
                          onChange={(e) =>
                            setAnalysis({ excluded: e.target.checked })
                          }
                        />
                        {t("排除此图像", "Exclude image")}
                      </label>
                      <div className="inline-actions">
                        {button(
                          <>
                            <RotateCcw size={15} />
                            {t("恢复示例参数", "Restore example")}
                          </>,
                          () =>
                            mutate((p) => restoreExampleAnalysis(p, image.id)),
                        )}
                        {button(
                          <>
                            <Check size={16} />
                            {t("确认复核", "Confirm review")}
                          </>,
                          () => {
                            setAnalysis({ status: "confirmed" });
                            setNotice(
                              t(
                                "已记录复核；历史参数仍可追溯。",
                                "Review recorded; previous settings remain traceable.",
                              ),
                            );
                          },
                          "button primary",
                          analysis.status === "stale" ||
                            analysis.excluded ||
                            !resultValid,
                        )}
                      </div>
                    </div>
                  </section>
                  <section className="panel measurement-panel">
                    <div className="panel-title">
                      <h3>
                        {t("示例测量预览", "Example measurement preview")}
                      </h3>
                      <span className="small-muted">
                        {t(
                          "预设值 · 非实时定量",
                          "Preset values · not live quantification",
                        )}
                      </span>
                    </div>
                    {resultValid ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>{t("样本", "Sample")}</th>
                              <th>{t("面积", "Area")}</th>
                              <th>{t("背景均值", "Background mean")}</th>
                              <th>{t("净信号", "Net signal")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {measurements.map((m) => (
                              <tr key={m.sampleId}>
                                <td>
                                  {
                                    project.samples.find(
                                      (s) => s.id === m.sampleId,
                                    )?.label
                                  }
                                </td>
                                <td>{m.area}</td>
                                <td>{m.backgroundMean.toFixed(1)}</td>
                                <td>{m.net.toLocaleString("en-US")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-small">
                        {t(
                          "当前参数没有有效示例结果。请检查排除状态、样本配置和参考图像，或恢复示例。",
                          "No valid fixture for these settings. Check exclusion, samples, and reference image, or restore the example.",
                        )}
                      </div>
                    )}
                  </section>
                </div>
                <aside className="analysis-inspector">
                  <section className="panel">
                    <div className="panel-title">
                      <h3>{t("区域设置", "ROI settings")}</h3>
                      <Settings2 size={17} />
                    </div>
                    <p className="inspector-hint">
                      {t(
                        "点击区域选择；拖动或用方向键微调。",
                        "Select a region. Drag or use arrow keys to adjust.",
                      )}
                    </p>
                    <div className="lane-picker">
                      {analysis.rois
                        .filter((r) => r.kind === "band")
                        .map((r, i) => (
                          <button
                            className={r.laneId === roi?.laneId ? "active" : ""}
                            key={r.id}
                            onClick={() => setSelectedRoi(r.id)}
                          >
                            {i + 1}
                          </button>
                        ))}
                    </div>
                    {roi && (
                      <>
                        <div className="selected-roi-label">
                          {roi.kind === "band"
                            ? t("条带区域", "Band region")
                            : t("背景区域", "Background region")}{" "}
                          ·{" "}
                          {
                            project.lanes.find((l) => l.id === roi.laneId)
                              ?.number
                          }
                        </div>
                        <div className="roi-fields">
                          {(["x", "y", "width", "height"] as const).map((k) => (
                            <label key={k}>
                              {k === "width"
                                ? t("宽度", "Width")
                                : k === "height"
                                  ? t("高度", "Height")
                                  : k.toUpperCase()}
                              <input
                                type="number"
                                aria-label={`ROI ${k}`}
                                value={roi.rect[k]}
                                min={k === "width" || k === "height" ? 1 : 0}
                                max={
                                  k === "x" || k === "width"
                                    ? image.width
                                    : image.height
                                }
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (Number.isFinite(v))
                                    mutate((p) =>
                                      updateRoi(p, image.id, roi.id, {
                                        ...roi.rect,
                                        [k]: v,
                                      }),
                                    );
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="inspector-meta">
                      <span>{t("坐标基准", "Coordinates")}</span>
                      <b>{t("原图像素", "Source pixels")}</b>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-title">
                      <h3>{t("模板复用", "Reusable template")}</h3>
                      <Copy size={17} />
                    </div>
                    <p className="template-name">{project.template.name}</p>
                    <div className="inspector-meta">
                      <span>{t("项目模板", "Project template")}</span>
                      <b>v{project.template.version}</b>
                    </div>
                    <div className="inspector-meta">
                      <span>{t("当前图像快照", "Image snapshot")}</span>
                      <b>v{analysis.templateSnapshot.version}</b>
                    </div>
                    {button(
                      <>
                        <Settings2 size={14} />
                        {t("编辑新版本", "Edit new version")}
                      </>,
                      () => {
                        setTemplateForm({
                          bandWidth: project.template.bandWidth,
                          bandHeight: project.template.bandHeight,
                          backgroundGap: project.template.backgroundGap,
                        });
                        setModal("template");
                      },
                      "button full",
                    )}
                    {button(
                      <>
                        <Copy size={14} />
                        {checked.length
                          ? t(
                              `应用到选中 ${checked.length} 张`,
                              `Apply to ${checked.length} selected`,
                            )
                          : t("应用到当前图像", "Apply to current image")}
                      </>,
                      () => {
                        mutate((p) =>
                          applyTemplate(
                            p,
                            checked.length ? checked : [image.id],
                          ),
                        );
                        setNotice(
                          t(
                            "已应用模板；发生变化的图像需重新检查。",
                            "Template applied; changed images need review.",
                          ),
                        );
                      },
                      "button full",
                    )}
                    <p className="inspector-hint">
                      {t(
                        "编辑模板不会悄悄修改旧分析。",
                        "Editing a template never silently changes existing analyses.",
                      )}
                    </p>
                  </section>
                  <section className="panel">
                    <div className="panel-title">
                      <h3>{t("内参配对", "Reference pairing")}</h3>
                      <Layers size={16} />
                    </div>
                    {image.role === "target" ? (
                      <label className="field-label">
                        {t("参考图像", "Reference image")}
                        <select
                          aria-label={t("内参图像", "Reference image")}
                          value={analysis.referenceImageId ?? ""}
                          onChange={(e) =>
                            setAnalysis({
                              referenceImageId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">{t("未配对", "Unpaired")}</option>
                          {project.images
                            .filter(
                              (i) =>
                                i.role === "reference" &&
                                i.membraneId === image.membraneId &&
                                i.batchId === image.batchId,
                            )
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.protein} · {i.batchId} ·{" "}
                                {i.exposureMs / 1000}s
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : (
                      <p className="inspector-hint">
                        {t(
                          "此图像在示例中作为参考蛋白。",
                          "This image is a reference protein in the example.",
                        )}
                      </p>
                    )}
                    <p className="inspector-hint">
                      {t(
                        "按样本、膜和采集条件核对，不按位置自动推断。",
                        "Check samples, membrane, and acquisition conditions; do not infer pairing from position alone.",
                      )}
                    </p>
                    <div className="inspector-meta">
                      <span>{t("分析版本", "Analysis revision")}</span>
                      <b>r{analysis.revision}</b>
                    </div>
                  </section>
                </aside>
              </div>
            ))}
          {activeView === "samples" && (
            <section className="panel samples-panel">
              <div className="section-top">
                <div>
                  <h3>{t("样本关系表", "Sample relationships")}</h3>
                  <p>
                    {t(
                      "同一样本的不同曝光、跨膜重复测量不增加独立实验单位数。",
                      "Additional exposures or repeated measurements of the same sample do not add experimental units.",
                    )}
                  </p>
                </div>
                <span className="count-pill">
                  {units} {t("个独立单位", "units")}
                </span>
              </div>
              <div className="info-note">
                <ShieldCheck size={17} />
                {t(
                  "示例中的两个批次复测相同的 6 个样本。日期、图像数、泳道数都不能替代实验设计中的 N。",
                  "Both example batches measure the same 6 samples. Dates, image counts, and lane counts do not define N.",
                )}
              </div>
              {project.samples.length === 0 ? (
                <Empty t={t} onExample={() => setModal("example")} />
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("泳道", "Lane")}</th>
                        <th>{t("样本名称", "Sample name")}</th>
                        <th>{t("分组", "Group")}</th>
                        <th>{t("独立实验单位", "Experimental unit")}</th>
                        <th>{t("技术重复集合", "Technical replicate set")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.samples.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <span className="lane-number">
                              {
                                project.lanes.find((l) => l.sampleId === s.id)
                                  ?.number
                              }
                            </span>
                          </td>
                          {(
                            [
                              "label",
                              "group",
                              "experimentalUnitId",
                              "technicalReplicateSetId",
                            ] as const
                          ).map((k) => (
                            <td key={k}>
                              <BufferedField
                                label={`${s.id} ${k}`}
                                value={s[k]}
                                maxLength={80}
                                required
                                onDirty={(dirty) =>
                                  draftDirty(`${s.id}-${k}`, dirty)
                                }
                                onCommit={(value) =>
                                  mutate((p) =>
                                    updateSample(p, s.id, { [k]: value }),
                                  )
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="panel-footnote">
                {t(
                  "修改分组或重复关系会使相关示例结果失效。正式版将依据明确的实验设计计算，不按分组编号选择统计检验。",
                  "Changing groups or replicate relationships invalidates related fixture results. Statistical tests are never inferred from group numbers.",
                )}
              </div>
            </section>
          )}
          {activeView === "results" && (
            <>
              <div className="results-summary">
                <div className="panel result-explainer">
                  <div className="eyebrow">
                    {t("可检查的计算过程", "AN INSPECTABLE CALCULATION CHAIN")}
                  </div>
                  <h2>
                    {t(
                      "每个结果，都保留前一步。",
                      "Every result keeps its preceding step.",
                    )}
                  </h2>
                  <div className="calculation-chain">
                    <span>{t("条带积分", "Band sum")}</span>
                    <ArrowRight size={15} />
                    <span>{t("扣除背景", "Subtract background")}</span>
                    <ArrowRight size={15} />
                    <span>{t("目标 / 内参", "Target / reference")}</span>
                    <ArrowRight size={15} />
                    <span>{t("相对对照", "Relative to control")}</span>
                  </div>
                  <p>
                    {t(
                      "下表是合成项目的预设演示值，并非通过当前图像实时定量。CSV 仅包含目标与对应内参均已确认且参数仍匹配的记录。",
                      "Values below are preset synthetic fixtures, not live image quantification. CSV includes only records whose target and reference are both confirmed and still match the fixture.",
                    )}
                  </p>
                </div>
                <div className="panel export-panel">
                  <FileArchive size={25} />
                  <h3>{t("让结果带上来源", "Export with provenance")}</h3>
                  <p>
                    {t(
                      "包含样本、分析版本、归一化链和 DEMO 标识。",
                      "Includes samples, analysis revisions, the normalization chain, and DEMO labels.",
                    )}
                  </p>
                  {button(
                    <>
                      <Download size={16} />
                      {t("导出示例 CSV", "Export demo CSV")}
                    </>,
                    () => {
                      try {
                        const csv = exportCsv(project);
                        if (csv.trim().split("\n").length < 2) {
                          setError(
                            t(
                              "请先确认一张目标图像和它配对的内参图像，再导出。",
                              "Confirm a target image and its paired reference before exporting.",
                            ),
                          );
                          return;
                        }
                        download(
                          new Blob(["\ufeff" + csv], {
                            type: "text/csv;charset=utf-8",
                          }),
                          "DEMO-results.csv",
                        );
                        setNotice(
                          t(
                            "已导出带演示标识的 CSV",
                            "Exported CSV with DEMO labels",
                          ),
                        );
                      } catch (e) {
                        setError(String(e));
                      }
                    },
                    "button primary full",
                  )}
                </div>
              </div>
              <section className="panel">
                <div className="section-top">
                  <div>
                    <h3>
                      {t(
                        "目标蛋白 · 示例结果",
                        "Target protein · example results",
                      )}
                    </h3>
                    <p>
                      {t(
                        "仅用于了解流程，不提供显著性检验。",
                        "For workflow demonstration only. No significance tests.",
                      )}
                    </p>
                  </div>
                  <span className="demo-pill">
                    {t("合成示例 / 演示", "SYNTHETIC / DEMO")}
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("图像 / 曝光", "Image / exposure")}</th>
                        <th>{t("样本", "Sample")}</th>
                        <th>{t("净信号", "Net")}</th>
                        <th>{t("内参净信号", "Reference net")}</th>
                        <th>{t("比值", "Ratio")}</th>
                        <th>{t("相对对照", "Relative")}</th>
                        <th>{t("状态", "Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.images
                        .filter((i) => i.role === "target")
                        .flatMap((img) => {
                          const a = project.analyses.find(
                            (a) => a.imageId === img.id,
                          );
                          const ms = getMeasurements(project, img.id);
                          return ms.length
                            ? ms.map((m, idx) => (
                                <tr key={`${img.id}-${m.sampleId}`}>
                                  <td>
                                    {idx === 0 ? (
                                      <button
                                        className="table-link"
                                        onClick={() => openImage(img.id)}
                                      >
                                        {img.batchId} · {img.exposureMs / 1000}s
                                      </button>
                                    ) : (
                                      ""
                                    )}
                                  </td>
                                  <td>
                                    {
                                      project.samples.find(
                                        (s) => s.id === m.sampleId,
                                      )?.label
                                    }
                                  </td>
                                  <td>{m.net.toLocaleString("en-US")}</td>
                                  <td>
                                    {m.referenceNet.toLocaleString("en-US")}
                                  </td>
                                  <td>{m.ratio.toFixed(3)}</td>
                                  <td>
                                    <span className="relative-value">
                                      {m.relative.toFixed(3)}
                                    </span>
                                  </td>
                                  <td>
                                    <span className={`status-tag ${a?.status}`}>
                                      {statusLabel(a)}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            : [
                                <tr key={img.id}>
                                  <td>
                                    <button
                                      className="table-link"
                                      onClick={() => openImage(img.id)}
                                    >
                                      {img.batchId} · {img.exposureMs / 1000}s
                                    </button>
                                  </td>
                                  <td colSpan={5} className="muted">
                                    {t(
                                      "当前分析无有效示例结果",
                                      "No valid example result for current settings",
                                    )}
                                  </td>
                                  <td>
                                    <span
                                      className={`status-tag ${a?.excluded ? "excluded" : a?.status}`}
                                    >
                                      {statusLabel(a)}
                                    </span>
                                  </td>
                                </tr>,
                              ];
                        })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel history-panel">
                <div className="section-top">
                  <div>
                    <h3>{t("分析历史快照", "Analysis history")}</h3>
                    <p>
                      {t(
                        "修改不会覆盖过去的区域与参数。",
                        "Changes retain previous regions and parameters.",
                      )}
                    </p>
                  </div>
                  <span className="count-pill">{project.history.length}</span>
                </div>
                {project.history.length ? (
                  <div className="history-list">
                    {project.history
                      .slice(-12)
                      .reverse()
                      .map((a, i) => (
                        <div
                          className="history-item"
                          key={`${a.imageId}-${a.revision}-${i}`}
                        >
                          <History size={16} />
                          <div>
                            <strong>
                              {
                                project.images.find(
                                  (img) => img.id === a.imageId,
                                )?.name
                              }
                            </strong>
                            <small>
                              r{a.revision} · {t("模板", "template")} v
                              {a.templateSnapshot.version} · {a.rois.length} ROI
                            </small>
                          </div>
                          <span className={`status-tag ${a.status}`}>
                            {statusLabel(a)}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="empty-small">
                    {t(
                      "修改区域、配对或参数后，旧版本会保留在这里。",
                      "Previous versions appear here after you edit regions, pairings, or parameters.",
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>
              Blot Workbench <span className="footer-dot">·</span>{" "}
              {t("为可追溯的研究而设计", "Designed for traceable research")}
            </span>
            <span>
              {t(
                "合成示例 · 非科研验证版",
                "Synthetic demo · Not research-validated",
              )}
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {translateMessage(notice, language)}
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle className="spin" size={16} />
          {t("处理中…", "Working…")}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            ref={dialog}
            className={`modal${modal === "vision" ? " vision-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="icon-button modal-close"
              aria-label={t("关闭对话框", "Close dialog")}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "vision" && <VisionSettings language={language} />}
            {modal === "import" && pendingImport && (
              <>
                <div className="modal-icon">
                  <FileArchive size={26} />
                </div>
                <h2 id="modal-title">
                  {t("替换当前工作区？", "Replace the current workspace?")}
                </h2>
                <p>
                  {t(
                    "项目包已通过校验。导入后会替换本机当前工作区；请先导出需要保留的项目。",
                    "The archive passed validation. Importing replaces this browser's current workspace. Export the current project first if you need to keep it.",
                  )}
                </p>
                <div className="info-note">{pendingImport.name}</div>
                <div className="modal-actions">
                  {button(<>{t("取消", "Cancel")}</>, () => {
                    setModal(null);
                    setPendingImport(null);
                  })}
                  {button(
                    <>
                      <FileArchive size={15} />
                      {t("先导出当前项目", "Export current project")}
                    </>,
                    () => {
                      void archive();
                    },
                  )}
                  {button(
                    <>{t("确认导入", "Import project")}</>,
                    () => {
                      setProject(pendingImport);
                      leaveGuide();
                      setPendingImport(null);
                      setChecked([]);
                      setModal(null);
                      setNotice(t("项目已导入", "Project imported"));
                    },
                    "button primary",
                  )}
                </div>
              </>
            )}
            {modal === "new" && (
              <>
                <div className="modal-icon">
                  <FolderOpen size={26} />
                </div>
                <h2 id="modal-title">
                  {t("新建研究项目", "New research project")}
                </h2>
                <p>
                  {t(
                    "项目可以包含不同日期、批次和蛋白。此演示版可管理示例，不导入真实科研图片。新项目会替换当前工作区；请先导出需要保留的项目。",
                    "A project spans dates, batches, and proteins. This demo manages examples, not real research images. Export your current project before replacing this workspace.",
                  )}
                </p>
                <label className="field-label">
                  {t("项目名称", "Project name")}
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t(
                      "例如：蛋白表达研究",
                      "e.g. Protein expression study",
                    )}
                  />
                </label>
                <div className="modal-actions">
                  {button(<>{t("取消", "Cancel")}</>, () => setModal(null))}
                  {button(
                    <>
                      {t("创建项目", "Create project")}
                      <ArrowRight size={15} />
                    </>,
                    () => {
                      const empty = createEmptyProject(name.trim());
                      empty.ui.language = project.ui.language;
                      setProject(empty);
                      leaveGuide();
                      setChecked([]);
                      setModal(null);
                    },
                    "button primary",
                    !name.trim(),
                  )}
                </div>
              </>
            )}
            {modal === "example" && (
              <>
                <div className="modal-icon">
                  <Sparkles size={26} />
                </div>
                <h2 id="modal-title">
                  {t("打开合成示例", "Open the synthetic example")}
                </h2>
                <p>
                  {t(
                    "8 张图像 · 2 个实验批次 · 6 个独立实验单位。包含目标、内参及不同曝光，所有图片与结果都是演示数据。",
                    "8 images, 2 batches, and 6 experimental units. Explore target/reference proteins and different exposures. All images and results are synthetic.",
                  )}
                </p>
                <div className="info-note">
                  {t(
                    "这会替换当前工作区。需要保留修改时，请先导出项目。",
                    "This replaces the current workspace. Export your project first to keep your changes.",
                  )}
                </div>
                <div className="modal-actions">
                  {button(
                    <>
                      <FileArchive size={15} />
                      {t("先导出当前项目", "Export current project")}
                    </>,
                    () => {
                      void archive();
                    },
                  )}
                  {button(
                    <>
                      <FolderOpen size={15} />
                      {t("载入示例", "Load example")}
                    </>,
                    () => {
                      void loadExample();
                    },
                    "button primary",
                  )}
                </div>
              </>
            )}
            {modal === "template" && (
              <>
                <div className="modal-icon">
                  <Copy size={25} />
                </div>
                <h2 id="modal-title">
                  {t("保存模板新版本", "Save a new template version")}
                </h2>
                <p>
                  {t(
                    "模板保存为新版本，不影响已存在的图像分析。应用模板是另一个明确的操作。",
                    "Saving a new template version does not change existing analyses. Applying the template is a separate action.",
                  )}
                </p>
                <div className="template-form">
                  {(["bandWidth", "bandHeight", "backgroundGap"] as const).map(
                    (k) => (
                      <label className="field-label" key={k}>
                        {k === "bandWidth"
                          ? t("条带宽度（px）", "Band width (px)")
                          : k === "bandHeight"
                            ? t("条带高度（px）", "Band height (px)")
                            : t("背景间距（px）", "Background gap (px)")}
                        <input
                          aria-label={k}
                          type="number"
                          min={k === "backgroundGap" ? 0 : 4}
                          max={
                            k === "bandWidth"
                              ? 96
                              : k === "bandHeight"
                                ? 60
                                : 28
                          }
                          value={templateForm[k]}
                          onChange={(e) =>
                            setTemplateForm({
                              ...templateForm,
                              [k]: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
                <div className="modal-actions">
                  {button(<>{t("取消", "Cancel")}</>, () => setModal(null))}
                  {button(
                    <>
                      <Save size={15} />
                      {t(
                        `保存为 v${project.template.version + 1}`,
                        `Save v${project.template.version + 1}`,
                      )}
                    </>,
                    () => {
                      try {
                        mutate((p) => editTemplate(p, templateForm));
                        setModal(null);
                        setNotice(
                          t(
                            "新模板已保存，已有分析保持原样。",
                            "New template saved. Existing analyses are unchanged.",
                          ),
                        );
                      } catch (e) {
                        setError(String(e));
                      }
                    },
                    "button primary",
                    !Number.isFinite(templateForm.bandWidth) ||
                      templateForm.bandWidth < 4 ||
                      templateForm.bandWidth > 96 ||
                      templateForm.bandHeight < 4 ||
                      templateForm.bandHeight > 60 ||
                      templateForm.backgroundGap < 0 ||
                      templateForm.backgroundGap > 28 ||
                      !Object.values(templateForm).every(Number.isFinite),
                  )}
                </div>
              </>
            )}
            {modal === "help" && (
              <>
                <div className="modal-icon">
                  <BookOpen size={25} />
                </div>
                <h2 id="modal-title">
                  {t(
                    "从示例开始，随时继续",
                    "Start with an example. Resume anytime.",
                  )}
                </h2>
                <p>
                  {t(
                    "这是工作流程演示版，不是已经验证的科研定量工具。",
                    "This is a workflow demonstration, not a validated research quantification tool.",
                  )}
                </p>
                <ol className="help-steps">
                  <li>
                    <strong>
                      {t("了解项目与样本", "Explore projects and samples")}
                    </strong>
                    <span>
                      {t(
                        "示例跨两个批次，共享 6 个独立实验单位；曝光数不增加 N。",
                        "Two batches share 6 experimental units; exposures do not increase N.",
                      )}
                    </span>
                  </li>
                  <li>
                    <strong>
                      {t(
                        "复核条带、背景与配对",
                        "Review bands, background, and pairing",
                      )}
                    </strong>
                    <span>
                      {t(
                        "选择区域可拖动或编辑坐标。修改分析后，旧示例结果变为待重算。",
                        "Drag regions or edit coordinates. Changed analysis settings invalidate the preset results.",
                      )}
                    </span>
                  </li>
                  <li>
                    <strong>{t("确认并导出", "Confirm and export")}</strong>
                    <span>
                      {t(
                        "目标与内参都确认后，可导出带 DEMO 标识的结果。",
                        "Confirm both target and reference to export results labeled DEMO.",
                      )}
                    </span>
                  </li>
                  <li>
                    <strong>
                      {t("保存项目，几周后继续", "Save and come back later")}
                    </strong>
                    <span>
                      {t(
                        "浏览器会自动保存；请导出项目包做长期备份和跨设备迁移。",
                        "Browser storage saves progress. Export a project archive for durable backup and migration.",
                      )}
                    </span>
                  </li>
                </ol>
                <div className="info-note">
                  {t(
                    "本页演示固定合成图像和预设结果。实际图像测量请进入“单条带识别”或“多排与内参”，支持 8/16 位 TIFF 与 8 位 PNG/JPEG；批量原图、实验配对和统计请进入“真实图像分析”。自动取样需要人工复核。",
                    "This page demonstrates fixed synthetic images and preset results. For image measurements, use Single-strip analysis or Multiple rows & reference with 8/16-bit TIFF or 8-bit PNG/JPEG. Use Analyze real images for original-image batches, experimental pairing, and statistics. Review automatic sampling regions manually.",
                  )}
                </div>
                <div className="modal-actions">
                  <button className="button" onClick={openGuide}>
                    <BookOpen size={15} />
                    {t("完整使用教程", "Full user guide")}
                  </button>
                  <a
                    className="button"
                    href={`${REPO}/tree/main/docs`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <BookOpen size={15} />
                    {t("完整文档", "Documentation")}
                  </a>
                  {button(
                    <>
                      {t("开始复核", "Start reviewing")}
                      <ArrowRight size={15} />
                    </>,
                    () => {
                      setModal(null);
                      if (image) openImage(image.id);
                    },
                    "button primary",
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function BufferedField({
  value,
  label,
  placeholder,
  onCommit,
  onDirty,
  multiline = false,
  required = false,
  maxLength = 200,
  className,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onDirty: (dirty: boolean) => void;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const callbacks = useRef({ onCommit, onDirty });
  callbacks.current = { onCommit, onDirty };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDraft(value);
    callbacks.current.onDirty(false);
  }, [value]);
  useEffect(() => {
    if (draft === value || (required && !draft.trim())) return;
    timer.current = setTimeout(() => {
      callbacks.current.onCommit(required ? draft.trim() : draft);
      callbacks.current.onDirty(false);
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, value, required]);
  useEffect(() => () => callbacks.current.onDirty(false), []);
  const props = {
    "aria-label": label,
    placeholder,
    maxLength,
    className,
    value: draft,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setDraft(event.target.value);
      callbacks.current.onDirty(event.target.value !== value);
    },
    onBlur: () => {
      if (timer.current) clearTimeout(timer.current);
      const next = required ? draft.trim() : draft;
      if (required && !next) setDraft(value);
      else if (next !== value) callbacks.current.onCommit(next);
      callbacks.current.onDirty(false);
    },
  };
  return multiline ? <textarea {...props} /> : <input {...props} />;
}
function Empty({
  t,
  onExample,
}: {
  t: (a: string, b: string) => string;
  onExample: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Microscope size={32} />
      </div>
      <h3>{t("从一个示例开始", "Start with an example")}</h3>
      <p>
        {t(
          "加载合成 WB 项目，体验完整的分析工作流程。",
          "Load a synthetic WB project and explore the workflow.",
        )}
      </p>
      <button className="button primary" onClick={onExample}>
        <Plus size={16} />
        {t("加载 Example", "Load example")}
      </button>
      <small>
        {t(
          "真实科研图像导入将在定量验证后开放。",
          "Real research image import follows quantitative validation.",
        )}
      </small>
    </div>
  );
}
function BlotCanvas({
  image,
  rois,
  selected,
  showRois,
  showBackground,
  contrast,
  onSelect,
  onMove,
}: {
  image: Project["images"][number];
  rois: Roi[];
  selected: string;
  showRois: boolean;
  showBackground: boolean;
  contrast: number;
  onSelect: (id: string) => void;
  onMove: (id: string, rect: Rect) => void;
}) {
  const { t } = useLanguage();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: string;
    start: { x: number; y: number };
    rect: Rect;
  } | null>(null);
  const [draft, setDraft] = useState<{ id: string; rect: Rect } | null>(null);
  const point = (e: React.PointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix
      ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
      : { x: 0, y: 0 };
  };
  const clamp = (rect: Rect): Rect => ({
    ...rect,
    x: Math.round(Math.max(0, Math.min(image.width - rect.width, rect.x))),
    y: Math.round(Math.max(0, Math.min(image.height - rect.height, rect.y))),
  });
  return (
    <div className="blot-stage">
      <div className="stage-label">
        {image.role === "reference"
          ? t("内参", "REFERENCE")
          : t("目标", "TARGET")}{" "}
        <span>· {t("合成示例", "SYNTHETIC")}</span>
      </div>
      <svg
        role="img"
        aria-label={t(
          "可编辑取样区域的合成条带演示",
          "Interactive synthetic blot with editable regions",
        )}
        ref={svg}
        viewBox={`0 0 ${image.width} ${image.height}`}
        className="blot-svg"
        onPointerMove={(e) => {
          if (drag.current) {
            const pt = point(e),
              d = drag.current;
            setDraft({
              id: d.id,
              rect: clamp({
                ...d.rect,
                x: d.rect.x + pt.x - d.start.x,
                y: d.rect.y + pt.y - d.start.y,
              }),
            });
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (
            d &&
            draft &&
            (draft.rect.x !== d.rect.x || draft.rect.y !== d.rect.y)
          )
            onMove(d.id, draft.rect);
          drag.current = null;
          setDraft(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
      >
        <image
          href={image.dataUrl}
          width={image.width}
          height={image.height}
          style={{ filter: `contrast(${contrast}%)` }}
        />
        {showRois &&
          rois
            .filter((r) => r.kind === "band" || showBackground)
            .map((r) => {
              const rect = draft?.id === r.id ? draft.rect : r.rect;
              const isSelected = selected === r.id;
              return (
                <g
                  key={r.id}
                  className={`roi ${r.kind} ${isSelected ? "selected" : ""}`}
                >
                  <rect
                    {...rect}
                    tabIndex={0}
                    role="button"
                    aria-label={`${r.kind === "band" ? t("条带", "band") : t("背景", "background")} ${r.laneId}`}
                    onFocus={() => onSelect(r.id)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onSelect(r.id);
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = {
                        id: r.id,
                        start: point(e),
                        rect: r.rect,
                      };
                    }}
                    onKeyDown={(e) => {
                      const direction: Record<string, [number, number]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, -1],
                        ArrowDown: [0, 1],
                      };
                      const move = direction[e.key];
                      if (move) {
                        e.preventDefault();
                        const step = e.shiftKey ? 10 : 1;
                        onMove(
                          r.id,
                          clamp({
                            ...r.rect,
                            x: r.rect.x + move[0] * step,
                            y: r.rect.y + move[1] * step,
                          }),
                        );
                      }
                    }}
                  />
                  {r.kind === "band" && (
                    <text x={rect.x + rect.width / 2} y={rect.y - 9}>
                      {r.laneId.split("-").at(-1)}
                    </text>
                  )}
                  {isSelected && (
                    <>
                      <circle cx={rect.x} cy={rect.y} r={3} />
                      <circle
                        cx={rect.x + rect.width}
                        cy={rect.y + rect.height}
                        r={3}
                      />
                    </>
                  )}
                </g>
              );
            })}
      </svg>
      <div className="stage-bottom">
        <span>01</span>
        <span>02</span>
        <span>03</span>
        <span>04</span>
        <span>05</span>
        <span>06</span>
      </div>
    </div>
  );
}
export default App;
