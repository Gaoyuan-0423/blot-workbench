import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzlibSync, zlibSync } from "fflate";

// An independent PNG fixture: every 24 × 16 band has a known constant signal.
// These are synthetic pixels for flow checks, not experimental-image validation.
function bandsPng(
  rows: number[][] = [[200, 180, 160, 140, 120, 100]],
  invert = false,
) {
  const width = 360;
  const height = rows.length > 1 ? 200 : 112;
  const pixels = new Uint8Array(width * height).fill(240);
  rows.forEach((lanes, row) => {
    lanes.forEach((gray, lane) => {
      for (let y = 48 + row * 82; y < 64 + row * 82; y++) {
        for (let x = 18 + lane * 60; x < 42 + lane * 60; x++) {
          pixels[y * width + x] = gray;
        }
      }
    });
  });
  if (invert)
    for (let i = 0; i < pixels.length; i++) pixels[i] = 255 - pixels[i];
  const scanlines = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines.set(
      pixels.subarray(y * width, (y + 1) * width),
      y * (width + 1) + 1,
    );
  }
  const uint32 = (value: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value);
    return buffer;
  };
  const chunk = (name: string, content: Uint8Array) => {
    const payload = Buffer.concat([Buffer.from(name), content]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return Buffer.concat([
      uint32(content.length),
      payload,
      uint32((crc ^ 0xffffffff) >>> 0),
    ]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk(
      "IHDR",
      Buffer.concat([
        uint32(width),
        uint32(height),
        Buffer.from([8, 0, 0, 0, 0]),
      ]),
    ),
    chunk("IDAT", zlibSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (character === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...values] = rows;
  return values.map((values) =>
    Object.fromEntries(header.map((key, i) => [key, values[i]])),
  );
}

async function ready(page: Page) {
  await page.goto("/?mode=quick");
  await expect(
    page.getByRole("heading", { name: "导入条带，直接看结果", exact: true }),
  ).toBeVisible();
}

async function importPng(page: Page, rows?: number[][], reference = false) {
  await page
    .getByLabel(reference ? "添加内参图片" : "导入条带图片", { exact: true })
    .setInputFiles({
      name: reference ? "reference.png" : "known-bands.png",
      mimeType: "image/png",
      buffer: bandsPng(rows),
    });
}

async function csvResults(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV", exact: true }).click();
  const file = await download;
  return parseCsv(await readFile((await file.path())!, "utf8"));
}

const table = (page: Page) =>
  page.getByRole("table", { name: "条带定量结果", exact: true });

test("demo generates six lanes and a chart beside the image without an analysis step", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "定量结果", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "项目演示", exact: true }),
  ).toHaveAttribute("href", "?mode=project");
  await page.screenshot({
    path: testInfo.outputPath("quick-home.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  await expect(
    page.getByRole("img", { name: "原图与取样框", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("img", { name: "条带相对强度柱状图", exact: true }),
  ).toBeInViewport();
  await expect(page.getByTestId("relative-1")).toHaveText("1×");
  await page.screenshot({
    path: testInfo.outputPath("quick-results.png"),
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click();
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("8-bit 像素估计");
  expect(svg).toContain("泳道 6");
  expect(errors).toEqual([]);
});

test("PNG export contains a complete image at the chart export dimensions", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  const png = await readFile((await file.path())!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.toString("ascii", 12, 16)).toBe("IHDR");
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  expect([width, height]).toEqual([1560, 990]);
  expect(png[24]).toBe(8);
  const channels = png[25] === 2 ? 3 : png[25] === 6 ? 4 : undefined;
  expect(channels).toBeDefined();
  expect(png[28]).toBe(0);
  const idat: Buffer[] = [];
  let offset = 8,
    ended = false;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    expect(offset + length + 12).toBeLessThanOrEqual(png.length);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT")
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") {
      expect(length).toBe(0);
      ended = true;
    }
    offset += length + 12;
  }
  expect(ended).toBe(true);
  expect(offset).toBe(png.length);
  const pixels = unzlibSync(Buffer.concat(idat));
  const rowLength = width * channels! + 1;
  expect(pixels.length).toBe(rowLength * height);
  for (let row = 0; row < height; row++)
    expect(pixels[row * rowLength]).toBeLessThanOrEqual(4);
});

test("PNG import measures its pixels, exports the method, and immediately changes control", async ({
  page,
}) => {
  await ready(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await importPng(page);
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("relative-6")).toHaveText("3.5×");
  const before = await csvResults(page);
  expect(before).toHaveLength(6);
  for (const [i, row] of before.entries()) {
    expect(row.source).toBe("known-bands.png");
    expect(Number(row.net_signal)).toBe(24 * 16 * (40 + i * 20));
    expect(Number(row.relative_value)).toBeCloseTo(1 + i * 0.5, 5);
    expect(Number(row.raw_signal) - Number(row.background_signal)).toBe(
      Number(row.net_signal),
    );
    expect(row.method).toContain("local mean background subtraction");
    expect(row.status).toBe("UNREVIEWED_PIXEL_ESTIMATE");
  }
  await page
    .getByRole("combobox", { name: "对照泳道", exact: true })
    .selectOption("1");
  await expect(page.getByTestId("relative-2")).toHaveText("1×");
  await expect(page.getByTestId("relative-1")).toHaveText("0.67×");
  const after = await csvResults(page);
  for (const [i, row] of after.entries()) {
    expect(row.control_lane).toBe("泳道 2");
    expect(row.net_signal).toBe(before[i].net_signal);
    expect(Number(row.relative_value)).toBeCloseTo((1 + i * 0.5) / 1.5, 5);
  }
  expect(requests).toEqual([]);
});

test("a blank image replaces previous results without fabricating lanes or values", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  await importPng(page, [[]]);
  await expect(
    page.getByRole("heading", { name: "还没有找到清晰条带", exact: true }),
  ).toBeVisible();
  await expect(table(page)).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "条带相对强度柱状图", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "导出 CSV", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "导出 SVG", exact: true }),
  ).toBeDisabled();
});

