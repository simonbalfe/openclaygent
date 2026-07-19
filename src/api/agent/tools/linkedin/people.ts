import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordProviderResults } from "../apify.ts";
import { assertVerifiedUrl, type RunContext } from "../../sink.ts";
import { ACTORS, emailAddress, LINKEDIN_URL, runEmployeesActor } from "./shared.ts";

const InputSchema = z.object({
  company: z
    .string()
    .describe(
      "LinkedIn company URL (preferred, e.g. https://www.linkedin.com/company/pagerduty) or exact company name.",
    ),
  jobTitles: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Strict title filters, e.g. ['VP Sales', 'Marketing Director']."),
  searchQuery: z.string().optional().describe("Fuzzy search query, e.g. 'demand generation'."),
  maxItems: z.number().int().min(1).max(10).default(5),
  findEmails: z.boolean().default(false).describe("Also search work emails (3x cost)."),
});

export function linkedinPeopleTool(context: RunContext) {
  return createTool({
    id: "linkedin_find_people",
    description:
      "Find people at a company via LinkedIn employee search, filtered by job title. Returns name, title, location, profile URL, and (when findEmails is true) a work email if one can be found. Costs credits per profile and 3x with emails — keep maxItems small and filter by title.",
    inputSchema: InputSchema,
    outputSchema: z.object({ people: z.array(z.unknown()) }),
    execute: async ({ company, jobTitles, searchQuery, maxItems, findEmails }) => {
      if (LINKEDIN_URL.test(company)) {
        assertVerifiedUrl(
          context,
          company,
          "Pass the exact company name instead, or web_search for the company's LinkedIn page first.",
        );
      }
      const items = await runEmployeesActor(
        ACTORS.employees,
        {
          companies: [company],
          ...(jobTitles?.length ? { jobTitles } : {}),
          ...(searchQuery ? { searchQuery } : {}),
          maxItems,
          profileScraperMode: findEmails ? "Full + email search ($12 per 1k)" : "Short ($4 per 1k)",
        },
      );
      const people = items.slice(0, maxItems).map((item) => {
        const current = item.currentPositions?.find((position) => position.current) ?? item.currentPositions?.[0];
        return {
          name: [item.firstName, item.lastName].filter(Boolean).join(" ") || (item.name ?? ""),
          title: current?.title ?? item.position ?? item.headline ?? "",
          company: current?.companyName ?? "",
          location: item.location?.linkedinText ?? "",
          linkedinUrl: item.linkedinUrl ?? "",
          email: item.email ?? emailAddress(item.emails?.[0] ?? item.contactEmails?.[0]),
        };
      });
      recordProviderResults(
        context,
        "linkedin",
        `people:${company}`,
        people.map((person) => ({ title: person.name, url: person.linkedinUrl, preview: person.title })),
      );
      return { people };
    },
  });
}
