import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "wisplab-build-identity",
      transformIndexHtml() {
        const sha = execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim();
        const dirty = execFileSync(
          "git",
          ["status", "--porcelain", "--untracked-files=no"],
          { encoding: "utf8" },
        ).trim();
        return [
          {
            tag: "meta",
            attrs: {
              name: "wisplab-build",
              content: "wb:" + sha + (dirty ? ":local-changes" : ""),
            },
            injectTo: "head" as const,
          },
        ];
      },
    },
    react(),
  ],
  build: { sourcemap: false },
});
