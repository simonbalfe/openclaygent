import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clip, record, type Sink } from "./web.ts";

const APIFY = "https://api.apify.com/v2";

async function runActor<T>(actor: string, input: unknown): Promise<T[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not set");
  const res = await fetch(
    `${APIFY}/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=120`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(`Apify ${actor} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T[]>;
}

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
      const items = await runActor<RawProfile>("harvestapi~linkedin-profile-scraper", { url });
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
      const items = await runActor<RawPost>("harvestapi~linkedin-profile-posts", {
        targetUrls: [profileUrl],
        maxPosts,
      });
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
      const items = await runActor<RawReaction>("harvestapi~linkedin-post-reactions", {
        posts: [postUrl],
        maxItems: maxReactions,
      });
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
      const items = await runActor<RawEmployee>("harvestapi~linkedin-company-employees", {
        companies: [company],
        ...(jobTitles?.length ? { jobTitles } : {}),
        ...(searchQuery ? { searchQuery } : {}),
        maxItems,
        profileScraperMode: findEmails ? "Full + email search ($12 per 1k)" : "Short ($4 per 1k)",
      });
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
      });
      return { people };
    },
  });

  const linkedin_company = createTool({
    id: "linkedin_company",
    description:
      "Get a company's LinkedIn profile as structured data: exact employee count, size range, industry, founded year, headquarters, follower count, website, and description. Use for firmographic facts (headcount, industry, HQ) instead of fetching linkedin.com pages, which are login-walled. Costs credits — call once per company.",
    inputSchema: z.object({
      company: z
        .string()
        .describe(
          "LinkedIn company URL (preferred, e.g. https://www.linkedin.com/company/grow-with-clay) or exact company name to search.",
        ),
    }),
    outputSchema: z.object({ company: z.unknown() }),
    execute: async ({ company }) => {
      const isUrl = /linkedin\.com\/company\//i.test(company);
      const items = await runActor<RawCompany>("harvestapi~linkedin-company", {
        ...(isUrl ? { companies: [company] } : { searches: [company] }),
      });
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
      });
      return { company: profile ?? null };
    },
  });

  return { linkedin_profile, linkedin_posts, linkedin_post_reactions, linkedin_find_people, linkedin_company };
}
