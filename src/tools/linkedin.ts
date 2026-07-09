import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { runActor } from "./apify.ts";
import { assertVerifiedUrl, clip, record, type Sink } from "./sink.ts";

const LINKEDIN_URL = /^https?:\/\/([\w-]+\.)*linkedin\.com\//i;

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

export function linkedinTools(sink: Sink) {
  const linkedin_profile = createTool({
    id: "linkedin_profile",
    description:
      "Get a person's LinkedIn profile as structured data (name, headline, location, about, experience, follower count). Use for LinkedIn facts instead of fetching linkedin.com pages, which are login-walled. Costs credits — call once per person.",
    inputSchema: z.object({
      url: z.string().describe("LinkedIn profile URL, e.g. https://www.linkedin.com/in/<slug>"),
    }),
    outputSchema: z.object({ profile: z.unknown() }),
    execute: async ({ url }) => {
      assertVerifiedUrl(sink, url, "web_search for the person first, then pass the LinkedIn URL from the results.");
      const { items, usd } = await runActor<RawProfile>(ACTORS.profile, { url });
      sink.cost.apify += usd;
      const p = items[0];
      const profile = p && {
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
      };
      if (profile?.linkedinUrl) sink.sources.add(profile.linkedinUrl);
      record(sink, {
        type: "linkedin",
        query: url,
        resultCount: profile ? 1 : 0,
        results: profile
          ? [{ title: profile.name, url: profile.linkedinUrl, preview: clip(profile.headline) }]
          : [],
        cost: usd,
      });
      return { profile: profile ?? null };
    },
  });

  const linkedin_posts = createTool({
    id: "linkedin_posts",
    description:
      "Get the recent LinkedIn posts of a person or company profile: text, date, engagement counts, post URLs. Costs credits per post — keep maxPosts small.",
    inputSchema: z.object({
      profileUrl: z.string().describe("LinkedIn profile or company URL whose posts to fetch."),
      maxPosts: z.number().int().min(1).max(20).default(5),
    }),
    outputSchema: z.object({ posts: z.array(z.unknown()) }),
    execute: async ({ profileUrl, maxPosts }) => {
      assertVerifiedUrl(sink, profileUrl, "web_search for the profile first, then pass the LinkedIn URL from the results.");
      const { items, usd } = await runActor<RawPost>(ACTORS.posts, {
        targetUrls: [profileUrl],
        maxPosts,
      });
      sink.cost.apify += usd;
      const posts = items.slice(0, maxPosts).map((p) => ({
        url: p.linkedinUrl ?? "",
        postedAt: p.postedAt?.date ?? p.postedAt?.postedAgoText ?? "",
        text: (p.content ?? "").slice(0, 600),
        likes: p.engagement?.likes ?? 0,
        comments: p.engagement?.comments ?? 0,
        shares: p.engagement?.shares ?? 0,
      }));
      for (const p of posts) if (p.url) sink.sources.add(p.url);
      record(sink, {
        type: "linkedin",
        query: `posts:${profileUrl}`,
        resultCount: posts.length,
        results: posts.map((p) => ({ url: p.url, preview: clip(p.text) })),
        cost: usd,
      });
      return { posts };
    },
  });

  const linkedin_post_reactions = createTool({
    id: "linkedin_post_reactions",
    description:
      "Get who reacted to a LinkedIn post: reaction type plus each person's name, position, and profile URL. Costs credits per reaction — keep maxReactions small.",
    inputSchema: z.object({
      postUrl: z.string().describe("Full LinkedIn post URL."),
      maxReactions: z.number().int().min(1).max(100).default(20),
    }),
    outputSchema: z.object({ reactions: z.array(z.unknown()) }),
    execute: async ({ postUrl, maxReactions }) => {
      assertVerifiedUrl(sink, postUrl, "web_search for the post first, then pass the LinkedIn URL from the results.");
      const { items, usd } = await runActor<RawReaction>(ACTORS.reactions, {
        posts: [postUrl],
        maxItems: maxReactions,
      });
      sink.cost.apify += usd;
      const reactions = items.slice(0, maxReactions).map((r) => ({
        type: r.reactionType ?? "",
        name: r.actor?.name ?? "",
        position: (r.actor?.position ?? "").slice(0, 120),
        linkedinUrl: r.actor?.linkedinUrl ?? "",
      }));
      record(sink, {
        type: "linkedin",
        query: `reactions:${postUrl}`,
        resultCount: reactions.length,
        results: reactions.map((r) => ({
          title: r.name,
          url: r.linkedinUrl,
          preview: clip(`${r.type} · ${r.position}`),
        })),
        cost: usd,
      });
      return { reactions };
    },
  });

  const linkedin_find_people = createTool({
    id: "linkedin_find_people",
    description:
      "Find people at a company via LinkedIn employee search, filtered by job title. Returns name, title, location, profile URL, and (when findEmails is true) a work email if one can be found. Costs credits per profile and 3x with emails — keep maxItems small and filter by title.",
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
    outputSchema: z.object({ people: z.array(z.unknown()) }),
    execute: async ({ company, jobTitles, searchQuery, maxItems, findEmails }) => {
      if (LINKEDIN_URL.test(company))
        assertVerifiedUrl(sink, company, "Pass the exact company name instead, or web_search for the company's LinkedIn page first.");
      const { items, usd } = await runActor<RawEmployee>(ACTORS.employees, {
        companies: [company],
        ...(jobTitles?.length ? { jobTitles } : {}),
        ...(searchQuery ? { searchQuery } : {}),
        maxItems,
        profileScraperMode: findEmails ? "Full + email search ($12 per 1k)" : "Short ($4 per 1k)",
      });
      sink.cost.apify += usd;
      const people = items.slice(0, maxItems).map((p) => {
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
      });
      for (const p of people) if (p.linkedinUrl) sink.sources.add(p.linkedinUrl);
      record(sink, {
        type: "linkedin",
        query: `people:${company}`,
        resultCount: people.length,
        results: people.map((p) => ({ title: p.name, url: p.linkedinUrl, preview: clip(p.title) })),
        cost: usd,
      });
      return { people };
    },
  });

  const linkedin_company = createTool({
    id: "linkedin_company",
    description:
      "Get a company's LinkedIn profile as structured data: exact employee count, size range, industry, founded year, headquarters, follower count, website, and description. Use for firmographic facts (headcount, industry, HQ) instead of fetching linkedin.com pages, which are login-walled. Pass the exact COMPANY NAME and let the tool resolve the page — never guess or construct a /company/<slug> URL, as the wrong slug returns a stale decoy page. Only pass a URL if it appeared verbatim in a web_search result. Costs credits — call once per company.",
    inputSchema: z.object({
      company: z
        .string()
        .describe(
          "Exact company name (preferred — the tool resolves the right page). A linkedin.com/company URL is accepted ONLY if it came from a web_search result; constructed/guessed URLs are rejected.",
        ),
    }),
    outputSchema: z.object({ company: z.unknown() }),
    execute: async ({ company }) => {
      const isUrl = /linkedin\.com\/company\//i.test(company);
      if (isUrl)
        assertVerifiedUrl(sink, company, "Pass the exact company name instead, or web_search for the company's LinkedIn page first.");
      const { items, usd } = await runActor<RawCompany>(ACTORS.company, {
        ...(isUrl ? { companies: [company] } : { searches: [company] }),
      });
      sink.cost.apify += usd;
      const c = items[0];
      const hq = c?.locations?.find((l) => l.headquarter) ?? c?.locations?.[0];
      const range = c?.employeeCountRange;
      const profile = c && {
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
        headquarters: hq
          ? [hq.city, hq.geographicArea, hq.country].filter(Boolean).join(", ")
          : "",
      };
      if (profile?.linkedinUrl) sink.sources.add(profile.linkedinUrl);
      record(sink, {
        type: "linkedin",
        query: `company:${company}`,
        resultCount: profile ? 1 : 0,
        results: profile
          ? [{ title: profile.name, url: profile.linkedinUrl, preview: clip(profile.industry) }]
          : [],
        cost: usd,
      });
      return { company: profile ?? null };
    },
  });

  return { linkedin_profile, linkedin_posts, linkedin_post_reactions, linkedin_find_people, linkedin_company };
}