test("multirow import offers row selection and normalizes against the chosen row", async ({
  page,
}) => {
  await ready(page);
  const intensities = [200, 180, 160, 140, 120, 100];
  await importPng(page, [intensities, intensities]);
  const first = page.getByRole("button", { name: /^第 1 排/ });
  const second = page.getByRole("button", { name: /^第 2 排/ });
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toBeVisible();
  await expect(page.getByTestId("relative-6")).toHaveText("3.5×");
  await page
    .getByRole("combobox", { name: "内参条带", exact: true })
    .selectOption("row:1");
  for (let lane = 1; lane <= 6; lane++)
    await expect(page.getByTestId(`relative-${lane}`)).toHaveText("1×");
  const paired = await csvResults(page);
  expect(
    paired.every(
      (row) =>
        row.reference_protein === "蛋白 2" && Number(row.relative_value) === 1,
    ),
  ).toBe(true);
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "蛋白名称", exact: true }),
  ).toHaveValue("蛋白 2");
  await expect(
    page.getByRole("combobox", { name: "内参条带", exact: true }),
  ).toHaveValue("none");
  await expect(page.getByTestId("relative-6")).toHaveText("3.5×");
  const secondRow = await csvResults(page);
  expect(secondRow.every((row) => Number(row.roi_y) > 100)).toBe(true);
});

test("external reference pairs left to right and a count mismatch leaves relative values unavailable", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  await importPng(page, undefined, true);
  for (let lane = 1; lane <= 6; lane++)
    await expect(page.getByTestId(`relative-${lane}`)).toHaveText("1×");
  await importPng(page, [[200, 180, 160]], true);
  await expect(page.getByText(/内参与目标的泳道数量不同/)).toBeVisible();
  for (let lane = 1; lane <= 6; lane++)
    await expect(page.getByTestId(`relative-${lane}`)).toHaveText("—");
  await expect(
    page.getByRole("button", { name: "导出 SVG", exact: true }),
  ).toBeDisabled();
  const rows = await csvResults(page);
  expect(rows).toHaveLength(6);
  expect(rows.every((row) => row.relative_value === "")).toBe(true);
  expect(rows.every((row) => Number(row.net_signal) > 0)).toBe(true);
});

test("manual rectangle changes recalculate measured pixels before export", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  const before = await csvResults(page);
  await page.getByRole("button", { name: "调整取样框", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "取样框 width", exact: true })
    .fill("13");
  await expect(page.getByTestId("relative-2")).toHaveText("3×");
  const after = await csvResults(page);
  expect(Number(after[0].net_signal)).toBe(Number(before[0].net_signal) / 2);
  expect(after[0].roi_width).toBe("13");
  expect(after[1].net_signal).toBe(before[1].net_signal);
});

