import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordProviderResults } from "../apify.ts";
import { assertVerifiedUrl, type RunContext } from "../../sink.ts";
import { ACTORS, runReactionsActor } from "./shared.ts";

const InputSchema = z.object({
  postUrl: z.string().describe("Full LinkedIn post URL."),
  maxReactions: z.number().int().min(1).max(100).default(20),
});

export function linkedinReactionsTool(context: RunContext) {
  return createTool({
    id: "linkedin_post_reactions",
    description:
      "Get who reacted to a LinkedIn post: reaction type plus each person's name, position, and profile URL. Costs credits per reaction — keep maxReactions small.",
    inputSchema: InputSchema,
    outputSchema: z.object({ reactions: z.array(z.unknown()) }),
    execute: async ({ postUrl, maxReactions }) => {
      assertVerifiedUrl(
        context,
        postUrl,
        "web_search for the post first, then pass the LinkedIn URL from the results.",
      );
      const items = await runReactionsActor(
        ACTORS.reactions,
        { posts: [postUrl], maxItems: maxReactions },
      );
      const reactions = items.slice(0, maxReactions).map((item) => ({
        type: item.reactionType ?? "",
        name: item.actor?.name ?? "",
        position: (item.actor?.position ?? "").slice(0, 120),
        linkedinUrl: item.actor?.linkedinUrl ?? "",
      }));
      recordProviderResults(
        context,
        "linkedin",
        `reactions:${postUrl}`,
        reactions.map((reaction) => ({
          title: reaction.name,
          url: reaction.linkedinUrl,
          preview: `${reaction.type} · ${reaction.position}`,
        })),
        false,
      );
      return { reactions };
    },
  });
}
