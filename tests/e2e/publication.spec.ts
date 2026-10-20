import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { encode as encodePng, decode as decodePng } from "fast-png";
import { unzipSync, strFromU8 } from "fflate";
import { encodeFigureTiff } from "../../src/real/figure-export";

// Synthetic fixtures only. Native 16-bit samples are generated directly, never
// recovered from a displayed image. Rectangular bands match the real-image suite.
function syntheticFile(name: string, depth: 8 | 16, levels: number[]) {
  const width = 100;
  const height = 64;
  const scale = depth === 16 ? 257 : 1;
  const samples = new Uint16Array(width * height).fill(220 * scale);
  for (let lane = 0; lane < levels.length; lane++)
    for (let y = 20; y < 28; y++)
      for (let x = 12 + lane * 43; x < 30 + lane * 43; x++)
        samples[y * width + x] = levels[lane] * scale;
  let bytes: Uint8Array;
  if (name.endsWith(".tif")) {
    const rgba = new Uint8Array(width * height * 4);
    samples.forEach((value, i) => rgba.set([value, value, value, 255], i * 4));
    bytes = encodeFigureTiff(width, height, rgba);
  } else {
    bytes = encodePng({
      width,
      height,
      depth,
      channels: 1,
      data: depth === 16 ? samples : Uint8Array.from(samples),
    });
  }
  return {
    name,
    mimeType: name.endsWith(".tif") ? "image/tiff" : "image/png",
    buffer: Buffer.from(bytes),
  };
}

async function openEnglish(page: Page, baseURL?: string) {
  await page.goto(`${baseURL ?? ""}/?lang=zh#real`);
  await expect(
    page.getByRole("heading", {
      name: "真实 Western blot 工作区",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Real Western blot workspace",
      exact: true,
    }),
  ).toBeVisible();
  await saved(page);
}

async function saved(page: Page) {
  await expect(page.locator(".real-save-status")).toHaveText("Saved locally");
}

async function downloadBytes(page: Page, button: string) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const download = await event;
  return readFile((await download.path())!);
}

async function archive(page: Page) {
  const bytes = await downloadBytes(page, "Export project");
  const entries = unzipSync(bytes);
  return {
    bytes,
    entries,
    manifest: JSON.parse(strFromU8(entries["manifest.json"])),
  };
}

