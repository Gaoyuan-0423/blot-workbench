import { expect, test, type Page } from "@playwright/test";
import {
  createQuickExample,
  createQuickReferenceExample,
} from "../../src/quick/image";
import {
  importQuickProject,
  importSingleProject,
} from "../../src/cloud-project";

test.beforeEach(async ({ page }) => {
  // Test the tool contract without a server account or any network upload.
  await page.route("**/platform/wisplab.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "// adapter contract fixture",
    }),
  );
  await page.addInitScript(() => {
    (window as any).WispLab = {
      registerProjectAdapter(adapter: unknown) {
        (window as any).__adapter = adapter;
        return () => {
          if ((window as any).__adapter === adapter)
            delete (window as any).__adapter;
        };
      },
    };
  });
});
const upload = (reference = false) => ({
  name: reference ? "reference.png" : "experiment.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    (reference ? createQuickReferenceExample() : createQuickExample()).original!
      .bytes,
  ),
});
async function exported(page: Page): Promise<number[]> {
  return page.evaluate(async () => [
    ...new Uint8Array(
      await (
        await (window as any).__adapter.exportProject()
      ).blob.arrayBuffer(),
    ),
  ]);
}
async function restore(
  page: Page,
  bytes: number[],
  isCurrent = true,
): Promise<string> {
  return page.evaluate(
    async ({ bytes, isCurrent }) => {
      try {
        await (window as any).__adapter.importProject(
          new Blob([new Uint8Array(bytes)]),
          { isCurrent: () => isCurrent },
        );
        return "ok";
      } catch (error) {
        return (error as Error).name;
      }
    },
    { bytes, isCurrent },
  );
}

test("single: preserve exposures, manual ROI and display settings; cancellation and stale parses cannot replace edits", async ({
  page,
}) => {
  await page.goto("/?mode=single&lang=zh");
  await page
    .getByLabel("导入单排条带图片")
    .setInputFiles([upload(), upload(true)]);
  await expect(page.locator(".single-filebar")).toBeVisible();
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  await page.getByRole("slider", { name: "显示亮度" }).press("End");
  await page.getByText("识别不准？调整取样", { exact: true }).click();
  await page.getByLabel("对照泳道").selectOption("1");
  const x = page.getByLabel("取样框 x", { exact: true });
  await x.fill(String(Number(await x.inputValue()) + 1));
  const bytes = await exported(page);
  const saved = (await importSingleProject(new Blob([new Uint8Array(bytes)])))
    .project;
  expect(saved.strips).toHaveLength(2);
  expect(saved.strips[0].appearance.brightness).toBe(200);
  expect(saved.strips[0].control).toBe(1);
  expect(saved.strips[0].prepared.source.original?.bytes).toEqual(
    new Uint8Array(upload().buffer),
  );
  await page.getByLabel("对照泳道").selectOption("0");
  page.once("dialog", (dialog) => dialog.dismiss());
  expect(await restore(page, bytes)).toBe("AbortError");
  await expect(page.getByLabel("对照泳道")).toHaveValue("0");
  expect(await restore(page, bytes, false)).toBe("AbortError");
  await expect(page.getByLabel("对照泳道")).toHaveValue("0");
  page.once("dialog", (dialog) => dialog.accept());
  expect(await restore(page, bytes)).toBe("ok");
  await expect(page.getByLabel("对照泳道")).toHaveValue("1");
  const again = (
    await importSingleProject(new Blob([new Uint8Array(await exported(page))]))
  ).project;
  expect(again.strips[0].bands).toEqual(saved.strips[0].bands);
  // Hold parsing open, then make a real UI edit. The late decode must abort.
  await page.evaluate((bytes) => {
    const buffer = new Uint8Array(bytes).buffer;
    const blob = {
      size: buffer.byteLength,
      arrayBuffer: async () => {
        await new Promise<void>((resolve) => {
          (window as any).__release = resolve;
        });
        return buffer;
      },
    };
    (window as any).__pending = (window as any).__adapter
      .importProject(blob)
      .then(
        () => "ok",
        (e: Error) => e.name,
      );
  }, bytes);
  await page.getByLabel("对照泳道").selectOption("2");
  expect(
    await page.evaluate(async () => {
      (window as any).__release();
      return (window as any).__pending;
    }),
  ).toBe("AbortError");
  await expect(page.getByLabel("对照泳道")).toHaveValue("2");
});

test("quick: restore target, external reference, sample names and selected ROI without re-recognition", async ({
  page,
}) => {
  await page.goto("/?mode=quick&lang=zh");
  await page
    .getByLabel("导入条带图片", { exact: true })
    .setInputFiles(upload());
  await expect(page.getByRole("table", { name: "条带定量结果" })).toBeVisible();
  await page
    .getByLabel("添加内参图片", { exact: true })
    .setInputFiles(upload(true));
  await expect(page.getByLabel("内参条带")).toHaveValue("external:0");
  await page.getByLabel("泳道 1 名称", { exact: true }).fill("Control custom");
  await page.getByLabel("对照泳道").selectOption("1");
  const bytes = await exported(page);
  const saved = (await importQuickProject(new Blob([new Uint8Array(bytes)])))
    .project;
  expect(saved.labels[0]).toBe("Control custom");
  expect(saved.external?.image.original?.bytes).toEqual(
    new Uint8Array(upload(true).buffer),
  );
  await page.getByLabel("泳道 1 名称", { exact: true }).fill("Changed");
  page.once("dialog", (dialog) => dialog.accept());
  expect(await restore(page, bytes)).toBe("ok");
  await expect(page.getByLabel("泳道 1 名称", { exact: true })).toHaveValue(
    "Control custom",
  );
  expect(
    (await importQuickProject(new Blob([new Uint8Array(await exported(page))])))
      .project,
  ).toEqual(saved);
});
