# open-apify

Framework-independent Apify actor execution for Bun and TypeScript. It starts an actor,
polls active runs, retrieves the default dataset, and returns run metadata with the items.

```ts
import { runActor } from "open-apify";
import { z } from "zod";

const ProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});
const token = process.env.APIFY_API_TOKEN;
if (!token) throw new Error("APIFY_API_TOKEN is required");

const result = await runActor({
  actor: "harvestapi~linkedin-profile-scraper",
  input: { url: "https://www.linkedin.com/in/example" },
  itemSchema: ProfileSchema,
  token,
});
```

The caller owns provider-specific item validation and mapping. The package has no Mastra,
Openclaygent runtime, provenance, or environment-variable dependencies.
