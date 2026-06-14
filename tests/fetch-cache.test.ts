import { expect, test } from "bun:test";
import { isDeadStatus } from "../src/tools/fetch.ts";

test("isDeadStatus: 401/404/410 are definitively dead", () => {
  for (const s of [401, 404, 410]) expect(isDeadStatus(s)).toBe(true);
});

test("isDeadStatus: 403 escalates (not dead), and transient codes are not dead", () => {
  for (const s of [200, 403, 429, 500, 502, 503, 0]) expect(isDeadStatus(s)).toBe(false);
});
