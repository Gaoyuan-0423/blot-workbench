#!/usr/bin/env node
// One maintained source, reproducible generated assets in each tool repository.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  check = args.includes("--check");
const targets = [
  path.join(root, "public/platform"),
  path.join(root, "deployment/wisplab/portal/platform"),
];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--target") {
    if (!args[i + 1]) throw new Error("--target needs a repository path");
    targets.push(path.resolve(args[++i], "public/platform"));
  } else if (args[i] !== "--check")
    throw new Error("Unknown argument: " + args[i]);
}
const files = ["client.js", "wisplab.js", "wisplab.css"];
const manifest = {
  schemaVersion: 1,
  sourceRepository: "Gaoyuan-0423/blot-workbench",
  sourceDirectory: "platform",
  files: {},
};
const content = new Map();
for (const file of files) {
  const bytes = await readFile(path.join(root, "platform", file));
  content.set(file, bytes);
  manifest.files[file] = createHash("sha256").update(bytes).digest("hex");
}
content.set(
  "manifest.json",
  Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
);
for (const target of targets) {
  if (!check) await mkdir(target, { recursive: true });
  for (const [file, bytes] of content) {
    const output = path.join(target, file);
    if (check) {
      if (!(await readFile(output)).equals(bytes))
        throw new Error("Stale generated platform asset: " + output);
    } else await writeFile(output, bytes);
  }
  const unexpected = (await readdir(target)).filter((f) => !content.has(f));
  if (unexpected.length)
    throw new Error(
      "Unexpected platform files in " + target + ": " + unexpected.join(", "),
    );
}
console.log(
  `${check ? "Verified" : "Generated"} shared platform assets in ${targets.length} destinations.`,
);
