import { clearLegacyAccountTokens } from "./client.js";

// Only obsolete sign-in tokens are removed; local experiments and preferences stay intact.
clearLegacyAccountTokens();
const root = document.createElement("wisplab-platform");
const shadow = root.attachShadow({ mode: "open" });
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./wisplab.css", import.meta.url).href;
shadow.append(css);
const container = document.createElement("div");
shadow.append(container);
document.body.append(root);
const t = (zh, en) =>
  document.documentElement.lang.toLowerCase().startsWith("en") ? en : zh;
const brand = () =>
  t("WispLab实验数据分析", "WispLab Experimental Data Analysis");
const desktop = !!window.wispLabDesktop?.isDesktop;
let adapter = null,
  generation = 0,
  view = "",
  busy = false,
  modal,
  content,
  status;
let restoreFocus = null;
let renderedLanguage = document.documentElement.lang;
const disabledControls = new Map();
const tools = {
  "wb-single": ["单排条带", "Single strip"],
  "wb-quick": ["WB 快速分析", "WB quick analysis"],
  "wb-real": ["WB 原图项目", "WB original-image project"],
  "wb-demo": ["WB 示例", "WB demo"],
  pathology: ["IHC / 染色 / IF", "IHC / stains / IF"],
  pcr: ["PCR 数据分析", "PCR analysis"],
};
function node(tag, text, attrs = {}) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  for (const [key, value] of Object.entries(attrs))
    e.setAttribute(key, String(value));
  return e;
}
function button(label, action, secondary = false) {
  const b = node("button", label, {
    type: "button",
    class: secondary ? "secondary" : "",
  });
  b.addEventListener("click", (event) => {
    if (!busy) action(event);
  });
  return b;
}
function syncBusy() {
  if (busy) {
    modal?.setAttribute("aria-busy", "true");
    for (const control of shadow.querySelectorAll(
      "button,input,select,textarea",
    )) {
      if (!disabledControls.has(control))
        disabledControls.set(control, control.disabled);
      control.disabled = true;
    }
  } else {
    modal?.removeAttribute("aria-busy");
    for (const [control, disabled] of disabledControls)
      control.disabled = disabled;
    disabledControls.clear();
  }
}
// Block navigation as well as form controls while a project operation is in flight.
for (const event of ["click", "submit", "change"])
  shadow.addEventListener(
    event,
    (e) => {
      if (busy && !e.target.closest?.("[data-wl-download]")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
new MutationObserver(() => {
  if (busy) syncBusy();
}).observe(shadow, { subtree: true, childList: true });
function currentOperation(active = adapter) {
  const version = generation;
  const isCurrent = () => adapter === active && generation === version;
  return {
    isCurrent,
    check() {
      if (!isCurrent()) throw new DOMException("Cancelled", "AbortError");
    },
  };
}
function changeLanguage(language) {
  const u = new URL(location.href);
  u.searchParams.set("lang", language);
  history.replaceState(history.state, "", u);
  try {
    localStorage.setItem("wisplab.lang", language);
  } catch {
    /* URL retains the preference. */
  }
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  window.dispatchEvent(
    new StorageEvent("storage", { key: "wisplab.lang", newValue: language }),
  );
}
function refreshDialogLanguage() {
  if (busy || renderedLanguage === document.documentElement.lang) return;
  renderedLanguage = document.documentElement.lang;
  if (view) open(false);
}
function msg(text, kind = "") {
  if (status) {
    status.textContent = text;
    status.className = "status " + kind;
  }
}
function errorMessage(error) {
  if (error?.name === "AbortError")
    return t(
      "已取消，当前分析保留。",
      "Cancelled. Your current analysis is retained.",
    );
  return t(
    "操作未完成，当前分析已保留。请核对项目文件后重试。",
    "The operation did not complete. Local analysis is retained. Check the project file and retry.",
  );
}
async function task(action) {
  if (busy) return;
  const job = Symbol(),
    startedGeneration = generation;
  busy = job;
  msg(t("正在处理…", "Working…"));
  syncBusy();
  try {
    await action();
  } catch (e) {
    if (busy === job) msg(errorMessage(e), "error");
  } finally {
    const ended = busy === job;
    if (ended) {
      busy = false;
      syncBusy();
    }
    renderBar();
    if (ended && generation !== startedGeneration && view === "local")
      open(false);
    else refreshDialogLanguage();
  }
}
function homeLink() {
  const url = new URL(desktop ? "app://wisplab/" : "https://wisplab.top/");
  url.searchParams.set("lang", t("zh", "en"));
  return url.href;
}
const bar = node("footer", null, { class: "bar", "aria-label": brand() });
container.append(bar);
function renderBar() {
  bar.setAttribute("aria-label", brand());
  bar.replaceChildren();
  bar.append(node("a", brand(), { href: homeLink(), class: "brand" }));
  const controls = node("div", null, { class: "bar-actions" });
  if (adapter)
    controls.append(button(t("本地项目", "Local project"), () => open(), true));
  controls.append(
    node("span", t("本机分析 · 本地保存", "Local analysis · local files"), {
      class: "identity",
    }),
  );
  bar.append(controls);
  syncBusy();
}
function updateRoute(next) {
  const url = new URL(location.href);
  url.searchParams.delete("account");
  url.searchParams.delete("cloudProject");
  if (next) url.searchParams.set("project", "local");
  else url.searchParams.delete("project");
  history.replaceState(history.state, "", url);
}
function close() {
  if (busy) return;
  view = "";
  modal?.close();
  modal?.remove();
  modal = null;
  updateRoute(false);
  restoreFocus?.focus?.();
}
function open(route = true) {
  if (busy) return;
  if (!modal) restoreFocus = document.activeElement;
  view = "local";
  renderedLanguage = document.documentElement.lang;
  modal?.remove();
  modal = node("dialog", null, {
    class: "dialog",
    "aria-labelledby": "wl-heading",
  });
  const top = node("header", null, { class: "dialog-top" }),
    language = node("div", null, {
      class: "actions",
      "aria-label": "中文 / English",
    });
  for (const [code, label] of [
    ["zh", "中文"],
    ["en", "EN"],
  ]) {
    const b = button(label, () => changeLanguage(code), true);
    b.lang = code === "zh" ? "zh-CN" : "en";
    b.setAttribute("aria-pressed", String(t("zh", "en") === code));
    language.append(b);
  }
  top.append(
    node("a", brand(), { href: homeLink(), class: "brand" }),
    language,
    button(t("返回分析 ×", "Back to analysis ×"), close, true),
  );
  content = node("div", null, { class: "dialog-body" });
  status = node("p", "", {
    class: "status",
    role: "status",
    "aria-live": "polite",
  });
  modal.append(top, content, status);
  container.append(modal);
  modal.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  modal.showModal();
  if (route) updateRoute(true);
  renderLocal();
}
function heading(text, description) {
  content.append(node("h1", text, { id: "wl-heading" }));
  if (description) content.append(node("p", description, { class: "intro" }));
}
function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = node("a", "", {
    href: url,
    download: name,
    "data-wl-download": "true",
  });
  shadow.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function renderLocal() {
  heading(
    t("本地项目", "Local project"),
    t(
      "项目文件包含原图或原表格、取样区域和分析设置。保存在你选择的位置，不上传。",
      "Project files contain source images or tables, sampling regions and settings. Save them locally without uploading.",
    ),
  );
  const active = adapter;
  if (!active) {
    msg(t("请先打开分析工具。", "Open an analysis tool first."));
    return;
  }
  content.append(
    button(t("下载当前项目", "Download current project"), () =>
      task(async () => {
        const operation = currentOperation(active);
        const s = await active.exportProject();
        operation.check();
        saveFile(s.blob, s.name);
        msg(t("项目已准备下载。", "Your project is ready to download."));
      }),
    ),
  );
  const input = node("input", null, {
    type: "file",
    accept: ".zip,.json,.wisplab",
    "aria-label": t("选择本地项目", "Choose a local project"),
  });
  input.onchange = () =>
    task(async () => {
      const f = input.files?.[0];
      if (!f) return;
      const operation = currentOperation(active);
      operation.check();
      const accepted = await active.importProject(f, {
        isCurrent: operation.isCurrent,
      });
      operation.check();
      if (accepted === false) throw new DOMException("Cancelled", "AbortError");
      msg(t("项目已打开。", "Project opened."));
    });
  content.append(
    fieldDescription(t("打开已有项目文件", "Open an existing project file")),
    input,
    platformPolicyLinks(),
  );
}
function fieldDescription(text) {
  return node("p", text, { class: "intro" });
}
function platformPolicyLinks() {
  const line = node("p", null, { class: "policy-links" });
  line.append(
    node("a", t("隐私政策", "Privacy Policy"), {
      href: "https://wisplab.top/privacy.html",
      target: "_blank",
      rel: "noreferrer",
    }),
    document.createTextNode(" · "),
    node("a", t("技术支持", "Support"), {
      href: "https://wisplab.top/support.html",
      target: "_blank",
      rel: "noreferrer",
    }),
  );
  return line;
}
window.WispLab = Object.freeze({
  registerProjectAdapter(next) {
    if (
      !tools[next?.tool] ||
      typeof next.exportProject !== "function" ||
      typeof next.importProject !== "function"
    )
      throw new Error("Invalid project adapter");
    adapter = next;
    generation++;
    renderBar();
    if (view === "local" && !busy) open(false);
    return () => {
      if (adapter === next) {
        adapter = null;
        generation++;
        renderBar();
        if (view === "local" && !busy) open(false);
      }
    };
  },
});
new MutationObserver(() => {
  renderBar();
  refreshDialogLanguage();
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["lang"],
});
function readRoute() {
  if (busy) return;
  const url = new URL(location.href);
  const local =
    url.searchParams.get("project") === "local" ||
    url.searchParams.get("account") === "local";
  const linked = url.searchParams.has("cloudProject");
  if (local || linked) {
    open();
    if (linked)
      msg(
        t(
          "此版本使用本地项目文件。请导入已下载的项目继续分析。",
          "This edition uses local project files. Import a downloaded project to continue.",
        ),
      );
  } else if (view) close();
  else if (url.searchParams.has("account")) updateRoute(false);
}
window.addEventListener("popstate", readRoute);
renderBar();
window.dispatchEvent(new Event("wisplab:ready"));
readRoute();
// The portal and desktop use the same source, with local tool links in the desktop shell.
if (desktop)
  for (const a of document.querySelectorAll("a[href]")) {
    try {
      const url = new URL(a.href);
      const host = {
        "wb.wisplab.top": "wb",
        "pathology.wisplab.top": "pathology",
        "pcr.wisplab.top": "pcr",
      }[url.hostname];
      if (host) a.href = `app://wisplab/${host}/${url.search}${url.hash}`;
    } catch {}
  }
