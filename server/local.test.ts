import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "./local";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const remove of cleanup.splice(0)) await remove();
});

async function staticHarness() {
  const root = await mkdtemp(
    resolve(dirname(fileURLToPath(import.meta.url)), ".static-test-"),
  );
  const dist = resolve(root, "dist");
  await mkdir(dist);
  await Promise.all([
    writeFile(resolve(dist, "index.html"), "<html>Local application</html>"),
    writeFile(resolve(dist, "bundle.js"), "/* public bundle */"),
    writeFile(resolve(dist, "server.ts"), "private source"),
    writeFile(resolve(dist, "bundle.js.map"), "private source map"),
    writeFile(resolve(dist, ".env"), "private configuration"),
    writeFile(resolve(root, "outside.txt"), "outside dist"),
  ]);
  await symlink(resolve(root, "outside.txt"), resolve(dist, "linked.txt"));
  const server = createServer((request, response) => {
    void serveStatic(request, response, dist);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  });
  const get = (path: string, method = "GET") =>
    new Promise<{ status?: number; body: string }>((done, reject) => {
      const request = httpRequest(origin, { path, method }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          done({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
      request.on("error", reject);
      request.end();
    });
  return { get };
}

describe("production static-file boundary", () => {
  it("serves only regular public assets, supports HEAD and does not list directories", async () => {
    const site = await staticHarness();
    expect(await site.get("/")).toEqual({
      status: 200,
      body: "<html>Local application</html>",
    });
    expect((await site.get("/bundle.js")).status).toBe(200);
    expect(await site.get("/", "HEAD")).toEqual({ status: 200, body: "" });
    expect((await site.get("/", "POST")).status).toBe(405);
    expect((await site.get("/missing/")).status).toBe(404);
  });
  it("rejects traversal, encoded separators, symlink escapes, source files, maps and dotfiles", async () => {
    const site = await staticHarness();
    for (const path of [
      "/../outside.txt",
      "/%2e%2e/outside.txt",
      "/%2e%2e%2foutside.txt",
      "/..%5coutside.txt",
      "/%00outside.txt",
      "/linked.txt",
      "/server.ts",
      "/bundle.js.map",
      "/.env",
      "//outside.txt",
    ])
      expect(await site.get(path), path).toEqual({
        status: 404,
        body: "Not found",
      });
  });
});
