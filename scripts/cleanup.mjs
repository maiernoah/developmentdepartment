// Tidies Markdown that came out of Notion (via Super.so) and Ghost.
// Used by import.mjs on every page, and runnable on its own to re-tidy
// files already in the repo:  node scripts/cleanup.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// [![Name](/assets/images/x.svg)Name](/url) -> [Name](/url)
// Notion page mentions carry the linked page's icon inside the link.
const ICON_IN_LINK = /\[!\[[^\]]*\]\([^)]*\)\s*([^\]]+)\]\(/g;

// A line made only of links glued together, as Notion galleries and
// lists of linked pages come out: [A](/a)[B](/b)[C](/c)
const LINK = String.raw`\[[^\]]+\]\([^)\s]+\)`;
const GLUED_LINKS = new RegExp(String.raw`^(${LINK})(${LINK})+\s*$`);
const ONE_LINK = new RegExp(LINK, "g");

export function cleanMarkdown(md) {
  const out = [];
  md = md
    .replace(ICON_IN_LINK, "[$1](")
    // Scheme-less links to the site itself ("www.developmentdepartment.org/x/").
    // An import that predates the scheme fix resolved them against the page:
    // "/7steps/www.developmentdepartment.org/asking/".
    .replace(/\]\((?:https?:\/\/|\/[^)\s]*?\/)?(?:www\.)?developmentdepartment\.org(\/[^)]*)?\)/gi, (_m, p) => "](" + (p || "/") + ")");
  for (let line of md.split("\n")) {
    // Notion toggle and mention markers with nothing else on the line.
    if (/^\s*‣\s*$/.test(line)) continue;
    line = line.replace(/\s*‣\s*$/, "");
    if (GLUED_LINKS.test(line.trim())) {
      out.push(...line.trim().match(ONE_LINK).map((l) => "- " + l));
      continue;
    }
    out.push(line);
  }
  // Turndown pads list markers ("-   item", "1.  item").
  return out
    .join("\n")
    .replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, "$1$2 ")
    .replace(/\n{3,}/g, "\n\n");
}

async function* markdownFiles(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(p);
    else if (entry.name.endsWith(".md")) yield p;
  }
}

async function main() {
  let changed = 0;
  for (const dir of ["src/content", "src/fast-decisions"]) {
    for await (const file of markdownFiles(dir)) {
      const text = await fs.readFile(file, "utf8");
      const end = text.indexOf("\n---", 4);
      const head = end > 0 ? text.slice(0, end + 4) : "";
      const body = end > 0 ? text.slice(end + 4) : text;
      const next = head + cleanMarkdown(body);
      if (next !== text) {
        await fs.writeFile(file, next);
        changed++;
      }
    }
  }
  console.log(`cleanup: ${changed} files changed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
