import { test, expect, type Page, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { encode as encodePng, decode as decodePng } from "fast-png";
import { unzipSync, strFromU8 } from "fflate";
import { encodeFigureTiff } from "../../src/real/figure-export";
import { decodeRaster } from "../../src/real/pixels";

// Public synthetic fixtures only: uniform background and two rectangular bands.
// The 16-bit fixtures use 257× the 8-bit scale, never a display-derived measurement.
function syntheticFile(name: string, depth: 8 | 16, levels: [number, number]) {
  const width = 100,
    height = 64,
    scale = depth === 16 ? 257 : 1;
  const samples = new Uint16Array(width * height).fill(220 * scale);
  for (let lane = 0; lane < 2; lane++)
    for (let y = 20; y < 28; y++)
      for (let x = lane === 0 ? 12 : 55; x < (lane === 0 ? 30 : 73); x++)
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
function fixtures() {
  return [
    syntheticFile("Target_rep1.tif", 8, [120, 160]),
    syntheticFile("Reference_rep1.tif", 8, [150, 185]),
    syntheticFile("Target_rep2.png", 16, [140, 140]),
    syntheticFile("Reference_rep2.png", 16, [120, 170]),
  ];
}
async function saved(page: Page) {
  await expect(page.locator(".real-save-status")).toHaveText("Saved locally");
}
async function openEnglish(page: Page, baseURL?: string) {
  await page.goto(`${baseURL ?? ""}/#real`);
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
async function importAndAnalyze(page: Page) {
  const files = fixtures();
  await page
    .getByLabel("Choose original WB images", { exact: true })
    .setInputFiles(files);
  await expect(page.locator(".real-mapping-table tbody tr")).toHaveCount(4);
  await expect(page.locator(".real-mapping-table")).toContainText("8-bit TIFF");
  await expect(page.locator(".real-mapping-table")).toContainText("16-bit PNG");
  for (const file of files) {
    const replicate = file.name.includes("rep1") ? "1" : "2";
    await expect(
      page.getByLabel(`${file.name} experiment ID`, { exact: true }),
    ).toHaveValue(replicate);
    await expect(
      page.getByLabel(`${file.name} membrane ID`, { exact: true }),
    ).toHaveValue(`M${replicate}`);
    await expect(
      page.getByLabel(`${file.name} role`, { exact: true }),
    ).toHaveValue(file.name.startsWith("Reference") ? "reference" : "target");
  }
  await page
    .getByLabel("Lane description", { exact: true })
    .fill("1=NC; 2=Drug; 3=marker");
  await expect(
    page.getByRole("button", { name: "Propose & calculate all", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Parse & preview", exact: true })
    .click();
  await expect(page.locator(".real-lane-preview")).toContainText(
    "Mapping awaiting confirmation",
  );
  await expect(page.locator(".real-lane-preview")).toContainText("Excluded");
  await page
    .getByRole("button", { name: "Confirm for all images", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Propose & calculate all", exact: true })
    .click();
  await expect(page.locator(".real-result-table tbody tr")).toHaveCount(4);
  await expect(page.locator(".real-result-table tbody")).toContainText("Drug");
  await expect(page.locator(".real-result-table tbody")).not.toContainText(
    "marker",
  );
  return files;
}
async function selectImage(page: Page, name: string) {
  await page
    .locator(".real-image-strip button")
    .filter({ hasText: name })
    .click();
  await expect(page.locator(".real-editor-toolbar strong")).toHaveText(name);
}
async function download(page: Page, button: string): Promise<Download> {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  return event;
}
async function downloadBytes(file: Download) {
  return readFile((await file.path())!);
}
// CSV includes quoted JSON geometry and may include newlines in notes.
function csvRows(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (c === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  const header = records.shift()!.map((value) => value.replace(/^\ufeff/, ""));
  return records.map((values) =>
    Object.fromEntries(header.map((key, i) => [key, values[i]])),
  );
}
async function exportCsv(page: Page) {
  return csvRows(
    (await downloadBytes(await download(page, "CSV"))).toString("utf8"),
  );
}

test("real 8/16-bit batch maps lanes, recalculates manual pixels, and retains draft scientific status", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [],
    external: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== new URL(baseURL!).origin
    )
      external.push(request.url());
  });
  await openEnglish(page);
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await importAndAnalyze(page);
  const initial = await exportCsv(page);
  expect(initial).toHaveLength(4);
  expect(initial.every((row) => row.record_status === "DRAFT")).toBe(true);
  expect(
    initial
      .filter((row) => row.condition === "Drug")
      .map((row) => Number(row.fold_vs_control)),
  ).toEqual([1.2, 2]);
  expect(
    initial.find((row) => row.image_name === "Target_rep2.png")!
      .source_bit_depth,
  ).toBe("16");
  expect(
    Number(
      initial.find((row) => row.image_name === "Target_rep2.png")!.target_net,
    ),
  ).toBe(18 * 8 * 80 * 257);

  await selectImage(page, "Target_rep1.tif");
  await page
    .getByRole("checkbox", {
      name: "I reviewed this image's regions and metadata",
      exact: true,
    })
    .check();
  for (const [key, value] of Object.entries({
    x: 12,
    y: 20,
    width: 18,
    height: 8,
  }))
    await page
      .getByRole("spinbutton", { name: `ROI ${key}`, exact: true })
      .fill(String(value));
  const measurement = page.locator(".real-editor table tbody tr").first();
  await expect(measurement.locator("td").nth(4)).toHaveText("14,400");
  await expect(
    page.getByRole("checkbox", {
      name: "I reviewed this image's regions and metadata",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("spinbutton", { name: "ROI width", exact: true })
    .fill("9");
  await expect(measurement.locator("td").nth(4)).toHaveText("7,200");
  await page
    .getByRole("button", { name: "Propose & calculate all", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "ROI width", exact: true }),
  ).toHaveValue("9");
  const changed = await exportCsv(page);
  const control = changed.find(
    (row) => row.image_name === "Target_rep1.tif" && row.condition === "NC",
  )!;
  expect(Number(control.target_net)).toBe(7200);
  expect(control.roi_source).toBe("manual");
  expect(JSON.parse(control.band_roi_json)).toEqual({
    x: 12,
    y: 20,
    width: 9,
    height: 8,
  });
  expect(
    Number(
      changed.find(
        (row) =>
          row.image_name === "Target_rep1.tif" && row.condition === "Drug",
      )!.fold_vs_control,
    ),
  ).toBe(2.4);
  expect(changed.every((row) => row.record_status === "DRAFT")).toBe(true);
  expect(external).toEqual([]);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("real archive preserves originals and revisions across reload/migration with bilingual figures", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  await openEnglish(page);
  const files = await importAndAnalyze(page);
  await page
    .getByRole("textbox", { name: "Real project name", exact: true })
    .fill("Synthetic paired workflow");
  await selectImage(page, "Target_rep1.tif");
  await page
    .getByRole("textbox", { name: "Real image review notes", exact: true })
    .fill("Synthetic only — original pixels retained");
  await page
    .getByRole("spinbutton", { name: "ROI width", exact: true })
    .fill("10");
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Real project name", exact: true }),
  ).toHaveValue("Synthetic paired workflow");
  await expect(
    page.getByRole("textbox", { name: "Real image review notes", exact: true }),
  ).toHaveValue("Synthetic only — original pixels retained");
  await expect(
    page.getByRole("spinbutton", { name: "ROI width", exact: true }),
  ).toHaveValue("10");
  const before = await exportCsv(page);
  const archive = await download(page, "Export project");
  const archivePath = testInfo.outputPath("synthetic.realwb.zip");
  await archive.saveAs(archivePath);
  const entries = unzipSync(await readFile(archivePath));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  expect(manifest.images).toHaveLength(4);
  expect(
    Object.keys(entries).filter((name) => name.startsWith("originals/")),
  ).toHaveLength(4);
  for (const image of manifest.images) {
    const file = files.find((candidate) => candidate.name === image.name)!;
    expect(Buffer.from(entries[image.path])).toEqual(file.buffer);
    expect(image.hash).toBe(
      createHash("sha256").update(file.buffer).digest("hex"),
    );
  }
  expect(manifest.images[0].history.length).toBeGreaterThan(0);
  expect(manifest.images[0].regions[0].band.width).toBe(10);

  const context = await browser.newContext();
  try {
    const destination = await context.newPage();
    await openEnglish(destination, baseURL);
    await destination
      .getByLabel("Import real project archive", { exact: true })
      .setInputFiles(archivePath);
    await expect(destination.getByRole("dialog")).toBeVisible();
    await expect(destination.locator(".real-mapping-table")).toHaveCount(0);
    await destination
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      destination.locator(".real-mapping-table tbody tr"),
    ).toHaveCount(4);
    await expect(
      destination.getByRole("spinbutton", { name: "ROI width", exact: true }),
    ).toHaveValue("10");
    expect(await exportCsv(destination)).toEqual(before);
    await destination
      .getByRole("button", { name: "Switch to Chinese", exact: true })
      .click();
    await expect(
      destination.getByRole("heading", {
        name: "真实 Western blot 工作区",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      destination.getByLabel("泳道说明", { exact: true }),
    ).toHaveValue("1=NC; 2=Drug; 3=marker");
    await destination
      .getByRole("button", { name: "切换到英文", exact: true })
      .click();
    const svg = await download(destination, "SVG");
    expect(svg.suggestedFilename()).toMatch(/^DRAFT-.*\.svg$/);
    const svgText = (await downloadBytes(svg)).toString("utf8");
    expect(svgText).toContain("DRAFT");
    expect(svgText).toContain("No significance test.");
    expect(svgText).toContain("paired sets");
    const png = decodePng(
      await downloadBytes(await download(destination, "PNG")),
    );
    const tif = decodeRaster(
      await downloadBytes(await download(destination, "TIFF")),
      "figure.tif",
    );
    expect(png.width).toBe(2700);
    expect(tif.width).toBe(png.width);
    expect(tif.height).toBe(png.height);
    expect(png.height).toBeGreaterThan(1500);
    expect(tif.format).toBe("TIFF");
    expect(await exportCsv(destination)).toEqual(before);
  } finally {
    await context.close();
  }
});

test("public pixel example loads after confirmation and pending edits survive browser Back", async ({
  page,
}) => {
  await page.goto("/#demo");
  await openEnglish(page);
  const exampleResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(
      "/examples/real/example.realwb.zip",
    ),
  );
  await page
    .getByRole("button", {
      name: "Load synthetic pixel-validation example",
      exact: true,
    })
    .click();
  expect((await exampleResponse).status()).toBe(200);
  await expect(page.getByRole("dialog")).toContainText("SYNTHETIC");
  await expect(page.locator(".real-mapping-table")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Real project name", exact: true }),
  ).toHaveValue("Western blot");
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  // The archive records Chinese as its language; changing it does not alter measurements.
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await expect(page.locator(".real-mapping-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".real-mapping-table")).toContainText("16-bit PNG");
  await expect(page.locator(".real-result-table tbody tr")).toHaveCount(6);
  const treatmentRows = page
    .locator(".real-result-table tbody tr")
    .filter({
      has: page.getByRole("cell", { name: "Treatment", exact: true }),
    });
  await expect(treatmentRows).toHaveCount(3);
  expect(
    await treatmentRows.locator("td:nth-child(6)").allTextContents(),
  ).toEqual(["0.5", "0.75", "1"]);
  const exampleResults = await exportCsv(page);
  expect(new Set(exampleResults.map((row) => row.experiment_id)).size).toBe(3);
  expect(new Set(exampleResults.map((row) => row.condition)).size).toBe(2);
  expect(new Set(exampleResults.map((row) => row.source_bit_depth))).toEqual(
    new Set(["8", "16"]),
  );
  expect(
    exampleResults
      .filter((row) => row.condition === "Treatment")
      .map((row) => Number(row.fold_vs_control)),
  ).toEqual([0.5, 0.75, 1]);
  expect(exampleResults.every((row) => row.record_status === "DRAFT")).toBe(
    true,
  );
  await saved(page);
  await page
    .getByRole("textbox", { name: "Real project name", exact: true })
    .fill("Edited immediately before browser Back");
  // Deliberately do not wait for Saved locally: this leaves the debounce pending.
  await page.goBack();
  await expect(page).toHaveURL(/#demo$/);
  await expect(page.locator(".real-workbench")).toHaveCount(0);
  await page.goForward();
  await expect(
    page.getByRole("textbox", { name: "Real project name", exact: true }),
  ).toHaveValue("Edited immediately before browser Back");
  await saved(page);
});
