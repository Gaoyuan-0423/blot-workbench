import { mkdir, writeFile } from "node:fs/promises";
import {
  createExampleProject,
  exportProject,
  exportCsv,
  updateAnalysis,
} from "../src/core/index";
import { getFixtures } from "../src/core/fixtures";
import { unzipSync } from "fflate";

// Stable demonstration identity and dates; not a recorded laboratory experiment.
let project = await createExampleProject();
project.id = "00000000-0000-4000-8000-000000000001";
project.createdAt = project.updatedAt = "2026-10-10T00:00:00.000Z";
const directory = "public/examples";
await mkdir(`${directory}/images`, { recursive: true });
for (const fixture of getFixtures())
  await writeFile(`${directory}/images/${fixture.image.id}.png`, fixture.png);
const archive = new Uint8Array(
  await (await exportProject(project)).arrayBuffer(),
);
await writeFile(`${directory}/example.wbproj.zip`, archive);
await writeFile(
  `${directory}/manifest.json`,
  unzipSync(archive)["manifest.json"],
);
// This second file is an expected output after manually reviewing every eligible pair.
for (const image of project.images) {
  if (image.qc !== "saturated")
    project = updateAnalysis(project, image.id, { status: "confirmed" });
}
await writeFile(`${directory}/example-results.csv`, exportCsv(project));
await writeFile(
  `${directory}/README.md`,
  `# Synthetic demonstration / 合成演示\n\nVersion 0.1.0-alpha.1. Not validated for research. All images were generated in this repository. No laboratory data.\n\n- example.wbproj.zip: open in Blot Workbench; all analyses start unreviewed.\n- manifest.json: project metadata, samples, ROI rectangles, template snapshots and image SHA-256 checksums.\n- images/: original 8-bit grayscale PNG fixtures, 720 × 280 px, 8 images.\n- example-results.csv: expected DEMO output after manually confirming all seven eligible images. Three target/reference pairs produce 18 rows. Saturated a-target-4000 has no result. Each row is a measurement; the same six experimental units recur across batches/exposures.\n\nThe fixed values describe the default synthetic configuration, not arbitrary uploaded images or changed ROIs. Source: src/core/fixtures.ts; regeneration: npm run examples. PNG byte checksums are stable. Project archives may differ in ZIP timestamps; compare manifest and assets.\n\n这些是交互示例，不是独立算法真值集。CSV 必须在目标及内参均确认后才能导出，不能把 18 行当成 18 个独立样本。图片内不写入水印以保留像素演示；文件夹、项目元数据、页面及 CSV 持续标注 SYNTHETIC/DEMO。\n`,
);
console.log(
  `Generated ${getFixtures().length} synthetic PNG fixtures, project archive, manifest, and 18-row DEMO CSV.`,
);
