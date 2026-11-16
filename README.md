# AFW Image Tools

A private, browser-only Island City, CHIR FM, Sunday Sessions, and Community Curation (CC) thumbnail maker. Built with TypeScript, Vite, React component APIs running on **TanStack Redact 0.3.1**, Tailwind CSS, and daisyUI. No backend, uploads, analytics, or remote fonts.

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
3. Choose Island City, CHIR FM (the default), Sunday, or CC using the station controls. CC shares Sunday’s logo-free footer and host wrapping, with “Community Curation”, a date such as “Saturday, October 24”, and editable start/finish times (shown as “4:00pm–5:00pm”). CC times are preserved when switching stations; empty times are omitted. Its optional gradient shades only the footer, like Sunday. Sunday uses a logo-free, two-column footer: “A Friendly Wave”, “Sunday Sessions”, and “with” the host on the left; weekday/month/day (without a year), “10:15am–1:15pm”, and “Cassette Café” on the right. Its date, host, color, and photo treatment settings are shared with the other stations. Island City always includes its logo overlay and places the show date at bottom-left. Both stations offer a date input; CHIR FM also shows a host-name input. Its thumbnail includes “A Friendly Wave Radio”, wrapped host names, and a long-form date at top-left, with the fixed Tuesday schedule, frequencies, and website at top-right. Empty host/date fields are omitted. Switching stations preserves those values. Both stations offer a Color radio group: Copper, Berry, or Lime (the default), controlling text and both logos without changing the photo colors. The separate Duotone toggle defaults off; enabling it maps the photo to navy shadows and the selected Color with a subtle print texture. Artwork stays in the selected canonical theme color, without automatic lightening. Corner gradient defaults off and can be switched independently of Duotone, shading the photo corners with either treatment (bottom corners only for Sunday’s footer). Switching colors or stations preserves both toggle choices.
4. The processed preview updates automatically inside the selected crop, then download `<source-stem>_thumb.png`. Crop guides are editor-only; downloads include only the image, grain, and enabled artwork.

HEIC, batch processing, adjustable templates, and offline caching are intentionally out of scope for this first version.

## Output

- 1080 × 1080 square or 1080 × 1350 portrait opaque PNG; transparent input is flattened onto black.
- Browser-normalized EXIF orientation, full-resolution source retained for export.
- Monochrome Gaussian grain (sigma 25), soft-light blended before the logos.
- Island City uses the selected Color for its artwork and optional long-form date. Its overlay is always included, 324px wide with a 49px top/left margin; the date sits 24px from the left and 20px from the bottom in Iosevka. AFW is always included for Island City and CHIR FM, 454px wide, flush bottom-right. Transparent SVG padding is trimmed before sizing.
- CHIR FM and Sunday wrap host names at words and split long unbroken names without horizontal squashing. Sunday’s left footer grows upward while its right-hand date, time, and venue stay pinned to the bottom; exceptionally large hosts use proportionally smaller type to stay inside the image. Island City has no host input.
- CHIR FM replaces the Island City overlay with Iosevka show details and an inset bottom-left CHIR logo. Details and both logos use the selected Color, defaulting to Lime (`#e2ff78`). With Duotone off, the photo retains its source colors with the usual grain.
- Duotone maps photo luminance for either station, after grain, between theme navy (`#001a72`) and Copper (`#e06c3a`), Berry (`#b34479`), or Lime (`#e2ff78`). A lightly deepened tonal curve and a fine angled halftone blended at 12% add subtle print texture without replacing the continuous photographic tones.
- When Corner gradient is enabled, duotone images have soft navy corner gradients beneath the artwork (50% peak opacity, held through the inner quarter of each fade before feathering out through the top/bottom 30% of the image). The middle 40% stays untouched by the gradients. Text and both logos use the exact selected theme color; no automatic lightening or solid backing panel is applied. Contrast depends on the photo and is **not guaranteed to meet WCAG**. Duotone-off bypasses only the duotone treatment; source photos and cached logos remain untouched. Fonts are loaded before export; calendar dates are formatted without UTC day shifts.

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

Unit tests cover crop bounds and resizing. Browser tests run against the production build and cover selection, pointer/keyboard controls, PNG dimensions/opacity/artwork, independent Color and Duotone controls, duotone palettes, subtle print texture, canonical artwork colors on dark and bright photos, keyboard-toggleable corner shading with an untouched center in both formats, gradient restoration and station isolation, matching preview/download pixels, color/duotone restoration and station isolation, downloads, EXIF rotation/mirroring, failures/recovery, stale decodes, and local-only requests. The `mobile` project uses Chromium device emulation; `mobile-safari` uses WebKit emulation, not a real iPhone.

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
