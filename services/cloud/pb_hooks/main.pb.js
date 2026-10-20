// All writes use custom routes + transactions. Built-in list/view/file APIs
// independently enforce owner rules; direct create/update/delete are locked.
$app.onServe().bindFunc((e) => {
  // Official ServeEvent override: do not create the setup superuser, mint a
  // setup token in stdout, or launch a browser on headless/test installations.
  e.installerFunc = null;
  return e.next();
});

onBootstrap((e) => {
  const cloud = require(__hooks + "/cloud.js");
  cloud.limits(); // Fail startup on invalid operator settings.
  cloud.registrationMode();
  cloud.projectStorage();
  return e.next();
});
routerUse(new Middleware((e) => {
  const cloud = require(__hooks + "/cloud.js");
  const origin = e.request.header.get("Origin");
  if (origin && !cloud.allowedOrigins().includes(origin)) throw new ForbiddenError("Origin is not allowed / 来源未获允许");
  if (e.request.url.path.startsWith("/api/")) {
    e.response.header().set("Cache-Control", "no-store");
    e.response.header().set("Referrer-Policy", "no-referrer");
    e.response.header().set("X-Content-Type-Options", "nosniff");
  }
  return e.next();
}, -1042)); // Reject unknown origins before PocketBase's CORS middleware.

onRecordCreateRequest((e) => {
  const body = e.requestInfo().body;
  if (require(__hooks + "/cloud.js").registrationMode() !== "open") throw new ForbiddenError("Registration is closed / 注册暂未开放");
  if (Object.keys(body).some((key) => !["username", "password", "passwordConfirm"].includes(key))) throw new BadRequestError("Only username and password are accepted / 仅接受用户名和密码");
  // Keep the ASCII identity canonical; never store or log cleartext passwords.
  if (typeof body.username !== "string" || !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(body.username)) throw new BadRequestError("Username must be 3–32 lowercase letters, digits, _, . or - / 用户名需为3–32位小写字母、数字、_、.或-");
  if (typeof body.password !== "string" || toBytes(body.password).length > 71) throw new BadRequestError("Password exceeds 71 UTF-8 bytes / 密码不能超过71个UTF-8字节");
  return e.next();
}, "users");

onRecordUpdate((e) => { throw new ForbiddenError("Snapshots are immutable / 历史版本不可修改"); }, "cloud_snapshots");
onRecordDelete((e) => { throw new ForbiddenError("Archive the project instead / 请归档项目，历史版本不永久删除"); }, "cloud_snapshots", "cloud_projects", "users");

routerAdd("GET", "/api/wisplab/capabilities", (e) => {
  const c = require(__hooks + "/cloud.js");
  return e.json(200, { version: 1, accounts: true, registration: c.registrationMode(), projectStorage: c.projectStorage() });
});

routerAdd("GET", "/api/wisplab/usage", (e) => {
  const c = require(__hooks + "/cloud.js"), u = c.usage(e.app, e.auth.id);
  return e.json(200, { usedBytes: u.bytes, projectCount: u.projects, limits: c.limits() });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/wisplab/projects", (e) => {
  const c = require(__hooks + "/cloud.js");
  c.requireCloudProjectWrites();
  const b = e.requestInfo().body;
  if (Object.keys(b).some((key) => !["title", "tool"].includes(key))) throw new BadRequestError("Unexpected project fields / 项目字段无效");
  if (typeof b.title !== "string" || !b.title.trim() || b.title.trim().length > 120) throw new BadRequestError("Invalid title / 项目名称无效");
  if (!["wb-real", "wb-single", "wb-quick", "wb-demo", "pathology", "pcr"].includes(b.tool)) throw new BadRequestError("Invalid tool / 工具类型无效");
  let result;
  e.app.runInTransaction((app) => {
    if (c.usage(app, e.auth.id).projects >= c.limits().maxProjects) c.fail(507, "project_quota", "Project limit reached / 项目数量已达上限");
    const project = new Record(app.findCollectionByNameOrId("cloud_projects"));
    project.set("owner", e.auth.id); project.set("title", b.title.trim()); project.set("tool", b.tool);
    app.save(project); result = c.projectJson(project);
  });
  return e.json(201, result);
}, $apis.requireAuth("users"), $apis.bodyLimit(8192));

