# Open Extract

Framework-agnostic Bun and TypeScript URL-to-Markdown extraction workspace package.

```ts
import { extract } from "open-extract";

const result = await extract("https://example.com");
```

```bash
bun run packages/open-extract/src/cli.ts https://example.com
bun run packages/open-extract/src/cli.ts --debug https://example.com
```

The only extraction input is a URL. The package owns retrieval, fallback selection, HTML and PDF extraction, page usability detection, Markdown conversion, and bounded output. It has no dependency on Openclaygent runtime code.

`--debug` writes each attempted provider, outcome, duration, status, and final selection to stderr while keeping the JSON result on stdout.

The optional rendered-browser service is owned here too:

```bash
docker build -t open-extract-patchright ./packages/open-extract/patchright
docker run --rm -p 9223:9223 open-extract-patchright
```

Set `PATCHRIGHT_URL=http://localhost:9223` to enable it. The monorepo's root Compose file builds this same package-owned service alongside the application and search services.
