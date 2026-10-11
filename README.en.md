# Blot Workbench / 印迹工作台

[中英首页 / Bilingual home](README.md) · [Live demo](https://gaoyuan-0423.github.io/blot-workbench/) · [User guide](docs/user-guide.en.md) · [Vision API guide](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/vision-api.en.md) · [Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues)

A Western blot project workbench for laboratories. The first step is to make image organization, sample relationships, review, and returning to unfinished work easier, before validating experimental-image quantification.

## Versions and boundaries

**Development version: `0.2.0-dev.1`.** Adds configurable local vision API access, a built-in synthetic-image interface check, and a standalone bilingual user guide. It has not replaced the public website or released downloads.

**Published version: `0.1.0-alpha.1`, dated 2026-10-10.** The [live demonstration](https://gaoyuan-0423.github.io/blot-workbench/) needs no installation. Its fixed archive and build evidence are in the [alpha Release](https://github.com/Gaoyuan-0423/blot-workbench/releases/tag/v0.1.0-alpha.1).

Development features remain on the [`codex/configurable-vision-api` branch](https://github.com/Gaoyuan-0423/blot-workbench/tree/codex/configurable-vision-api) and are not merged into the main application. Updating this bilingual repository homepage does not replace the deployed app.

**Neither version imports real TIFF/PNG images or performs scientific quantification. Demonstration values come from fixed synthetic images and preset regions; editing an ROI does not remeasure it. Do not use these values for experimental conclusions or publication quantification.**

![Blot Workbench synthetic-data demonstration](docs/screenshots/app-home.jpg)

The screenshot shows the released demonstration. See the [screenshot record](docs/screenshots/README.md) for version and environment evidence; a screenshot does not establish algorithm accuracy or cross-platform compatibility.

## What you can explore

- Organize dates, batches, membranes, target/reference images, and exposures within one project. A project is not a single experiment.
- Inspect samples, groups, and experimental units without treating image count as independent sample count.
- Review band/background ROIs, reference pairing, and exclusions; see how changes invalidate existing illustrative results.
- Reuse templates while preserving analysis-time snapshots and revisions.
- Inspect preset background correction and normalization, export projects/CSV, and resume saved work.
- Switch between Chinese and English. In the development version, configure a vision service and explicitly test it with the built-in synthetic image.

The demonstration contains **8 synthetic images, 2 batches, a target and reference at 2 exposures, and the same 6 samples representing 6 experimental units across batches**. Repeated exposures or loading do not increase independent sample count. See [demo boundaries](docs/demo-boundary.md).

## Guides and first use

In the development version, select **User guide / 使用教程** in the sidebar to open the standalone `#guide` page. It follows the top-right **EN / 中文** language switch. You can also append `#guide` to the local app URL. The published `0.1` site does not yet include this new entry; use the repository guides:

- [User guide](docs/user-guide.en.md): projects, review, templates, results, recovery, and export. [中文](docs/user-guide.md)
- [Vision API guide](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/vision-api.en.md): local setup, credentials, the synthetic test, and its limitations. [中文](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/vision-api.md)

For a first walkthrough, load the example, check samples and exposures, review ROIs/reference pairing, confirm eligible images, inspect results, then export and reopen the project. Change an ROI or pairing to observe stale results; this does not trigger fresh quantification.

Download the [example project](public/examples/example.wbproj.zip), [expected results CSV](public/examples/example-results.csv), and [manifest](public/examples/manifest.json). The archive starts unreviewed. The CSV contains the expected output after confirming all 7 eligible images: 3 target/reference pairs × 6 samples = 18 rows. The saturated image produces no valid result; 18 rows do not mean 18 independent samples. [Example file notes](public/examples/README.md)

## Not implemented

Real TIFF/PNG decoding and quantification, validated high-bit-depth processing, automatic band detection on experimental images, batch automation, statistical tests, publication figure composition, immunofluorescence analysis, desktop installers, and Wisp Science integration are future work. A vision API returning 6 candidates does not establish correct localization or scientific accuracy.

See the [architecture and roadmap](docs/architecture.md) and [batch automation design](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/automation-design.md). The latter describes unimplemented behavior, not an available workflow.

## Local use and development

These API and new-guide instructions apply only to the development branch; they are not a desktop installer. Use Git and Node.js 22.12 or a newer compatible version. The same commands work in Windows and macOS terminals. From your cloned repository, switch to the development branch before starting:

```sh
git fetch origin
git switch codex/configurable-vision-api
npm ci
npm run local
```

Open the printed loopback address, default `http://127.0.0.1:4318`. The standalone guide is at `http://127.0.0.1:4318/#guide`. Press `Ctrl+C` to stop. `npm run dev` starts the frontend only, **without the vision API service**. Do not open `index.html` directly.

To preview a build locally with the API:

```sh
npm run build
npm run local:preview
```

Verification commands:

```sh
npm run check
npm run test:scripts
npm run test:e2e
npm run test:vision:e2e
```

Browser tests require the environment matching the project's Playwright version. These commands do not claim that tests have run. Consult the [released-demo validation](docs/validation.md) and [development API validation](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/validation-vision-api.md) separately; evidence applies to the recorded commit and environment. Passing workflow tests does not validate scientific quantification.

## Data and privacy

Projects are processed in the browser, which holds one current workspace. Creating a project, loading the example, or importing another archive replaces it. Export work you want to keep first. Browser storage is not a backup: clearing site data, changing browsers/origins, or private browsing may make saved work unavailable. The hosted site and local server do not synchronize.

GitHub Pages serves the online page, scripts, and synthetic examples, so opening the site makes network requests. The optional development API test sends only the built-in synthetic PNG and prompt to your configured service, **not current project data or experimental images**. The local service holds the key only in memory; it is not returned, persisted in browser storage, or exported with projects. Restarting clears configuration. Providers may charge for requests; a local timeout or cancellation does not guarantee remote billing stops. See [privacy](docs/privacy.md) and the [API guide](https://github.com/Gaoyuan-0423/blot-workbench/blob/codex/configurable-vision-api/docs/vision-api.en.md).

ROI, pairing, or analysis-parameter changes invalidate prior illustrative results. Updating a template must not silently alter existing analysis snapshots. Numerical correctness and experimental-image reliability require separate validation. See [methods](docs/methods.md).

## Contributing and citation

Report reproducible problems through [GitHub Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues), including the exact version, operating system/browser, steps, and expected behavior. Prefer the built-in example. Do not post unauthorized experimental images, private sample information, or API keys. Read [Contributing](CONTRIBUTING.md).

The software uses the [MIT license](LICENSE). Cite the version and commit actually used; [CITATION.cff](CITATION.cff) describes the published version, not the development branch. There is no software paper or DOI. Open source, automation, and project saving are not claimed as unique innovations; see [related work](docs/methods.md#相关工作).

[Changelog](CHANGELOG.md) · [Released version notes](docs/releases/v0.1.0-alpha.1.md) · [Publication record](docs/publishing-plan.md) · [Documentation index](docs/README.md)