test("publication editing, bilingual persistence and source exports preserve native analysis and originals", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEnglish(page);
  const files = [
    syntheticFile("Target_rep1.tif", 8, [120, 160]),
    syntheticFile("Reference_rep1.png", 16, [150, 185]),
  ];
  await page
    .getByLabel("Choose original WB images", { exact: true })
    .setInputFiles(files);
  await expect(page.locator(".real-mapping-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".real-mapping-table")).toContainText("8-bit TIFF");
  await expect(page.locator(".real-mapping-table")).toContainText("16-bit PNG");
  await page
    .getByLabel("Lane description", { exact: true })
    .fill("1=NC; 2=Drug");
  await page
    .getByRole("button", { name: "Parse & preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm for all images", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Propose & calculate all", exact: true })
    .click();
  await expect(page.locator(".real-result-table tbody tr")).toHaveCount(2);
  await saved(page);
  const before = await archive(page);
  const resultsBefore = (await downloadBytes(page, "CSV")).toString("utf8");
  expect(before.manifest.images[0].regions.length).toBeGreaterThan(0);

  const title = "Figure <script>alert(1)</script> & review";
  const targetLabel = "Target <b>A & B</b>";
  await page.getByLabel("Figure title", { exact: true }).fill(title);
  await page.getByLabel("Figure width (mm)", { exact: true }).fill("120");
  for (const file of files) {
    await page
      .getByLabel("Image to add to figure", { exact: true })
      .selectOption({ label: file.name });
    await page
      .getByRole("button", { name: "Add to figure", exact: true })
      .click();
  }
  await page
    .getByLabel("Figure row 1: label", { exact: true })
    .fill(targetLabel);
  await page.getByLabel("Figure row 1: panel", { exact: true }).fill("A");
  await page
    .getByLabel("Figure row 1: molecular weight", { exact: true })
    .fill("42");
  await page
    .getByLabel("Figure row 2: label", { exact: true })
    .fill("Reference");
  await page.getByLabel("Figure row 2: panel", { exact: true }).fill("B");
  for (const row of [1, 2]) {
    // Narrow the display crop first so subsequent origins remain in bounds.
    for (const [field, value] of [
      ["width", "90"],
      ["height", "24"],
      ["x", "5"],
      ["y", "12"],
    ]) {
      const input = page.getByLabel(`Figure row ${row}: ${field}`, {
        exact: true,
      });
      await input.fill(value);
      await input.press("Tab");
    }
  }
  await page.locator(".publication-sources > summary").click();
  await page
    .getByLabel("Original type: Target_rep1.tif", { exact: true })
    .selectOption("ecl");
  await page
    .getByLabel("Original type: Reference_rep1.png", { exact: true })
    .selectOption("long-exposure");
  const cropWidth = page.getByLabel("Figure row 2: width", { exact: true });
  await cropWidth.fill("96");
  await cropWidth.press("Tab");
  await expect(cropWidth).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("button", { name: "Export figure SVG", exact: true }),
  ).toBeDisabled();
  await cropWidth.press("Escape");
  await cropWidth.press("Tab");
  await expect(cropWidth).toHaveValue("90");
  await expect(cropWidth).toHaveAttribute("aria-invalid", "false");
  await page
    .getByRole("button", { name: "Figure row 2: move up", exact: true })
    .click();
  await expect(
    page.getByLabel("Figure row 1: label", { exact: true }),
  ).toHaveValue("Reference");
  await expect(
    page.getByLabel("Figure row 2: label", { exact: true }),
  ).toHaveValue(targetLabel);
  await saved(page);

  const changed = await archive(page);
  expect(changed.manifest.images).toEqual(before.manifest.images);
  expect((await downloadBytes(page, "CSV")).toString("utf8")).toBe(
    resultsBefore,
  );
  expect(changed.manifest.publication.title).toBe(title);
  expect(changed.manifest.publication.widthMm).toBe(120);
  expect(changed.manifest.publication.rows).toHaveLength(2);
  expect(changed.manifest.publication.rows[1].crop).toEqual({
    x: 5,
    y: 12,
    width: 90,
    height: 24,
  });

  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(page.getByLabel("图版标题", { exact: true })).toHaveValue(title);
  await expect(
    page.getByLabel("图版第 2 行：标签", { exact: true }),
  ).toHaveValue(targetLabel);
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("Figure title", { exact: true })).toHaveValue(
    title,
  );
  await expect(
    page.getByLabel("Figure row 2: label", { exact: true }),
  ).toHaveValue(targetLabel);
  await expect(page.getByLabel("Figure row 2: x", { exact: true })).toHaveValue(
    "5",
  );
  expect((await archive(page)).manifest.publication).toEqual(
    changed.manifest.publication,
  );

  const svg = (await downloadBytes(page, "Export figure SVG")).toString("utf8");
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).toContain("Target &lt;b&gt;A &amp; B&lt;/b&gt;");
  expect(svg).not.toContain("<script>alert(1)</script>");
  const png = decodePng(await downloadBytes(page, "Export figure PNG"));
  expect(png.width).toBeGreaterThan(500);
  expect(png.height).toBeGreaterThan(100);
  let sourceGrayPixels = 0;
  for (let i = 0; i < png.data.length; i += png.channels) {
    if (
      png.data[i] >= 110 &&
      png.data[i] <= 230 &&
      png.data[i] === png.data[i + 1] &&
      png.data[i] === png.data[i + 2]
    )
      sourceGrayPixels++;
  }
  // A white canvas with labels alone cannot satisfy the broad image-area check.
  expect(sourceGrayPixels).toBeGreaterThan(png.width * 30);
  const html = (await downloadBytes(page, "Export source data HTML")).toString(
    "utf8",
  );
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; review");
  expect(html).not.toContain("<script>alert(1)</script>");
  for (const file of files)
    expect(html).toContain(
      createHash("sha256").update(file.buffer).digest("hex"),
    );

  const bundle = unzipSync(
    await downloadBytes(page, "Export complete bundle ZIP"),
  );
  for (const name of [
    "source-data.html",
    "figure.svg",
    "provenance.json",
    "results.csv",
    "statistics.csv",
    "project.realwb.zip",
  ])
    expect(bundle[name], name).toBeDefined();
  const nested = unzipSync(bundle["project.realwb.zip"]);
  const nestedManifest = JSON.parse(strFromU8(nested["manifest.json"]));
  expect(nestedManifest.publication).toEqual(changed.manifest.publication);
  expect(nestedManifest.images).toEqual(before.manifest.images);
  for (const image of nestedManifest.images) {
    const file = files.find((candidate) => candidate.name === image.name)!;
    expect(Buffer.from(nested[image.path])).toEqual(file.buffer);
    expect(image.hash).toBe(
      createHash("sha256").update(file.buffer).digest("hex"),
    );
  }

  await page
    .getByLabel("Figure title", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("publication-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Figure title", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("publication-mobile.png"),
  });
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const context = await browser.newContext();
  try {
    const destination = await context.newPage();
    await openEnglish(destination, baseURL);
    await destination
      .getByLabel("Import real project archive", { exact: true })
      .setInputFiles({
        name: "publication.realwb.zip",
        mimeType: "application/zip",
        buffer: changed.bytes,
      });
    await destination
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      destination.getByLabel("Figure title", { exact: true }),
    ).toHaveValue(title);
    await expect(
      destination.getByLabel("Figure width (mm)", { exact: true }),
    ).toHaveValue("120");
    await expect(
      destination.getByLabel("Figure row 2: label", { exact: true }),
    ).toHaveValue(targetLabel);
    await saved(destination);
    const restored = await archive(destination);
    expect(restored.manifest.publication).toEqual(changed.manifest.publication);
    expect(restored.manifest.images).toEqual(before.manifest.images);
    expect((await downloadBytes(destination, "CSV")).toString("utf8")).toBe(
      resultsBefore,
    );
  } finally {
    await context.close();
  }
  // Keep a readable synthetic example as well as the injection-proof screenshots.
  await page
    .getByLabel("Figure title", { exact: true })
    .fill("WB 条带图版示例");
  await page.getByLabel("Figure row 2: label", { exact: true }).fill("Target");
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(page.locator(".real-save-status")).toHaveText("已保存到本机");
  await page.locator(".publication-panel").screenshot({
    path: testInfo.outputPath("publication-preview-zh.png"),
  });
  const sourceHtml = (await downloadBytes(page, "导出原始数据 HTML")).toString(
    "utf8",
  );
  await writeFile(
    testInfo.outputPath("publication-source-data.html"),
    sourceHtml,
  );
  const report = await page.context().newPage();
  try {
    await report.setContent(sourceHtml, { waitUntil: "load" });
    await expect(report.locator("section.source")).toHaveCount(2);
    await expect(report.locator("section.source svg image")).toHaveCount(2);
    await expect(report.locator("script")).toHaveCount(0);
    await report.screenshot({
      path: testInfo.outputPath("publication-source-data.png"),
      fullPage: true,
    });
    await report.pdf({
      path: testInfo.outputPath("publication-source-data.pdf"),
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await report.close();
  }
  expect(errors).toEqual([]);
});
