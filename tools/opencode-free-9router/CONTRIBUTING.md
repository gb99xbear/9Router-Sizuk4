# Contributing

Thanks for helping improve `opencode-free-9router`.

## Ground rules

- Keep the project **dependency-free**. Everything runs on Node's standard library.
- Keep it **auditable**: small files, clear names, no build step.
- Respect the upstream free tier. Do not add features that hammer the gateway, rotate IPs to dodge
  limits, or resell access.

## Getting started

```bash
git clone https://github.com/0xgetz/opencode-free-9router.git
cd opencode-free-9router
npm test          # offline, fast
```

No `npm install` is needed.

## What to work on

- **New free models** — when the gateway adds one, add it to `CHAT_MODELS` / `RESPONSES_MODELS`
  in `src/opencode_free.js` and to the README table.
- **Gateway changes** — if the attestation changes, update `buildHeaders` /
  `prepareChatBody` / `prepareResponsesBody` and the `STRUCTURE.md` attestation table.
- **9Router compatibility** — keep `connect-9router.js` working across 9Router versions.

## Before you open a PR

1. `npm test` passes.
2. `npm run test:live` passes for any model you touched (be patient — it is rate-limited on purpose).
3. Docs are updated in **all five** READMEs if behaviour or the model list changed.
4. The diff stays small and focused.

## Reporting issues

Include: Node version, OS, the exact command, the full error, and whether `npm run test:live` passes.

## Code style

- ES modules, 2-space indent, double quotes, semicolons.
- No comments that restate the code; comment only non-obvious intent.
- Prefer small pure functions that are easy to unit-test.

## License

By contributing you agree your work is released under the [MIT License](LICENSE).