routerAdd("PATCH", "/api/wisplab/projects/{id}", (e) => {
  const c = require(__hooks + "/cloud.js");
  c.requireCloudProjectWrites();
  const b = e.requestInfo().body;
  if (!Object.keys(b).length || Object.keys(b).some((key) => !["title", "archived"].includes(key))) throw new BadRequestError("Only title and archived may change / 仅可修改名称和归档状态");
  if (b.title !== undefined && (typeof b.title !== "string" || !b.title.trim() || b.title.trim().length > 120)) throw new BadRequestError("Invalid title / 名称无效");
  if (b.archived !== undefined && typeof b.archived !== "boolean") throw new BadRequestError("Invalid archived flag / 归档状态无效");
  let result;
  e.app.runInTransaction((app) => {
    const project = c.ownProject(app, e.request.pathValue("id"), e.auth.id);
    if (b.title !== undefined) project.set("title", b.title.trim());
    if (b.archived !== undefined) project.set("archived", b.archived);
    app.save(project); result = c.projectJson(project);
  });
  return e.json(200, result);
}, $apis.requireAuth("users"), $apis.bodyLimit(8192));

routerAdd("POST", "/api/wisplab/projects/{id}/snapshots", (e) => {
  const c = require(__hooks + "/cloud.js"), limits = c.limits();
  c.requireCloudProjectWrites();
  // Authorize before parsing/uploading large bodies.
  c.ownProject(e.app, e.request.pathValue("id"), e.auth.id);
  const files = e.findUploadedFiles("file"), b = e.requestInfo().body;
  if (files.length !== 1 || files[0].size < 1) throw new BadRequestError("Exactly one project file is required / 请选择一个项目文件");
  const file = files[0];
  if (file.size > limits.maxFileBytes) c.fail(413, "file_too_large", "Project file exceeds limit / 项目文件超过大小限制");
  if (!/\.(zip|json|wisplab)$/i.test(file.originalName)) throw new BadRequestError("Only ZIP or JSON project snapshots are accepted / 仅接受ZIP或JSON项目快照");
  if (typeof b.baseRevision !== "string" || (b.baseRevision !== "" && !/^[a-z0-9]{15}$/.test(b.baseRevision))) throw new BadRequestError("baseRevision is required / 缺少基础版本");
  if (typeof b.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(b.sha256)) throw new BadRequestError("SHA-256 is required / 缺少SHA-256校验值");
  const schemaVersion = Number(b.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 10000 || typeof b.appVersion !== "string" || !b.appVersion || b.appVersion.length > 100) throw new BadRequestError("Invalid version metadata / 版本信息无效");
  let result;
  e.app.runInTransaction((app) => {
    const project = c.ownProject(app, e.request.pathValue("id"), e.auth.id);
    if (project.getBool("archived")) c.fail(409, "project_archived", "Restore the archived project first / 请先恢复已归档项目");
    const current = project.getString("currentRevision");
    if (current !== b.baseRevision) c.fail(409, "revision_conflict", "A newer version exists; open it or save a copy / 云端已有新版本，请先打开或另存副本");
    const revision = current ? app.findRecordById("cloud_snapshots", current).getInt("revision") + 1 : 1;
    const usage = c.usage(app, e.auth.id);
    if (revision > limits.maxRevisions) c.fail(507, "revision_quota", "Version limit reached / 历史版本数量已达上限");
    if (usage.bytes + file.size > limits.userBytes || usage.totalBytes + file.size > limits.totalBytes) c.fail(507, "storage_quota", "Cloud storage limit reached / 云端存储空间已达上限");
    const snapshot = new Record(app.findCollectionByNameOrId("cloud_snapshots"));
    snapshot.set("owner", e.auth.id); snapshot.set("project", project.id); snapshot.set("revision", revision);
    snapshot.set("file", file); snapshot.set("sha256", b.sha256); snapshot.set("schemaVersion", schemaVersion);
    snapshot.set("appVersion", b.appVersion); snapshot.set("sizeBytes", file.size);
    app.save(snapshot);
    project.set("currentRevision", snapshot.id); app.save(project);
    result = { project: c.projectJson(project), snapshot: c.snapshotJson(snapshot) };
  });
  return e.json(201, result);
}, $apis.requireAuth("users"), $apis.bodyLimit(281 * 1024 * 1024));

routerAdd("POST", "/api/wisplab/logout-all", (e) => {
  e.app.runInTransaction((app) => {
    const user = app.findRecordById("users", e.auth.id);
    user.refreshTokenKey(); app.save(user);
  });
  return e.noContent(204);
}, $apis.requireAuth("users"), $apis.bodyLimit(1024));
