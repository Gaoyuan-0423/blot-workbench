import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encode } from "fast-png";

// These inputs are independently drawn synthetic rasters with known intensities.
// They exercise the browser workflow, not accuracy on experimental Western blots.
const intensities = [200, 180, 160, 140, 120, 100];
type Point = { x: number; y: number };

function png(
  kind: "flat" | "multirow" | "tilted" | "curved" = "flat",
  shift = 0,
) {
  const width = kind === "tilted" || kind === "curved" ? 420 : 360;
  const height = kind === "flat" ? 112 : 200;
  const pixels = new Uint8Array(width * height).fill(240);
  const angle = (12 * Math.PI) / 180;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let px = x + 0.5,
        py = y + 0.5;
      if (kind === "tilted") {
        const dx = px - 210,
          dy = py - 100;
        px = 210 + dx * Math.cos(angle) + dy * Math.sin(angle);
        py = 100 - dx * Math.sin(angle) + dy * Math.cos(angle);
      }
      const start = kind === "tilted" || kind === "curved" ? 48 : 18;
      for (let lane = 0; lane < 6; lane++) {
        if (
          px < start + lane * 60 + shift ||
          px >= start + 24 + lane * 60 + shift
        )
          continue;
        const center =
          kind === "curved"
            ? 60 + Math.abs(px - 210) / 4
            : kind === "tilted"
              ? 100
              : 56;
        if (py >= center - 8 && py < center + 8)
          pixels[y * width + x] = intensities[lane];
        if (kind === "multirow" && py >= 130 && py < 146)
          pixels[y * width + x] = intensities[5 - lane];
      }
    }
  }
  return Buffer.from(
    encode({ width, height, data: pixels, channels: 1, depth: 8 }),
  );
}

function file(
  name: string,
  kind: Parameters<typeof png>[0] = "flat",
  shift = 0,
) {
  return { name, mimeType: "image/png", buffer: png(kind, shift) };
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...values] = rows;
  return values.map((cells) =>
    Object.fromEntries(headers.map((header, i) => [header, cells[i]])),
  );
}

async function ready(page: Page) {
  await page.goto("/?mode=single&lang=zh");
  await expect(
    page.getByRole("heading", { name: "单条带识别", exact: true }),
  ).toBeVisible();
}

async function csv(page: Page, language: "zh" | "en" = "zh") {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: language === "zh" ? "导出 CSV" : "Export CSV",
      exact: true,
    })
    .click();
  const download = await pending;
  return parseCsv(await readFile((await download.path())!, "utf8"));
}

async function previewPoint(page: Page, point: Point) {
  const preview = page.getByRole("img", {
    name: "单排条带取样预览",
    exact: true,
  });
  await preview.scrollIntoViewIfNeeded();
  return preview.evaluate((svg, p) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("Image preview has no screen transform");
    const screen = new DOMPoint(p.x, p.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, point);
}

async function pointAt(page: Page, points: Point[]) {
  for (const point of points) {
    const screen = await previewPoint(page, point);
    await page.mouse.click(screen.x, screen.y);
  }
}

async function crop(page: Page, start: Point, end: Point) {
  await page.getByRole("button", { name: "圈出一排", exact: true }).click();
  const first = await previewPoint(page, start),
    last = await previewPoint(page, end);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
}

async function adjustments(page: Page) {
  const details = page.locator(".single-adjust");
  if ((await details.getAttribute("open")) === null)
    await page.getByText("识别不准？调整取样", { exact: true }).click();
}

async function setAppearance(slider: Locator, end: "Home" | "End") {
  await slider.focus();
  await slider.press(end);
  expect(await slider.inputValue()).not.toBe("100");
  return slider.inputValue();
}

test("brightness, contrast, and original preview never alter source measurements or the exported CSV", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles(file("known-pixels.png"));
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const baseline = await csv(page);
  for (const [lane, row] of baseline.entries())
    expect(Number(row.net_signal)).toBe(24 * 16 * (40 + lane * 20));
  const values = await page.getByTestId(/^single-relative-/).allTextContents();
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  await setAppearance(
    page.getByRole("slider", { name: "显示亮度", exact: true }),
    "End",
  );
  await setAppearance(
    page.getByRole("slider", { name: "显示对比度", exact: true }),
    "Home",
  );
  expect(await page.getByTestId(/^single-relative-/).allTextContents()).toEqual(
    values,
  );
  expect(await csv(page)).toEqual(baseline);
  await page.getByRole("button", { name: "查看原图", exact: true }).click();
  expect(await csv(page)).toEqual(baseline);
});

