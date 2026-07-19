# Open Search

Framework-agnostic Bun and TypeScript web-search ladder package.

```ts
import { search } from "open-search";

const result = await search("IANA example domains", { maxResults: 5 });
```

```bash
bun run packages/open-search/src/cli.ts --debug --max 5 "IANA example domains"
```

The package owns the SearXNG → Serper → Exa → Tavily ladder and its provider diagnostics. The input is a query and the output contains normalized results, the winning provider, and every attempt. It has no dependency on Openclaygent runtime code.

The package also owns the SearXNG image source and configuration under `searxng/`. The monorepo Compose file pulls the published `openclaygent-search` image built from that directory.
