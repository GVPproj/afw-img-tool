# Iosevka font assets

Latin-subsetted WOFF2 fonts copied from the AFW website, originally from [Iosevka v34.9.0](https://github.com/be5invis/Iosevka/releases/tag/v34.9.0). These are modified subsets, licensed under [SIL OFL 1.1](iosevka-LICENSE.md).

- `iosevka-regular.woff2`: Iosevka Regular, UI copy.
- `iosevka-bold.woff2`: Iosevka Bold, UI emphasis.
- `iosevka-aile-heavy.woff2`: Iosevka Aile Heavy, display headings.

Original archives: `PkgWebFont-Unhinted-Iosevka-34.9.0.zip` and `PkgWebFont-Unhinted-IosevkaAile-34.9.0.zip`. AFW's source subsets were produced using fonttools 4.63.0 and brotli 1.2.0. To expand character coverage, regenerate from the original release files, not these subsets; this application does not include font-build tooling.

Font-face and metric-adjusted fallback declarations are in `src/styles.css`. The regular font is preloaded in `index.html`. All font requests are local. Generic fallbacks remain unadjusted on systems without the named local fonts.

After font or heading-copy changes, delay font responses until after first paint and compare mobile/desktop heading wrapping before and after loading. Actual platform fallback checks on Linux, Windows, macOS, and mobile remain necessary.
