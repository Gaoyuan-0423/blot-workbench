// Shared module loaded inside each isolated PocketBase hook runtime.
const MAX_FILE_BYTES = 280 * 1024 * 1024;
function limit(name, fallback, maximum) {
  const raw = $os.getenv(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("Invalid cloud limit: " + name);
  return value;
}
function limits() {
  return {
    maxFileBytes: limit("WISPLAB_MAX_FILE_BYTES", MAX_FILE_BYTES, MAX_FILE_BYTES),
    userBytes: limit("WISPLAB_USER_BYTES", 512 * 1024 * 1024, 1024 ** 4),
    totalBytes: limit("WISPLAB_TOTAL_BYTES", 5 * 1024 ** 3, 1024 ** 4),
    maxProjects: limit("WISPLAB_MAX_PROJECTS", 100, 10000),
    maxRevisions: limit("WISPLAB_MAX_REVISIONS", 200, 10000),
  };
}
function registrationMode() {
  // An absent setting must never open a production installation. Development
  // and integration runners opt in explicitly instead of relying on a default.
  const mode = $os.getenv("WISPLAB_REGISTRATION") || "closed";
  if (mode !== "open" && mode !== "closed") throw new Error("Invalid WISPLAB_REGISTRATION: expected open or closed");
  return mode;
}
function projectStorage() {
  const mode = $os.getenv("WISPLAB_PROJECT_STORAGE") || "local";
  if (mode !== "local" && mode !== "cloud") throw new Error("Invalid WISPLAB_PROJECT_STORAGE: expected local or cloud");
  return mode;
}
function requireCloudProjectWrites() {
  if (projectStorage() !== "cloud") fail(403, "cloud_disabled", "Cloud project storage is disabled; use local project files / 云项目存储未开放，请使用本地项目文件");
}
// PocketBase serializes each data entry as a validation error; a bare string
// is replaced with validation_invalid_value. Use its supported public shape.
function fail(status, code, message) { throw new ApiError(status, message, { code: new ValidationError(code, message) }); }
function ownProject(app, id, owner) {
  let project;
  try { project = app.findRecordById("cloud_projects", id); } catch { fail(404, "not_found", "Project not found / 找不到项目"); }
  if (project.getString("owner") !== owner) fail(404, "not_found", "Project not found / 找不到项目");
  return project;
}
function projectJson(record) {
  return { id: record.id, title: record.getString("title"), tool: record.getString("tool"),
    currentRevision: record.getString("currentRevision"), archived: record.getBool("archived"), updated: record.getString("updated") };
}
function snapshotJson(record) {
  return { id: record.id, project: record.getString("project"), revision: record.getInt("revision"),
    file: record.getString("file"), sha256: record.getString("sha256"), schemaVersion: record.getInt("schemaVersion"),
    appVersion: record.getString("appVersion"), created: record.getString("created"), sizeBytes: record.getInt("sizeBytes") };
}
function usage(app, owner) {
  const result = new DynamicModel({ bytes: 0, totalBytes: 0, projects: 0 });
  app.db().newQuery("SELECT COALESCE((SELECT SUM(sizeBytes) FROM cloud_snapshots WHERE owner={:owner}),0) AS bytes, COALESCE((SELECT SUM(sizeBytes) FROM cloud_snapshots),0) AS totalBytes, (SELECT COUNT(*) FROM cloud_projects WHERE owner={:owner}) AS projects")
    .bind({ owner }).one(result);
  return { bytes: result.bytes, totalBytes: result.totalBytes, projects: result.projects };
}
function allowedOrigins() {
  const origins = ["https://wisplab.top", "https://wb.wisplab.top", "https://pathology.wisplab.top", "https://pcr.wisplab.top", "https://gaoyuan-0423.github.io", "app://wisplab"];
  if ($os.getenv("WISPLAB_ENV") === "development") {
    origins.push("http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5187", "http://localhost:5187");
  }
  return origins;
}
module.exports = { limits, registrationMode, projectStorage, requireCloudProjectWrites, fail, ownProject, projectJson, snapshotJson, usage, allowedOrigins };
