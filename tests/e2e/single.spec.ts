import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zlibSync } from "fflate";

// Independent synthetic input with known pixel integrals, not validation on experimental blots.
function singlePng(
  rows: number[][] = [[200, 180, 160, 140, 120, 100]],
  invert = false,
) {
  const width = 360,
    height = rows.length > 1 ? 200 : 112;
  const pixels = new Uint8Array(width * height).fill(240);
  rows.forEach((lanes, row) =>
    lanes.forEach((gray, lane) => {
      for (let y = 48 + row * 82; y < 64 + row * 82; y++) {
        for (let x = 18 + lane * 60; x < 42 + lane * 60; x++)
          pixels[y * width + x] = gray;
      }
    }),
  );
  if (invert)
    for (let i = 0; i < pixels.length; i++) pixels[i] = 255 - pixels[i];
  const scanlines = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    scanlines.set(
      pixels.subarray(y * width, (y + 1) * width),
      y * (width + 1) + 1,
    );
  const uint32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return bytes;
  };
  const chunk = (name: string, bytes: Uint8Array) => {
    const payload = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return Buffer.concat([
      uint32(bytes.length),
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
  await page.goto("/?mode=single");
  await expect(
    page.getByRole("heading", { name: "单条带识别", exact: true }),
  ).toBeVisible();
}

async function importPng(page: Page, rows?: number[][], invert = false) {
  await page.getByLabel("导入单排条带图片", { exact: true }).setInputFiles({
    name: "known-single-strip.png",
    mimeType: "image/png",
    buffer: singlePng(rows, invert),
  });
}

async function csvResults(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV", exact: true }).click();
  return parseCsv(await readFile((await (await download).path())!, "utf8"));
}

test("original workbench links to a separate simple single-strip page with immediate demo results", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#demo");
  await expect(
    page.getByRole("heading", { name: "项目总览", exact: true }),
  ).toBeVisible();
  const singleLink = page.getByRole("link", {
    name: "单条带识别",
    exact: true,
  });
  await expect(singleLink).toHaveAttribute("href", /\?mode=single&lang=zh$/);
  await singleLink.click();
  await expect(page).toHaveURL(/\?mode=single&lang=zh$/);
  await expect(
    page.getByRole("heading", { name: "单条带识别", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("single-home.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "识别结果", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await expect(
    page.getByRole("img", { name: "单排条带取样预览", exact: true }),
  ).toBeInViewport();
  await expect(page.getByTestId("single-relative-1")).toHaveText("1×");
  await expect(
    page.getByRole("spinbutton", { name: "泳道数量", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "图像类型", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "对照泳道", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "内参条带", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("添加内参图片", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "导出结果图", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("single-results.png"),
    fullPage: true,
  });
  const imageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果图", exact: true }).click();
  const png = await readFile((await (await imageDownload).path())!);
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(png.readUInt32BE(16)).toBe(1040);
  expect(png.readUInt32BE(20)).toBe(680);
  expect(errors).toEqual([]);
});

test("single-strip PNG import immediately measures known pixels and exports their values", async ({
  page,
}) => {
  await ready(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await importPng(page);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await expect(page.getByTestId("single-relative-6")).toHaveText("3.5×");
  const rows = await csvResults(page);
  expect(rows).toHaveLength(6);
  for (const [i, row] of rows.entries()) {
    expect(row.source).toBe("known-single-strip.png");
    expect(Number(row.net_signal)).toBe(24 * 16 * (40 + i * 20));
    expect(Number(row.relative_value)).toBeCloseTo(1 + i * 0.5, 5);
    expect(Number(row.raw_signal) - Number(row.background_signal)).toBe(
      Number(row.net_signal),
    );
    expect(row.method).toContain("local mean background subtraction");
    expect(row.status).toBe("UNREVIEWED_PIXEL_ESTIMATE");
    expect(row.reference_source).toBe("");
  }
  expect(requests).toEqual([]);
});

test("light bands on a dark background are recognized automatically without opening settings", async ({
  page,
}) => {
  await ready(page);
  await importPng(page, undefined, true);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await expect(page.getByTestId("single-relative-1")).toHaveText("1×");
  await expect(page.getByTestId("single-relative-6")).toHaveText("3.5×");
  await expect(
    page.getByRole("combobox", { name: "图像类型", exact: true }),
  ).not.toBeVisible();
  const rows = await csvResults(page);
  expect(rows).toHaveLength(6);
  for (const [i, row] of rows.entries()) {
    expect(row.polarity).toBe("light");
    expect(Number(row.net_signal)).toBe(24 * 16 * (40 + i * 20));
    expect(Number(row.relative_value)).toBeCloseTo(1 + i * 0.5, 5);
  }
});

test("multirow input asks for a single-strip crop and clears the previous measurements", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const intensities = [200, 180, 160, 140, 120, 100];
  await importPng(page, [intensities, intensities]);
  await expect(page.getByRole("alert")).toContainText("请先裁成单排条带");
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "导出 CSV", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "导出结果图", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "单排条带取样预览", exact: true }),
  ).toBeVisible();
});

test("an invalid image format reports its error and preserves the current results", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const before = await csvResults(page);
  await page.getByLabel("导入单排条带图片", { exact: true }).setInputFiles({
    name: "unsupported.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not image bytes"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(/PNG|JPEG/);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await expect(page.getByTestId("single-relative-6")).toHaveText("3.5×");
  expect(await csvResults(page)).toEqual(before);
});

test("optional adjustments reveal the controls and changing the control updates the ratios", async ({
  page,
}) => {
  await ready(page);
  await importPng(page);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await page.getByText("识别不准？调整取样", { exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "泳道数量", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "图像类型", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "对照泳道", exact: true })
    .selectOption("1");
  await expect(page.getByTestId("single-relative-2")).toHaveText("1×");
  await expect(page.getByTestId("single-relative-1")).toHaveText("0.67×");
  const rows = await csvResults(page);
  expect(rows.every((row) => row.control_lane === "泳道 2")).toBe(true);
  expect(Number(rows[5].relative_value)).toBeCloseTo(3.5 / 1.5, 5);
  const roiWidth = page.getByRole("spinbutton", {
    name: "取样框 width",
    exact: true,
  });
  const roiHeight = page.getByRole("spinbutton", {
    name: "取样框 height",
    exact: true,
  });
  const width = await roiWidth.inputValue(),
    height = await roiHeight.inputValue();
  await page
    .getByRole("spinbutton", { name: "取样框 x", exact: true })
    .fill("999");
  await page
    .getByRole("spinbutton", { name: "取样框 y", exact: true })
    .fill("999");
  await expect(roiWidth).toHaveValue(width);
  await expect(roiHeight).toHaveValue(height);
  const moved = (await csvResults(page))[0];
  expect(Number(moved.roi_x) + Number(moved.roi_width)).toBe(360);
  expect(Number(moved.roi_y) + Number(moved.roi_height)).toBe(112);
});

test("single-strip results remain readable on mobile without horizontal page overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole("button", { name: "试用示例", exact: true }).click();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const chart = page.getByRole("img", { name: "单条带相对强度", exact: true });
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect((await chart.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("single-mobile-results.png"),
    fullPage: true,
  });
});
