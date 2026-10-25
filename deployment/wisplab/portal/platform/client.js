// The public platform has no account or cloud client. This small migration is local only.
const LEGACY_TOKEN_KEYS = [
  "wisplab.account.v1",
  "wisplab.account.v1@http://127.0.0.1:8090",
];

export function clearLegacyAccountTokens(scope = globalThis) {
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      const storage = scope[name];
      for (const key of LEGACY_TOKEN_KEYS) {
        try {
          storage?.removeItem(key);
        } catch {
          /* Storage restrictions never block local analysis. */
        }
      }
    } catch {
      /* Browser storage getters can themselves throw. */
    }
  }
}
