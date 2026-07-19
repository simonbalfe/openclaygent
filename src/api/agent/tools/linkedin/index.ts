import type { RunContext } from "../../sink.ts";
import { linkedinCompanyTool } from "./company.ts";
import { linkedinPeopleTool } from "./people.ts";
import { linkedinPostsTool } from "./posts.ts";
import { linkedinProfileTool } from "./profile.ts";
import { linkedinReactionsTool } from "./reactions.ts";

export function linkedinTools(context: RunContext) {
  return {
    linkedin_profile: linkedinProfileTool(context),
    linkedin_posts: linkedinPostsTool(context),
    linkedin_post_reactions: linkedinReactionsTool(context),
    linkedin_find_people: linkedinPeopleTool(context),
    linkedin_company: linkedinCompanyTool(context),
  };
}
