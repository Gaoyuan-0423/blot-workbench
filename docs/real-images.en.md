# Real-image analysis guide

[中文](real-images.md) · [Synthetic example guide](user-guide.en.md)

`0.3.0-dev.1` adds a real-image project workspace at `#real`, also accessible through **Analyze real images** in the legacy example sidebar. This is a development preview. Independent laboratory validation, a fixed ImageJ comparison, and comprehensive instrument-format coverage are still pending. The public alpha website and existing downloads do not automatically update with the development branch.

## 1. Import and map files

Select or drop multiple TIFF/PNG files. Decoding runs locally; experimental images are not sent to a vision API. Original bytes, filenames, SHA-256 hashes, and image metadata are preserved. Preview pixels never replace decoded source arrays for measurement.

Initial support covers a subset of single-page, unsigned 8/16-bit grayscale or opaque RGB/RGBA images. Unsupported encodings, page counts, transparency, orientation, and oversized inputs are rejected rather than silently reduced to 8 bits. See the [validation record](validation-real-images.md) for exact coverage. RGB uses the documented grayscale conversion; this is not a multichannel fluorescence analysis tool.

Protein names and trailing numbers inferred from filenames are suggestions. Check protein, target/reference role, replicate, membrane, and exposure for every image. One project may contain multiple experiments. Additional exposures are not additional independent replicates; exclude unused exposures when pairing is ambiguous. Dates do not establish independence.

## 2. Describe lanes once

For a shared layout, enter sample labels from left to right, for example `NC, siRNA`, then apply them to the batch. Supported concise Chinese/English descriptions are converted into labels for review. This is a limited local parser, not unrestricted language understanding. Rewrite unrecognized text as an explicit ordered list.

You may enter `NC, siRNA, marker`; a trailing marker need not be present in every image. An extra marker on the right is not a sample and must not enter normalization or n. Automatic proposals find the requested candidates from left to right; inspect them for marker or nonspecific-band mistakes. Multiple band rows and touching lanes can defeat automatic localization.

Confirm independent experiments and the same-membrane, same-sample pairing before enabling experimental-design confirmation. Labels and filename suffixes cannot establish biological independence.

## 3. Run automatically, adjust manually

Batch analysis proposes band and local-background rectangles. Inspect the overlay for each image and move or resize bands/backgrounds manually. Automatic proposals preserve manually modified regions by default.

Measurements use original decoded arrays. For dark bands, net signal is `band area × background mean − band pixel sum`; light bands reverse the sign. Nonpositive net signals are neither changed to zero nor used for a valid ratio. Band/background rectangles should not overlap, and backgrounds must represent local noise without other signal. Region edits trigger fresh calculations, invalidate related reviews, and preserve analysis history.

Pixels at the signal endpoint trigger clipping warnings. Exposure, processing, or export can cause this, so it is not definitive evidence of camera saturation. Conversely, no endpoint pixels does not prove a linear response. A review action cannot erase a pixel warning.

## 4. Normalize and plot

Within the same experiment, membrane, and lane, compute `target net signal / reference net signal`. Divide by the ratio of the unique lane explicitly labeled `NC`, `control`, or 对照 in that experiment to obtain a fold value relative to its matched control. Every control becomes 1 by definition; this does not mean the controls lack biological variation.

Plots show individual complete replicates and mean ± sample standard deviation (SD). A replicate identifier counts at most once. Missing references, ambiguous pairings, and invalid net signals are not silently replaced with zero. Unreviewed analyses, unconfirmed designs, and quality warnings retain draft labels in figures and exports.

This version provides descriptive statistics only. It does not automatically choose t tests/ANOVA or generate significance stars. Inferential methods require a justified sample size, pairing structure, and transformation. See [GraphPad's ratio t-test explanation](https://www.graphpad.com/guides/prism/latest/statistics/stat_interpreting_results_ratio_t_t.htm). Both target and reference measurements need an appropriate dynamic range; see [Taylor et al.'s WB quantification study](https://pmc.ncbi.nlm.nih.gov/articles/PMC3840294/).

## 5. Export, save, and return

CSV exports retain provenance, measurement method, normalization values, review state, and quality flags. Charts support SVG, PNG, and TIFF. Figure export renders results and does not modify measurement images. A TIFF figure export does not establish source-image bit-depth preservation.

Real projects use a distinct archive format and browser-storage key, including original images and settings. Existing synthetic archives remain available through the legacy workspace. Export a project archive for long-term backup and migration: browser storage is not a backup. Archives can contain private experimental data and should not be uploaded to public repositories.

Optional vision API settings still transmit only a built-in synthetic test image. Real-image automation uses local algorithms and needs no API key; it does not send experimental images to a configured provider.

This version supports one control and one lane per condition in each image, with a shared project layout. Multi-patient N1/T1/N2/T2 pairings, technical-replicate aggregation, cross-membrane calibration, and exposure merging are not modeled. Renaming N1 to NC does not make these designs valid. Assembled figures, transparent canvases, and nonspecific band rows require source-image review; a display montage is not a continuous original blot.
