import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  messages,
  resolveLanguage,
  languageUrl,
} from "../deployment/wisplab/portal/locale.js";

test("portal language preference handles deep links and unavailable or invalid storage", () => {
  assert.equal(resolveLanguage("?lang=en", "zh"), "en");
  assert.equal(resolveLanguage("?lang=zh", "en"), "zh");
  assert.equal(resolveLanguage("?lang=invalid", "en"), "en");
  assert.equal(resolveLanguage("", null), "zh");
  assert.equal(resolveLanguage("", "unexpected"), "zh");
});

test("cross-site language links retain tool mode, other parameters and fragments", () => {
  const link = new URL(
    languageUrl(
      "https://wb.wisplab.top/?mode=single&foo=bar#results",
      "en",
      "https://wisplab.top/",
    ),
  );
  assert.equal(link.hostname, "wb.wisplab.top");
  assert.equal(link.searchParams.get("mode"), "single");
  assert.equal(link.searchParams.get("foo"), "bar");
  assert.equal(link.searchParams.get("lang"), "en");
  assert.equal(link.hash, "#results");
});

test("every explicit portal text and accessibility label has both language entries", () => {
  const html = readFileSync(
    new URL("../deployment/wisplab/portal/index.html", import.meta.url),
    "utf8",
  );
  const used = new Set(
    [...html.matchAll(/data-i18n(?:-aria-label|-content)?="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  assert.ok(used.size > 50);
  for (const key of used) {
    assert.ok(messages[key]?.zh?.trim(), `Missing Chinese: ${key}`);
    assert.ok(messages[key]?.en?.trim(), `Missing English: ${key}`);
  }
  assert.deepEqual([...used].sort(), Object.keys(messages).sort());
});
