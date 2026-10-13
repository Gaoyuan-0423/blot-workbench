# Real-image analysis guide

[中文](real-images.md) · [Synthetic example guide](user-guide.en.md)

`0.3.0-dev.2` adds a real-image project workspace at `#real`, also accessible through **Analyze real images** in the legacy example sidebar. This is a development preview. Independent laboratory validation, a fixed ImageJ comparison, and comprehensive instrument-format coverage are still pending. The public alpha website and existing downloads do not automatically update with the development branch.

## 1. Import and map files

Select or drop multiple TIFF/PNG files. Decoding runs locally; experimental images are not sent to a vision API. Original bytes, filenames, SHA-256 hashes, and image metadata are preserved. Preview pixels never replace decoded source arrays for measurement.

Initial support covers a subset of single-page, unsigned 8/16-bit grayscale or opaque RGB/RGBA images. Unsupported encodings, page counts, transparency, orientation, and oversized inputs are rejected rather than silently reduced to 8 bits. See the [validation record](validation-real-images.md) for exact coverage. RGB uses the documented grayscale conversion; this is not a multichannel fluorescence analysis tool.

Protein names and trailing numbers inferred from filenames are suggestions. Check protein, target/reference role, replicate, membrane, and exposure for every image. One project may contain multiple experiments. Additional exposures are not additional independent replicates; exclude unused exposures when pairing is ambiguous. Dates do not establish independence.

## 2. Describe lanes once

For a shared layout, enter sample labels from left to right, for example `NC, siRNA`, then apply them to the batch. Supported concise Chinese/English descriptions are converted into labels for review. This is a limited local parser, not unrestricted language understanding. Rewrite unrecognized text as an explicit ordered list.

You may enter `NC, siRNA, marker`; a trailing marker need not be present in every image. An extra marker on the right is not a sample and must not enter normalization or n. Automatic proposals find the requested candidates from left to right; inspect them for marker or nonspecific-band mistakes. Multiple band rows and touching lanes can defeat automatic localization.

Alternatively, select **explicit individual N/T pairs**. Enter one row as `source group ID, individual ID, N lane, T lane`, for example `group-1, individual-1, 1, 2`. Group IDs must match the image mapping table; target and reference images in a group share the individual table. Use distinct IDs for distinct individuals and reuse the same ID for repeated measurements across groups. Renaming a repeated measurement must not increase n. Preview the table before applying it; dates do not establish pairing.

Confirm independent experiments or distinct individuals, and the same-membrane, same-sample target/reference relationship before enabling experimental-design confirmation. Labels, image counts, and filename suffixes cannot establish biological independence.

## 3. Run automatically, adjust manually

Batch analysis proposes band and local-background rectangles. Inspect the overlay for each image and move or resize bands/backgrounds manually. Automatic proposals preserve manually modified regions by default.

Measurements use original decoded arrays. For dark bands, net signal is `band area × background mean − band pixel sum`; light bands reverse the sign. Nonpositive net signals are neither changed to zero nor used for a valid ratio. Band/background rectangles should not overlap, and backgrounds must represent local noise without other signal. Region edits trigger fresh calculations, invalidate related reviews, and preserve analysis history.

Pixels at the signal endpoint trigger clipping warnings. Exposure, processing, or export can cause this, so it is not definitive evidence of camera saturation. Conversely, no endpoint pixels does not prove a linear response. A review action cannot erase a pixel warning.

## 4. Normalize and plot

First compute `target net signal / reference net signal` for each valid lane. Target/reference images must share a source group, membrane, and sample, with unambiguous exposure selection. Then select a **Normalization baseline**:

- **Each matched control = 1** uses the unique `NC`, `control`, or 对照 lane in a shared layout, or each individual's N in an N/T design. Every pair is divided by its own control ratio. Controls become 1 by definition, not because they lack biological variation.
- **Use one control as a common baseline** selects one experiment's NC or individual's N and divides all ratios for that protein by that selected control ratio. Only the selected control is defined as 1; other control values retain their calculated variation. This rescales values without calibrating membranes, exposures, or batches; the development version retains a cross-experiment comparability warning and DRAFT state.

