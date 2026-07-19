import { z } from "zod";
import { apifyTool } from "./apify.ts";
import type { RunContext } from "../sink.ts";

const LINKEDIN_URL = /^https?:\/\/([\w-]+\.)*linkedin\.com\//i;
const COMPANY_URL = /linkedin\.com\/company\//i;

const ACTORS = {
  profile: process.env.APIFY_LINKEDIN_PROFILE_ACTOR ?? "harvestapi~linkedin-profile-scraper",
  posts: process.env.APIFY_LINKEDIN_POSTS_ACTOR ?? "harvestapi~linkedin-profile-posts",
  reactions: process.env.APIFY_LINKEDIN_REACTIONS_ACTOR ?? "harvestapi~linkedin-post-reactions",
  employees: process.env.APIFY_LINKEDIN_EMPLOYEES_ACTOR ?? "harvestapi~linkedin-company-employees",
  company: process.env.APIFY_LINKEDIN_COMPANY_ACTOR ?? "harvestapi~linkedin-company",
};

const LocationSchema = z.object({ linkedinText: z.string().optional() });
const EmailSchema = z.union([
  z.string().transform((address) => ({ address })),
  z
    .object({
      email: z.string().optional(),
      status: z.string().optional(),
      qualityScore: z.number().optional(),
    })
    .transform(({ email: address, status, qualityScore }) => ({ address, status, qualityScore })),
]);
const FoundedYearSchema = z.union([
  z.number(),
  z.object({ year: z.number().optional() }).transform(({ year }) => year ?? null),
  z.null(),
]);
const RawProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  location: LocationSchema.optional(),
  about: z.string().optional(),
  linkedinUrl: z.string().optional(),
  publicIdentifier: z.string().optional(),
  followerCount: z.number().optional(),
  connectionsCount: z.number().optional(),
  experience: z
    .array(
      z.object({
        position: z.string().optional(),
        companyName: z.string().optional(),
        duration: z.string().optional(),
      }),
    )
    .optional(),
});
const RawPostSchema = z.object({
  linkedinUrl: z.string().optional(),
  content: z.string().optional(),
  postedAt: z.object({ postedAgoText: z.string().optional(), date: z.string().optional() }).optional(),
  engagement: z
    .object({ likes: z.number().optional(), comments: z.number().optional(), shares: z.number().optional() })
    .optional(),
});
const RawEmployeeSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  headline: z.string().optional(),
  position: z.string().optional(),
  summary: z.string().optional(),
  currentPositions: z
    .array(z.object({ companyName: z.string().optional(), title: z.string().optional(), current: z.boolean().optional() }))
    .optional(),
  location: LocationSchema.optional(),
  linkedinUrl: z.string().optional(),
  email: EmailSchema.optional(),
  emails: z.array(z.string()).optional(),
  contactEmails: z.array(z.string()).optional(),
});
const RawReactionSchema = z.object({
  reactionType: z.string().optional(),
  actor: z
    .object({ name: z.string().optional(), position: z.string().optional(), linkedinUrl: z.string().optional() })
    .optional(),
});
const RawCompanySchema = z.object({
  name: z.string().optional(),
  linkedinUrl: z.string().optional(),
  website: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  foundedOn: FoundedYearSchema.optional(),
  employeeCount: z.number().optional(),
  employeeCountRange: z.object({ start: z.number().optional(), end: z.number().optional() }).optional(),
  followerCount: z.number().optional(),
  industries: z.array(z.object({ name: z.string().optional(), title: z.string().optional() })).optional(),
  specialities: z.array(z.string()).optional(),
  locations: z
    .array(
      z.object({
        city: z.string().optional(),
        geographicArea: z.string().optional(),
        country: z.string().optional(),
        headquarter: z.boolean().optional(),
      }),
    )
    .optional(),
});

type RawProfile = z.infer<typeof RawProfileSchema>;
type RawPost = z.infer<typeof RawPostSchema>;
type RawEmployee = z.infer<typeof RawEmployeeSchema>;
type RawReaction = z.infer<typeof RawReactionSchema>;
type RawCompany = z.infer<typeof RawCompanySchema>;

function emailAddress(address?: string): { address: string } | null {
  return address ? { address } : null;
}

