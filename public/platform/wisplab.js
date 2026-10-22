import { CloudClient, validAccount } from "./client.js";

// An explicit loopback-only acceptance switch. Hosted sites cannot redirect auth to a query-provided server.
const localApi =
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URL(location.href).searchParams.get("cloudApi") === "local";
const client = new CloudClient(
  localApi ? { base: "http://127.0.0.1:8090" } : {},
);
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
  binding = null,
  generation = 0,
  page = 1,
  archived = false,
  view = "",
  busy = false,
  modal,
  content,
  status;
let historyProject = null,
  historyPage = 1,
  pendingSnapshot = null,
  restoreFocus = null;
let renderedLanguage = document.documentElement.lang;
let capabilitiesLoaded = false,
  cloudLinkUnavailable = false;
const cloudEnabled = () => client.capabilities.projectStorage === "cloud";
const disabledControls = new Map();
const tools = {
  "wb-single": ["单排条带", "Single strip"],
  "wb-quick": ["WB 快速分析", "WB quick analysis"],
  "wb-real": ["WB 原图项目", "WB original-image project"],
  "wb-demo": ["WB 示例", "WB demo"],
  pathology: ["IHC / 染色 / IF", "IHC / stains / IF"],
  pcr: ["PCR 数据分析", "PCR analysis"],
};
const titleFor = (tool) => (tools[tool] ? t(...tools[tool]) : tool);
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
  const version = generation,
    account = client.generation,
    id = client.auth?.record.id;
  const isCurrent = () =>
    adapter === active &&
    generation === version &&
    client.generation === account &&
    client.auth?.record.id === id;
  return {
    isCurrent,
    check() {
      if (!isCurrent()) throw new DOMException("Cancelled", "AbortError");
    },
  };
}
function transition(action) {
  busy = false;
  syncBusy();
  action();
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
  const values = [...(content?.querySelectorAll("input[name]") || [])].map(
    (input) => ({
      name: input.name,
      value: input.type === "file" ? "" : input.value,
      checked: input.checked,
    }),
  );
  renderedLanguage = document.documentElement.lang;
  if (!view) return;
  open(view, false);
  // Keep unfinished credentials only in the form, never in persistent storage.
  for (const saved of values) {
    const input = [...content.querySelectorAll("input[name]")].find(
      (input) => input.name === saved.name,
    );
    if (input && input.type !== "file") {
      input.value = saved.value;
      input.checked = saved.checked;
    }
  }
  if (content.querySelector('input[name="showPassword"]')?.checked)
    for (const input of content.querySelectorAll(
      'input[name="password"],input[name="passwordConfirm"]',
    ))
      input.type = "text";
  const saveAsNew = content.querySelector('input[name="saveAsNew"]');
  if (saveAsNew) saveAsNew.onchange();
}
function msg(text, kind = "") {
  if (status) {
    status.textContent = text;
    status.className = "status " + kind;
  }
}
function errorMessage(e) {
  if (e?.name === "AbortError")
    return t(
      "已取消，当前分析保留。",
      "Cancelled. Your current analysis is retained.",
    );
  if (e.code === "account_changed")
    return t(
      "账号已变更，操作已取消；当前分析保留。",
      "The account changed. The operation was cancelled and local analysis is retained.",
    );
  if (e.code === "cloud_disabled")
    return t(
      "此部署未开放云项目保存或同步。请使用本地项目文件。",
      "Cloud project storage and sync are unavailable on this deployment. Use local project files.",
    );
  if (e.status === 401)
    return t(
      "登录已过期，请重新登录；本机分析已保留。",
      "Your session expired. Sign in again; local analysis is retained.",
    );
  if (e.status === 409)
    return t(
      "云端已有新版本，未覆盖。请打开版本记录核对，或另存为新项目。",
      "The cloud project has changed. Nothing was overwritten. Review its history or save a new project.",
    );
  if (e.status === 413 || e.status === 507)
    return t(
      "项目或存储空间超出限额，未保存。可先下载本地项目。",
      "Project or storage limit reached. Nothing was saved. Download a local project instead.",
    );
  if (e.status === 429)
    return t(
      "操作过于频繁，请稍后重试。",
      "Too many requests. Try again shortly.",
    );
  if (e.code === "integrity")
    return t(
      "下载文件校验失败，未替换当前分析。",
      "Download integrity check failed. Your current analysis is unchanged.",
    );
  if (e.status === 403 || e.status === 404)
    return t(
      "项目不存在或当前账号无权访问。",
      "This project is unavailable to this account.",
    );
  if (e.status === 400)
    return t(
      "请求未通过校验。请检查用户名、密码或项目文件。",
      "Validation failed. Check the username, password, or project file.",
    );
  if (e.status === 0 || e instanceof TypeError)
    return t(
      "暂时无法连接云服务。请检查网络；仍可使用本机分析。",
      "Cloud service is unavailable. Check your connection; local analysis remains available.",
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
    if (
      ended &&
      generation !== startedGeneration &&
      ["projects", "history", "account", "local"].includes(view)
    )
      open(view, false);
    else refreshDialogLanguage();
  }
}
function homeLink() {
  const url = new URL(desktop ? "app://wisplab/" : "https://wisplab.top/");
  url.searchParams.set("lang", t("zh", "en"));
  return url.href;
}
function toolLink(tool) {
  if (!tools[tool]) throw new Error("Unknown project tool");
  const family = tool.startsWith("wb-") ? "wb" : tool;
  const url = new URL(
    desktop ? `app://wisplab/${family}/` : `https://${family}.wisplab.top/`,
  );
  if (tool === "wb-single") url.searchParams.set("mode", "single");
  if (tool === "wb-quick") url.searchParams.set("mode", "quick");
  if (tool === "wb-real") url.hash = "real";
  if (tool === "wb-demo") url.hash = "demo";
  url.searchParams.set("lang", t("zh", "en"));
  return url;
}
const bar = node("footer", null, { class: "bar", "aria-label": brand() });
container.append(bar);
function renderBar() {
  bar.setAttribute("aria-label", brand());
  bar.replaceChildren();
  bar.append(node("a", brand(), { href: homeLink(), class: "brand" }));
  const controls = node("div", null, { class: "bar-actions" });
  if (adapter) {
    controls.append(
      button(t("本地项目", "Local project"), () => open("local"), true),
    );
  }
  controls.append(
    node(
      "span",
      client.auth
        ? client.auth.record.username
        : t("游客 · 本机分析", "Guest · local analysis"),
      { class: "identity" },
    ),
  );
  controls.append(
    button(
      client.auth
        ? cloudEnabled()
          ? t("云端项目", "Cloud projects")
          : t("账号", "Account")
        : t("登录 / 注册", "Sign in / Register"),
      () => open(client.auth ? "account" : "login"),
    ),
  );
  bar.append(controls);
  syncBusy();
}
function updateRoute(next) {
  const u = new URL(location.href);
  if (next) u.searchParams.set("account", next);
  else u.searchParams.delete("account");
  history.replaceState(history.state, "", u);
}
function close() {
  if (busy) return;
  view = "";
  cloudLinkUnavailable = false;
  pendingSnapshot = null;
  modal?.close();
  modal?.remove();
  modal = null;
  updateRoute("");
  const u = new URL(location.href);
  u.searchParams.delete("cloudProject");
  history.replaceState(history.state, "", u);
  restoreFocus?.focus?.();
}
function open(next, route = true, checked = false) {
  if (busy) return;
  if (
    !checked &&
    ["login", "register", "account", "projects", "linked"].includes(next) &&
    (route || !capabilitiesLoaded)
  ) {
    open("loading", false, true);
    task(async () => {
      await client.loadCapabilities();
      capabilitiesLoaded = true;
      if (!cloudEnabled()) binding = null;
      if (client.auth && next === "account" && !cloudEnabled()) {
        try {
          await client.refresh();
        } catch (error) {
          if (error.status !== 401) {
            /* Keep the local account view usable offline. */
          }
        }
      }
      transition(() => open(next, route, true));
    });
    return;
  }
  if (next !== "loading" && !cloudEnabled() && deepProjectId()) {
    cloudLinkUnavailable = true;
    const url = new URL(location.href);
    url.searchParams.delete("cloudProject");
    history.replaceState(history.state, "", url);
  }
  if (next === "account" && cloudEnabled()) next = "projects";
  if (
    ["projects", "history", "linked", "save"].includes(next) &&
    !cloudEnabled()
  ) {
    cloudLinkUnavailable = true;
    next = client.auth ? "account" : "login";
    const url = new URL(location.href);
    url.searchParams.delete("cloudProject");
    history.replaceState(history.state, "", url);
  }
  if (["account", "delete-account"].includes(next) && !client.auth) next = "login";
  if (next === "register" && client.capabilities.registration !== "open")
    next = "login";
  restoreFocus = document.activeElement;
  if (next === "save" && !pendingSnapshot) next = "projects";
  view = next;
  if (next !== "save") pendingSnapshot = null;
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
  if (route) updateRoute(next);
  if (next === "loading")
    heading(t("正在读取账号服务…", "Checking account service…"));
  else if (next === "login" || next === "register") renderAuth(next);
  else if (next === "account") renderAccount();
  else if (next === "delete-account") renderDeleteAccount();
  else if (next === "local") renderLocal();
  else if (next === "projects") {
    renderProjectsFrame();
    task(loadProjects);
  } else if (next === "history") {
    renderHistoryFrame();
    task(loadHistory);
  } else if (next === "linked") {
    heading(t("正在打开云端项目", "Opening cloud project"));
    task(() => resolveLinkedProject(deepProjectId()));
  } else if (next === "save") renderSaveConfirmation(pendingSnapshot);
  if (cloudLinkUnavailable && ["account", "login", "local"].includes(next))
    msg(errorMessage({ code: "cloud_disabled" }));
}
function heading(text, description) {
  content.append(node("h1", text, { id: "wl-heading" }));
  if (description) content.append(node("p", description, { class: "intro" }));
}
function field(form, label, name, type = "text", attributes = {}) {
  const wrap = node("label", null, { class: "field" }),
    input = node("input", null, { name, type, ...attributes });
  wrap.append(node("span", label), input);
  form.append(wrap);
  return input;
}
function renderAuth(mode) {
  const register = mode === "register";
  heading(
    register
      ? t("创建 WispLab 账号", "Create your WispLab account")
      : t("欢迎回到 WispLab", "Welcome to WispLab"),
    t(
      "账号可选。实验在本机分析，项目可通过本地文件保存和恢复。",
      "Accounts are optional. Analyze on your device and save or restore projects with local files.",
    ),
  );
  const split = node("div", null, { class: "auth-grid" }),
    aside = node("aside", null, { class: "auth-aside" }),
    form = node("form");
  aside.append(
    node("div", "W", { class: "monogram" }),
    node("h2", t("你的实验，随时继续", "Your experiments, ready to continue")),
  );
  for (const [zh, en] of [
    [
      "下载包含原文件与设置的本地项目",
      "Download local projects with original files and settings",
    ],
    ["打开项目文件继续分析", "Open a project file to continue analysis"],
    [
      "游客使用与离线分析始终保留",
      "Guest access and offline analysis remain available",
    ],
  ])
    aside.append(node("p", "✓ " + t(zh, en)));
  aside.append(
    node(
      "p",
      t(
        "登录不会上传实验数据。更换电脑时，可自行传输本地项目文件并打开。",
        "Signing in does not upload experimental data. Move a local project file yourself to continue on another computer.",
      ),
      { class: "fine" },
    ),
  );
  const username = field(form, t("用户名", "Username"), "username", "text", {
    required: "",
    autocomplete: "username",
    minlength: "3",
    maxlength: "32",
    pattern: "[a-z0-9][a-z0-9_.-]{2,31}",
    autocapitalize: "none",
    spellcheck: "false",
  });
  form.append(
    node(
      "p",
      t(
        "3–32 位小写字母、数字、点、下划线或短横线，以字母或数字开头。",
        "3–32 lowercase letters, numbers, dots, underscores or hyphens; start with a letter or number.",
      ),
      { class: "fine" },
    ),
  );
  const password = field(form, t("密码", "Password"), "password", "password", {
    required: "",
    autocomplete: register ? "new-password" : "current-password",
    minlength: register ? "12" : "1",
    maxlength: "71",
  });
  let confirm;
  if (register)
    confirm = field(
      form,
      t("再次输入密码", "Confirm password"),
      "passwordConfirm",
      "password",
      {
        required: "",
        autocomplete: "new-password",
        minlength: "12",
        maxlength: "71",
      },
    );
  const show = node("label", null, { class: "check" }),
    showBox = node("input", null, { type: "checkbox", name: "showPassword" });
  show.append(showBox, document.createTextNode(t("显示密码", "Show password")));
  showBox.onchange = () => {
    password.type = showBox.checked ? "text" : "password";
    if (confirm) confirm.type = password.type;
  };
  form.append(show);
  if (register)
    form.append(
      node(
        "p",
        t(
          "至少 12 个字符，最多 71 个 UTF-8 字节。首版不提供自动找回密码，请妥善保存。",
          "Use at least 12 characters and no more than 71 UTF-8 bytes. Automatic password recovery is not available yet; keep your password safe.",
        ),
        { class: "fine" },
      ),
    );
  const rememberWrap = node("label", null, { class: "check" }),
    remember = node("input", null, { type: "checkbox", name: "remember" });
  rememberWrap.append(
    remember,
    document.createTextNode(
      t("在这台私人设备上记住登录", "Remember me on this private device"),
    ),
  );
  form.append(rememberWrap);
  form.append(
    node(
      "button",
      register ? t("注册并登录", "Register and sign in") : t("登录", "Sign in"),
      { type: "submit" },
    ),
  );
  if (register || client.capabilities.registration === "open")
    form.append(
      button(
        register
          ? t("已有账号？前往登录", "Already registered? Sign in")
          : t("还没有账号？创建账号", "New here? Create an account"),
        () => open(register ? "login" : "register"),
        true,
      ),
    );
  form.append(button(t("以游客身份继续", "Continue as guest"), close, true));
  if (client.capabilities.registration !== "open")
    form.append(
      node(
        "p",
        t(
          "当前暂不开放注册，已有账号仍可登录。",
          "Registration is currently unavailable. Existing accounts can still sign in.",
        ),
        { class: "fine" },
      ),
    );
  form.onsubmit = (e) => {
    e.preventDefault();
    task(async () => {
      await client.loadCapabilities();
      capabilitiesLoaded = true;
      if (register && client.capabilities.registration !== "open") {
        msg(
          t("当前暂不开放注册。", "Registration is currently unavailable."),
          "error",
        );
        return;
      }
      const name = username.value.trim();
      if (
        register &&
        (!validAccount(name, password.value) ||
          password.value !== confirm.value)
      ) {
        msg(
          t(
            "请核对用户名和密码；两次密码必须一致。",
            "Check your username and password. Both passwords must match.",
          ),
          "error",
        );
        return;
      }
      if (register) await client.register(name, password.value, confirm.value);
      await client.login(name, password.value, remember.checked);
      password.value = "";
      if (confirm) confirm.value = "";
      binding = null;
      transition(() => {
        if (deepProjectId()) openLinkedProject();
        else open("account", true, true);
      });
    });
  };
  split.append(aside, form);
  content.append(split);
  username.focus();
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
      binding = null;
      msg(t("项目已打开。", "Project opened."));
    });
  content.append(
    fieldDescription(t("打开已有项目文件", "Open an existing project file")),
    input,
  );
}
function fieldDescription(text) {
  return node("p", text, { class: "intro" });
}
function renderAccount() {
  heading(
    t("WispLab 账号", "WispLab account"),
    t(
      "当前部署仅提供账号与本地项目。实验数据留在本机，不提供云上传或跨电脑自动同步。",
      "This deployment provides accounts and local projects only. Experimental data stays on this device; cloud uploads and automatic cross-computer sync are unavailable.",
    ),
  );
  content.append(
    node("p", t("已登录：", "Signed in as: ") + client.auth.record.username, {
      class: "identity",
    }),
  );
  const actions = node("div", null, { class: "actions" });
  actions.append(
    button(t("本地项目", "Local project"), () => open("local"), true),
  );
  appendAccountActions(actions);
  content.append(actions, platformPolicyLinks());
}
function renderDeleteAccount() {
  heading(t("删除 WispLab 账号", "Delete WispLab account"), t(
    "将永久删除此账号及其服务器项目和文件，并使所有登录失效。此操作不可撤销；本机分析项目不会删除，请先导出需要的备份。服务器历史备份与安全日志的处理请查看隐私政策，或联系 gaoyuan1799@163.com。",
    "Permanently delete this account and its server projects/files, revoking all sessions. This cannot be undone. Local analysis projects are retained; export any backups you need first. See the privacy policy or contact gaoyuan1799@163.com about historical server backups and security logs."));
  const form = node("form");
  const username = field(form, t("输入当前用户名以确认", "Confirm your current username"), "deleteUsername", "text", { required: true, autocomplete: "username" });
  const password = field(form, t("当前密码", "Current password"), "deletePassword", "password", { required: true, autocomplete: "current-password" });
  const submit = node("button", t("永久删除账号", "Permanently delete account"), { type: "submit" });
  form.append(submit, button(t("取消", "Cancel"), () => open("account"), true));
  form.onsubmit = (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (username.value !== client.auth?.record.username) {
      msg(t("请输入当前登录的用户名。", "Enter the username of the signed-in account."), "error"); return;
    }
    if (!window.confirm(t("确认永久删除账号及服务器数据？本机项目保留。", "Permanently delete this account and its server data? Local projects are retained."))) return;
    const secret = password.value;
    password.value = "";
    task(async () => {
      try { await client.deleteAccount(secret, username.value); }
      catch (error) {
        msg(error.status === 400 ? t("用户名或密码不正确，未删除账号。", "Username or password did not match. Account not deleted.") : t("未能确认删除成功。请重新登录确认账号状态，或联系 gaoyuan1799@163.com；请勿将密码发送给支持人员。", "Deletion could not be confirmed. Sign in again to check account status or contact gaoyuan1799@163.com. Never send your password to support."), "error"); return;
      }
      binding = null;
      transition(() => open("login", true, true));
      msg(t("账号已删除，本机分析项目已保留。", "Account deleted. Local analysis projects have been retained."));
    });
  };
  content.append(form, platformPolicyLinks());
}
function platformPolicyLinks() {
  const line = node("p", null, { class: "policy-links" });
  line.append(
    node("a", t("隐私政策", "Privacy Policy"), {
      href: "https://wisplab.top/privacy.html", target: "_blank", rel: "noreferrer",
    }),
    document.createTextNode(" · "),
    node("a", t("技术支持", "Support"), {
      href: "https://wisplab.top/support.html", target: "_blank", rel: "noreferrer",
    }),
  );
  return line;
}
function appendAccountActions(actions) {
  actions.append(button(t("删除账号", "Delete account"), () => open("delete-account"), true));
  actions.append(
    button(
      t("退出登录", "Sign out"),
      () => {
        if (busy) return;
        client.logout();
        binding = null;
        close();
        renderBar();
      },
      true,
    ),
  );
  actions.append(
    button(
      t("退出所有设备", "Sign out all devices"),
      () => {
        if (
          !window.confirm(
            t(
              "退出所有设备？所有现有登录会被撤销，本机分析保留。",
              "Sign out all devices? All existing sessions will be revoked. Local analysis is retained.",
            ),
          )
        )
          return;
        task(async () => {
          try {
            await client.logoutAll();
          } catch {
            binding = null;
            transition(() => open("login"));
            msg(
              t(
                "本机已退出，但未能确认其他设备退出。重新登录后可重试退出所有设备。",
                "Signed out here, but other sessions could not be confirmed revoked. Sign in again to retry signing out all devices.",
              ),
              "error",
            );
            return;
          }
          binding = null;
          transition(close);
        });
      },
      true,
    ),
  );
}
function renderProjectsFrame() {
  heading(
    t("云端项目", "Cloud projects"),
    t(
      "只有点击保存才会上传。每次保存增加一个版本，保留原版本。",
      "Files upload only when you save. Every save adds a version and keeps earlier versions.",
    ),
  );
  const actions = node("div", null, { class: "actions" });
  if (adapter)
    actions.append(
      button(t("保存当前分析到云端", "Save current analysis to cloud"), () =>
        task(prepareSave),
      ),
    );
  actions.append(
    button(
      archived
        ? t("查看活动项目", "Show active projects")
        : t("查看已归档", "Show archived"),
      () => {
        archived = !archived;
        page = 1;
        task(loadProjects);
      },
      true,
    ),
  );
  appendAccountActions(actions);
  content.append(actions, node("div", null, { id: "wl-list" }));
}
function pager(parent, data, change) {
  if (data.totalPages <= 1) return;
  const row = node("div", null, { class: "actions" });
  const prev = button(
      t("上一页", "Previous"),
      () => change(data.page - 1),
      true,
    ),
    next = button(t("下一页", "Next"), () => change(data.page + 1), true);
  prev.disabled = data.page <= 1;
  next.disabled = data.page >= data.totalPages;
  row.append(prev, node("span", `${data.page} / ${data.totalPages}`), next);
  parent.append(row);
}
async function loadProjects() {
  const operation = currentOperation();
  await client.refresh();
  operation.check();
  const list = await client.list(adapter?.tool, page, archived);
  operation.check();
  const target = shadow.getElementById("wl-list");
  if (!target) return;
  target.replaceChildren();
  if (!list.items.length)
    target.append(
      node(
        "p",
        t(
          "这里还没有项目。打开工具后，可将当前分析保存到云端。",
          "No projects here yet. Open a tool to save your current analysis.",
        ),
      ),
    );
  for (const p of list.items) {
    const row = node("article", null, { class: "project" }),
      meta = node("div");
    meta.append(
      node("h2", p.title),
      node("p", `${titleFor(p.tool)} · ${p.updated}`, { class: "fine" }),
    );
    row.append(meta);
    row.append(
      button(
        t("版本记录 / 打开", "Versions / Open"),
        () => {
          historyProject = p;
          historyPage = 1;
          open("history");
        },
        true,
      ),
    );
    row.append(
      button(
        p.archived ? t("恢复项目", "Restore project") : t("归档", "Archive"),
        () =>
          task(async () => {
            const operation = currentOperation();
            await client.patch(p.id, { archived: !p.archived });
            operation.check();
            await loadProjects();
          }),
        true,
      ),
    );
    target.append(row);
  }
  pager(target, list, (p) => {
    page = p;
    task(loadProjects);
  });
  const usage = await client.request("/api/wisplab/usage");
  operation.check();
  msg(
    t("已用 ", "Used ") +
      size(usage.usedBytes) +
      " / " +
      size(usage.limits.userBytes) +
      t(
        "。历史版本与归档文件计入空间。",
        " including historical and archived versions.",
      ),
  );
}
function size(n) {
  return (n / 1048576).toFixed(1) + " MiB";
}
async function prepareSave() {
  const active = adapter;
  if (!active) return;
  const operation = currentOperation(active),
    bound = binding;
  await client.refresh();
  operation.check();
  const snapshot = await active.exportProject();
  operation.check();
  const usage = await client.request("/api/wisplab/usage");
  operation.check();
  if (
    snapshot.blob.size > usage.limits.maxFileBytes ||
    usage.usedBytes + snapshot.blob.size > usage.limits.userBytes
  )
    throw Object.assign(new Error(), { status: 507 });
  pendingSnapshot = {
    snapshot,
    active,
    operation,
    bound,
    createdProject: null,
  };
  view = "save";
  updateRoute("save");
  renderSaveConfirmation(pendingSnapshot);
}
function renderSaveConfirmation(pending) {
  const { snapshot, active, operation, bound } = pending;
  content.replaceChildren();
  heading(
    t("确认保存项目", "Save this project"),
    t(
      "将上传下列项目包；确认后会保留一个云端历史版本。",
      "The following project package will be uploaded and retained as a cloud version.",
    ),
  );
  content.append(
    node(
      "p",
      snapshot.summaryTranslations?.[t("zh", "en")] ||
        snapshot.summary ||
        snapshot.name,
    ),
    node("p", size(snapshot.blob.size), { class: "fine" }),
  );
  const form = node("form"),
    name = field(form, t("项目名称", "Project name"), "title", "text", {
      required: "",
      maxlength: "120",
    });
  name.value =
    bound?.title || snapshot.name.replace(/\.(zip|json|wisplab)$/i, "");
  const newWrap = node("label", null, { class: "check" }),
    newProject = node("input", null, { type: "checkbox", name: "saveAsNew" });
  newProject.checked = !bound;
  newProject.disabled = !bound;
  newWrap.append(
    newProject,
    document.createTextNode(t("另存为新项目", "Save as a new project")),
  );
  form.append(newWrap);
  name.disabled = !!bound;
  newProject.onchange = () => {
    name.disabled = !newProject.checked;
  };
  form.append(
    node("button", t("确认上传", "Upload project"), { type: "submit" }),
    button(t("返回项目列表", "Back to projects"), () => open("projects"), true),
  );
  content.append(form);
  msg(
    t(
      "原文件会上传至 WispLab 服务器。项目仅对你的账号开放，管理员可访问存储数据。",
      "Original files will be uploaded to the WispLab server. Projects are private to your account; the administrator can access stored data.",
    ),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    task(async () => {
      operation.check();
      if (pendingSnapshot?.snapshot !== snapshot)
        throw new DOMException("Cancelled", "AbortError");
      await client.refresh();
      operation.check();
      let project = newProject.checked
        ? pending.createdProject ||
          (await client.create(active.tool, name.value.trim()))
        : bound;
      operation.check();
      if (newProject.checked) pending.createdProject = project;
      if (!project) return;
      // Retain a newly created empty project on uncertain network errors; never retry a mutation automatically.
      binding = project;
      const result = await client.upload(
        project,
        snapshot,
        snapshot.appVersion ||
          active.appVersion ||
          document.querySelector('meta[name="wisplab-build"]')?.content ||
          "wisplab-platform-1",
      );
      operation.check();
      binding = result.project;
      pendingSnapshot = null;
      msg(t("已保存新版本。", "New version saved."));
      transition(() => open("projects"));
    });
  };
}
function renderHistoryFrame() {
  heading(
    historyProject.title,
    t(
      "选择版本打开；重新保存会创建新版本。",
      "Choose a version to open. Saving again creates a new version.",
    ),
  );
  content.append(
    button(t("返回项目列表", "Back to projects"), () => open("projects"), true),
    node("div", null, { id: "wl-history" }),
  );
}
async function loadHistory() {
  const operation = currentOperation(),
    project = historyProject;
  await client.refresh();
  operation.check();
  const data = await client.history(project.id, historyPage);
  operation.check();
  const target = shadow.getElementById("wl-history");
  if (!target) return;
  target.replaceChildren();
  if (!data.items.length)
    target.append(
      node(
        "p",
        t("项目尚未保存版本。", "This project has no saved versions yet."),
      ),
    );
  for (const snapshot of data.items) {
    const row = node("article", null, { class: "project" }),
      meta = node("div");
    meta.append(
      node("h2", t("版本 ", "Version ") + snapshot.revision),
      node("p", `${snapshot.created} · ${size(snapshot.sizeBytes)}`, {
        class: "fine",
      }),
    );
    row.append(meta);
    if (adapter?.tool === project.tool)
      row.append(
        button(t("打开此版本", "Open this version"), () =>
          task(async () => {
            const active = adapter,
              operation = currentOperation(active);
            const blob = await client.download(snapshot);
            operation.check();
            const accepted = await active.importProject(blob, {
              isCurrent: operation.isCurrent,
            });
            operation.check();
            if (accepted === false)
              throw new DOMException("Cancelled", "AbortError");
            binding = project;
            msg(
              t(
                "项目已打开，可继续分析。",
                "Project opened. Continue your analysis.",
              ),
            );
            transition(close);
          }),
        ),
      );
    else {
      const url = toolLink(historyProject.tool);
      url.searchParams.set("cloudProject", historyProject.id);
      row.append(
        node("a", t("在对应工具中打开", "Open in the matching tool"), {
          href: url.href,
          class: "button",
        }),
      );
    }
    row.append(
      button(
        t("下载项目文件", "Download project file"),
        () =>
          task(async () => {
            const operation = currentOperation();
            const blob = await client.download(snapshot);
            operation.check();
            saveFile(blob, snapshot.file);
            msg(t("项目已准备下载。", "Project is ready to download."));
          }),
        true,
      ),
    );
    target.append(row);
  }
  pager(target, data, (p) => {
    historyPage = p;
    task(loadHistory);
  });
  msg("");
}
function deepProjectId() {
  const id = new URL(location.href).searchParams.get("cloudProject");
  return /^[a-z0-9]{15}$/.test(id || "") ? id : null;
}
function openLinkedProject() {
  const id = deepProjectId();
  if (!id) return;
  if (!client.auth) {
    open("login");
    return;
  }
  // Open a version list first; a link never automatically replaces local analysis.
  open("linked");
}
async function resolveLinkedProject(id) {
  client.id(id);
  const context = client.context();
  await client.refresh();
  client.assertContext(context);
  const project = await client.request(
    `/api/collections/cloud_projects/records/${id}`,
  );
  client.assertContext(context);
  if (!tools[project.tool]) throw new Error("Unknown project tool");
  historyProject = project;
  historyPage = 1;
  transition(() => open("history"));
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
    binding = null;
    generation++;
    renderBar();
    if (["projects", "history", "account", "local"].includes(view) && !busy)
      open(view, false);
    return () => {
      if (adapter === next) {
        adapter = null;
        binding = null;
        generation++;
        renderBar();
        if (["projects", "history", "account", "local"].includes(view) && !busy)
          open(view, false);
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
window.addEventListener("popstate", () => {
  if (busy) return;
  if (deepProjectId()) {
    openLinkedProject();
    return;
  }
  const mode = new URL(location.href).searchParams.get("account");
  if (["login", "register", "projects", "account", "local"].includes(mode))
    open(mode === "projects" && !client.auth ? "login" : mode, false);
  else close();
});
renderBar();
window.dispatchEvent(new Event("wisplab:ready"));
const initial = new URL(location.href).searchParams.get("account");
if (deepProjectId()) openLinkedProject();
else if (
  ["login", "register", "projects", "account", "local"].includes(initial)
)
  open(initial === "projects" && !client.auth ? "login" : initial, false);
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