New projects default to the **common baseline**: once a design is set, the first available control is chosen automatically. Change the baseline or switch back to matched controls at any time; a choice matching the default is still recorded explicitly. Archives created before this preference keep matched-control behavior, and stored policies are untouched.

Default figures use bars with individual complete-unit points and mean ± sample SD. An optional paired-line view shows the matching structure. Each complete experiment or individual counts once. Missing references, ambiguous repeated measurements, and invalid signals omit the unit from both groups rather than inserting zero. n is the number of complete units actually included, never the number of images. Without confirmed independence, n denotes paired sets.

**Statistical testing is off by default.** After confirming independence and a paired design with exactly two conditions, explicitly select a two-sided paired t-test. It tests treatment-minus-control differences (T−N for N/T designs) using original target/reference ratios, **not fold values divided by each pair's own control**. Changing a valid plot baseline therefore cannot change the P-value for the same eligible pairs. Reports include actual n, degrees of freedom, an unadjusted P-value, mean difference, and its 95% confidence interval. Quality warnings and DRAFT may coexist with exploratory inference; blocked measurements cannot enter it, and a P-value cannot resolve image-quality limitations.

Cross-membrane, exposure, and batch comparability limits apply to both plotting baselines and inference itself; displaying every matched control as 1 cannot calibrate the original test ratios.

With small n, especially n=3, approximate normality of paired differences is difficult to assess. Do not select a baseline, ROI, exclusion, or test to obtain a smaller P-value. Additional conditions, nonparametric tests, technical-replicate aggregation, and multiplicity correction are not provided. See [statistical methods and limits](paired-statistics.md). Both target and reference signals still require an appropriate quantitative dynamic range; see [the WB quantification study](https://pmc.ncbi.nlm.nih.gov/articles/PMC3840294/).

## 5. Background methods, vision candidates, and composed figures (new in 0.4.0-dev.1)

**Background correction**: next to the normalization settings, choose "Local background ROIs" (default) or "Rolling ball". The rolling ball is pixel-identical to ImageJ's "Process › Subtract Background" (light background); the radius ranges 10–200 (25–50 is common). In this mode background ROIs are unused and band IntDen is the corrected signal sum. Switching methods invalidates all review states; results and CSV record the method and radius. The ImageJ parity table lives in the [validation notes](validation-real-images.md).

**Vision API candidates (optional)**: once the local vision service is configured, request candidates for one image or the whole batch. The app sends a downscaled preview plus the declared lane labels; returned rectangles are strictly validated, merged into the proposals, and always flagged for review. Requests are cached by image hash, preview size, provider, and model, and can be cancelled at any time. Keys stay in local process memory and images go only to the provider you configured. Model answers are candidates only — pixel measurement always happens locally on original pixels.

**Composed figure**: the results bar gains "Composed figure SVG/PNG/TIFF", combining the ROI-annotated original, the quantification chart, and a method footer (background method/radius, normalization baseline, app version) into a single file for archiving or discussion.

## 6. Export, save, and return

CSV exports retain provenance, measurement method, normalization values, review state, and quality flags. Charts support SVG, PNG, and TIFF. Figure export renders results and does not modify measurement images. A TIFF figure export does not establish source-image bit-depth preservation.

Real projects use a distinct archive format and browser-storage key, including original images and settings. Existing synthetic archives remain available through the legacy workspace. Export a project archive for long-term backup and migration: browser storage is not a backup. Archives can contain private experimental data and should not be uploaded to public repositories.

Optional vision API settings still transmit only a built-in synthetic test image. Real-image automation uses local algorithms and needs no API key; it does not send experimental images to a configured provider.

Shared-layout mode supports one lane per condition. Explicit N/T tables support multiple individuals in each image. Automatic technical-replicate aggregation, cross-membrane calibration, and complex exposure merging are not modeled. Assembled figures, transparent canvases, and nonspecific band rows require source-image review; a display montage is not a continuous original blot.

Built-in website examples and public fixtures contain synthetic images only. Private images or results never become preloaded website content, public screenshots, or repository examples.