test("appended exposures with identical filenames retain independent regions, controls, display settings, and exports", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles(file("same-name.png"));
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await adjustments(page);
  await page
    .getByRole("spinbutton", { name: "取样框 height", exact: true })
    .fill("8");
  await page
    .getByRole("combobox", { name: "对照泳道", exact: true })
    .selectOption("1");
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  const brightness = page.getByRole("slider", {
    name: "显示亮度",
    exact: true,
  });
  const firstBrightness = await setAppearance(brightness, "End");
  const first = await csv(page);
  expect(first[0].exposure_id).toBeTruthy();
  expect(new Set(first.map((row) => row.exposure_id)).size).toBe(1);
  await page
    .getByLabel("添加曝光图片", { exact: true })
    .setInputFiles(file("same-name.png", "flat", 6));
  const tabs = page.getByRole("tab", { name: "same-name.png", exact: true });
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await adjustments(page);
  await page
    .getByRole("spinbutton", { name: "取样框 height", exact: true })
    .fill("12");
  await page
    .getByRole("combobox", { name: "对照泳道", exact: true })
    .selectOption("2");
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  const secondBrightness = await setAppearance(brightness, "Home");
  const second = await csv(page);
  expect(second[0].exposure_id).toBeTruthy();
  expect(second[0].exposure_id).not.toBe(first[0].exposure_id);
  expect(new Set(second.map((row) => row.exposure_id)).size).toBe(1);
  expect(firstBrightness).not.toBe(secondBrightness);
  expect(first[0].roi_height).toBe("8");
  expect(second[0].roi_height).toBe("12");
  expect(first[0].control_lane).toBe("泳道 2");
  expect(second[0].control_lane).toBe("泳道 3");
  expect(first[0].roi_x).not.toBe(second[0].roi_x);
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  expect(await csv(page)).toEqual(first);
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  await expect(brightness).toHaveValue(firstBrightness);
  await tabs.nth(1).click();
  expect(await csv(page)).toEqual(second);
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  await expect(brightness).toHaveValue(secondBrightness);
});

