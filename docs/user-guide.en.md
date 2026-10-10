# User guide

Applies to `0.1.0-alpha.1`. All images and numbers are synthetic demonstration material. Confirming an item records a workflow review; it does not certify scientific validity.

## 1. Open a project

Start the local server as described in the [README](../README.en.md#local-use-and-development) and open its printed address. No hosted demo is available. On first opening, the page loads the built-in example; on later visits it attempts to restore the current workspace. Use **Open project** to import a `.wbproj.zip` archive exported by this version. **Project import does not support arbitrary TIFF/PNG images.**

Only one workspace is stored in the browser. Creating a project, loading the example, or importing another project replaces it. Use **Export project** first to preserve your work. An empty project demonstrates the entry point; real images cannot yet be added.

After selecting a valid archive, the app validates it and opens **Replace the current workspace?** without replacing anything immediately. Choose **Export current project**, **Cancel**, or **Import project** to confirm the replacement. A corrupt or invalid archive produces an error and leaves the current workspace unchanged.

A project spans dates and batches. The example's 2 batches and 8 images belong to one project. Inspect its description and outstanding review items before opening an image.

## 2. Check sample relationships

Review groups, samples, and experimental units for each lane. There are 6 samples representing 6 experimental units; the later batch reuses the same samples. Reloading a sample or capturing another exposure does not create an independent experimental unit.

Group labels organize data; they do not choose a statistical test. Dates are batch attributes. This demonstration does not calculate inferential statistics or significance.

Sample and project names are committed and saved after a pause in typing; you do not need to click elsewhere first. A blank required name is not saved and reverts to its previous valid value when focus leaves the field. Review notes may be empty.

## 3. Review images and regions

Select a batch and image, then check its target/reference role, membrane, and exposure. Inspect the band and background regions. Weak-band, uneven-background, and saturation labels are authored scenario labels, not automated detection results.

Saturated image `a-target-4000` never provides valid example results, even if its exclusion flag is cleared; it cannot be confirmed or exported as quantification.

After changing a region of interest (ROI), the analysis should become stale. Its previous illustrative numbers must not remain valid current results. Moving an ROI does not run pixel integration in this version.

Check target/reference pairing using sample identity, membrane, and experimental context. Matching lane numbers alone is insufficient. Leave uncertain items unconfirmed or exclude them with a reason.

## 4. Reuse a template

A template supplies starting settings. Each analysis retains its own template version and snapshot; editing the current template must not silently change older analyses. Reapplying it is an explicit analysis change that requires another review.

Saving unchanged template values, applying an identical snapshot, or restoring an already unchanged example/state does not create extra revisions. A real status change still creates a revision.

Batch reuse can reduce repeated setup. It does not replace checking band positions, saturation, and pairing in individual images.

## 5. Inspect illustrative results

Explore sums for the fixed synthetic images and default regions, background correction, target/reference ratios, and relative values. These are preset `DEMO` fixtures. See their origin and limitations in [methods](methods.md).

Before CSV export, use **Confirm review** for both a target and its paired reference. Both must still match the example settings. Unconfirmed, excluded, or stale records do not produce valid export rows. Changes to a reference also affect its paired targets.

The downloadable project archive starts with all analyses unreviewed. Its companion `example-results.csv` shows the expected output after reviewing all 7 eligible images: 18 rows from 3 target/reference pairs and 6 samples. It is not the immediately exportable state of the archive. The same 6 experimental units occur across these rows; row count does not determine independent n.

Excluded or stale analyses must not be represented as current valid results. If settings no longer match the demonstration fixture, retain them to discuss the workflow, or reload the original example to inspect its preset numbers. Do not interpret these as recalculated measurements.

## 6. Save, export, and return

Changes are saved automatically in the browser. Notes, sample names, and project names are committed after a pause in typing without requiring the field to lose focus. The top bar shows **Saving** until the content is written to browser storage. Wait for **Saved locally** before refreshing or leaving. Leaving while a save is pending triggers the browser's confirmation prompt; choose to stay and wait for the save.

Export a project archive for long-term backup and migration. The archive preserves images, ROIs, pairing, and parameter snapshots; a CSV contains only tabular results and is not a project backup.

Return to the same origin in the same browser to inspect the restored project, selected image, and analysis status, or import an exported archive. Start by reviewing outstanding and stale items and notes.

Browser storage is tied to the browser and site origin. Private browsing, clearing site data, or changing browsers or domains can make previous work unavailable. Use an archive for migration and backup.

## Report a problem

Include the application version, operating system, browser version, reproduction steps, expected behavior, and actual behavior. Prefer reproducing with the built-in example. Remove private sample names, local paths, and unpublished data from screenshots. Use the [report template](../.github/ISSUE_TEMPLATE/bug_report.md) and submit through [GitHub Issues](https://github.com/Gaoyuan-0423/blot-workbench/issues).
