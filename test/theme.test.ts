import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateThemeJson } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-json.js";
import { loadThemeFromPath, setThemeJsonValidator } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const path = new URL("../themes/fuyao-soft.json", import.meta.url).pathname;

test("standalone palette validates and resolves through Pi's native theme loader", async () => {
  const json = JSON.parse(await readFile(path, "utf8"));
  validateThemeJson("fuyao-soft", json);
  setThemeJsonValidator(validateThemeJson);
  for (const mode of ["truecolor", "256color"] as const) {
    const theme = loadThemeFromPath(path, mode);
    expect(theme.name).toBe("fuyao-soft");
    for (const role of Object.keys(json.colors)) {
      const rendered = role.endsWith("Bg")
        ? theme.bg(role as Parameters<typeof theme.bg>[0], "sample")
        : theme.fg(role as Parameters<typeof theme.fg>[0], "sample");
      expect(rendered).toContain("sample");
    }
  }
});