test("two points straighten a tilted strip and leave six usable candidates", async ({
  page,
}, testInfo) => {
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles(file("tilted.png", "tilted"));
  await page.getByRole("button", { name: "拉直条带", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用校直", exact: true }),
  ).toBeDisabled();
  const angle = (12 * Math.PI) / 180;
  await pointAt(page, [
    { x: 210 - 180 * Math.cos(angle), y: 100 - 180 * Math.sin(angle) },
    { x: 210 + 180 * Math.cos(angle), y: 100 + 180 * Math.sin(angle) },
  ]);
  await page.getByRole("button", { name: "应用校直", exact: true }).click();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const rows = await csv(page);
  expect(rows).toHaveLength(6);
  const geometry = JSON.parse(rows[0].preparation);
  expect(geometry.rotationDegrees).toBeCloseTo(-12, 0);
  expect(geometry.straighten).toHaveLength(2);
  expect(geometry.sourceSize).toEqual({ width: 420, height: 200 });
  expect(geometry.measurement).toBe("original-8-bit-pixel-centers");
  for (const [lane, row] of rows.entries()) {
    expect(row.coordinate_space).toBe("prepared_pixels");
    expect(row.source_width).toBe("420");
    expect(row.source_height).toBe("200");
    expect(Number(row.source_pixel_area)).toBeGreaterThan(0);
    expect(Number(row.background_source_pixel_area)).toBeGreaterThan(0);
    expect(row.source).toBe("tilted.png");
    expect(Number(row.net_signal)).toBeGreaterThan(0);
    expect(Number(row.relative_value)).toBeCloseTo(1 + lane * 0.5, 1);
  }
  await page.screenshot({
    path: testInfo.outputPath("single-preparation-zh-desktop.png"),
    fullPage: true,
  });
});

test("a curved strip can be straightened with three landmarks", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles(file("curved.png", "curved"));
  await page.getByRole("button", { name: "拉直条带", exact: true }).click();
  await page.getByRole("button", { name: "弯曲校直", exact: true }).click();
  await pointAt(page, [
    { x: 30, y: 105 },
    { x: 210, y: 60 },
  ]);
  await expect(
    page.getByRole("button", { name: "应用校直", exact: true }),
  ).toBeDisabled();
  await pointAt(page, [{ x: 390, y: 105 }]);
  await page.getByRole("button", { name: "应用校直", exact: true }).click();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const rows = await csv(page);
  const geometry = JSON.parse(rows[0].preparation);
  expect(geometry.curve).toHaveLength(3);
  expect(geometry.sourceSize).toEqual({ width: 420, height: 200 });
  for (const [lane, row] of rows.entries()) {
    expect(row.coordinate_space).toBe("prepared_pixels");
    expect(Number(row.source_pixel_area)).toBeGreaterThan(0);
    expect(row.source).toBe("curved.png");
    expect(Number(row.net_signal)).toBeGreaterThan(0);
    expect(Number(row.relative_value)).toBeCloseTo(1 + lane * 0.5, 1);
  }
});

test("an imported multirow image can be cropped to one row in place and restored without stale measurements", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles(file("two-rows.png", "multirow"));
  await expect(page.getByRole("alert")).toContainText("多排");
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(0);
  await crop(page, { x: 3, y: 30 }, { x: 357, y: 85 });
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const rows = await csv(page);
  const geometry = JSON.parse(rows[0].preparation);
  expect(geometry.sourceSize).toEqual({ width: 360, height: 200 });
  // Pointer coordinates may round by one display pixel; the retained row and
  // source integral are the invariant, not a particular mouse rounding rule.
  expect(geometry.crop.y).toBeGreaterThanOrEqual(29);
  expect(geometry.crop.y).toBeLessThanOrEqual(31);
  expect(geometry.crop.y + geometry.crop.height).toBeLessThan(100);
  for (const [lane, row] of rows.entries()) {
    expect(row.coordinate_space).toBe("prepared_pixels");
    expect(row.source_width).toBe("360");
    expect(row.source_height).toBe("200");
    expect(row.source).toBe("two-rows.png");
    expect(Number(row.net_signal)).toBe(24 * 16 * (40 + lane * 20));
    expect(Number(row.relative_value)).toBeCloseTo(1 + lane * 0.5, 5);
  }
  await page.getByRole("button", { name: "恢复完整原图", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("多排");
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "导出 CSV", exact: true }),
  ).toHaveCount(0);
});

test("multiple import and preparation controls remain bilingual and usable on a phone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles([file("exposure-A.png"), file("exposure-B.png", "flat", 6)]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const values = await page.getByTestId(/^single-relative-/).allTextContents();
  await page.getByRole("button", { name: "显示调整", exact: true }).click();
  await setAppearance(
    page.getByRole("slider", { name: "显示亮度", exact: true }),
    "End",
  );
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.getByTestId(/^single-relative-/).allTextContents()).toEqual(
    values,
  );
  await expect(
    page.getByRole("slider", { name: "Display brightness", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Straighten strip", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select one row", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add exposure", exact: true }),
  ).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/[\u3400-\u9fff]/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const rows = await csv(page, "en");
  expect(rows).toHaveLength(6);
  expect(rows[0].source).toBe("exposure-A.png");
  await page.screenshot({
    path: testInfo.outputPath("single-preparation-en-mobile.png"),
    fullPage: true,
  });
});

