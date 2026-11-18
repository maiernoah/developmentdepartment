// One-time import of the two old sites into this repo.
//
//   developmentdepartment.org (Ghost)  -> src/content/posts, src/content/pages
//                                         same URLs as today
//   fastdecisions.org (Super.so/Notion) -> src/fast-decisions
//                                         URLs move under /fast-decisions/
//
// It reads each site's public sitemap, fetches every page, keeps the article
// body, converts it to Markdown, downloads images to src/assets/images and
// rewrites links between the two sites. It also writes redirect pages for
// fastdecisions.org into redirects/fastdecisions.org, to be published only
// once Noah decides how that domain should behave.
//
// Runs in GitHub Actions (see .github/workflows/import.yml) because it needs
// the open internet. Re-running overwrites imported files; pages written by
// hand should not live in the imported folders.

import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { cleanMarkdown } from "./cleanup.mjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SITE_URL = "https://www.developmentdepartment.org";
const UA = "developmentdepartment-site-import/1.0";
const IMAGE_DIR = "src/assets/images";
const REPORT = "import-report.json";

const DD_HOSTS = new Set(["developmentdepartment.org", "www.developmentdepartment.org"]);
const FD_HOSTS = new Set(["fastdecisions.org", "www.fastdecisions.org"]);

// Ghost sub-sitemaps that hold listing pages we rebuild ourselves.
const GHOST_SKIP_SITEMAPS = /sitemap-(tags|authors)\.xml$/;

const SOURCES = [
  {
    key: "dd",
    sitemap: process.env.IMPORT_DD_SITEMAP || "https://www.developmentdepartment.org/sitemap.xml",
    // Most Ghost themes put the post body in one of these.
    bodySelectors: [".gh-content", ".post-content", ".post-full-content", ".page-content", ".article-content", "article", "main"],
  },
  {
    key: "fd",
    sitemap: process.env.IMPORT_FD_SITEMAP || "https://fastdecisions.org/sitemap.xml",
    // Super.so renders Notion pages inside these.
    bodySelectors: [".super-content", ".notion-page-content", ".notion-root", "article", "main"],
  },
];

// Things that must not come across: Ghost member forms, scripts, site chrome.
const STRIP = [
  "script", "style", "noscript", "form", "header", "footer", "nav",
  ".kg-signup-card", ".gh-subscribe", ".gh-post-upgrade-cta", "[data-members-form]",
  ".super-navbar", ".super-footer", ".notion-header", ".notion-breadcrumb",
  ".gh-share", ".post-share", ".comments", "#ghost-portal-root",
];

const failures = [];
const report = { dd: [], fd: [], images: 0, failures };
const imageCache = new Map();

