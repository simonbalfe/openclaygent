import type TurndownService from "turndown";
import { createRequire } from "node:module";

interface GfmModule {
  gfm: TurndownService.Plugin;
}

function isGfmModule(value: unknown): value is GfmModule {
  return typeof value === "object" && value !== null && "gfm" in value && typeof value.gfm === "function";
}

const require = createRequire(import.meta.url);
const loaded: unknown = require("turndown-plugin-gfm");
if (!isGfmModule(loaded)) throw new Error("turndown-plugin-gfm did not export a gfm plugin");

export const gfm = loaded.gfm;