test("a mixed valid and invalid import keeps usable exposures and retranslates errors without changing filenames", async ({
  page,
}) => {
  await ready(page);
  const damagedName = "损坏曝光.png";
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles([
      {
        name: damagedName,
        mimeType: "image/png",
        buffer: Buffer.from("invalid image bytes"),
      },
      file("有效曝光-A.png"),
      file("有效曝光-B.png", "flat", 6),
    ]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "有效曝光-A.png", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(damagedName);
  await expect(alert).toContainText("请选择有效的 8-bit PNG 或 JPEG 图片。");
  const values = await page.getByTestId(/^single-relative-/).allTextContents();
  await page.getByRole("button", { name: "切换到英文", exact: true }).click();
  await expect(alert).toContainText(damagedName);
  await expect(alert).toContainText("Choose a valid 8-bit PNG or JPEG image.");
  expect((await alert.innerText()).replace(damagedName, "")).not.toMatch(
    /[\u3400-\u9fff]/,
  );
  expect(await page.getByTestId(/^single-relative-/).allTextContents()).toEqual(
    values,
  );
  expect((await csv(page, "en"))[0].source).toBe("有效曝光-A.png");
  await page
    .getByRole("button", { name: "Switch to Chinese", exact: true })
    .click();
  await expect(alert).toContainText("请选择有效的 8-bit PNG 或 JPEG 图片。");
  await page.getByRole("tab", { name: "有效曝光-B.png", exact: true }).click();
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  expect((await csv(page))[0].source).toBe("有效曝光-B.png");
});

test("appending a slowly read exposure preserves changes made to the existing exposure while it loads", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel("导入单排条带图片", { exact: true })
    .setInputFiles(file("existing-exposure.png"));
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
  await adjustments(page);
  await page
    .getByRole("spinbutton", { name: "取样框 height", exact: true })
    .fill("8");
  const original = await csv(page);
  // Gate only the new file read. No timeout races or artificial delays are
  // needed: the test releases the read after a real user control change.
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    const gate = window as typeof window & { releaseExposureRead?: () => void };
    File.prototype.arrayBuffer = function () {
      if (this.name !== "slow-exposure.png") return read.call(this);
      return new Promise<ArrayBuffer>((resolve, reject) => {
        gate.releaseExposureRead = () => {
          void read.call(this).then(resolve, reject);
        };
      });
    };
  });
  await page
    .getByLabel("添加曝光图片", { exact: true })
    .setInputFiles(file("slow-exposure.png", "flat", 6));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as typeof window & { releaseExposureRead?: () => void }
          ).releaseExposureRead,
      ),
    )
    .toBe("function");
  await expect(page.getByRole("status")).toContainText("正在识别条带");
  await page
    .getByRole("combobox", { name: "对照泳道", exact: true })
    .selectOption("1");
  await expect(page.getByTestId("single-relative-2")).toHaveText("1×");
  await page.evaluate(() =>
    (window as typeof window & { releaseExposureRead?: () => void })
      .releaseExposureRead!(),
  );
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "slow-exposure.png", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("tab", { name: "existing-exposure.png", exact: true })
    .click();
  await expect(page.getByTestId("single-relative-2")).toHaveText("1×");
  const restored = await csv(page);
  expect(restored[0].exposure_id).toBe(original[0].exposure_id);
  expect(restored.every((row) => row.control_lane === "泳道 2")).toBe(true);
  expect(restored[0].roi_height).toBe("8");
  expect(restored.map((row) => row.net_signal)).toEqual(
    original.map((row) => row.net_signal),
  );
  expect(Number(restored[5].relative_value)).toBeCloseTo(3.5 / 1.5, 5);
});
