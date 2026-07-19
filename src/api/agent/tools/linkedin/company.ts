import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordProviderResults } from "../apify.ts";
import { assertVerifiedUrl, type RunContext } from "../../sink.ts";
import { ACTORS, COMPANY_URL, runCompanyActor } from "./shared.ts";

const InputSchema = z.object({
  company: z
    .string()
    .describe(
      "Exact company name (preferred — the tool resolves the right page). A linkedin.com/company URL is accepted ONLY if it came from a web_search result; constructed/guessed URLs are rejected.",
    ),
});

export function linkedinCompanyTool(context: RunContext) {
  return createTool({
    id: "linkedin_company",
    description:
      "Get a company's LinkedIn profile as structured data: exact employee count, size range, industry, founded year, headquarters, follower count, website, and description. Use for firmographic facts (headcount, industry, HQ) instead of fetching linkedin.com pages, which are login-walled. Pass the exact COMPANY NAME and let the tool resolve the page — never guess or construct a /company/<slug> URL, as the wrong slug returns a stale decoy page. Only pass a URL if it appeared verbatim in a web_search result. Costs credits — call once per company.",
    inputSchema: InputSchema,
    outputSchema: z.object({ company: z.unknown() }),
    execute: async ({ company }) => {
      const isUrl = COMPANY_URL.test(company);
      if (isUrl) {
        assertVerifiedUrl(
          context,
          company,
          "Pass the exact company name instead, or web_search for the company's LinkedIn page first.",
        );
      }
      const items = await runCompanyActor(
        ACTORS.company,
        isUrl ? { companies: [company] } : { searches: [company] },
      );
      const result = items.slice(0, 1).map((item) => {
        const headquarters = item.locations?.find((location) => location.headquarter) ?? item.locations?.[0];
        const range = item.employeeCountRange;
        return {
          name: item.name ?? "",
          linkedinUrl: item.linkedinUrl ?? (isUrl ? company : ""),
          website: item.website ?? "",
          tagline: item.tagline ?? "",
          description: (item.description ?? "").slice(0, 1000),
          employeeCount: item.employeeCount ?? null,
          employeeCountRange:
            range?.start != null ? `${range.start}-${range.end ?? ""}`.replace(/-$/, "+") : null,
          followers: item.followerCount ?? null,
          foundedYear: item.foundedOn ?? null,
          industry: item.industries?.[0]?.title ?? item.industries?.[0]?.name ?? "",
          specialities: (item.specialities ?? []).slice(0, 10),
          headquarters: headquarters
            ? [headquarters.city, headquarters.geographicArea, headquarters.country].filter(Boolean).join(", ")
            : "",
        };
      })[0] ?? null;
      recordProviderResults(
        context,
        "linkedin",
        `company:${company}`,
        result ? [{ title: result.name, url: result.linkedinUrl, preview: result.industry }] : [],
      );
      return { company: result };
    },
  });
}
