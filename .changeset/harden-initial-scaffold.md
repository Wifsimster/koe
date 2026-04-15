---
"@wifsimster/koe": patch
---

Harden the initial scaffold in response to the stack-validation review:

- Standalone `<script>` build is now a self-contained IIFE that bundles
  React and the JSX runtime. The previous UMD build externalized
  `react/jsx-runtime` and was not a drop-in script target.
- The widget now supports `userHash` for server-signed identity
  verification; it's forwarded to the API as `X-Koe-User-Hash`.
- Request bodies no longer duplicate `projectKey` — the
  `X-Koe-Project-Key` header is authoritative.
