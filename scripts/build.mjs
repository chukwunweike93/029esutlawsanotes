// Builds the website into /dist. Vercel runs this automatically after every upload.
// It scans the notes folders, so you never type a list of files by hand.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const warnings = [];
let totalBytes = 0;

const config = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));

/* ---------- Upload dates (from Git history) ---------- */
function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

function readUploadDates() {
  const dates = new Map();
  try {
    // A "shallow" clone has cut-off history. Its oldest commits falsely look as if
    // they added every file, so those files get no date instead of a wrong one.
    const shallowFile = path.resolve(ROOT, git(['rev-parse', '--git-path', 'shallow']).trim());
    const cutOff = new Set(existsSync(shallowFile) ? readFileSync(shallowFile, 'utf8').split(/\s+/) : []);
    const log = git(['-c', 'core.quotepath=off', 'log', '--no-renames', '--diff-filter=A',
      '--relative', '--name-only', '--format=@@%H|%cI', '--', 'notes', 'know-your-pedagogy']);
    let commit = null;
    for (const line of log.split('\n')) {
      if (line.startsWith('@@')) {
        const [hash, date] = line.slice(2).split('|');
        commit = { hash, date };
      } else if (line && commit && !dates.has(line)) {
        // Newest commit comes first, so the first match is the latest upload.
        dates.set(line, cutOff.has(commit.hash) ? null : commit.date);
      }
    }
    if (cutOff.size) {
      console.log('Note: shallow Git history. Older files have no date. Set VERCEL_DEEP_CLONE=true to fix.');
    }
    return { dates, hasGit: true };
  } catch {
    return { dates, hasGit: false };
  }
}
const { dates, hasGit } = readUploadDates();

/* ---------- Helpers ---------- */
async function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const toPosix = (p) => p.split(path.sep).join('/');
const toUrl = (rel) => '/files/' + rel.split('/').map(encodeURIComponent).join('/');

async function publish(full) {
  const rel = toPosix(path.relative(ROOT, full));
  const info = await stat(full);
  const target = path.join(DIST, 'files', rel);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(full, target);
  totalBytes += info.size;
  if (info.size > 25 * 1024 * 1024) warnings.push(`Very large file (over 25 MB), please compress: ${rel}`);
  let addedAt = null;
  if (dates.has(rel)) addedAt = dates.get(rel);
  else if (!process.env.VERCEL) addedAt = info.mtime.toISOString(); // local preview only
  return { url: toUrl(rel), fileName: path.basename(full), size: info.size, addedAt };
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });

/* ---------- Start ---------- */
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'src'), DIST, { recursive: true });

const levels = [];
for (const level of config.levels) {
  const base = path.join(ROOT, 'notes', level.folder);
  const known = new Map(level.subsections.map((s) => [s.folder, s]));
  const notes = [];
  for (const full of await walk(base)) {
    const ext = path.extname(full).toLowerCase();
    if (ext !== '.pdf') {
      if (path.basename(full) !== 'README.md') warnings.push(`Skipped (not a PDF): ${path.relative(ROOT, full)}`);
      continue;
    }
    const parts = toPosix(path.relative(base, full)).split('/');
    const folder = parts.length > 1 ? parts[0] : null;
    if (folder && !known.has(folder)) {
      warnings.push(`Folder "${folder}" in ${level.folder} is not listed in site.config.json. Its file shows under "General".`);
    }
    notes.push({
      name: path.basename(full).slice(0, -ext.length),
      subsection: known.has(folder) ? folder : null,
      ...await publish(full)
    });
  }
  notes.sort(byName);
  levels.push({ id: level.id, subsections: level.subsections, notes });
}

/* Know Your Pedagogy: files sharing a name make one edition. */
const editions = new Map();
for (const full of await walk(path.join(ROOT, 'know-your-pedagogy'))) {
  if (path.basename(full) === 'README.md') continue;
  const ext = path.extname(full).toLowerCase();
  if (!IMAGE.has(ext) && ext !== '.pdf' && ext !== '.txt') {
    warnings.push(`Skipped (use PDF, PNG, JPG, WEBP or TXT): ${path.relative(ROOT, full)}`);
    continue;
  }
  const title = path.basename(full).slice(0, -ext.length).replace(/\s*\(\d+\)$/, '').trim();
  const key = toPosix(path.join(path.dirname(path.relative(ROOT, full)), title)).toLowerCase();
  if (!editions.has(key)) editions.set(key, { name: title, images: [], pdfs: [], text: '', stamps: [] });
  const edition = editions.get(key);
  const file = await publish(full);
  edition.stamps.push(file.addedAt);
  if (ext === '.pdf') edition.pdfs.push(file);
  else if (ext === '.txt') edition.text += (edition.text ? '\n\n' : '') + (await readFile(full, 'utf8')).replace(/^﻿/, '').trim();
  else edition.images.push(file);
}
const pedagogy = [...editions.values()].map(({ stamps, ...e }) => {
  // Dated by first upload, so adding text later does not announce it twice.
  const addedAt = stamps.includes(null) ? null : [...stamps].sort((a, b) => new Date(a) - new Date(b))[0];
  e.images.sort((a, b) => a.fileName.localeCompare(b.fileName, 'en', { numeric: true }));
  return { ...e, addedAt };
}).sort((a, b) => (new Date(b.addedAt || 0) - new Date(a.addedAt || 0)) || byName(b, a));

await writeFile(path.join(DIST, 'catalog.json'), JSON.stringify({
  title: config.title, eyebrow: config.eyebrow, tagline: config.tagline,
  builtAt: new Date().toISOString(), levels, pedagogy
}));

const count = levels.reduce((n, l) => n + l.notes.length, 0);
console.log(`Built: ${count} note(s), ${pedagogy.length} pedagogy edition(s), ${(totalBytes / 1048576).toFixed(1)} MB of uploads.`);
if (!hasGit) console.log('Note: no Git history found, so upload dates may be unavailable.');
warnings.forEach((w) => console.warn('WARNING: ' + w));
