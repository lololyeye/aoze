// The CSP only applies to release builds (not `tauri dev`): a missing source
// here breaks the installed app while every dev test passes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
  app: { security: { csp: Record<string, string> } };
};
const csp = conf.app.security.csp;

describe("content security policy", () => {
  it.each(["img-src", "media-src"])("%s allows local files served by the asset protocol", (directive) => {
    const sources = csp[directive]?.split(/\s+/) ?? [];
    expect(sources).toContain("asset:");
    expect(sources).toContain("http://asset.localhost");
  });
});