test("arrow keys on a band move that band even when the background editor was selected", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  await page.getByRole("button", { name: "调整取样框", exact: true }).click();
  const type = page.getByRole("combobox", {
    name: "编辑取样类型",
    exact: true,
  });
  const x = page.getByRole("spinbutton", { name: "取样框 x", exact: true });
  const bandX = Number(await x.inputValue());
  await type.selectOption("background");
  const backgroundX = await x.inputValue();
  await page
    .getByRole("button", { name: "泳道 1 取样框", exact: true })
    .press("ArrowRight");
  await type.selectOption("band");
  await expect(x).toHaveValue(String(bandX + 1));
  await type.selectOption("background");
  await expect(x).toHaveValue(backgroundX);
});

test("editing an external reference preserves the target and immediately recalculates ratios", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  const protein = page.getByRole("textbox", { name: "蛋白名称", exact: true });
  await protein.fill("目标蛋白");
  const target = await csvResults(page);
  await importPng(page, undefined, true);
  for (let lane = 1; lane <= 6; lane++)
    await expect(page.getByTestId(`relative-${lane}`)).toHaveText("1×");
  await page.getByRole("button", { name: "调整内参取样", exact: true }).click();
  await expect(page.locator(".quick-source")).toContainText("reference.png");
  await expect(protein).toHaveValue("目标蛋白");
  await page
    .getByRole("combobox", { name: "编辑取样类型", exact: true })
    .selectOption("band");
  const x = page.getByRole("spinbutton", { name: "取样框 x", exact: true });
  const originalX = await x.inputValue();
  await x.fill("45");
  for (let lane = 1; lane <= 6; lane++)
    await expect(page.getByTestId(`relative-${lane}`)).toHaveText("—");
  await expect(
    page.getByRole("button", { name: "导出 SVG", exact: true }),
  ).toBeDisabled();
  const invalid = await csvResults(page);
  for (const [i, row] of invalid.entries()) {
    expect(row.source).toBe("known-bands.png");
    expect(row.protein).toBe("目标蛋白");
    expect(row.net_signal).toBe(target[i].net_signal);
    expect(row.reference_source).toBe("reference.png");
    expect(row.relative_value).toBe("");
  }
  expect(invalid[0].reference_net_signal).toBe("");
  await x.fill(originalX);
  for (let lane = 1; lane <= 6; lane++)
    await expect(page.getByTestId(`relative-${lane}`)).toHaveText("1×");
  await expect(
    page.getByRole("button", { name: "导出 SVG", exact: true }),
  ).toBeEnabled();
});

test("mobile shows usable result controls without horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(6);
  const chart = page.getByRole("img", {
    name: "条带相对强度柱状图",
    exact: true,
  });
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeInViewport();
  await expect(
    page.getByRole("combobox", { name: "对照泳道", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect((await chart.boundingBox())!.width).toBeLessThanOrEqual(390);
});

test("reference polarity can differ without changing target pixels or control", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await page
    .getByRole("combobox", { name: "对照泳道", exact: true })
    .selectOption("1");
  const before = await csvResults(page);
  await page.getByLabel("添加内参图片", { exact: true }).setInputFiles({
    name: "light-reference.png",
    mimeType: "image/png",
    buffer: bandsPng(undefined, true),
  });
  await page.getByRole("button", { name: "调整内参取样", exact: true }).click();
  await page
    .getByRole("combobox", { name: "图像类型", exact: true })
    .selectOption("light");
  for (let i = 1; i <= 6; i++)
    await expect(page.getByTestId(`relative-${i}`)).toHaveText("1×");
  const after = await csvResults(page);
  for (const [i, row] of after.entries()) {
    expect(row.net_signal).toBe(before[i].net_signal);
    expect(row.polarity).toBe("dark");
    expect(row.reference_polarity).toBe("light");
    expect(row.reference_roi_x).not.toBe("");
  }
  await expect(
    page.getByRole("combobox", { name: "对照泳道", exact: true }),
  ).toHaveValue("1");
  await page.getByRole("button", { name: "返回目标条带", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "图像类型", exact: true }),
  ).toHaveValue("dark");
});
