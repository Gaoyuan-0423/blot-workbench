# Synthetic demonstration / 合成演示

Version 0.1.0-alpha.1. Not validated for research. All images were generated in this repository. No laboratory data.

- example.wbproj.zip: open in Blot Workbench; all analyses start unreviewed.
- manifest.json: project metadata, samples, ROI rectangles, template snapshots and image SHA-256 checksums.
- images/: original 8-bit grayscale PNG fixtures, 720 × 280 px, 8 images.
- example-results.csv: expected DEMO output after manually confirming all seven eligible images. Three target/reference pairs produce 18 rows. Saturated a-target-4000 has no result. Each row is a measurement; the same six experimental units recur across batches/exposures.

The fixed values describe the default synthetic configuration, not arbitrary uploaded images or changed ROIs. Source: src/core/fixtures.ts; regeneration: npm run examples. PNG byte checksums are stable. Project archives may differ in ZIP timestamps; compare manifest and assets.

这些是交互示例，不是独立算法真值集。CSV 必须在目标及内参均确认后才能导出，不能把 18 行当成 18 个独立样本。图片内不写入水印以保留像素演示；文件夹、项目元数据、页面及 CSV 持续标注 SYNTHETIC/DEMO。
