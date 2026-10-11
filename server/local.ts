import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createVisionApi, hasTrustedHost } from "./api";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
function status(response: ServerResponse, code: number): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(
    code === 403
      ? "Forbidden"
      : code === 405
        ? "Method not allowed"
        : "Not found",
  );
}
function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/** Only regular, explicitly typed assets inside dist are exposed in production. */
export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    status(response, 405);
    return;
  }
  try {
    const raw = (request.url ?? "").split("?", 1)[0];
    if (!raw.startsWith("/") || raw.startsWith("//")) {
      status(response, 404);
      return;
    }
    const pathname = decodeURIComponent(raw);
    if (
      pathname.includes("\\") ||
      pathname.includes("\0") ||
      pathname.split("/").some((part) => part.startsWith("."))
    ) {
      status(response, 404);
      return;
    }
    const requested = pathname === "/" ? "/index.html" : pathname;
    const contentType = types[extname(requested).toLowerCase()];
    if (!contentType) {
      status(response, 404);
      return;
    }
    const root = await realpath(directory);
    const file = resolve(root, `.${requested}`);
    if (!inside(root, file)) {
      status(response, 404);
      return;
    }
    const resolvedFile = await realpath(file);
    if (!inside(root, resolvedFile)) {
      status(response, 404);
      return;
    }
    const metadata = await stat(resolvedFile);
    if (!metadata.isFile()) {
      status(response, 404);
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": metadata.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(resolvedFile);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch {
    status(response, 404);
  }
}

export async function startLocalServer({
  port = 4318,
  production = false,
}: { port?: number; production?: boolean } = {}): Promise<{
  server: Server;
  origin: string;
  close: () => Promise<void>;
}> {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("WB_PORT must be an integer from 1 to 65535.");
  const origin = `http://127.0.0.1:${port}`;
  const api = createVisionApi({ origin });
  let dev:
    Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
  const server = createServer((request, response) => {
    if (!hasTrustedHost(request, origin)) {
      status(response, 403);
      return;
    }
    if ((request.url ?? "").startsWith("/api")) {
      api(request, response);
      return;
    }
    if (production) {
      void serveStatic(request, response, resolve(repositoryRoot, "dist"));
      return;
    }
    if (dev) dev.middlewares(request, response, () => status(response, 404));
    else status(response, 404);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 64;
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  if (!production) {
    const { createServer: createViteServer } = await import("vite");
    dev = await createViteServer({
      root: repositoryRoot,
      server: {
        middlewareMode: true,
        host: "127.0.0.1",
        allowedHosts: ["127.0.0.1"],
        hmr: false,
      },
      appType: "spa",
    });
  }
  try {
    await new Promise<void>((resolveStarted, reject) => {
      const failed = (error: Error) => reject(error);
      server.once("error", failed);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", failed);
        resolveStarted();
      });
    });
  } catch (error) {
    api.close();
    await dev?.close();
    throw error;
  }
  return {
    server,
    origin,
    close: async () => {
      api.close();
      await dev?.close();
      server.closeAllConnections();
      await new Promise<void>((resolveClosed, reject) =>
        server.close((error) => (error ? reject(error) : resolveClosed())),
      );
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const portValue = process.env.WB_PORT ?? "4318";
  if (!/^\d+$/.test(portValue)) {
    console.error("WB_PORT must be an integer from 1 to 65535.");
    process.exitCode = 1;
  } else {
    void startLocalServer({
      port: Number(portValue),
      production: process.argv.includes("--production"),
    })
      .then(({ origin, close }) => {
        console.log(`Local WB Workbench: ${origin}`);
        let closing = false;
        const shutdown = () => {
          if (!closing) {
            closing = true;
            void close().catch(() => {
              process.exitCode = 1;
            });
          }
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      })
      .catch(() => {
        console.error(
          "Unable to start the local WB server. Check the port and local build.",
        );
        process.exitCode = 1;
      });
  }
}
