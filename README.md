# AFW Image Tool

Browser-only thumbnail maker for Island City, CHIR FM, Sunday Sessions, and Community Curation (CC). Processing on device.

## Local development

Use Node 24+ and pnpm 12.18.0 (pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:12302.

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

## Cloudflare Pages

Deploys on push to https://image-tool.afriendlywave.com
