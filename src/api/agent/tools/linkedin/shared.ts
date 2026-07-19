import { z } from "zod";
import { createApifyRunner } from "../apify.ts";

export const LINKEDIN_URL = /^https?:\/\/([\w-]+\.)*linkedin\.com\//i;
export const COMPANY_URL = /linkedin\.com\/company\//i;

export const ACTORS = {
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

export const runProfileActor = createApifyRunner(RawProfileSchema);
export const runPostsActor = createApifyRunner(RawPostSchema);
export const runEmployeesActor = createApifyRunner(RawEmployeeSchema);
export const runReactionsActor = createApifyRunner(RawReactionSchema);
export const runCompanyActor = createApifyRunner(RawCompanySchema);

export function emailAddress(address?: string): { address: string } | null {
  return address ? { address } : null;
}
