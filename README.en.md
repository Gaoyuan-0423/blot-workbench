# Blot Workbench / 印迹工作台

[中文](README.md) · [Live demo](https://gaoyuan-0423.github.io/blot-workbench/) · [GitHub repository](https://github.com/Gaoyuan-0423/blot-workbench) · [User guide](docs/user-guide.en.md) · [Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues)

A Western blot project workbench for laboratories. The first step is to make image organization, sample relationships, review, and returning to unfinished work easier, before validating experimental-image quantification.

**Version `0.1.0-alpha.1` is a browser demonstration with synthetic data. Numbers are fixed example measurements for the synthetic images and their preset regions; edits do not run fresh quantification. Real TIFF/PNG import is not implemented. This version must not be used for experimental conclusions or publication quantification.**

**[Open the live demo](https://gaoyuan-0423.github.io/blot-workbench/)** without installing software. Version date: 2026-10-10. See the [alpha prerelease record](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1) for the version archive and final build evidence. Local startup instructions are also available below.

![Blot Workbench browser demonstration](docs/screenshots/app-home.jpg)

See the [screenshot record](docs/screenshots/README.md) for version and environment evidence. A screenshot is not evidence of algorithm accuracy or cross-platform compatibility.

## What you can explore

- Organize batches, membranes, target/reference images, and exposures within one project.
- Inspect samples, groups, and experimental units without treating image count as independent sample count.
- Review band/background ROIs, reference pairing, and exclusions; see how changes invalidate existing illustrative results.
- Preserve analysis-time template snapshots and explore template revisions.
- Inspect preset background correction, target/reference ratios, relative values, project recovery, and exports.
- Switch between Chinese and English.

The demonstration contains **8 synthetic images, 2 batches, a target and reference at 2 exposures, and the same 6 samples representing 6 experimental units across the batches**. These are not 12 or 48 independent biological replicates. See [demo boundaries](docs/demo-boundary.md).

## Try the workflow

1. Open the [live demo](https://gaoyuan-0423.github.io/blot-workbench/). The first visit loads the built-in example. To run it on your own machine, follow [local startup](#local-use-and-development).
2. Select an image and review ROIs, exposure, sample assignments, and reference pairing.
3. Change an ROI or a pairing and inspect the resulting stale state. This does not trigger scientific quantification.
4. Save and export the project, then reload the page or import the archive to inspect recovery.

Download the [example project](public/examples/example.wbproj.zip), [illustrative results CSV](public/examples/example-results.csv), and [example manifest](public/examples/manifest.json). All examples are synthetic; see their provenance and limitations in [demo boundaries](docs/demo-boundary.md).

The archive starts with unreviewed analyses. The example CSV is the expected output after confirming all 7 eligible images: 3 target/reference pairs × 6 samples = 18 rows. The saturated image produces no result; 18 measurement rows do not mean 18 independent samples. [Example file notes](public/examples/README.md)

Browser storage holds one current workspace. Creating a project, loading the example, or importing an archive replaces it; export work you want to keep first. Clearing site data, changing browsers or origins, and private browsing can make saved work unavailable. Local storage is not a backup. [Full user guide](docs/user-guide.en.md)

## Not implemented in this alpha

Real TIFF/PNG import and quantification, validated high-bit-depth processing, automatic band detection, statistical tests, publication figure composition, immunofluorescence analysis, desktop installers, and Wisp Science integration are future work. See the [architecture and roadmap](docs/architecture.md).

The [M1 main-branch CI run](https://github.com/Gaoyuan-0423/blot-workbench/actions/runs/38060883807) passed 18 core tests, 12 script tests, and 7 end-to-end tests in each of four combinations: Windows/macOS × Chrome/Edge. These checks cover the demonstration workflow, not scientific quantification accuracy or unrecorded browsers. See the [validation record](docs/validation.md) for environments and commits.

## Data and methods

Project state is processed and saved in the browser. There is no account or image-upload service. GitHub Pages serves the online page, scripts, and synthetic examples, so the browser requests those static assets from the hosting provider. Local computation does not mean that visiting the page makes no network requests. See [privacy](docs/privacy.md).

Changes to ROIs, pairing, or analysis parameters must invalidate prior illustrative results. Updating a template must not silently alter an existing analysis snapshot. This version supports discussion of these workflow and data-model decisions; numerical correctness and experimental-image reliability require separate validation. See [methods](docs/methods.md).

## Local use and development

These are developer instructions, not a desktop installer. Use Node.js 22.12 or a newer compatible version. The same commands work in Windows and macOS terminals; run them from the project directory:

```sh
npm ci
npm run dev
```

The development server listens on the local machine. Open the address printed in the terminal, usually `http://127.0.0.1:5173`, and press `Ctrl+C` to stop. Opening `index.html` directly is not a substitute for the server.

Build and verification commands:

```sh
npm run check
npm run test:e2e
```

After building, `npm run preview` serves the build locally at the printed address. It does not publish the application.

End-to-end tests require the browser environment matching the project's Playwright version. Listing a command does not claim that it has passed on any operating system. See the [validation record](docs/validation.md).

## Contributing and citation

We welcome reproducible reports about the workflow, recovery, and terminology through [GitHub Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues). Read [CONTRIBUTING.md](CONTRIBUTING.md). Do not post experimental images or sample information publicly without permission.

The software is distributed under the [MIT license](LICENSE). Cite the exact version using [CITATION.cff](CITATION.cff). There is no software paper or DOI at present. Open source, automation, and project saving are not claimed as unique innovations; related tools are linked in [methods](docs/methods.md#相关工作).

[Changelog](CHANGELOG.md) · [Release notes](docs/releases/v0.1.0-alpha.1.md) · [Publication and reproducibility](docs/publishing-plan.md) · [Documentation index](docs/README.md)
