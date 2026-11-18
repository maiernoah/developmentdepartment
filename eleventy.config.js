import { HtmlBasePlugin } from "@11ty/eleventy";
import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import fs from "node:fs";

const site = JSON.parse(fs.readFileSync("src/_data/site.json", "utf8"));

export default function (eleventyConfig) {
  // PATH_PREFIX lets the draft run at maiernoah.github.io/developmentdepartment/
  // before the custom domain is switched. HtmlBasePlugin rewrites every
  // absolute URL in the output to match.
  eleventyConfig.addPlugin(HtmlBasePlugin);

  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });

  eleventyConfig.addCollection("posts", (api) =>
    api
      .getFilteredByGlob("src/content/posts/**/*.md")
      .filter((p) => !p.data.draft)
      .sort((a, b) => b.date - a.date),
  );

  eleventyConfig.addCollection("fastDecisions", (api) =>
    api
      .getFilteredByGlob("src/fast-decisions/**/*.md")
      .filter((p) => p.url !== "/fast-decisions/")
      .sort((a, b) => (a.data.title || "").localeCompare(b.data.title || "")),
  );

  eleventyConfig.addFilter("readableDate", (d) =>
    new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }),
  );
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter("head", (arr, n) => (arr || []).slice(0, n));
  eleventyConfig.addFilter("year", () => new Date().getUTCFullYear());

  // Ghost served its feed at /rss/. GitHub Pages answers /rss/ with
  // /rss/index.html, so the feed is written there to keep existing feed
  // readers working (served as text/html, which readers tolerate).
  // /feed.xml is the conventional address with the right content type.
  for (const output of ["/rss/index.html", "/feed.xml"]) {
    eleventyConfig.addPlugin(feedPlugin, {
      type: "rss",
      outputPath: output,
      inputPath: `feed-${output.replace(/[^a-z]/g, "")}.njk`,
      collection: { name: "posts", limit: 30 },
      metadata: {
        language: "en",
        title: site.title,
        subtitle: site.tagline,
        base: site.url + "/",
        author: { name: site.author },
      },
    });
  }

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
