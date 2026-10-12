import { test, expect, type Page, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { encode as encodePng, decode as decodePng } from "fast-png";
import { unzipSync, strFromU8 } from "fflate";
import { encodeFigureTiff } from "../../src/real/figure-export";
import { decodeRaster } from "../../src/real/pixels";

// Public synthetic fixtures only: uniform background and two rectangular bands.
// The 16-bit fixtures use 257× the 8-bit scale, never a display-derived measurement.
function syntheticFile(name: string, depth: 8 | 16, levels: number[]) {
  const width = levels.length * 50,
    height = 64,
    scale = depth === 16 ? 257 : 1;
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
  await expect(page.locator(".real-workspace-banner")).toContainText(
    "Personal workspace on this device",
  );
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
  // New projects default to the first control as a common baseline.
  await expect(
    page.getByLabel("Normalization baseline", { exact: true }),
  ).toHaveValue("reference-unit");
  await expect(
    page.getByLabel("Common baseline ID", { exact: true }),
  ).toHaveValue("1");
  const initial = await exportCsv(page);
  expect(initial).toHaveLength(4);
  expect(initial.every((row) => row.record_status === "DRAFT")).toBe(true);
  expect(
    initial.every((row) => row.normalization_method === "reference-unit"),
  ).toBe(true);
  const initialDrugFolds = initial
    .filter((row) => row.condition === "Drug")
    .map((row) => Number(row.fold_vs_control));
  expect(initialDrugFolds[0]).toBe(1.2);
  expect(initialDrugFolds[1]).toBeCloseTo(1.12, 12);
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
    expect(svgText).toContain("Complete pairs only.");
    expect(svgText).not.toContain('class="real-p-value"');
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
  await expect(page.locator(".real-workspace-banner")).toContainText(
    "Synthetic example workspace",
  );
  await expect(page.locator(".real-workspace-banner")).toContainText(
    "Website examples and public screenshots use synthetic data only.",
  );
  const exampleSvg = (
    await downloadBytes(await download(page, "SVG"))
  ).toString("utf8");
  expect(exampleSvg).toContain(
    "SYNTHETIC · Simulated pixels, not real experiments",
  );
  await expect(page.locator(".real-mapping-table")).toContainText("16-bit PNG");
  await expect(page.locator(".real-result-table tbody tr")).toHaveCount(6);
  const treatmentRows = page.locator(".real-result-table tbody tr").filter({
    has: page.getByRole("cell", { name: "Treatment", exact: true }),
  });
  await expect(treatmentRows).toHaveCount(3);
  expect(
    await treatmentRows.locator("td:nth-child(6)").allTextContents(),
  ).toEqual(["0.5", "0.75", "1"]);
  const exampleResults = await exportCsv(page);
  expect(
    new Set(exampleResults.map((row) => row.source_group_or_experiment_id))
      .size,
  ).toBe(3);
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
  await page
    .getByLabel("Choose original WB images", { exact: true })
    .setInputFiles([syntheticFile("Local-import.png", 8, [111, 153])]);
  await expect(page.locator(".real-workspace-banner")).toContainText(
    "Personal workspace on this device",
  );
  await expect(page.locator(".real-workspace-banner")).toContainText(
    "do not become website examples or public displays",
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

// Independence is confirmed only within this generated QA fixture to exercise
// the inference controls. No synthetic fixture is treated as biological evidence.
test("explicit paired inference, common baseline, and plot styles retain auditable raw-ratio tests", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  await openEnglish(page);
  await importAndAnalyze(page);
  // Exercise the explicit matched path first; new projects would otherwise
  // already sit on the first control as a common baseline.
  await page
    .getByLabel("Normalization baseline", { exact: true })
    .selectOption("matched-control");
  const testChoice = page.getByRole("checkbox", {
    name: "Two-sided paired t-test",
    exact: true,
  });
  await expect(testChoice).toBeDisabled();
  await expect(testChoice).not.toBeChecked();
  await expect(page.locator(".real-mean-bar")).toHaveCount(2);
  await expect(page.locator(".real-result-figure polyline")).toHaveCount(0);
  await expect(page.locator(".real-p-value")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: /^I have checked lane assignments/ })
    .check();
  await testChoice.check();
  await expect(page.locator(".real-p-value")).toContainText("P = ");
  await expect(page.locator(".real-statistics-panel")).toContainText(
    "95% confidence interval",
  );
  await expect(page.locator(".real-statistics-panel")).toContainText(
    "target/reference ratio units",
  );
  const initialStats = csvRows(
    (await downloadBytes(await download(page, "Statistics CSV"))).toString(
      "utf8",
    ),
  );
  expect(initialStats).toHaveLength(1);
  const inference = initialStats[0];
  expect(inference.method).toBe("paired-t");
  expect(inference.alternative).toBe("two-sided");
  expect(inference.input_basis).toBe("target/reference");
  expect(inference.n_complete_pairs).toBe("2");
  expect(inference.df).toBe("1");
  expect(inference.quality_status).toBe("DRAFT");
  // Independent closed-form reference: df=1 follows the Cauchy distribution.
  const differences = [60 / 35 - 100 / 70, 80 / 50 - 80 / 100];
  const meanDifference = (differences[0] + differences[1]) / 2;
  const sd = Math.abs(differences[1] - differences[0]) / Math.sqrt(2);
  const expectedT = meanDifference / (sd / Math.sqrt(2));
  const expectedP = 1 - (2 / Math.PI) * Math.atan(Math.abs(expectedT));
  expect(Number(inference.t)).toBeCloseTo(expectedT, 12);
  // Allow 1e-10 numerical error from the incomplete-beta t-tail evaluation.
  expect(Number(inference.p_value_unadjusted)).toBeCloseTo(expectedP, 10);
  expect(Number(inference.mean_difference_treatment_minus_control)).toBeCloseTo(
    meanDifference,
    12,
  );
  const pText = await page.locator(".real-p-value text").textContent();
  await page
    .getByLabel("Normalization baseline", { exact: true })
    .selectOption("reference-unit");
  await expect(
    page.getByLabel("Common baseline ID", { exact: true }),
  ).toHaveValue("1");
  await expect(page.locator(".real-p-value text")).toHaveText(pText!);
  const commonResults = await exportCsv(page);
  const controlValues = commonResults
    .filter((row) => row.condition === "NC")
    .map((row) => Number(row.fold_vs_control));
  expect(controlValues[0]).toBe(1);
  expect(controlValues[1]).toBeCloseTo(0.56, 12);
  expect(
    commonResults.every((row) => row.normalization_method === "reference-unit"),
  ).toBe(true);
  const commonStats = csvRows(
    (await downloadBytes(await download(page, "Statistics CSV"))).toString(
      "utf8",
    ),
  )[0];
  for (const column of [
    "n_complete_pairs",
    "t",
    "p_value_unadjusted",
    "mean_difference_treatment_minus_control",
    "ci95_low",
    "ci95_high",
  ])
    expect(commonStats[column]).toBe(inference[column]);
  expect(commonStats.plot_reference_unit).toBe("1");
  await page.getByLabel("Plot style", { exact: true }).selectOption("paired");
  await expect(page.locator(".real-mean-bar")).toHaveCount(0);
  await expect(page.locator(".real-result-figure polyline")).toHaveCount(2);
  await expect(page.locator(".real-p-value text")).toHaveText(pText!);
  await saved(page);
  await page.reload();
  await expect(
    page.getByLabel("Normalization baseline", { exact: true }),
  ).toHaveValue("reference-unit");
  await expect(
    page.getByLabel("Common baseline ID", { exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("checkbox", {
      name: "Two-sided paired t-test",
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.locator(".real-p-value text")).toHaveText(pText!);
  await expect(page.locator(".real-mean-bar")).toHaveCount(2);
  const archivePath = testInfo.outputPath("synthetic-inference.realwb.zip");
  await (await download(page, "Export project")).saveAs(archivePath);
  const manifest = JSON.parse(
    strFromU8(unzipSync(await readFile(archivePath))["manifest.json"]),
  );
  expect(manifest.normalization).toEqual({
    kind: "reference-unit",
    unitId: "1",
  });
  expect(manifest.statisticalTest).toBe("paired-t");
  const context = await browser.newContext();
  try {
    const destination = await context.newPage();
    await openEnglish(destination, baseURL);
    await destination
      .getByLabel("Import real project archive", { exact: true })
      .setInputFiles(archivePath);
    await destination
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      destination.getByLabel("Normalization baseline", { exact: true }),
    ).toHaveValue("reference-unit");
    await expect(
      destination.getByRole("checkbox", {
        name: "Two-sided paired t-test",
        exact: true,
      }),
    ).toBeChecked();
    await expect(destination.locator(".real-p-value text")).toHaveText(pText!);
    expect(await exportCsv(destination)).toEqual(commonResults);
    const svg = (
      await downloadBytes(await download(destination, "SVG"))
    ).toString("utf8");
    expect(svg).toContain("Common baseline:");
    expect(svg).toContain("Two-sided paired t-test:");
    expect(svg).toContain("unadjusted");
    expect(svg).toContain("DRAFT");
    await destination
      .getByRole("button", { name: "Switch to Chinese", exact: true })
      .click();
    await expect(
      destination.getByLabel("共同基准编号", { exact: true }),
    ).toHaveValue("1");
    await expect(destination.locator(".real-statistics-panel")).toContainText(
      "95% 置信区间",
    );
  } finally {
    await context.close();
  }
});

test("explicit N/T mapping counts distinct individuals across source groups and survives migration", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90000);
  await openEnglish(page);
  await page
    .getByLabel("Choose original WB images", { exact: true })
    .setInputFiles([
      syntheticFile("Target_rep1.png", 8, [120, 140, 160, 150]),
      syntheticFile("Reference_rep1.png", 8, [180, 190, 180, 185]),
      syntheticFile("Target_rep2.png", 8, [130, 150, 155, 165]),
      syntheticFile("Reference_rep2.png", 8, [170, 180, 175, 180]),
    ]);
  await expect(page.locator(".real-mapping-table tbody tr")).toHaveCount(4);
  await page
    .getByLabel("Comparison design", { exact: true })
    .selectOption("paired");
  await page
    .getByLabel("N/T pairing table", { exact: true })
    .fill(
      "1, person-1, 1, 2\n1, person-2, 3, 4\n2, person-3, 1, 2\n2, person-4, 3, 4",
    );
  await expect(
    page.getByRole("button", { name: "Confirm N/T pairs", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Propose & calculate all", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Preview N/T pairs", exact: true })
    .click();
  await expect(page.locator(".real-pair-form table tbody tr")).toHaveCount(4);
  await expect(page.locator(".real-lane-preview")).toContainText(
    "Distinct individual IDs: 4",
  );
  await expect(
    page.getByLabel("Target_rep1.png experiment ID", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm N/T pairs", exact: true })
    .click();
  await expect(
    page.getByLabel("Target_rep1.png source group ID", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Propose & calculate all", exact: true })
    .click();
  await expect(page.locator(".real-result-table tbody tr")).toHaveCount(8);
  // Capture the paired P under the explicit matched path before switching to
  // the common baseline; the test below asserts P does not move with it.
  await page
    .getByLabel("Normalization baseline", { exact: true })
    .selectOption("matched-control");
  const before = await exportCsv(page);
  expect(new Set(before.map((row) => row.individual_id)).size).toBe(4);
  expect(
    new Set(before.map((row) => row.source_group_or_experiment_id)).size,
  ).toBe(2);
  expect(new Set(before.map((row) => row.condition))).toEqual(
    new Set(["N", "T"]),
  );
  await expect(page.locator(".real-result-figure")).toContainText(
    "n = 4 · paired sets",
  );
  await page
    .getByRole("checkbox", {
      name: /^I have checked each individual's N\/T lanes/,
    })
    .check();
  await expect(page.locator(".real-result-figure")).toContainText(
    "n = 4 · individuals",
  );
  await page
    .getByRole("checkbox", { name: "Two-sided paired t-test", exact: true })
    .check();
  await expect(page.locator(".real-p-value")).toContainText("P = ");
  const stats = csvRows(
    (await downloadBytes(await download(page, "Statistics CSV"))).toString(
      "utf8",
    ),
  )[0];
  expect(stats.n_complete_pairs).toBe("4");
  expect(JSON.parse(stats.individual_or_experiment_ids_json)).toEqual([
    "person-1",
    "person-2",
    "person-3",
    "person-4",
  ]);
  const pairedP = stats.p_value_unadjusted;
  await page
    .getByLabel("Normalization baseline", { exact: true })
    .selectOption("reference-unit");
  await expect(
    page.getByLabel("Common baseline ID", { exact: true }),
  ).toHaveValue("person-1");
  const common = await exportCsv(page);
  expect(
    common
      .filter((row) => row.condition === "N")
      .map((row) => Number(row.fold_vs_control)),
  ).not.toEqual([1, 1, 1, 1]);
  const afterStats = csvRows(
    (await downloadBytes(await download(page, "Statistics CSV"))).toString(
      "utf8",
    ),
  )[0];
  expect(afterStats.p_value_unadjusted).toBe(pairedP);
  const archivePath = testInfo.outputPath("synthetic-individuals.realwb.zip");
  await (await download(page, "Export project")).saveAs(archivePath);
  const manifest = JSON.parse(
    strFromU8(unzipSync(await readFile(archivePath))["manifest.json"]),
  );
  expect(manifest.pairedDesign.pairs).toHaveLength(4);
  expect(manifest.pairedDesign.pairs[3]).toEqual({
    groupId: "2",
    unitId: "person-4",
    normalLane: 3,
    tumorLane: 4,
  });
  const context = await browser.newContext();
  try {
    const destination = await context.newPage();
    await openEnglish(destination, baseURL);
    await destination
      .getByLabel("Import real project archive", { exact: true })
      .setInputFiles(archivePath);
    await destination
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      destination.getByLabel("Comparison design", { exact: true }),
    ).toHaveValue("paired");
    await expect(
      destination.getByLabel("N/T pairing table", { exact: true }),
    ).toContainText("person-4");
    await expect(destination.locator(".real-result-figure")).toContainText(
      "n = 4 · individuals",
    );
    expect(await exportCsv(destination)).toEqual(common);
    await saved(destination);
    await destination.reload();
    await expect(
      destination.getByLabel("Comparison design", { exact: true }),
    ).toHaveValue("paired");
    await expect(
      destination.getByLabel("Common baseline ID", { exact: true }),
    ).toHaveValue("person-1");
    await expect(destination.locator(".real-result-figure")).toContainText(
      "n = 4 · individuals",
    );
    await destination
      .getByRole("button", { name: "Switch to Chinese", exact: true })
      .click();
    await expect(
      destination.getByLabel("N/T 配对表", { exact: true }),
    ).toBeVisible();
    await expect(destination.locator(".real-result-figure")).toContainText(
      "独立个体",
    );
  } finally {
    await context.close();
  }
});
