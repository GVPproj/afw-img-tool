# AFW Image Tools

Browser-only thumbnail maker for Island City, CHIR FM, Sunday Sessions, and Community Curation (CC). Processing on device

## Local development

Use Node 24+ and pnpm 12.18.0 (pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:12302 (loopback only; the port must be free).

## Usage and limitations

Choose a JPEG or PNG, crop by dragging or using the keyboard controls, set the station, show details, colour, and effect, then download `<source-stem>_thumb.png`.

- Output: opaque PNG, 1728 × 1728 square or 1728 × 2160 portrait. Transparency is flattened onto black.
- Dither and duotone use navy and the selected theme colour. Corner gradient is independent.
- Contrast depends on the photo; WCAG compliance is not guaranteed.

## Checks

```sh
pnpm build
pnpm test
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
# Without WebKit's OS dependencies:
pnpm test:e2e --project chromium --project firefox --project mobile
```

Browser tests use the production build. Mobile projects are emulated; real iPhone/Safari validation is still needed.

For native React instead of Redact, prefix `pnpm dev` or `pnpm test:e2e --project chromium` with `NATIVE_REACT=1`.

## Cloudflare Pages

Connect the repository to a **Pages** project (not Workers): Vite preset, repository root, build command `pnpm build`, output `dist`, and `NODE_VERSION=24`. Use the pinned pnpm version; no deploy command or runtime secrets are needed.

Hosting is public by default; use Cloudflare Access to restrict it.
