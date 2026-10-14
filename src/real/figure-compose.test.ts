import { describe, expect, it } from "vitest";
import { buildComposedFigureSvg } from "./figure-compose";
import type { LaneRegion } from "./pixels";

const regions: LaneRegion[] = [
  {
    lane: 1,
    band: { x: 10, y: 20, width: 40, height: 16 },
    background: { x: 10, y: 44, width: 40, height: 6 },
    source: "manual",
  },
];
const base = {
  layout: "side-by-side" as const,
  imageHref: "data:image/png;base64,AAAA",
  imageWidth: 400,
  imageHeight: 200,
  regions,
  laneLabels: ["NC <a>", "siX"],
  chartSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500"><g id="chart">BODY</g></svg>',
  captionLines: ["Background: rolling ball r=50 (imagej1-rolling-ball-1)", "Normalization: matched-control"],
};

describe("composed figure assembly", () => {
  it("assembles a self-contained SVG with image panel, nested chart, and captions", () => {
    const svg = buildComposedFigureSvg(base);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('viewBox="0 0 900 500"');
    expect(svg).toContain("BODY");
    expect(svg).not.toContain('width="900"'); // chart root attributes stripped
    expect(svg).toContain("rolling ball r=50");
    // band box scaled into the half-width panel (652/400 = 1.63)
    expect(svg).toContain('x="40.30"');
    // lane label XML-escaped
    expect(svg).toContain("NC &lt;a&gt;");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("stacks vertically with different total height than the side-by-side layout", () => {
    const side = buildComposedFigureSvg(base);
    const stacked = buildComposedFigureSvg({ ...base, layout: "stacked" });
    const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)![1]);
    expect(height(stacked)).toBeGreaterThan(height(side));
  });

  it("rejects remote image hrefs and invalid chart input", () => {
    expect(() =>
      buildComposedFigureSvg({ ...base, imageHref: "blob:local" }),
    ).toThrow(/data URL/);
    expect(() =>
      buildComposedFigureSvg({ ...base, chartSvg: "<div>no</div>" }),
    ).toThrow(/chart/);
    expect(() => buildComposedFigureSvg({ ...base, imageWidth: 0 })).toThrow();
  });
});
