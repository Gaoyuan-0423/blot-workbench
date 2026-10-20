// WispLab cloud schema v1. No production accounts or credentials are seeded.
migrate((app) => {
  // The official binary creates an empty `users` collection during its own
  // initial migration. This service must start from a dedicated, empty store.
  const users = app.findCollectionByNameOrId("users");
  if (app.findRecordsByFilter("users", "", "", 1, 0).length) throw new Error("WispLab initial migration requires an empty users collection");
  users.listRule = null; users.viewRule = "id = @request.auth.id";
  users.createRule = ""; users.updateRule = null; users.deleteRule = null;
  users.fields.add(new TextField({ name: "username", required: true, min: 3, max: 32, pattern: "^[a-z0-9][a-z0-9_.-]{2,31}$" }));
  users.addIndex("idx_users_username", true, "username", "");
  users.passwordAuth = { enabled: true, identityFields: ["username"] };
  users.oauth2.enabled = false; users.otp.enabled = false; users.mfa.enabled = false;
  users.authAlert.enabled = false;
  users.authToken.duration = 3600; users.fileToken.duration = 120;
  users.fields.getByName("email").required = false;
  users.fields.getByName("password").min = 12;
  users.fields.getByName("password").max = 71;
  app.save(users);
  const own = "@request.auth.id != '' && owner = @request.auth.id";
  const timestamps = () => [
    { name: "created", type: "autodate", onCreate: true },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const projects = new Collection({
    type: "base", name: "cloud_projects", listRule: own, viewRule: own,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "title", type: "text", required: true, min: 1, max: 120 },
      { name: "tool", type: "select", required: true, maxSelect: 1, values: ["wb-real", "wb-single", "wb-quick", "wb-demo", "pathology", "pcr"] },
      { name: "archived", type: "bool" }, ...timestamps(),
    ],
    indexes: ["CREATE INDEX idx_cloud_projects_owner ON cloud_projects (owner, archived)"],
  });
  app.save(projects);
  const snapshots = new Collection({
    type: "base", name: "cloud_snapshots", listRule: own, viewRule: own,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "project", type: "relation", required: true, collectionId: projects.id, maxSelect: 1, cascadeDelete: false },
      { name: "revision", type: "number", required: true, min: 1, onlyInt: true },
      { name: "file", type: "file", required: true, protected: true, maxSelect: 1, maxSize: 293601280, mimeTypes: ["application/zip", "application/json"] },
      { name: "sha256", type: "text", required: true, pattern: "^[a-f0-9]{64}$", max: 64 },
      { name: "schemaVersion", type: "number", required: true, min: 1, max: 10000, onlyInt: true },
      { name: "appVersion", type: "text", required: true, max: 100 },
      { name: "sizeBytes", type: "number", required: true, min: 1, onlyInt: true },
      ...timestamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_cloud_revision ON cloud_snapshots (project, revision)",
      "CREATE INDEX idx_cloud_snapshots_owner ON cloud_snapshots (owner)",
    ],
  });
  app.save(snapshots);
  projects.fields.add(new RelationField({ name: "currentRevision", collectionId: snapshots.id, maxSelect: 1, cascadeDelete: false }));
  app.save(projects);
  const settings = app.settings();
  settings.meta.appName = "WispLab";
  settings.meta.appURL = "https://wisplab.top";
  settings.rateLimits = { enabled: true, rules: [
    { label: "users:create", audience: "", duration: 3600, maxRequests: 10 },
    { label: "*:auth", audience: "", duration: 60, maxRequests: 20 },
    { label: "/api/", audience: "", duration: 60, maxRequests: 120 },
  ] };
  settings.batch.enabled = false;
  settings.superuserIPs = ["127.0.0.1", "::1"];
  // The loopback-only service trusts this single header, overwritten by Caddy.
  settings.trustedProxy = { headers: ["X-Real-IP"], useLeftmostIP: false };
  app.save(settings);
}, () => {
  // Reverting this migration would delete accounts and experiments. Restore a
  // consistent verified backup instead; never silently drop scientific data.
  throw new Error("Irreversible WispLab data migration: restore a verified backup.");
});
