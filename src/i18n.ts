import { useSyncExternalStore } from "react";
import { messages } from "./messages";

export type Language = "zh" | "en";
export const LANGUAGE_KEY = "wisplab.lang";
const valid = (value: unknown): value is Language =>
  value === "zh" || value === "en";
const listeners = new Set<() => void>();
const pairs = new Map<string, [string, string]>();
for (const [zh, en] of Object.entries(messages)) {
  pairs.set(zh, [zh, en]);
  pairs.set(en, [zh, en]);
}

export function initialLanguage(url: string, saved: string | null): Language {
  const query = new URL(url).searchParams.get("lang");
  return valid(query) ? query : valid(saved) ? saved : "zh";
}

let language: Language = "zh";
if (typeof window !== "undefined") {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANGUAGE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
  language = initialLanguage(window.location.href, saved);
}

export function languageUrl(
  href: string,
  lang: Language = language,
  base?: string,
): string {
  const url = new URL(
    href,
    base ??
      (typeof window === "undefined"
        ? "http://localhost/"
        : window.location.href),
  );
  if (url.protocol !== "http:" && url.protocol !== "https:") return href;
  url.searchParams.set("lang", lang);
  return url.href;
}

function applyLanguage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* The URL still preserves the choice. */
  }
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title =
    language === "zh"
      ? "Blot Workbench · 印迹工作台"
      : "Blot Workbench · Western blot analysis";
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      "content",
      language === "zh"
        ? "单条带快速识别与完整 Western blot 分析。导入图像、本机处理、核对取样并导出结果。"
        : "Single-strip recognition and full Western blot analysis. Import images, process locally, review regions and export results.",
    );
  const url = languageUrl(window.location.href);
  if (url !== window.location.href)
    window.history.replaceState(window.history.state, "", url);
}
applyLanguage();

export function setLanguage(next: Language) {
  language = next;
  applyLanguage();
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_KEY && valid(event.newValue))
      setLanguage(event.newValue);
  });
  window.addEventListener("popstate", () => {
    const query = new URL(window.location.href).searchParams.get("lang");
    if (valid(query) && query !== language) setLanguage(query);
  });
}

/** Explicit translation for interface copy; never apply this to user-entered text. */
export function translate(
  zh: string,
  en: string,
  lang: Language = language,
): string {
  pairs.set(zh, [zh, en]);
  pairs.set(en, [zh, en]);
  return lang === "zh" ? zh : en;
}

/** Translate system messages, including known parameterized warnings. User data is untouched. */
export function translateMessage(
  message: string,
  lang: Language = language,
): string {
  const pair = pairs.get(message);
  if (pair) return pair[lang === "zh" ? 0 : 1];
  const bilingual = message.split(
    /\s+\/\s+|\/(?= Configure your own provider)/,
  );
  if (
    bilingual.length === 2 &&
    /[\u3400-\u9fff]/.test(bilingual[0]) !==
      /[\u3400-\u9fff]/.test(bilingual[1])
  ) {
    const zh = bilingual.find((part) => /[\u3400-\u9fff]/.test(part))!;
    const en = bilingual.find((part) => !/[\u3400-\u9fff]/.test(part))!;
    return lang === "zh" ? zh : en;
  }
  for (const [pattern, replacements] of messagePatterns) {
    const match = message.match(pattern);
    if (match) return replacements[lang === "zh" ? 0 : 1](match, lang);
  }
  return message;
}
type MessagePattern = [
  RegExp,
  [
    (match: RegExpMatchArray, lang: Language) => string,
    (match: RegExpMatchArray, lang: Language) => string,
  ],
];
const messagePatterns: MessagePattern[] = [
  [
    /^(.*?)(?: 仍显示上一张图片。| The previous image is still displayed\.)$/s,
    [
      (m, l) => `${translateMessage(m[1], l)} 仍显示上一张图片。`,
      (m, l) =>
        `${translateMessage(m[1], l)} The previous image is still displayed.`,
    ],
  ],
  [
    /^此简易模式仅支持 8-bit PNG；当前为 (\d+)-bit。请使用 8-bit 副本，保留高位深原图。$/,
    [
      (m) => m[0],
      (m) =>
        `Simple mode supports only 8-bit PNG; this image is ${m[1]}-bit. Use an 8-bit copy and keep the high-bit-depth original.`,
    ],
  ],
  [
    /^Simple mode supports only 8-bit PNG; this image is (\d+)-bit\. Use an 8-bit copy and keep the high-bit-depth original\.$/,
    [
      (m) =>
        `此简易模式仅支持 8-bit PNG；当前为 ${m[1]}-bit。请使用 8-bit 副本，保留高位深原图。`,
      (m) => m[0],
    ],
  ],
  [
    /^(?:Provider returned HTTP |服务返回 HTTP )(\d+)\. (.*)$/s,
    [
      (m) => `服务返回 HTTP ${m[1]}. ${m[2]}`,
      (m) => `Provider returned HTTP ${m[1]}. ${m[2]}`,
    ],
  ],
  [
    /^(?:泳道 |Lane )(\d+)(?:：|: )(.*)$/s,
    [
      (m, l) => `泳道 ${m[1]}：${translateMessage(m[2], l)}`,
      (m, l) => `Lane ${m[1]}: ${translateMessage(m[2], l)}`,
    ],
  ],
  [
    /^(?:内参泳道 |Reference lane )(\d+)(?:：|: )(.*)$/s,
    [
      (m, l) => `内参泳道 ${m[1]}：${translateMessage(m[2], l)}`,
      (m, l) => `Reference lane ${m[1]}: ${translateMessage(m[2], l)}`,
    ],
  ],
  [
    /^(?:内参：|Reference: )(.*)$/s,
    [
      (m, l) => `内参：${translateMessage(m[1], l)}`,
      (m, l) => `Reference: ${translateMessage(m[1], l)}`,
    ],
  ],
  [
    /^(?:导入失败：|Import failed: )(.*)$/s,
    [
      (m, l) => `导入失败：${translateMessage(m[1], l)}`,
      (m, l) => `Import failed: ${translateMessage(m[1], l)}`,
    ],
  ],
];

/** Named UI templates retain parameters verbatim (for example, user filenames). */
export function formatMessage(template: string, ...values: unknown[]): string {
  return translateMessage(template).replace(/\{(\d+)\}/g, (_, index: string) =>
    String(values[Number(index)] ?? ""),
  );
}

export function useLanguage() {
  const lang = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => language,
    () => "zh" as Language,
  );
  return {
    language: lang,
    setLanguage,
    t: (zh: string, en: string) => translate(zh, en, lang),
    tr: (message: string) => translateMessage(message, lang),
    href: (url: string) => languageUrl(url, lang),
  };
}