export function linkedinTools(context: RunContext) {
  const linkedin_profile = apifyTool(context, {
    id: "linkedin_profile",
    description:
      "Get a person's LinkedIn profile as structured data (name, headline, location, about, experience, follower count). Use for LinkedIn facts instead of fetching linkedin.com pages, which are login-walled. Costs credits — call once per person.",
    type: "linkedin",
    rawSchema: RawProfileSchema,
    inputSchema: z.object({
      url: z.string().describe("LinkedIn profile URL, e.g. https://www.linkedin.com/in/<slug>"),
    }),
    outputKey: "profile",
    single: true,
    prepare: ({ url }) => ({
      actor: ACTORS.profile,
      actorInput: { url },
      query: url,
      guard: { url, hint: "web_search for the person first, then pass the LinkedIn URL from the results." },
    }),
    map: (items: RawProfile[], { url }) =>
      items.slice(0, 1).map((p) => ({
        name: [p.firstName, p.lastName].filter(Boolean).join(" "),
        headline: p.headline ?? "",
        location: p.location?.linkedinText ?? "",
        about: (p.about ?? "").slice(0, 1500),
        linkedinUrl: p.linkedinUrl ?? url,
        publicIdentifier: p.publicIdentifier ?? "",
        followers: p.followerCount ?? null,
        connections: p.connectionsCount ?? null,
        experience: (p.experience ?? []).slice(0, 5).map((e) => ({
          position: e.position ?? "",
          company: e.companyName ?? "",
          duration: e.duration ?? "",
        })),
      })),
    view: (p) => ({ title: p.name, url: p.linkedinUrl, preview: p.headline }),
    sourceUrl: (p) => p.linkedinUrl,
  });

  const linkedin_posts = apifyTool(context, {
    id: "linkedin_posts",
    description:
      "Get the recent LinkedIn posts of a person or company profile: text, date, engagement counts, post URLs. Costs credits per post — keep maxPosts small.",
    type: "linkedin",
    rawSchema: RawPostSchema,
    inputSchema: z.object({
      profileUrl: z.string().describe("LinkedIn profile or company URL whose posts to fetch."),
      maxPosts: z.number().int().min(1).max(20).default(5),
    }),
    outputKey: "posts",
    prepare: ({ profileUrl, maxPosts }) => ({
      actor: ACTORS.posts,
      actorInput: { targetUrls: [profileUrl], maxPosts },
      query: `posts:${profileUrl}`,
      guard: {
        url: profileUrl,
        hint: "web_search for the profile first, then pass the LinkedIn URL from the results.",
      },
    }),
    map: (items: RawPost[], { maxPosts }) =>
      items.slice(0, maxPosts).map((p) => ({
        url: p.linkedinUrl ?? "",
        postedAt: p.postedAt?.date ?? p.postedAt?.postedAgoText ?? "",
        text: (p.content ?? "").slice(0, 600),
        likes: p.engagement?.likes ?? 0,
        comments: p.engagement?.comments ?? 0,
        shares: p.engagement?.shares ?? 0,
      })),
    view: (p) => ({ url: p.url, preview: p.text }),
    sourceUrl: (p) => p.url,
  });

  const linkedin_post_reactions = apifyTool(context, {
    id: "linkedin_post_reactions",
    description:
      "Get who reacted to a LinkedIn post: reaction type plus each person's name, position, and profile URL. Costs credits per reaction — keep maxReactions small.",
    type: "linkedin",
    rawSchema: RawReactionSchema,
    inputSchema: z.object({
      postUrl: z.string().describe("Full LinkedIn post URL."),
      maxReactions: z.number().int().min(1).max(100).default(20),
    }),
    outputKey: "reactions",
    prepare: ({ postUrl, maxReactions }) => ({
      actor: ACTORS.reactions,
      actorInput: { posts: [postUrl], maxItems: maxReactions },
      query: `reactions:${postUrl}`,
      guard: { url: postUrl, hint: "web_search for the post first, then pass the LinkedIn URL from the results." },
    }),
    map: (items: RawReaction[], { maxReactions }) =>
      items.slice(0, maxReactions).map((r) => ({
        type: r.reactionType ?? "",
        name: r.actor?.name ?? "",
        position: (r.actor?.position ?? "").slice(0, 120),
        linkedinUrl: r.actor?.linkedinUrl ?? "",
      })),
    view: (r) => ({ title: r.name, url: r.linkedinUrl, preview: `${r.type} · ${r.position}` }),
  });

  const linkedin_find_people = apifyTool(context, {
    id: "linkedin_find_people",
    description:
      "Find people at a company via LinkedIn employee search, filtered by job title. Returns name, title, location, profile URL, and (when findEmails is true) a work email if one can be found. Costs credits per profile and 3x with emails — keep maxItems small and filter by title.",
    type: "linkedin",
    rawSchema: RawEmployeeSchema,
    inputSchema: z.object({
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
    }),
    outputKey: "people",
    prepare: ({ company, jobTitles, searchQuery, maxItems, findEmails }) => ({
      actor: ACTORS.employees,
      actorInput: {
        companies: [company],
        ...(jobTitles?.length ? { jobTitles } : {}),
        ...(searchQuery ? { searchQuery } : {}),
        maxItems,
        profileScraperMode: findEmails ? "Full + email search ($12 per 1k)" : "Short ($4 per 1k)",
      },
      query: `people:${company}`,
      guard: LINKEDIN_URL.test(company)
        ? {
            url: company,
            hint: "Pass the exact company name instead, or web_search for the company's LinkedIn page first.",
          }
        : undefined,
    }),
    map: (items: RawEmployee[], { maxItems }) =>
      items.slice(0, maxItems).map((p) => {
        const current = p.currentPositions?.find((cp) => cp.current) ?? p.currentPositions?.[0];
        return {
          name: [p.firstName, p.lastName].filter(Boolean).join(" ") || (p.name ?? ""),
          title: current?.title ?? p.position ?? p.headline ?? "",
          company: current?.companyName ?? "",
          location: p.location?.linkedinText ?? "",
          linkedinUrl: p.linkedinUrl ?? "",
          email: p.email ?? emailAddress(p.emails?.[0] ?? p.contactEmails?.[0]),
        };
      }),
    view: (p) => ({ title: p.name, url: p.linkedinUrl, preview: p.title }),
    sourceUrl: (p) => p.linkedinUrl,
  });

  const linkedin_company = apifyTool(context, {
    id: "linkedin_company",
    description:
      "Get a company's LinkedIn profile as structured data: exact employee count, size range, industry, founded year, headquarters, follower count, website, and description. Use for firmographic facts (headcount, industry, HQ) instead of fetching linkedin.com pages, which are login-walled. Pass the exact COMPANY NAME and let the tool resolve the page — never guess or construct a /company/<slug> URL, as the wrong slug returns a stale decoy page. Only pass a URL if it appeared verbatim in a web_search result. Costs credits — call once per company.",
    type: "linkedin",
    rawSchema: RawCompanySchema,
    inputSchema: z.object({
      company: z
        .string()
        .describe(
          "Exact company name (preferred — the tool resolves the right page). A linkedin.com/company URL is accepted ONLY if it came from a web_search result; constructed/guessed URLs are rejected.",
        ),
    }),
    outputKey: "company",
    single: true,
    prepare: ({ company }) => ({
      actor: ACTORS.company,
      actorInput: COMPANY_URL.test(company) ? { companies: [company] } : { searches: [company] },
      query: `company:${company}`,
      guard: COMPANY_URL.test(company)
        ? {
            url: company,
            hint: "Pass the exact company name instead, or web_search for the company's LinkedIn page first.",
          }
        : undefined,
    }),
    map: (items: RawCompany[], { company }) => {
      const isUrl = COMPANY_URL.test(company);
      return items.slice(0, 1).map((c) => {
        const hq = c.locations?.find((l) => l.headquarter) ?? c.locations?.[0];
        const range = c.employeeCountRange;
        return {
          name: c.name ?? "",
          linkedinUrl: c.linkedinUrl ?? (isUrl ? company : ""),
          website: c.website ?? "",
          tagline: c.tagline ?? "",
          description: (c.description ?? "").slice(0, 1000),
          employeeCount: c.employeeCount ?? null,
          employeeCountRange:
            range?.start != null ? `${range.start}-${range.end ?? ""}`.replace(/-$/, "+") : null,
          followers: c.followerCount ?? null,
          foundedYear: c.foundedOn ?? null,
          industry: c.industries?.[0]?.title ?? c.industries?.[0]?.name ?? "",
          specialities: (c.specialities ?? []).slice(0, 10),
          headquarters: hq ? [hq.city, hq.geographicArea, hq.country].filter(Boolean).join(", ") : "",
        };
      });
    },
    view: (c) => ({ title: c.name, url: c.linkedinUrl, preview: c.industry }),
    sourceUrl: (c) => c.linkedinUrl,
  });

  return { linkedin_profile, linkedin_posts, linkedin_post_reactions, linkedin_find_people, linkedin_company };
}
