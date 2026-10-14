import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from "node:http";
import { z } from "zod";
import { ApiFailure, assertLocalRequest } from "./api";
import {
  analyzeAll,
  applyLaneDescription,
  applyNormalization,
  createRealProject,
  exportRealCsv,
  importRealImages,
  results,
  updateRealProject,
} from "../src/real/model";
import { buildAnalysisReport } from "../src/real/analysis-report";

/**
 * One-click local analysis API. Accepts original TIFF/PNG images plus the
 * lane description, runs the entire deterministic pipeline in this process
 * (decode → propose → measure → normalize → statistics inputs), and returns
 * the structured report (issues + recommendations), the result rows, and the
 * audit CSV. Nothing leaves the machine; no provider or API key is involved.
 */

const MAX_ANALYZE_BODY_BYTES = 96 * 1024 * 1024;
const MAX_IMAGES = 48;
const MAX_NAME = 200;

const failures = {
  INVALID_REQUEST: [400, "Invalid request. / 请求无效。"],
  REQUEST_TOO_LARGE: [413, "Request is too large. / 请求内容过大。"],
  FORBIDDEN: [
    403,
    "Only the configured local origin is allowed. / 仅允许指定的本机同源请求。",
  ],
  NOT_FOUND: [404, "API route not found. / API 路径不存在。"],
  METHOD_NOT_ALLOWED: [405, "Method not allowed. / 请求方法不允许。"],
  ANALYSIS_INVALID: [
    400,
    "The analysis request could not be processed. / 分析请求无法处理。",
  ],
  INTERNAL_ERROR: [
    500,
    "The local analysis could not be completed. / 本机分析未能完成。",
  ],
} as const;
type FailureCode = keyof typeof failures;

class AnalyzeFailure extends Error {
  constructor(readonly code: FailureCode, readonly detail = "") {
    super(code);
  }
}
function fail(code: FailureCode, detail = ""): never {
  throw new AnalyzeFailure(code, detail);
}
function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

const imageEntrySchema = z
  .object({
    name: z.string().min(1).max(MAX_NAME),
    base64: z
      .string()
      .max(96 * 1024 * 1024)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
const analyzeRequestSchema = z
  .object({
    name: z.string().min(1).max(MAX_NAME).optional(),
    laneDescription: z.string().min(1).max(4000),
    designConfirmed: z.boolean().optional(),
    backgroundCorrection: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("local") }).strict(),
        z
          .object({
            kind: z.literal("rolling-ball"),
            radius: z.number().int().min(10).max(200),
          })
          .strict(),
      ])
      .optional(),
    normalization: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("matched-control") }).strict(),
        z
          .object({
            kind: z.literal("reference-unit"),
            unitId: z.string().min(1).max(100),
          })
          .strict(),
      ])
      .optional(),
    images: z.array(imageEntrySchema).min(1).max(MAX_IMAGES),
  })
  .strict();

async function readJson(
  request: IncomingMessage,
): Promise<unknown> {
  const contentType = request.headers["content-type"]
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    contentType !== "application/json" ||
    request.headers["content-encoding"] !== undefined
  )
    fail("INVALID_REQUEST");
  const length = request.headers["content-length"];
  if (
    length !== undefined &&
    (!/^\d+$/.test(length) || Number(length) > MAX_ANALYZE_BODY_BYTES)
  )
    fail("REQUEST_TOO_LARGE");
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const data = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > MAX_ANALYZE_BODY_BYTES) {
        request.off("data", data);
        request.off("end", ended);
        reject(new AnalyzeFailure("REQUEST_TOO_LARGE"));
        request.resume();
        return;
      }
      chunks.push(bytes);
    };
    const ended = () => {
      request.off("data", data);
      request.off("end", ended);
      try {
        resolve(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ) as unknown,
        );
      } catch {
        reject(new AnalyzeFailure("INVALID_REQUEST"));
      }
    };
    request.on("data", data);
    request.once("end", ended);
    request.once("error", () => reject(new AnalyzeFailure("INVALID_REQUEST")));
    request.once("aborted", () =>
      reject(new AnalyzeFailure("INVALID_REQUEST")),
    );
  });
}

export interface AnalyzeApiOptions {
  origin: string;
}
export type AnalyzeApiHandler = RequestListener;

export function createAnalyzeApi({ origin }: AnalyzeApiOptions): AnalyzeApiHandler {
  const handler: RequestListener = (request, response) => {
    void (async () => {
      assertLocalRequest(request, origin);
      const path = request.url ?? "";
      if (!path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path))
        fail("INVALID_REQUEST");
      if (path !== "/api/analyze") fail("NOT_FOUND");
      if (request.method !== "POST") fail("METHOD_NOT_ALLOWED");
      const parsed = analyzeRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) fail("INVALID_REQUEST");
      const body = parsed.data;
      if (request.aborted || response.destroyed) return;

      let project = createRealProject(
        body.name?.trim() || "API analysis",
        "zh",
      );
      try {
        project = applyLaneDescription(project, body.laneDescription);
        project = await importRealImages(
          project,
          body.images.map((image) => ({
            name: image.name,
            bytes: new Uint8Array(
              Buffer.from(image.base64, "base64"),
            ),
          })),
        );
        const patch: Parameters<typeof updateRealProject>[1] = {};
        if (body.designConfirmed !== undefined)
          patch.designConfirmed = body.designConfirmed;
        if (body.backgroundCorrection !== undefined)
          patch.backgroundCorrection = body.backgroundCorrection;
        if (Object.keys(patch).length)
          project = updateRealProject(project, patch);
        if (body.normalization !== undefined)
          project = applyNormalization(project, body.normalization);
        project = analyzeAll(project, true);
      } catch (error) {
        fail(
          "ANALYSIS_INVALID",
          error instanceof Error ? error.message : String(error),
        );
      }
      const rows = results(project);
      sendJson(response, 200, {
        report: buildAnalysisReport(project),
        results: rows,
        csv: exportRealCsv(project),
      });
    })().catch((error: unknown) => {
      if (error instanceof AnalyzeFailure) {
        const [status, message] = failures[error.code];
        sendJson(response, status, {
          error: { code: error.code, message, detail: error.detail },
        });
        return;
      }
      // Shared origin/host guards throw the vision API's failure type; only
      // codes this API also defines can be mapped directly.
      if (error instanceof ApiFailure && error.code in failures) {
        const code = error.code as keyof typeof failures;
        const [status, message] = failures[code];
        sendJson(response, status, {
          error: { code, message, detail: "" },
        });
        return;
      }
      sendJson(response, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: failures.INTERNAL_ERROR[1],
          detail: error instanceof Error ? error.message.slice(0, 500) : "",
        },
      });
    });
  };
  return handler;
}
