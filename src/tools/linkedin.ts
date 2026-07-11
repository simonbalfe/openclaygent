import { z } from "zod";
import type { Cache } from "../core/cache.ts";
import { apifyTool } from "./apify.ts";
import type { Sink } from "./sink.ts";

const LINKEDIN_URL = /^https?:\/\/([\w-]+\.)*linkedin\.com\//i;
const COMPANY_URL = /linkedin\.com\/company\//i;

const ACTORS = {
  profile: process.env.APIFY_LINKEDIN_PROFILE_ACTOR ?? "harvestapi~linkedin-profile-scraper",
  posts: process.env.APIFY_LINKEDIN_POSTS_ACTOR ?? "harvestapi~linkedin-profile-posts",
  reactions: process.env.APIFY_LINKEDIN_REACTIONS_ACTOR ?? "harvestapi~linkedin-post-reactions",
  employees: process.env.APIFY_LINKEDIN_EMPLOYEES_ACTOR ?? "harvestapi~linkedin-company-employees",
  company: process.env.APIFY_LINKEDIN_COMPANY_ACTOR ?? "harvestapi~linkedin-company",
};

interface RawProfile {
  firstName?: string;
  lastName?: string;
  headline?: string;
  location?: { linkedinText?: string };
  about?: string;
  linkedinUrl?: string;
  publicIdentifier?: string;
  followerCount?: number;
  connectionsCount?: number;
  currentPosition?: { companyName?: string; position?: string }[];
  experience?: { position?: string; companyName?: string; duration?: string; location?: string }[];
}

interface RawPost {
  id?: string;
  linkedinUrl?: string;
  content?: string;
  postedAt?: { timestamp?: number; postedAgoText?: string; date?: string };
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
    reactions?: { type?: string; count?: number }[];
  };
  repostedBy?: unknown;
  type?: string;
}

interface RawEmployee {
  firstName?: string;
  lastName?: string;
  name?: string;
  headline?: string;
  position?: string;
  summary?: string;
  currentPositions?: { companyName?: string; title?: string; current?: boolean }[];
  location?: { linkedinText?: string };
  linkedinUrl?: string;
  email?: string | { email?: string; status?: string; qualityScore?: number };
  emails?: string[];
  contactEmails?: string[];
}

interface RawReaction {
  reactionType?: string;
  actor?: { name?: string; position?: string; linkedinUrl?: string };
  postId?: string;
}

interface RawCompany {
  name?: string;
  universalName?: string;
  linkedinUrl?: string;
  website?: string;
  tagline?: string;
  description?: string;
  foundedOn?: { year?: number } | number | null;
  employeeCount?: number;
  employeeCountRange?: { start?: number; end?: number };
  followerCount?: number;
  industries?: { name?: string; title?: string }[];
  specialities?: string[];
  locations?: { city?: string; geographicArea?: string; country?: string; headquarter?: boolean }[];
}

export function linkedinTools(sink: Sink, cache: Cache) {
  const linkedin_profile = apifyTool(sink, cache, {
    id: "linkedin_profile",
    description:
      "Get a person's LinkedIn profile as structured data (name, headline, location, about, experience, follower count). Use for LinkedIn facts instead of fetching linkedin.com pages, which are login-walled. Costs credits — call once per person.",
    type: "linkedin",
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

  const linkedin_posts = apifyTool(sink, cache, {
    id: "linkedin_posts",
    description:
      "Get the recent LinkedIn posts of a person or company profile: text, date, engagement counts, post URLs. Costs credits per post — keep maxPosts small.",
    type: "linkedin",
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

  const linkedin_post_reactions = apifyTool(sink, cache, {
    id: "linkedin_post_reactions",
    description:
      "Get who reacted to a LinkedIn post: reaction type plus each person's name, position, and profile URL. Costs credits per reaction — keep maxReactions small.",
    type: "linkedin",
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

  const linkedin_find_people = apifyTool(sink, cache, {
    id: "linkedin_find_people",
    description:
      "Find people at a company via LinkedIn employee search, filtered by job title. Returns name, title, location, profile URL, and (when findEmails is true) a work email if one can be found. Costs credits per profile and 3x with emails — keep maxItems small and filter by title.",
    type: "linkedin",
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
          email:
            typeof p.email === "object" && p.email
              ? { address: p.email.email, status: p.email.status, qualityScore: p.email.qualityScore }
              : (p.email ?? p.emails?.[0] ?? p.contactEmails?.[0] ?? null),
        };
      }),
    view: (p) => ({ title: p.name, url: p.linkedinUrl, preview: p.title }),
    sourceUrl: (p) => p.linkedinUrl,
  });

  const linkedin_company = apifyTool(sink, cache, {
    id: "linkedin_company",
    description:
      "Get a company's LinkedIn profile as structured data: exact employee count, size range, industry, founded year, headquarters, follower count, website, and description. Use for firmographic facts (headcount, industry, HQ) instead of fetching linkedin.com pages, which are login-walled. Pass the exact COMPANY NAME and let the tool resolve the page — never guess or construct a /company/<slug> URL, as the wrong slug returns a stale decoy page. Only pass a URL if it appeared verbatim in a web_search result. Costs credits — call once per company.",
    type: "linkedin",
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
          foundedYear: typeof c.foundedOn === "object" ? (c.foundedOn?.year ?? null) : (c.foundedOn ?? null),
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
