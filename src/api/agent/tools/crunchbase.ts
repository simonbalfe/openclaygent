import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createApifyRunner, recordProviderResults } from "./apify.ts";
import { assertVerifiedUrl, type RunContext } from "../sink.ts";

const DEFAULT_ACTOR = "parseforge~crunchbase-scraper";
const ORG_URL = /crunchbase\.com\/organization\//i;

const NamedEntitySchema = z.union([z.string(), z.object({ name: z.string().optional() })]);
const RawOrgSchema = z.object({
  name: z.string().optional(),
  cbUrl: z.string().optional(),
  crunchbaseUrl: z.string().optional(),
  url: z.string().optional(),
  website: z.string().optional(),
  founded: z.union([z.string(), z.number()]).optional(),
  foundedOn: z.string().optional(),
  headquarters: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  employeeCount: z.string().optional(),
  industries: z.array(z.string()).optional(),
  totalFundingUsd: z.number().optional(),
  totalFunding: z.number().optional(),
  lastRoundType: z.string().optional(),
  lastFundingType: z.string().optional(),
  lastRoundAmountUsd: z.number().optional(),
  lastFundingAmountUsd: z.number().optional(),
  lastRoundDate: z.string().optional(),
  lastFundingOn: z.string().optional(),
  founders: z.array(NamedEntitySchema).optional(),
  leadInvestors: z.array(z.string()).optional(),
  investors: z.array(NamedEntitySchema).optional(),
  ipoStatus: z.string().optional(),
  operatingStatus: z.string().optional(),
});
const runOrgActor = createApifyRunner(RawOrgSchema);

function nameOf(x: { name?: string } | string | undefined): string {
  return typeof x === "string" ? x : (x?.name ?? "");
}

export function crunchbaseTools(context: RunContext) {
  const CompanyInputSchema = z.object({
    company: z
      .string()
      .describe(
        "Crunchbase organization URL (preferred, e.g. https://www.crunchbase.com/organization/openai) or the exact company name.",
      ),
  });
  const crunchbase_company = createTool({
    id: "crunchbase_company",
    description:
      "FALLBACK ONLY. Get a company's Crunchbase funding & firmographics as structured data — total funding, latest round (type, amount, date), investors, founders, employee range, HQ, founded year, IPO status. Crunchbase is bot-walled, so call this ONLY after web_search has failed to pin the funding/firmographic facts from open sources. Costs Apify credits — call at most once per company. Pass the crunchbase.com/organization URL if one appeared in search results, otherwise the exact company name.",
    inputSchema: CompanyInputSchema,
    outputSchema: z.object({ company: z.unknown() }),
    execute: async ({ company }) => {
      const isUrl = ORG_URL.test(company);
      if (isUrl) {
        assertVerifiedUrl(
          context,
          company,
          "Pass the exact company name instead, or web_search for the crunchbase.com/organization page first.",
        );
      }
      const items = await runOrgActor(
        process.env.CRUNCHBASE_ACTOR ?? DEFAULT_ACTOR,
        isUrl ? { startUrls: [{ url: company }], maxItems: 1 } : { searchQuery: company, maxItems: 1 },
      );
      const mapped = items.slice(0, 1).map((o) => ({
        name: o.name ?? "",
        crunchbaseUrl: o.cbUrl ?? o.crunchbaseUrl ?? o.url ?? (isUrl ? company : ""),
        website: o.website ?? "",
        foundedYear: o.founded ?? o.foundedOn ?? null,
        employeeCount: o.employeeCount ?? null,
        industry: (o.industries ?? [])[0] ?? "",
        headquarters: o.headquarters ?? [o.city, o.region, o.country].filter(Boolean).join(", "),
        totalFundingUsd: o.totalFundingUsd ?? o.totalFunding ?? null,
        lastRound: {
          type: o.lastRoundType ?? o.lastFundingType ?? "",
          amountUsd: o.lastRoundAmountUsd ?? o.lastFundingAmountUsd ?? null,
          date: o.lastRoundDate ?? o.lastFundingOn ?? "",
        },
        founders: (o.founders ?? []).map(nameOf).filter(Boolean).slice(0, 6),
        leadInvestors: (o.leadInvestors ?? o.investors ?? []).map(nameOf).filter(Boolean).slice(0, 10),
        ipoStatus: o.ipoStatus ?? o.operatingStatus ?? "",
      }));
      const result = mapped[0] ?? null;
      recordProviderResults(
        context,
        "crunchbase",
        company,
        result
          ? [{
              title: result.name,
              url: result.crunchbaseUrl,
              preview: `${result.lastRound.type} ${result.lastRound.amountUsd ?? ""} · ${result.totalFundingUsd ?? ""}`,
            }]
          : [],
      );
      return { company: result };
    },
  });

  return { crunchbase_company };
}
