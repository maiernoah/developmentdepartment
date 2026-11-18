# Development Department

The site at developmentdepartment.org, rebuilt as a static site for GitHub Pages, with the Fast Decisions site (fastdecisions.org) folded in under `/fast-decisions/`.

Built with [Eleventy](https://www.11ty.dev/). Posts and pages are Markdown files.

## Layout

| Path | What it holds |
| --- | --- |
| `src/content/posts/` | Development Department essays. Same URLs as on Ghost (`/slug/`). |
| `src/content/pages/` | Standalone pages: about, photographs, photo essays. Same URLs as on Ghost. |
| `src/fast-decisions/` | Fast Decisions pages, now at `/fast-decisions/slug/`. |
| `src/assets/images/` | Images downloaded from Ghost, Unsplash and Super.so during import. |
| `redirects/fastdecisions.org/` | One redirect page per old Fast Decisions URL, for whenever that domain is pointed somewhere. Not deployed yet. |
| `scripts/import.mjs` | One-time import from both old sites. |

## Writing a new post

Add `src/content/posts/my-slug.md`:

```markdown
---
title: "My title"
date: 2026-12-01
description: "One line for search results and link previews."
---

Body in Markdown.
```

## Local preview

```sh
npm install
npm run serve
```

## Importing the old sites

The import needs the open internet, so it runs in GitHub Actions: Actions tab, "Import old sites", Run workflow. It opens a pull request with the imported content and `import-report.json`, which lists failures and pages whose body came out thin (worth a look before merging).

## Publishing

`Deploy to GitHub Pages` is manual for now. Before it can run, turn on Pages for this repo with Source set to GitHub Actions. Until the domain switch it builds for `maiernoah.github.io/developmentdepartment/`.

## Not carried over from Ghost

- Member signups and the email newsletter. Needs a newsletter service and an export of the Ghost member list.
- Members-only posts, if any. The import marks them with `members_only_on_ghost: true`.
- Comments, search and tag pages.

## Domain switch (not done; waits on Noah)

1. Keep every existing mail record (MX, TXT/SPF, DKIM) at Namecheap.
2. developmentdepartment.org: apex A records to GitHub Pages, `www` CNAME to `maiernoah.github.io`, custom domain set in Pages settings, HTTPS enforced.
3. Set repository variable `PATH_PREFIX` to `/` and switch the deploy trigger to push.
4. fastdecisions.org: decide between a redirect to `/fast-decisions/` (publish `redirects/fastdecisions.org` as its own Pages site) or letting it lapse.
