# Changelog

The [public repository](https://github.com/Gaoyuan-0423/blot-workbench) exists. The alpha release and hosted deployment remain pending verification. Validation claims belong in [the validation record](docs/validation.md).

## 0.1.0-alpha.1 — Unreleased

Initial synthetic-data browser workflow demonstration.

### Added

- A multi-batch Western blot project example with 8 synthetic images and 6 shared experimental units.
- Sample and lane context, band/background ROI review, reference pairing, and review states.
- Analysis-time template snapshots and stale-state handling for changed configurations.
- Preset illustrative normalization values, project recovery, and export workflows.
- Chinese/English interface and introductory documentation.
- MIT license, citation metadata, contribution guidance, and explicit validation boundaries.

### Pre-release fixes

- Commit notes, sample names, and project names after a typing pause, without requiring focus to leave the input.
- Show pending input/storage work as **Saving** and request a browser confirmation before leaving with unsaved work.
- Restore the previous valid value when a required field is left blank and loses focus.
- Validate project archives before showing an explicit workspace-replacement confirmation, with options to export the current project or cancel.

Validation evidence is tied to each recorded source commit; see [the validation record](docs/validation.md) for the tested behavior and environments.

### Limitations

- No real TIFF/PNG import or scientific image quantification.
- No inferential statistics, publication figure builder, IF analysis, desktop installer, or Wisp plugin.
- Quality labels and numerical outputs are fixtures, not algorithmic findings.
- Platform coverage requires recorded test evidence; target platforms are not automatically validated platforms.
