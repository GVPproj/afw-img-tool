# AFW Image Tools

A browser-only thumbnail maker for Island City, CHIR FM, Sunday Sessions, and Community Curation (CC). Images stay on your device: no backend, uploads, analytics, or remote fonts.

Built with TypeScript, Vite, React component APIs running on TanStack Redact 0.3.1, Tailwind CSS, and native HTML controls.

## Local development

Use Node 24+ and pnpm 12.18.0 (pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:12302**. The dev server binds only to loopback and fails if the port is occupied.

### Tailscale access

On the configured host, the app is also available at **https://asahi-mini.tail40c3ca.ts.net:12302** while Vite is running. Tailscale Serve proxies HTTP/WebSocket traffic to Vite over HTTPS; access is tailnet-only, not a public Funnel.

One-time setup:

```sh
tailscale serve --bg --https=12302 http://127.0.0.1:12302
```

The proxy persists independently of Vite. Stop `pnpm dev` to stop serving the app; remove the proxy with `tailscale serve --https=12302 off`. On another host, update `server.allowedHosts` in `vite.config.ts` to its exact Tailscale DNS name.

## Usage

1. Choose a JPEG or PNG.
2. Choose square (1:1) or portrait (4:5). Move and resize the crop by dragging or using the labelled keyboard controls.
3. Choose a station and edit its show details. CHIR FM is the default; Sunday and CC use logo-free footers, and CC has editable start/finish times.
4. Choose Copper, Berry, or Lime (default). Duotone and Corner gradient are independent, optional effects; station changes preserve shared settings.
5. Download `<source-stem>_thumb.png`. The preview updates automatically; crop guides are not exported.

HEIC, batch processing, adjustable templates, and offline caching are not supported.

## Output and limitations

- Opaque PNG: 1080 × 1080 square or 1080 × 1350 portrait. Transparent input is flattened onto black.
- Browser-normalized EXIF orientation; full-resolution source retained for export. Fonts load before export.
- Soft-light grain, station-specific artwork, and wrapped host names. Grain stays stable during the session.
- Duotone maps the photo to navy and the selected theme color with a subtle print texture. With Duotone off, the photo retains its source colors.
- Corner gradient shades beneath the artwork, affecting only the footer for Sunday and CC. Text and logos retain the selected theme color; contrast depends on the photo and is **not guaranteed to meet WCAG**.

Processing runs on the main thread. Rapid edits are coalesced, and stale renders cannot replace the current preview or download. Very large images, wide-gamut/HDR handling, and real iPhone/Safari validation remain limitations or follow-up work.

## Checks

```sh
pnpm build
pnpm test
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
# If WebKit's OS dependencies aren't installed:
pnpm test:e2e --project chromium --project firefox --project mobile
```

Unit tests cover crop geometry. Browser tests run against the production build and cover editing, image effects, exports, resource lifecycle, accessibility, visual snapshots, and local-only requests. The `mobile` project uses Chromium device emulation; `mobile-safari` uses WebKit emulation, not a real iPhone.

To compare with native React, omit the Redact plugin:

```sh
NATIVE_REACT=1 pnpm dev
NATIVE_REACT=1 pnpm test:e2e --project chromium
```

## Files

- `src/App.tsx`: photo workflow and crop interaction.
- `src/lib/crop.ts`: crop geometry.
- `src/lib/images.ts`: decoding, preview rendering, effects, artwork, and PNG export.
- `src/styles.css`: theme, fonts, layout, and crop overlay.
- `src/controls.css`: native controls and status indicators.
- `src/assets/`: station logos.
- `public/fonts/`: self-hosted Iosevka fonts, provenance, and SIL OFL licence.

## Cloudflare Pages

Create a **Pages** project connected to this repository, not a Workers project:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Repository root |
| Build command | `pnpm run build` |
| Build output directory | `dist` |
| Node version | `24` (set `NODE_VERSION=24`) |

Use pnpm 12.18.0 as pinned in `package.json`. Pages builds and publishes `dist/`; no deploy command, Wrangler configuration, runtime secrets, or Cloudflare Vite plugin is needed.

After verifying the Pages deployment, connect your custom domain and disable the old Netlify or Workers deployment. Hosting is public by default; configure Cloudflare Access if access should be restricted.
