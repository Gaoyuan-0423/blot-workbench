# User guide

Applies to `0.1.0-alpha.1`. All images and numbers are synthetic demonstration material. Confirming an item records a workflow review; it does not certify scientific validity.

## 1. Open a project

Start the local server as described in the [README](../README.en.md#local-use-and-development) and open its printed address. No hosted demo is available. On first opening, the page loads the built-in example; on later visits it attempts to restore the current workspace. Use **Open project** to import a `.wbproj.zip` archive exported by this version. **Project import does not support arbitrary TIFF/PNG images.**

Only one workspace is stored in the browser. Creating a project, loading the example, or importing another project replaces it. Use **Export project** first to preserve your work. An empty project demonstrates the entry point; real images cannot yet be added.

A project spans dates and batches. The example's 2 batches and 8 images belong to one project. Inspect its description and outstanding review items before opening an image.

## 2. Check sample relationships

Review groups, samples, and experimental units for each lane. There are 6 samples representing 6 experimental units; the later batch reuses the same samples. Reloading a sample or capturing another exposure does not create an independent experimental unit.

Group labels organize data; they do not choose a statistical test. Dates are batch attributes. This demonstration does not calculate inferential statistics or significance.

## 3. Review images and regions

Select a batch and image, then check its target/reference role, membrane, and exposure. Inspect the band and background regions. Weak-band, uneven-background, and saturation labels are authored scenario labels, not automated detection results.

After changing a region of interest (ROI), the analysis should become stale. Its previous illustrative numbers must not remain valid current results. Moving an ROI does not run pixel integration in this version.

Check target/reference pairing using sample identity, membrane, and experimental context. Matching lane numbers alone is insufficient. Leave uncertain items unconfirmed or exclude them with a reason.

## 4. Reuse a template

A template supplies starting settings. Each analysis retains its own template version and snapshot; editing the current template must not silently change older analyses. Reapplying it is an explicit analysis change that requires another review.

Batch reuse can reduce repeated setup. It does not replace checking band positions, saturation, and pairing in individual images.

## 5. Inspect illustrative results

Explore sums for the fixed synthetic images and default regions, background correction, target/reference ratios, and relative values. These are preset `DEMO` fixtures. See their origin and limitations in [methods](methods.md).

Before CSV export, use **Confirm review** for both a target and its paired reference. Both must still match the example settings. Unconfirmed, excluded, or stale records do not produce valid export rows. Changes to a reference also affect its paired targets.

Excluded or stale analyses must not be represented as current valid results. If settings no longer match the demonstration fixture, retain them to discuss the workflow, or reload the original example to inspect its preset numbers. Do not interpret these as recalculated measurements.

## 6. Save, export, and return

Changes are saved automatically in the browser. Check the save status before leaving and export a project archive. The archive supports backup and migration. A CSV contains tabular results; it does not replace images, ROIs, pairing, or parameter snapshots.

Return to the same origin in the same browser to inspect the restored project, selected image, and analysis status, or import an exported archive. Start by reviewing outstanding and stale items and notes.

Browser storage is tied to the browser and site origin. Private browsing, clearing site data, or changing browsers or domains can make previous work unavailable. Use an archive for migration and backup.

## Report a problem

Include the application version, operating system, browser version, reproduction steps, expected behavior, and actual behavior. Prefer reproducing with the built-in example. Remove private sample names, local paths, and unpublished data from screenshots. There is no remote issue tracker yet; use the [local report template](../.github/ISSUE_TEMPLATE/bug_report.md) to prepare feedback for the maintainer.
