import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordProviderResults } from "../apify.ts";
import { assertVerifiedUrl, type RunContext } from "../../sink.ts";
import { ACTORS, runProfileActor } from "./shared.ts";

const InputSchema = z.object({
  url: z.string().describe("LinkedIn profile URL, e.g. https://www.linkedin.com/in/<slug>"),
});

export function linkedinProfileTool(context: RunContext) {
  return createTool({
    id: "linkedin_profile",
    description:
      "Get a person's LinkedIn profile as structured data (name, headline, location, about, experience, follower count). Use for LinkedIn facts instead of fetching linkedin.com pages, which are login-walled. Costs credits — call once per person.",
    inputSchema: InputSchema,
    outputSchema: z.object({ profile: z.unknown() }),
    execute: async ({ url }) => {
      assertVerifiedUrl(
        context,
        url,
        "web_search for the person first, then pass the LinkedIn URL from the results.",
      );
      const items = await runProfileActor(ACTORS.profile, { url });
      const profile = items.slice(0, 1).map((item) => ({
        name: [item.firstName, item.lastName].filter(Boolean).join(" "),
        headline: item.headline ?? "",
        location: item.location?.linkedinText ?? "",
        about: (item.about ?? "").slice(0, 1500),
        linkedinUrl: item.linkedinUrl ?? url,
        publicIdentifier: item.publicIdentifier ?? "",
        followers: item.followerCount ?? null,
        connections: item.connectionsCount ?? null,
        experience: (item.experience ?? []).slice(0, 5).map((experience) => ({
          position: experience.position ?? "",
          company: experience.companyName ?? "",
          duration: experience.duration ?? "",
        })),
      }))[0] ?? null;
      recordProviderResults(
        context,
        "linkedin",
        url,
        profile ? [{ title: profile.name, url: profile.linkedinUrl, preview: profile.headline }] : [],
      );
      return { profile };
    },
  });
}
