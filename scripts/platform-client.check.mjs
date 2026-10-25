import test from "node:test";
import assert from "node:assert/strict";
import { clearLegacyAccountTokens } from "../platform/client.js";

function storage(entries) {
  const values = new Map(entries);
  return { values, removeItem: (key) => values.delete(key) };
}

test("account-free migration removes only known obsolete tokens from both stores", () => {
  const entries = [
    ["wisplab.account.v1", "obsolete-token"],
    ["wisplab.account.v1@http://127.0.0.1:8090", "local-test-token"],
    ["wb.project", "original experimental data"],
    ["wisplab.lang", "en"],
    ["pcr.ai-settings", "local provider preference"],
  ];
  const localStorage = storage(entries),
    sessionStorage = storage(entries);
  clearLegacyAccountTokens({ localStorage, sessionStorage });
  for (const current of [localStorage, sessionStorage]) {
    assert.deepEqual([...current.values], entries.slice(2));
  }
  clearLegacyAccountTokens({ localStorage, sessionStorage });
  assert.deepEqual([...localStorage.values], entries.slice(2));
});

test("blocked getters and per-key storage failures cannot prevent local startup", () => {
  const cleared = [];
  clearLegacyAccountTokens({
    get localStorage() {
      throw new Error("blocked");
    },
    sessionStorage: {
      removeItem(key) {
        cleared.push(key);
        if (key.endsWith("v1")) throw new Error("blocked key");
      },
    },
  });
  assert.equal(cleared.length, 2);
  assert.doesNotThrow(() => clearLegacyAccountTokens({}));
});
