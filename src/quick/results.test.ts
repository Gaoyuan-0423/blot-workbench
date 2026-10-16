import { describe, expect, it } from "vitest";
import { csvCell, relativeSignals, resultCsv } from "./results";
const signals = (values: (number | null)[]) =>
  values.map((net, i) => ({
    id: String(i),
    raw: net ?? 0,
    background: 0,
    net,
  }));
describe("relative intensity", () => {
  it("normalizes to the selected lane and optional matched reference", () => {
    expect(relativeSignals(signals([100, 200, 300]), null, 1)).toEqual([
      0.5, 1, 1.5,
    ]);
    expect(
      relativeSignals(signals([100, 200, 300]), signals([10, 40, 30]), 0),
    ).toEqual([1, 0.5, 1]);
  });
  it("never fills missing references, mismatched counts, or invalid controls", () => {
    expect(relativeSignals(signals([100, 200]), signals([10]), 0)).toEqual([
      null,
      null,
    ]);
    expect(
      relativeSignals(signals([100, 200]), signals([10, null]), 0),
    ).toEqual([1, null]);
    expect(relativeSignals(signals([null, 200]), null, 0)).toEqual([
      null,
      null,
    ]);
    expect(
      relativeSignals(signals([100, 200]), signals([10, Infinity]), 0),
    ).toEqual([1, null]);
    expect(relativeSignals(signals([100, NaN]), null, 0)).toEqual([1, null]);
    expect(
      relativeSignals(signals([Number.MIN_VALUE, Number.MAX_VALUE]), null, 0),
    ).toEqual([1, null]);
  });
  it("quotes filenames safely in spreadsheet exports", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("  =1+1")).toBe('"\'  =1+1"');
    expect(csvCell("\n@SUM(1,2)")).toBe('"\'\n@SUM(1,2)"');
  });
});

function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && char === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  const [header, ...body] = rows;
  return body.map((values) =>
    Object.fromEntries(header.map((key, i) => [key, values[i]])),
  );
}

function exportInput(): Parameters<typeof resultCsv>[0] {
  const target = [
    { id: "a", raw: 500, background: 100, net: 400 },
    { id: "b", raw: 900, background: 100, net: 800 },
  ];
  const reference = [
    { id: "a", raw: 200, background: 100, net: 100 },
    { id: "b", raw: 300, background: 100, net: 200 },
  ];
  return {
    file: "target.png",
    protein: "Target",
    polarity: "dark",
    labels: ["Control", "Treatment"],
    control: 0,
    bands: target.map((s, i) => ({
      id: s.id,
      rect: { x: 10 + 30 * i, y: 12, width: 20, height: 8 },
      background: { x: 10 + 30 * i, y: 2, width: 20, height: 8 },
    })),
    signals: target,
    reference,
    referenceFile: "reference.png",
    referenceProtein: "Actin",
    values: [1, 1],
    rowY: 100,
    referenceBands: reference.map((s, i) => ({
      id: s.id,
      rect: { x: 16 + 30 * i, y: 18, width: 18, height: 7 },
      background: { x: 16 + 30 * i, y: 4, width: 18, height: 7 },
    })),
    referenceRowY: 300,
    referencePolarity: "light",
    warnings: ["Automatic row detection requires review"],
  };
}

describe("CSV measurement traceability", () => {
  it("exports both image measurements, polarities and original-image coordinates", () => {
    const csv = resultCsv(exportInput());
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const [first, second] = parseCsv(csv);
    expect(first).toMatchObject({
      source: "target.png",
      protein: "Target",
      lane: "Control",
      control_lane: "Control",
      polarity: "dark",
      raw_signal: "500",
      background_signal: "100",
      net_signal: "400",
      relative_value: "1",
      roi_x: "10",
      roi_y: "112",
      roi_width: "20",
      roi_height: "8",
      reference_source: "reference.png",
      reference_protein: "Actin",
      reference_polarity: "light",
      reference_raw_signal: "200",
      reference_background_signal: "100",
      reference_net_signal: "100",
      reference_roi_x: "16",
      reference_roi_y: "318",
      reference_roi_width: "18",
      reference_roi_height: "7",
      status: "UNREVIEWED_PIXEL_ESTIMATE",
      warnings: "Automatic row detection requires review",
    });
    expect(JSON.parse(first.background_roi)).toEqual({
      x: 10,
      y: 102,
      width: 20,
      height: 8,
    });
    expect(JSON.parse(first.reference_background_roi)).toEqual({
      x: 16,
      y: 304,
      width: 18,
      height: 7,
    });
    expect(second.reference_roi_x).toBe("46");
    expect(second.reference_net_signal).toBe("200");
  });

  it("retains reference failures and global warnings without presenting invalid ratios as results", () => {
    const input = exportInput();
    input.reference![1] = {
      id: "b",
      raw: 25,
      background: null,
      net: null,
      warning: "Missing background",
    };
    input.values = [1, 99]; // A stale UI result must not survive an invalid reference.
    const [, second] = parseCsv(resultCsv(input));
    expect(second.reference_raw_signal).toBe("25");
    expect(second.reference_background_signal).toBe("");
    expect(second.reference_net_signal).toBe("");
    expect(second.relative_value).toBe("");
    expect(second.reference_warning).toBe("Missing background");
    expect(second.warnings).toContain(
      "Automatic row detection requires review",
    );
    expect(second.warnings).toContain("Reference: Missing background");
    expect(second.note).toContain("Relative value unavailable");
    input.reference = input.reference!.slice(0, 1);
    const unmatched = parseCsv(resultCsv(input));
    expect(unmatched.map((row) => row.relative_value)).toEqual(["", ""]);
    expect(unmatched[1].reference_roi_y).toBe("");
    expect(unmatched[0].warnings).toContain(
      "Reference lane count does not match",
    );
  });

  it("keeps optional reference metadata blank and defaults a supplied reference crop offset to zero", () => {
    const input = exportInput();
    delete input.referenceRowY;
    delete input.referencePolarity;
    delete input.warnings;
    expect(parseCsv(resultCsv(input))[0]).toMatchObject({
      reference_roi_y: "18",
      reference_polarity: "",
      warnings: "",
    });
    delete input.referenceBands;
    expect(parseCsv(resultCsv(input))[0]).toMatchObject({
      reference_roi_y: "",
      warnings: "Reference ROI metadata unavailable",
    });
    input.reference = null;
    expect(parseCsv(resultCsv(input))[0]).toMatchObject({
      reference_raw_signal: "",
      reference_net_signal: "",
      reference_roi_y: "",
      reference_background_roi: "",
    });
  });

  it("escapes formulas, commas, quotes and line breaks in user-supplied export fields", () => {
    const input = exportInput();
    input.file = '=HYPERLINK("https://example.invalid","x")';
    input.labels[0] = "  +SUM(1,2)";
    input.referenceFile = "@SUM(1,2)";
    input.referenceProtein = 'Actin,"control"\nsecond line';
    input.warnings = ["=1+1"];
    const [row] = parseCsv(resultCsv(input));
    expect(row.source).toBe(`'${input.file}`);
    expect(row.lane).toBe(`'${input.labels[0]}`);
    expect(row.reference_source).toBe(`'${input.referenceFile}`);
    expect(row.reference_protein).toBe(input.referenceProtein);
    expect(row.warnings).toBe("'=1+1");
  });
});
