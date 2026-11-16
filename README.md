# AFW Image Tools

A private, browser-only Island City and CHIR FM thumbnail maker. Built with TypeScript, Vite, React component APIs running on **TanStack Redact 0.3.1**, Tailwind CSS, and daisyUI. No backend, uploads, analytics, or remote fonts.

## Local development

Use Node 24+ and pnpm 12.18.0 (pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

Local URL: **http://127.0.0.1:12302**. The dev server binds only to loopback and fails if this port is occupied.

On the configured Tailscale host, `pnpm dev` is also available at **https://asahi-mini.tail40c3ca.ts.net:12302**. Tailscale Serve terminates HTTPS and proxies HTTP/WebSocket traffic to Vite; this is tailnet-only, not a public Funnel.

One-time proxy setup (already configured on this machine):

```sh
tailscale serve --bg --https=12302 http://127.0.0.1:12302
```

The proxy persists independently of Vite. Stop `pnpm dev` to stop serving the app; remove this proxy with `tailscale serve --https=12302 off`. On another host, update `server.allowedHosts` in `vite.config.ts` to its exact Tailscale DNS name.

1. Choose a JPEG or PNG. File signatures, not extensions/MIME alone, determine support.
2. Choose square (1:1) or Instagram portrait (4:5) in Settings. Drag the crop to move it, drag its bottom-right corner to resize, or use the labelled keyboard-accessible crop controls. Reset or changing format restores the largest centered crop.
3. Choose Island City or CHIR FM (the default) using the station controls. Island City has an optional logo overlay; CHIR FM shows daisyUI date and host-name inputs. Its thumbnail includes “A Friendly Wave Radio”, wrapped host names, and a long-form date at top-left, with the fixed Tuesday schedule, frequencies, and website at top-right. Empty host/date fields are omitted. Switching stations preserves those values. The original CHIR FM logo asset is not bundled.
4. The processed preview updates automatically inside the selected crop, then download `<source-stem>_thumb.png`. Crop guides are editor-only; downloads include only the image, grain, and enabled artwork.

HEIC, batch processing, adjustable templates, and offline caching are intentionally out of scope for this first version.

## Output

- 1080 × 1080 square or 1080 × 1350 portrait opaque PNG; transparent input is flattened onto black.
- Browser-normalized EXIF orientation, full-resolution source retained for export.
- Monochrome Gaussian grain (sigma 25), soft-light blended before the logos.
- Original yellow (`#FFEA48`) artwork: optional Island City overlay (enabled when Island City is selected), 324px wide with a 49px top/left margin; AFW always included, 454px wide, flush bottom-right. Transparent SVG padding is trimmed before sizing.
- CHIR FM replaces the Island City overlay with lime (`#e2ff78`) Iosevka show details. Fonts are loaded before export; calendar dates are formatted without UTC day shifts. Both stations retain the source photo’s colors.

Browser resampling and soft-light blending aim for visual equivalence, not pixel identity with Pillow. A random grain texture is reused throughout the session to keep live updates visually stable. Exact reference-image comparison, wide-gamut/HDR handling, very large photo memory use, and real iPhone/Safari validation remain follow-up work. Processing runs on the main thread; rapid edits are coalesced, and stale renders cannot replace the current preview or download.

## Checks

```sh
pnpm build
pnpm test
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
# If WebKit's OS dependencies aren't installed:
pnpm test:e2e --project chromium --project firefox --project mobile
```

Unit tests cover crop bounds and resizing. Browser tests run against the production build and cover selection, pointer/keyboard controls, PNG dimensions/opacity/artwork, downloads, EXIF rotation/mirroring, failures/recovery, stale decodes, and local-only requests. The `mobile` project uses Chromium device emulation; `mobile-safari` uses WebKit emulation, not a real iPhone.

To compare with native React, omit the Redact plugin via the environment flag:

```sh
NATIVE_REACT=1 pnpm dev
NATIVE_REACT=1 pnpm test:e2e --project chromium
```

## Files

- `src/App.tsx`: single-photo workflow, asynchronous selection ownership, crop interaction.
- `src/lib/crop.ts`: pure normalized square and portrait crop geometry.
- `src/lib/images.ts`: decoding, resource lifecycle, preview generation, grain, logo composition, PNG encoding.
- `src/styles.css`: self-contained AFW tokens, fonts, daisyUI theme, layout and crop overlay.
- `src/assets/`: fixed logo assets, with only explicit paint colors pre-tinted yellow.
- `public/fonts/`: self-hosted Iosevka subsets, provenance and SIL OFL licence.

The Python implementation and AFW website were implementation references only; builds do not need sibling checkouts.

## Static hosting

`pnpm build` produces `dist/`. `netlify.toml` sets the build command, publish directory, and Node version for a root-domain deployment. Nothing has been deployed. There are no server routes or runtime secrets.
