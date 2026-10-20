import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// The package is data only. No executable content, credentials, or model weights.
export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const BAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export const invalid = (): never => {
  throw new Error(
    "项目包无效、损坏或超出大小限制 / Invalid, damaged, or oversized project package",
  );
};
export type Check = (value: unknown) => boolean;
export const string: Check = (v) =>
  typeof v === "string" && v.length <= 1_000_000;
export const bool: Check = (v) => typeof v === "boolean";
export const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
export const numeric: Check = (v) => typeof v === "number";
export const integer =
  (min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export const oneOf =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v);
export const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
export const array =
  (check: Check, max = 100_000): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check);
export const record =
  (check: Check, max = 100_000): Check =>
  (v) =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.entries(v).length <= max &&
    Object.entries(v).every(([k, x]) => !BAD_KEYS.has(k) && check(x));
export const object =
  (
    required: Record<string, Check>,
    optional: Record<string, Check> = {},
  ): Check =>
  (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const obj = v as Record<string, unknown>;
    return (
      Object.keys(required).every((k) => Object.hasOwn(obj, k)) &&
      Object.entries(obj).every(
        ([k, x]) =>
          !BAD_KEYS.has(k) &&
          (Object.hasOwn(required, k)
            ? required[k](x)
            : Object.hasOwn(optional, k) &&
              (x === undefined || optional[k](x))),
      )
    );
  };

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "number" && !Number.isFinite(v) ? { $number: String(v) } : v,
  );
}
export function decodeJson(text: string): unknown {
  let nodes = 0;
  return JSON.parse(text, (key, v) => {
    if (++nodes > 2_000_000 || BAD_KEYS.has(key)) invalid();
    if (v && typeof v === "object" && Object.hasOwn(v, "$number")) {
      if (
        Object.keys(v).length !== 1 ||
        !["NaN", "Infinity", "-Infinity"].includes(v.$number)
      )
        invalid();
      return Number(v.$number);
    }
    return v;
  });
}

interface FileMeta {
  path: string;
  name: string;
  type: string;
  lastModified: number;
  size: number;
  sha256: string;
}
interface Manifest {
  format: "wisplab-project";
  version: 1;
  tool: string;
  state: unknown;
  files: FileMeta[];
}
const fileMetaCheck = object({
  path: string,
  name: string,
  type: string,
  lastModified: integer(),
  size: integer(0, MAX_EXPANDED_BYTES),
  sha256: string,
});
const manifestCheck = object({
  format: oneOf("wisplab-project"),
  version: oneOf(1),
  tool: string,
  state: () => true,
  files: array(fileMetaCheck, 3000),
});
const digest = async (bytes: Uint8Array): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

export async function packProject(
  tool: string,
  state: unknown,
  attachments: File[],
): Promise<Blob> {
  if (
    attachments.length > 3000 ||
    attachments.reduce((sum, f) => sum + f.size, 0) > MAX_EXPANDED_BYTES
  )
    invalid();
  const files: FileMeta[] = [];
  const entries: Record<string, Uint8Array> = {};
  for (const [i, file] of attachments.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = `blobs/${i}`;
    files.push({
      path,
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      size: bytes.length,
      sha256: await digest(bytes),
    });
    entries[path] = bytes;
  }
  const manifest: Manifest = {
    format: "wisplab-project",
    version: 1,
    tool,
    state,
    files,
  };
  if (!manifestCheck(manifest)) invalid();
  const json = encodeJson(manifest);
  decodeJson(json); // Apply the same tree/key limits on export and import.
  entries["manifest.json"] = strToU8(json);
  if (
    entries["manifest.json"].length > MAX_JSON_BYTES ||
    Object.values(entries).reduce((n, bytes) => n + bytes.length, 0) >
      MAX_EXPANDED_BYTES
  )
    invalid();
  const bytes = zipSync(entries, { level: 1 });
  if (bytes.length > MAX_PACKAGE_BYTES) invalid();
  return new Blob([Uint8Array.from(bytes).buffer], { type: "application/zip" });
}

export async function unpackProject(
  blob: Blob,
  tool: string,
  checkState: Check,
): Promise<{ state: unknown; files: File[] }> {
  if (!blob.size || blob.size > MAX_PACKAGE_BYTES) invalid();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let total = 0;
  const names = new Set<string>();
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      if (
        !/^(manifest\.json|blobs\/\d+)$/.test(entry.name) ||
        names.has(entry.name) ||
        names.size >= 3001
      )
        invalid();
      names.add(entry.name);
      total += entry.originalSize;
      if (
        total > MAX_EXPANDED_BYTES ||
        entry.originalSize > MAX_EXPANDED_BYTES ||
        (entry.name === "manifest.json" && entry.originalSize > MAX_JSON_BYTES)
      )
        invalid();
      return true;
    },
  });
  if (
    !entries["manifest.json"] ||
    entries["manifest.json"].length > MAX_JSON_BYTES
  )
    invalid();
  const data = decodeJson(strFromU8(entries["manifest.json"]));
  if (!manifestCheck(data)) invalid();
  const manifest = data as Manifest;
  if (
    manifest.tool !== tool ||
    !checkState(manifest.state) ||
    Object.keys(entries).length !== manifest.files.length + 1
  )
    invalid();
  const files: File[] = [];
  for (const [i, meta] of manifest.files.entries()) {
    const content = entries[meta.path];
    if (
      meta.path !== `blobs/${i}` ||
      !content ||
      content.length !== meta.size ||
      (await digest(content)) !== meta.sha256
    )
      invalid();
    files.push(
      new File([Uint8Array.from(content).buffer], meta.name, {
        type: meta.type,
        lastModified: meta.lastModified,
      }),
    );
  }
  return { state: manifest.state, files };
}

export interface ProjectAdapter {
  tool: "wb-single" | "wb-quick" | "wb-real" | "wb-demo" | "pathology" | "pcr";
  exportProject(): Promise<{
    blob: Blob;
    name: string;
    format: string;
    summary: string;
    summaryTranslations?: { zh: string; en: string };
  }>;
  importProject(
    blob: Blob,
    options?: { isCurrent: () => boolean },
  ): Promise<void>;
}
declare global {
  interface Window {
    WispLab?: {
      registerProjectAdapter(adapter: ProjectAdapter): (() => void) | void;
    };
  }
}
export function connectProjectAdapter(adapter: ProjectAdapter): () => void {
  let dispose: (() => void) | void;
  const register = () => {
    dispose?.();
    dispose = window.WispLab?.registerProjectAdapter(adapter);
  };
  window.addEventListener("wisplab:ready", register);
  register();
  return () => {
    window.removeEventListener("wisplab:ready", register);
    dispose?.();
  };
}
