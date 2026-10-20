import { beforeAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { encode } from "fast-png";
import { strFromU8, unzipSync } from "fflate";
import {
  createRealProject,
  importRealImages,
  updateRealImage,
  type RealProject,
} from "./model";
import {
  buildPublicationSvg,
  buildSourceDataHtml,
  createPublicationRow,
  defaultPublication,
  exportPublicationBundle,
  publicationPreflight,
} from "./publication";

beforeAll(() => {
  if (!globalThis.crypto?.subtle)
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
});

async function fixture(): Promise<RealProject> {
  let project = await importRealImages(
    createRealProject("Test <fig> & report"),
    [0, 1, 2].map((seed) => ({
      name: `Protein_${seed + 1}.png`,
      bytes: encode({
        width: 600,
        height: 100,
        depth: 16,
        channels: 1,
        data: new Uint16Array(600 * 100).fill(18000 + seed),
      }),
    })),
  );
  project = updateRealImage(project, project.images[0].id, {
    protein: '<script>alert("protein")</script>',
    membrane: "M1",
    regions: [
      {
        lane: 1,
        band: { x: 30, y: 20, width: 40, height: 20 },
        background: { x: 30, y: 60, width: 40, height: 20 },
        source: "manual",
      },
      {
        lane: 2,
        band: { x: 350, y: 20, width: 30, height: 20 },
        background: { x: 350, y: 60, width: 30, height: 20 },
        source: "manual",
      },
    ],
  });
  project = updateRealImage(project, project.images[2].id, { excluded: true });
  return project;
}

describe("publication exports", () => {
  it("starts with no figure rows and preserves all sources including excluded originals", async () => {
    const project = await fixture();
    const settings = defaultPublication(project);
    expect(settings.title).toBe(project.name);
    expect(settings.rows).toEqual([]);
    expect(settings.sources.map((source) => source.imageId)).toEqual(
      project.images.map((image) => image.id),
    );
    expect(
      settings.sources.every((source) => source.kind === "unspecified"),
    ).toBe(true);
    const row = createPublicationRow(project, project.images[0].id);
    expect(row).toMatchObject({
      panel: "A",
      molecularWeight: "",
      imageId: project.images[0].id,
    });
    expect(row.crop).toEqual({ x: 24, y: 14, width: 362, height: 32 });
    expect(createPublicationRow(project, project.images[1].id).crop).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 100,
    });
  });

  it("computes DPI from crop pixels and actual image width, independently of output metadata", async () => {
    const project = await fixture();
    const settings = defaultPublication(project);
    const row = createPublicationRow(project, project.images[1].id);
    settings.rows.push(row);
    settings.widthMm = 80;
    expect(
      publicationPreflight(project, settings).some(
        (issue) => issue.code === "LOW_EFFECTIVE_DPI",
      ),
    ).toBe(true); // 600/(80*.66/25.4)=289
    settings.rows[0].crop.width = 600;
    settings.widthMm = 200;
    const issue = publicationPreflight(project, settings).find(
      (item) => item.code === "LOW_EFFECTIVE_DPI",
    )!;
    expect(issue.messageEn).toContain("115 effective DPI");
    expect(issue.rowId).toBe(row.id);
    settings.rows[0].crop = { x: 500, y: 0, width: 200, height: 30 };
    expect(
      publicationPreflight(project, settings).some(
        (item) =>
          item.code === "CROP_OUT_OF_BOUNDS" && item.severity === "error",
      ),
    ).toBe(true);
    expect(() => buildPublicationSvg(project, settings, "en")).toThrow();
    settings.rows[0].imageId = "missing";
    expect(
      publicationPreflight(project, settings).some(
        (item) => item.code === "ORIGINAL_MISSING",
      ),
    ).toBe(true);
  });

  it("escapes text, keeps physical sizing and original-coordinate lane spacing without mutating ROIs", async () => {
    const project = await fixture();
    const before = structuredClone(project);
    const settings = defaultPublication(project);
    const row = createPublicationRow(project, project.images[0].id);
    row.crop = { x: 0, y: 0, width: 600, height: 100 };
    row.molecularWeight = "55 <text>";
    settings.rows.push(row);
    const svg = buildPublicationSvg(project, settings, "en");
    expect(svg).toContain('width="180mm"');
    expect(svg).toContain('viewBox="0 0 1000 ');
    expect(svg).toContain("DRAFT");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("55 &lt;text&gt;");
    expect(svg).toContain(" kDa</tspan>");
    expect(svg).toContain('data-crop="{&quot;x&quot;:0');
    expect(svg).toContain('data-lane="1"><text x="265"');
    expect(svg).toContain('data-lane="2"><text x="611.5"');
    expect(svg).toContain(project.images[0].hash.slice(0, 12));
    expect(project).toEqual(before);
  });

  it("includes every complete original preview and explicit source/row mappings in script-free offline HTML", async () => {
    const project = await fixture();
    project.images[1] = {
      ...project.images[1],
      note: '<img src="https://bad.test/" onerror="evil()">',
    };
    const settings = defaultPublication(project);
    settings.sources[0].kind = "overlay";
    const row = createPublicationRow(project, project.images[0].id);
    settings.rows.push(row);
    const html = buildSourceDataHtml(project, settings, "en");
    for (const image of project.images) {
      expect(html).toContain(`data-image-id="${image.id}"`);
      expect(html).toContain(image.hash);
    }
    expect(html.match(/href="data:image\/png;base64,/g)).toHaveLength(3);
    expect(html).toContain("16-bit");
    expect(html).toContain("Overlay / target");
    expect(html).toContain("Excluded from quantification");
    expect(html).toContain(row.id);
    expect(html).toContain("project.realwb.zip");
    expect(html).toContain('viewBox="0 0 600 100"');
    expect(html).toContain('class="annotations"');
    expect(html).toContain("break-before:page");
    expect(html).toContain("All originals by experiment and membrane");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('<img src="https://');
    expect(html).toContain("&lt;img src=&quot;https://bad.test/");
  });

  it("packages original bytes unchanged with mappings and CSVs, including source-only exports", async () => {
    const project = await fixture();
    const settings = defaultPublication(project);
    settings.rows.push(createPublicationRow(project, project.images[0].id));
    settings.sources[0].kind = "ecl";
    const before = structuredClone(project);
    const blob = await exportPublicationBundle(project, settings, "en");
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "figure.svg",
      "project.realwb.zip",
      "provenance.json",
      "results.csv",
      "source-data.html",
      "statistics.csv",
    ]);
    const nested = unzipSync(files["project.realwb.zip"]);
    for (const image of project.images)
      expect(nested[`originals/${image.id}.png`]).toEqual(image.bytes);
    const metadata = JSON.parse(strFromU8(files["provenance.json"]));
    expect(metadata.publication).toEqual(settings);
    expect(metadata.images).toHaveLength(3);
    expect(metadata.images[0].sourceKind).toBe("ecl");
    expect(metadata.images[0].publicationRows).toEqual(settings.rows);
    expect(metadata.images[2].excluded).toBe(true);
    expect(strFromU8(files["results.csv"])).toContain("image_sha256");
    expect(strFromU8(files["statistics.csv"])).toContain(
      "exact_input_pairs_and_provenance_json",
    );
    expect(project).toEqual(before);
    const sourceOnly = unzipSync(
      new Uint8Array(
        await (
          await exportPublicationBundle(
            project,
            defaultPublication(project),
            "zh",
          )
        ).arrayBuffer(),
      ),
    );
    expect(sourceOnly["figure.svg"]).toBeUndefined();
    expect(sourceOnly["source-data.html"]).toBeDefined();
  });

  it("never pairs empty identifiers and labels multiple matching references as ambiguous candidates", async () => {
    let project = await fixture();
    project = {
      ...project,
      images: project.images.map((image, index) => ({
        ...image,
        replicate: "",
        membrane: "",
        excluded: false,
        role: index === 0 ? ("target" as const) : ("reference" as const),
      })),
    };
    let html = buildSourceDataHtml(project, defaultPublication(project), "en");
    expect(html).toContain("identifiers-missing: None");
    expect(html).not.toContain("ambiguous-candidates:");
    project = {
      ...project,
      images: project.images.map((image) => ({
        ...image,
        replicate: "E1",
        membrane: "M1",
      })),
    };
    html = buildSourceDataHtml(project, defaultPublication(project), "en");
    expect(html).toContain(`ambiguous-candidates: ${project.images[1].name}`);
    expect(html).toContain("do not establish a confirmed correct pairing");
  });

  it.each(["local", "rolling-ball"] as const)(
    "describes the actual %s measurement and shows only participating background overlays",
    async (kind) => {
      const base = await fixture();
      const project: RealProject = {
        ...base,
        backgroundCorrection:
          kind === "rolling-ball" ? { kind, radius: 20 } : { kind },
      };
      const settings = defaultPublication(project);
      const files = unzipSync(
        new Uint8Array(
          await (
            await exportPublicationBundle(project, settings, "en")
          ).arrayBuffer(),
        ),
      );
      const metadata = JSON.parse(strFromU8(files["provenance.json"]));
      const html = strFromU8(files["source-data.html"]);
      expect(html).toContain('stroke="#00866f"'); // band ROIs remain in both modes
      expect(metadata.intensityModel).toContain("RGB arithmetic channel mean");
      if (kind === "local") {
        expect(metadata.intensityModel).toContain(
          "dark net=area*backgroundMean-bandSum",
        );
        expect(metadata.intensityModel).not.toContain("Rolling-ball net=");
        expect(html).toContain('stroke="#2774b9"');
        expect(html).toContain("blue dashed: local backgrounds");
      } else {
        expect(metadata.intensityModel).toContain(
          "Rolling-ball net=sum(max-correctedPixel)",
        );
        expect(metadata.intensityModel).toContain(
          "sum(correctedPixel) for light bands",
        );
        expect(metadata.intensityModel).not.toContain(
          "net=area*backgroundMean-bandSum",
        );
        expect(metadata.intensityModel).toContain("quantized and clamped");
        expect(html).not.toContain('stroke="#2774b9"');
        expect(html).not.toContain("blue dashed:");
        expect(html).toContain("rolling-ball background surface");
        expect(html).toContain("not local background rectangles");
        expect(html).toContain(
          "stored local background coordinates remain only in the ROI records",
        );
      }
      expect(project.images[0].regions).toEqual(base.images[0].regions);
    },
  );
});
