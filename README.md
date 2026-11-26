# Class of 2029 Course Notes (ESUT LAWSA)

A static website. No database, no server code, no installed packages.

## Where things are
| Path | What it is |
|---|---|
| `notes/<level>/` | PDF notes. Files in `300-level` go in its three subfolders |
| `know-your-pedagogy/` | Flyers (PNG/JPG/WEBP), announcement text (TXT), PDFs |
| `site.config.json` | Site title, hero text, levels and subsections |
| `src/` | Page (`index.html`), design (`styles.css`), behaviour (`app.js`), logos |
| `scripts/build.mjs` | Scans your folders and builds the site into `dist/` |
| `vercel.json` | Tells Vercel how to build |

## First deployment
1. Create a GitHub repository. Upload the CONTENTS of this folder, so `package.json` is at the top level.
2. On Vercel: Add New > Project > import the repository. Framework preset: Other.
3. Add the environment variable `VERCEL_DEEP_CLONE` = `true`, then Deploy.
   (Reported by users to give full Git history; Vercel does not officially document it.)

## Upload a note
1. Keep each file under 25 MB (GitHub's browser limit). Name it clearly: students see and search this name.
2. On GitHub open the folder, e.g. `notes/300-level/torts-law`.
3. Add file > Upload files > choose PDFs > Commit changes.
4. Vercel rebuilds automatically. Check the deployment shows Ready.

- Same name uploaded again: file is replaced, no new announcement.
- Renamed file: treated as new and announced again.
- Delete: open the file on GitHub, delete it, commit.

## Know Your Pedagogy
Files with the same name make one edition:

    Edition 02 - Dean's Directive.png
    Edition 02 - Dean's Directive.txt
    Edition 02 - Dean's Directive.pdf   (optional)

Extra images: `Edition 02 - Dean's Directive (2).png`.
In the TXT file, `*bold*`, `_italic_` and lines starting with `- ` are formatted. Save it as UTF-8.

## Add subsections later
1. In `site.config.json`, edit the level. Example:

       { "id": "200", "folder": "200-level", "subsections": [
         { "folder": "contract-law", "name": "Contract Law" }
       ] },

2. On GitHub: Add file > Create new file > name it `notes/200-level/contract-law/README.md` > commit.
3. Upload PDFs into that folder. Folder names must match exactly (lowercase, hyphens).

Notes left directly in a level folder appear under "General".

## Preview on a computer (optional, needs Node.js)
    npm run preview
Then open http://localhost:3000

## If something goes wrong
- Vercel build failed: read the build log. A missing comma or quote in `site.config.json` is a likely cause.
- A file is missing: check its folder and extension, then look for WARNING lines in the build log.
- Whole site shows 404: `package.json` and `vercel.json` are probably inside an extra folder.