async function get(url, { binary = false, tries = 3 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return binary
        ? { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "", finalUrl: res.url }
        : { text: await res.text(), finalUrl: res.url };
    } catch (err) {
      if (i === tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function sitemapUrls(url, kind = null) {
  const { text } = await get(url);
  const $ = cheerio.load(text, { xmlMode: true });
  const nested = $("sitemapindex > sitemap > loc").map((_, el) => $(el).text().trim()).get();
  if (nested.length) {
    const out = [];
    for (const sub of nested) {
      if (GHOST_SKIP_SITEMAPS.test(sub)) continue;
      const subKind = /sitemap-posts\.xml$/.test(sub) ? "post" : /sitemap-pages\.xml$/.test(sub) ? "page" : null;
      out.push(...(await sitemapUrls(sub, subKind)));
    }
    return out;
  }
  return $("urlset > url > loc").map((_, el) => ({ url: $(el).text().trim(), kind })).get();
}

// "/a/b/" -> "a/b"; "/" -> ""
function slugPath(u) {
  return new URL(u).pathname.replace(/^\/+|\/+$/g, "");
}

// pageHost/sourceKey: a relative link on a page belongs to the site the page
// came from, whatever host served it.
function newPathFor(absUrl, pageHost, sourceKey) {
  const u = new URL(absUrl);
  const p = u.pathname.replace(/\/+$/, "");
  const fromSelf = u.hostname === pageHost;
  if (DD_HOSTS.has(u.hostname) || (fromSelf && sourceKey === "dd")) return (p || "") + "/" + u.hash;
  if (FD_HOSTS.has(u.hostname) || (fromSelf && sourceKey === "fd")) return "/fast-decisions" + p + "/" + u.hash;
  return null;
}

const IMAGE_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg", "image/avif": ".avif" };

// Super.so serves images through Next.js (/_next/image?url=...). Notion's
// own image URLs are signed and expire, so they must be downloaded now.
function unwrapImageUrl(src, base) {
  const u = new URL(src, base);
  if (u.pathname.startsWith("/_next/image") && u.searchParams.get("url")) {
    return new URL(u.searchParams.get("url"), base).href;
  }
  return u.href;
}

async function localImage(src, base) {
  if (!src || src.startsWith("data:")) return src;
  let abs;
  try {
    abs = unwrapImageUrl(src, base);
  } catch {
    return src;
  }
  if (imageCache.has(abs)) return imageCache.get(abs);
  try {
    const { buf, type } = await get(abs, { binary: true });
    const ext = IMAGE_EXT[type.split(";")[0].trim()] || path.extname(new URL(abs).pathname) || ".bin";
    const name = crypto.createHash("sha1").update(abs).digest("hex").slice(0, 16) + ext;
    await fs.writeFile(path.join(IMAGE_DIR, name), buf);
    const local = "/assets/images/" + name;
    imageCache.set(abs, local);
    report.images++;
    return local;
  } catch (err) {
    failures.push({ image: abs, error: err.message });
    imageCache.set(abs, abs);
    return abs;
  }
}

function meta($, name) {
  return (
    $(`meta[property="${name}"]`).attr("content") ||
    $(`meta[name="${name}"]`).attr("content") ||
    ""
  ).trim();
}

function pickBody($, selectors) {
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 40) return el;
  }
  return $("body");
}

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", hr: "---" });
td.use(gfm);
td.keep(["iframe", "video", "audio"]);
// Ghost cards that have no Markdown equivalent come across as HTML.
td.addRule("ghostGallery", {
  filter: (node) => node.nodeName === "FIGURE" && /kg-(gallery|embed|video|audio|bookmark)-card/.test(node.getAttribute("class") || ""),
  replacement: (_c, node) => "\n\n" + node.outerHTML + "\n\n",
});

function yamlString(s) {
  return JSON.stringify(String(s ?? ""));
}

async function importPage(source, { url, kind }) {
  const { text, finalUrl } = await get(url);
  const $ = cheerio.load(text);

  const isFdHome = source.key === "fd" && slugPath(url) === "";
  const title = isFdHome ? "Fast Decisions" :
    meta($, "og:title").replace(/\s*[|·–-]\s*(Development Department|Fast Decisions.*)$/i, "") ||
    $("h1").first().text().trim() ||
    $("title").text().trim();

  const body = pickBody($, source.bodySelectors);
  body.find(STRIP.join(",")).remove();
  // The page title is rendered by our layout.
  body.find("h1").first().filter((_, el) => $(el).text().trim() === title).remove();

  for (const img of body.find("img").toArray()) {
    const $img = $(img);
    const src = $img.attr("src") || $img.attr("data-src");
    $img.attr("src", await localImage(src, finalUrl));
    $img.removeAttr("srcset").removeAttr("sizes").removeAttr("loading").removeAttr("data-src");
  }
  for (const a of body.find("a[href]").toArray()) {
    const $a = $(a);
    const href = $a.attr("href");
    if (/^(mailto:|tel:|#)/.test(href)) continue;
    // Some Ghost posts link "www.example.org/..." with no scheme.
    if (/^www\./i.test(href)) $a.attr("href", (href = "https://" + href));
    try {
      const mapped = newPathFor(new URL(href, finalUrl).href, new URL(finalUrl).hostname, source.key);
      if (mapped) $a.attr("href", mapped);
    } catch {}
  }

  const markdown = cleanMarkdown(td.turndown(body.html() || "")).trim() + "\n";
  const slug = slugPath(url);
  const featureSrc = meta($, "og:image");
  const feature = source.key === "dd" && kind === "post" && featureSrc ? await localImage(featureSrc, finalUrl) : "";

  let file, permalink;
  if (source.key === "dd") {
    if (slug === "") return null; // the home page is rebuilt by hand
    file = path.join("src/content", kind === "page" ? "pages" : "posts", slug + ".md");
    permalink = "/" + slug + "/";
  } else {
    file = slug === "" ? "src/fast-decisions/index.md" : path.join("src/fast-decisions", slug + ".md");
    permalink = slug === "" ? "/fast-decisions/" : "/fast-decisions/" + slug + "/";
  }

  const fm = [
    "---",
    `title: ${yamlString(title)}`,
    `permalink: ${permalink}`,
    `source_url: ${url}`,
  ];
  const published = meta($, "article:published_time");
  if (published) fm.push(`date: ${published}`);
  const modified = meta($, "article:modified_time");
  if (modified) fm.push(`updated: ${modified}`);
  const description = meta($, "description") || meta($, "og:description");
  // Notion descriptions often hold only a page-mention marker.
  if (description && !description.includes("‣")) fm.push(`description: ${yamlString(description)}`);
  if (feature) fm.push(`feature_image: ${feature}`);
  const tags = $('meta[property="article:tag"]').map((_, el) => $(el).attr("content")).get();
  if (tags.length) fm.push(`topics: ${JSON.stringify(tags)}`);
  // Ghost marks members-only posts; flag them so Noah can decide what to do.
  if ($(".gh-post-upgrade-cta, .post-upgrade-cta, [data-members-only]").length) fm.push("members_only_on_ghost: true");
  fm.push("---", "");

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, fm.join("\n") + "\n" + markdown);
  return { url, file, permalink, title, chars: markdown.length };
}

function redirectHtml(target) {
  return `<!doctype html><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${target}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${target}"><p>This page moved to <a href="${target}">${target}</a>.</p>\n`;
}

async function writeFastDecisionsRedirects(pages) {
  const root = "redirects/fastdecisions.org";
  await fs.rm(root, { recursive: true, force: true });
  const map = {};
  for (const p of pages) {
    const oldPath = new URL(p.url).pathname;
    const target = SITE_URL + p.permalink;
    map[oldPath] = target;
    const out = oldPath === "/" ? path.join(root, "index.html") : path.join(root, oldPath.replace(/^\/|\/$/g, ""), "index.html");
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, redirectHtml(target));
  }
  await fs.writeFile(path.join(root, "404.html"), redirectHtml(SITE_URL + "/fast-decisions/"));
  await fs.writeFile("redirects/fastdecisions-map.json", JSON.stringify(map, null, 2) + "\n");
}

async function main() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  for (const source of SOURCES) {
    const urls = await sitemapUrls(source.sitemap);
    console.log(`${source.key}: ${urls.length} URLs in sitemap`);
    for (const entry of urls) {
      try {
        const done = await importPage(source, entry);
        if (done) report[source.key].push(done);
        console.log(`  ok ${entry.url}`);
      } catch (err) {
        failures.push({ page: entry.url, error: err.message });
        console.log(`  FAIL ${entry.url}: ${err.message}`);
      }
    }
  }
  await writeFastDecisionsRedirects(report.fd);
  // Pages whose body came out nearly empty probably used a layout the
  // selectors missed. List them for a human look.
  report.thin = [...report.dd, ...report.fd].filter((p) => p.chars < 400).map((p) => p.url);
  await fs.writeFile(REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(`done: ${report.dd.length} Development Department, ${report.fd.length} Fast Decisions, ${report.images} images, ${failures.length} failures, ${report.thin.length} thin pages`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
