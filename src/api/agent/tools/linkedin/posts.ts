import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordProviderResults } from "../apify.ts";
import { assertVerifiedUrl, type RunContext } from "../../sink.ts";
import { ACTORS, runPostsActor } from "./shared.ts";

const InputSchema = z.object({
  profileUrl: z.string().describe("LinkedIn profile or company URL whose posts to fetch."),
  maxPosts: z.number().int().min(1).max(20).default(5),
});

export function linkedinPostsTool(context: RunContext) {
  return createTool({
    id: "linkedin_posts",
    description:
      "Get the recent LinkedIn posts of a person or company profile: text, date, engagement counts, post URLs. Costs credits per post — keep maxPosts small.",
    inputSchema: InputSchema,
    outputSchema: z.object({ posts: z.array(z.unknown()) }),
    execute: async ({ profileUrl, maxPosts }) => {
      assertVerifiedUrl(
        context,
        profileUrl,
        "web_search for the profile first, then pass the LinkedIn URL from the results.",
      );
      const items = await runPostsActor(ACTORS.posts, { targetUrls: [profileUrl], maxPosts });
      const posts = items.slice(0, maxPosts).map((item) => ({
        url: item.linkedinUrl ?? "",
        postedAt: item.postedAt?.date ?? item.postedAt?.postedAgoText ?? "",
        text: (item.content ?? "").slice(0, 600),
        likes: item.engagement?.likes ?? 0,
        comments: item.engagement?.comments ?? 0,
        shares: item.engagement?.shares ?? 0,
      }));
      recordProviderResults(
        context,
        "linkedin",
        `posts:${profileUrl}`,
        posts.map((post) => ({ url: post.url, preview: post.text })),
      );
      return { posts };
    },
  });
}
