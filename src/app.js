'use strict';

const $ = (sel) => document.querySelector(sel);
const library = $('#libraryPanel');
const updatesPanel = $('#updatesPanel');
const menu = $('#menu');
const menuBtn = $('#menuBtn');
const scrim = $('#scrim');
const dock = $('#dock');
const searchBox = $('#search');
const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const searchClose = $('#searchClose');
const tabs = $('#tabs');
const tabLibrary = $('#tabLibrary');
const tabUpdates = $('#tabUpdates');
const badge = $('#badge');

let catalog = null;
let query = '';
let activeSub = 'all';
let lastLibraryHash = '#/';
let currentHash = null;
let activeTab = 'library';
let freshIds = new Set();
const scrollMemory = new Map();

/* ---------- Safe storage (private browsing can block it) ---------- */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } }
};

/* ---------- DOM helper. Text is never inserted as HTML. ---------- */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const ICONS = {
  download: 'M12 4v11m-4.500-4.500L12 15l4.500-4.500M5 20h14',
  back: 'm14.500 6-6 6 6 6'
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

/* ---------- Formatting ---------- */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
function formatDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
const normalise = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-–—]+/g, ' ');
const terms = () => normalise(query).split(/\s+/).filter(Boolean);

function highlighted(text) {
  const words = query.trim().split(/\s+/).filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [text];
  return text.split(new RegExp(`(${words.join('|')})`, 'gi'))
    .map((part, i) => (i % 2 ? el('mark', {}, part) : part));
}

/* WhatsApp-style text: *bold*, _italic_, bullet lines and links. */
function inline(text) {
  const pattern = /(https?:\/\/[^\s]+|(?<![\p{L}\p{N}])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_(?!\s)[^_\n]+?(?<!\s)_(?![\p{L}\p{N}]))/gu;
  return text.split(pattern).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith('http')) return el('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, el('u', {}, part));
    return el(part[0] === '*' ? 'strong' : 'em', {}, inline(part.slice(1, -1)));
  });
}
function richText(text) {
  return el('div', { class: 'prose' }, text.split(/\r?\n/).map((line) => {
    const bullet = /^\s*(?:[-•]|\*(?=\s))\s+/.exec(line);
    return el('p', { class: bullet ? 'bullet' : null }, inline(bullet ? '• ' + line.slice(bullet[0].length) : line));
  }));
}

function downloadLink(file, label, primary = true) {
  return el('a', {
    class: 'btn' + (primary ? ' primary' : ''), href: file.url, download: file.fileName,
    'aria-label': `${label}: ${file.fileName}`
  }, icon('download'), label);
}
const viewLink = (file) => el('a', { class: 'btn', href: file.url, target: '_blank', rel: 'noopener', 'aria-label': `Open ${file.fileName}` }, 'Open');

/* ---------- Routing ---------- */
function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'level' && catalog.levels.some((l) => l.id === parts[1])) {
    return { page: 'level', level: catalog.levels.find((l) => l.id === parts[1]), sub: parts[2] || 'all' };
  }
  if (parts[0] === 'pedagogy') return { page: 'pedagogy', edition: parts[1] };
  if (parts[0] === 'updates') return { page: 'updates' };
  return { page: 'home' };
}

/* ---------- Pages ---------- */
function renderHome() {
  const hero = el('div', { class: 'hero glass' },
    el('div', { class: 'logos' },
      el('img', { src: '/assets/class-2029.png', alt: 'Law Students Association, ESUT, Class of 2029 logo', width: 640, height: 640 }),
      el('img', { class: 'main', src: '/assets/esut-lawsa.png', alt: 'Law Students Association, ESUT logo', width: 640, height: 640 }),
      el('img', { src: '/assets/academic-directors.png', alt: 'O’29 Academic Group, ESUT Chapter logo', width: 640, height: 640 })),
    el('p', { class: 'eyebrow' }, catalog.eyebrow),
    el('h1', {}, catalog.title),
    el('p', { class: 'lede' }, catalog.tagline),
    el('button', { class: 'btn primary', type: 'button', onclick: () => $('#sections').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, 'Browse notes'));

  const cards = catalog.levels.map((l) => el('li', {},
    el('a', { class: 'level-card glass sheen', href: `#/level/${l.id}` },
      el('span', { class: 'num' }, l.id),
      el('h3', {}, `${l.id} Level Notes`),
      el('p', {}, l.subsections.length ? l.subsections.map((s) => s.name).join(' · ') : 'Course subsections coming soon'),
      el('p', {}, plural(l.notes.length, 'note')))));
  cards.push(el('li', {},
    el('a', { class: 'level-card glass sheen', href: '#/pedagogy' },
      el('span', { class: 'num word' }, 'KYP'),
      el('h3', {}, 'Know Your Pedagogy Series'),
      el('p', {}, 'Teaching, course materials and personnel'),
      el('p', {}, plural(catalog.pedagogy.length, 'edition')))));

  const title = el('h2', { class: 'section-title', id: 'sections', style: 'scroll-margin-top:100px' }, 'Sections');
  library.replaceChildren(hero, title, el('ul', { class: 'level-grid' }, cards));
}

function noteItem(note, level) {
  const sub = level.subsections.find((s) => s.folder === note.subsection);
  const meta = [terms().length && sub ? sub.name : null, formatSize(note.size), note.addedAt ? `Added ${formatDate(note.addedAt)}` : null]
    .filter(Boolean).join(' · ');
  return el('li', { class: 'note glass sheen' },
    el('span', { class: 'file-tag', 'aria-hidden': 'true' }, 'PDF'),
    el('div', { class: 'note-info' }, el('h3', {}, highlighted(note.name)), el('p', {}, meta)),
    el('div', { class: 'actions' }, viewLink(note), downloadLink(note, 'Download')));
}
const noteList = (notes, level) => el('ul', { class: 'note-list' }, notes.map((n) => noteItem(n, level)));
const flatList = (notes, level) => [el('h2', { class: 'sr-only' }, 'Notes'), noteList(notes, level)];

function renderResults(level) {
  const box = $('#results');
  if (!box) return;
  const words = terms();

  if (words.length) {
    const found = level.notes.filter((n) => words.every((w) => normalise(n.name).includes(w)));
    $('#chips')?.setAttribute('hidden', '');
    const message = `${plural(found.length, 'result')} in ${level.id} Level`;
    $('#live').textContent = message;
    box.replaceChildren(el('p', { class: 'result-count' }, message),
      ...(found.length ? flatList(found, level) : [ el('p', { class: 'empty' }, 'No note name matches that search. Try a shorter word.')]));
    return;
  }

  $('#chips')?.removeAttribute('hidden');
  const general = level.notes.filter((n) => !n.subsection);
  if (!level.subsections.length) {
    box.replaceChildren(...(general.length ? flatList(general, level)
      : [el('p', { class: 'empty' }, `No notes have been uploaded for ${level.id} Level yet. Check back soon.`)]));
    return;
  }
  const groups = level.subsections
    .filter((s) => activeSub === 'all' || activeSub === s.folder)
    .map((s) => {
      const notes = level.notes.filter((n) => n.subsection === s.folder);
      return el('section', { class: 'group' }, el('h2', {}, s.name),
        notes.length ? noteList(notes, level) : el('p', { class: 'empty' }, `No ${s.name} notes yet.`));
    });
  if (activeSub === 'all' && general.length) {
    groups.push(el('section', { class: 'group' }, el('h2', {}, 'General'), noteList(general, level)));
  }
  box.replaceChildren(...groups);
}

const backLink = () => el('a', { class: 'back', href: '#/' }, icon('back'), 'Home');

function renderLevel(route) {
  const { level } = route;
  activeSub = level.subsections.some((s) => s.folder === route.sub) ? route.sub : 'all';
  let chips = null;
  if (level.subsections.length) {
    const options = [{ folder: 'all', name: 'All' }, ...level.subsections];
    chips = el('div', { class: 'chips', id: 'chips', role: 'group', 'aria-label': 'Subsections' },
      options.map((s) => el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(s.folder === activeSub),
        onclick: (e) => {
          activeSub = s.folder;
          for (const c of chips.children) c.setAttribute('aria-pressed', String(c === e.currentTarget));
          const hash = `#/level/${level.id}` + (s.folder === 'all' ? '' : `/${s.folder}`);
          history.replaceState(null, '', hash);
          currentHash = lastLibraryHash = library.dataset.hash = hash;
          renderResults(level);
        }
      }, s.name)));
  }
  library.replaceChildren(...[
    el('div', { class: 'page-head' }, backLink(), el('h1', {}, `${level.id} Level`),
      el('p', { class: 'lede' }, plural(level.notes.length, 'note') + ' available')),
    chips,
    el('div', { id: 'results' })
  ].filter(Boolean));
  renderResults(level);
}

function renderPedagogy() {
  const items = catalog.pedagogy.map((e) => {
    const images = e.images.length ? el('div', { class: 'flyers' }, e.images.map((img, i) =>
      el('a', { href: img.url, target: '_blank', rel: 'noopener', 'aria-label': `Open full-size flyer ${i + 1}: ${e.name}` },
        el('img', { src: img.url, alt: `${e.name}, flyer ${i + 1}`, loading: 'lazy' })))) : null;
    const buttons = [
      ...e.pdfs.flatMap((f) => [viewLink(f), downloadLink(f, 'Download PDF')]),
      ...e.images.map((f, i) => downloadLink(f, e.images.length > 1 ? `Download image ${i + 1}` : 'Download image', !e.pdfs.length)),
      e.text ? el('button', { class: 'btn', type: 'button', onclick: (ev) => copyText(e.text, ev.currentTarget) }, 'Copy text') : null
    ].filter(Boolean);
    return el('article', { class: 'edition glass' + (images && e.text ? ' has-both' : ''), id: slug(e.name) },
      el('h2', {}, e.name),
      e.addedAt ? el('p', { class: 'meta' }, `Added ${formatDate(e.addedAt)}`) : null,
      images, e.text ? richText(e.text) : null,
      el('div', { class: 'actions' }, buttons));
  });
  library.replaceChildren(
    el('div', { class: 'page-head' }, backLink(), el('h1', {}, 'Know Your Pedagogy'),
      el('p', { class: 'lede' }, 'From the Office of the Academic Directors: flyers, documents and announcements.')),
    items.length ? el('div', { class: 'editions' }, items) : el('p', { class: 'empty' }, 'The first edition will appear here soon.'));
}
const slug = (s) => 'kyp-' + (normalise(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'edition');

async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; }
  catch { button.textContent = 'Press and hold the text to copy'; }
  setTimeout(() => { button.textContent = 'Copy text'; }, 2200);
}

/* ---------- Updates (notifications) ---------- */
function allUpdates() {
  const items = [];
  for (const level of catalog.levels) {
    for (const note of level.notes) {
      if (!note.addedAt) continue;
      const sub = level.subsections.find((s) => s.folder === note.subsection);
      items.push({
        id: `${note.url}|${note.addedAt}`, addedAt: note.addedAt, name: note.name, file: note,
        where: `${level.id} Level` + (sub ? ` › ${sub.name}` : ''),
        href: `#/level/${level.id}` + (sub ? `/${sub.folder}` : ''), kind: 'New PDF note'
      });
    }
  }
  for (const e of catalog.pedagogy) {
    if (!e.addedAt) continue;
    items.push({
      id: `kyp|${e.name}|${e.addedAt}`, addedAt: e.addedAt, name: e.name, file: e.pdfs[0] || e.images[0] || null,
      where: 'Know Your Pedagogy', href: `#/pedagogy/${slug(e.name)}`, kind: 'New edition'
    });
  }
  return items.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)).slice(0, 50);
}

function readSeen() {
  const raw = store.get('seenUpdates');
  if (raw) {
    try { return new Set(JSON.parse(raw)); } catch { /* start again */ }
  }
  // First visit: only the last 14 days count as unread.
  const cutoff = Date.now() - 14 * 864e5;
  const seen = new Set(allUpdates().filter((u) => new Date(u.addedAt) < cutoff).map((u) => u.id));
  store.set('seenUpdates', JSON.stringify([...seen]));
  return seen;
}
let seen = null;
const unread = () => allUpdates().filter((u) => !seen.has(u.id));

function updateBadge() {
  const n = unread().length;
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? '9+' : String(n);
  tabUpdates.setAttribute('aria-label', n ? `Updates, ${n} unread` : 'Updates');
}

function renderUpdates() {
  const items = allUpdates();
  const list = el('ul', { class: 'note-list' }, items.map((u) => el('li', { class: 'update glass' },
    el('div', { class: 'update-top' },
      freshIds.has(u.id) ? el('span', { class: 'new-pill' }, 'NEW') : null,
      el('span', {}, `${u.kind} · ${formatDate(u.addedAt)}`)),
    el('p', {}, el('strong', {}, u.name), ` has been uploaded to ${u.where}.`),
    el('div', { class: 'actions' },
      el('a', { class: 'btn', href: u.href }, 'View in library'),
      u.file ? downloadLink(u.file, 'Download') : null))));
  updatesPanel.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', {}, 'Updates'),
      el('p', { class: 'lede' }, 'Newly uploaded notes and Know Your Pedagogy editions appear here.')),
    items.length ? el('h2', { class: 'sr-only' }, 'Latest uploads') : '',
    items.length ? list : el('p', { class: 'empty' }, 'Nothing new yet. New uploads will be announced here.'));
}

function markAllRead() {
  for (const u of unread()) { freshIds.add(u.id); seen.add(u.id); }
  renderUpdates();
  store.set('seenUpdates', JSON.stringify([...seen].slice(-500)));
  updateBadge();
}

/* ---------- Search ---------- */
function setSearch(open, { focus = false, restore = false } = {}) {
  searchBox.classList.toggle('open', open);
  searchBtn.setAttribute('aria-expanded', String(open));
  searchInput.tabIndex = searchClose.tabIndex = open ? 0 : -1;
  if (open) {
    if (focus) searchInput.focus({ preventScroll: true }); // must run inside the tap for phone keyboards
  } else {
    query = '';
    searchInput.value = '';
    searchInput.blur();
    if (restore) searchBtn.focus({ preventScroll: true });
  }
}
const refreshSearch = () => {
  const route = parseRoute(currentHash);
  if (route.page === 'level') renderResults(route.level);
};
searchBtn.addEventListener('click', () => {
  if (!searchBox.classList.contains('open')) setSearch(true, { focus: true });
  else searchInput.focus();
});
searchClose.addEventListener('click', () => { setSearch(false, { restore: true }); refreshSearch(); });
searchInput.addEventListener('input', () => {
  query = searchInput.value;
  refreshSearch();
  window.scrollTo(0, 0);
});
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchInput.blur(); });

/* Keeps the search bar above the on-screen keyboard (mainly iPhone). */
if (window.visualViewport) {
  const lift = () => {
    const gap = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
    const typing = document.activeElement === searchInput;
    document.documentElement.style.setProperty('--keyboard', `${typing && gap > 80 ? gap : 0}px`);
  };
  visualViewport.addEventListener('resize', lift);
  visualViewport.addEventListener('scroll', lift);
  searchInput.addEventListener('blur', () => document.documentElement.style.setProperty('--keyboard', '0px'));
}

/* ---------- Menu ---------- */
function buildMenu() {
  const links = [
    ['#/', 'Home', ''],
    ...catalog.levels.map((l) => [`#/level/${l.id}`, `${l.id} Level`, plural(l.notes.length, 'note')]),
    ['#/pedagogy', 'Know Your Pedagogy', '']
  ];
  menu.replaceChildren(...links.map(([href, label, small]) =>
    el('a', { href, onclick: () => setMenu(false, location.hash === href) }, el('span', {}, label), el('small', {}, small))));
  markCurrent();
}
function markCurrent() {
  for (const a of menu.children) {
    const href = a.getAttribute('href');
    const on = href === '#/' ? lastLibraryHash === '#/' : lastLibraryHash.startsWith(href);
    if (on && activeTab === 'library') a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
function setMenu(open, restore = false) {
  menu.classList.toggle('open', open);
  scrim.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close sections menu' : 'Open sections menu');
  if (!open && restore) menuBtn.focus({ preventScroll: true });
}
menuBtn.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
scrim.addEventListener('click', () => setMenu(false, true));
menu.addEventListener('focusout', (e) => {
  const next = e.relatedTarget;
  if (next && next !== menuBtn && !menu.contains(next)) setMenu(false);
});
$('.skip').addEventListener('click', (e) => { e.preventDefault(); $('#main').focus(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menu.classList.contains('open')) setMenu(false, true);
  else if (searchBox.classList.contains('open')) { setSearch(false, { restore: true }); refreshSearch(); }
});

/* ---------- Navigation between pages and the two tabs ---------- */
function render({ initial = false } = {}) {
  const hash = location.hash.startsWith('#/') ? location.hash : '#/';
  if (!initial && hash === currentHash) return;
  if (currentHash) scrollMemory.set(currentHash, window.scrollY);
  const previousTab = activeTab;
  const route = parseRoute(hash);
  currentHash = hash;
  activeTab = route.page === 'updates' ? 'updates' : 'library';
  const switched = previousTab !== activeTab;
  const returning = switched && activeTab === 'library' && hash === lastLibraryHash && library.dataset.hash === hash;

  const focused = document.activeElement;
  const focusInMenu = menu.contains(focused);
  setMenu(false);
  library.hidden = activeTab !== 'library';
  updatesPanel.hidden = activeTab !== 'updates';
  tabs.classList.toggle('updates', activeTab === 'updates');
  for (const [tab, name] of [[tabLibrary, 'library'], [tabUpdates, 'updates']]) {
    tab.setAttribute('aria-selected', String(activeTab === name));
    tab.tabIndex = activeTab === name ? 0 : -1;
  }

  const showSearch = route.page === 'level';
  searchBox.hidden = !showSearch;
  dock.classList.toggle('with-search', showSearch);

  if (activeTab === 'updates') {
    searchInput.blur(); // the search is only hidden, so it is still there when you return
    freshIds = new Set();
    markAllRead();
  } else {
    lastLibraryHash = hash;
    // Coming back from Updates keeps the page, and any search, just as you left it.
    if (!returning) {
      setSearch(false);
      if (route.page === 'level') renderLevel(route);
      else if (route.page === 'pedagogy') renderPedagogy();
      else renderHome();
      library.dataset.hash = hash;
    }
  }
  markCurrent();

  const panel = activeTab === 'updates' ? updatesPanel : library;
  panel.classList.remove('enter-left', 'enter-right', 'enter-up');
  void panel.offsetWidth; // restart the animation
  panel.classList.add(switched ? (activeTab === 'updates' ? 'enter-right' : 'enter-left') : 'enter-up');

  window.scrollTo(0, switched ? (scrollMemory.get(hash) || 0) : 0);
  if (route.page === 'pedagogy' && route.edition) document.getElementById(route.edition)?.scrollIntoView();
  // If the control just used has gone, move focus to the new page heading (also read out by screen readers).
  if (!initial && (focusInMenu || focused === document.body || !focused.isConnected || focused.closest('[hidden]'))) {
    const heading = panel.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  const names = { home: 'Home', pedagogy: 'Know Your Pedagogy', updates: 'Updates' };
  document.title = `${route.page === 'level' ? `${route.level.id} Level` : names[route.page]} · ${catalog.title}`;
}

function go(hash) { if (location.hash !== hash) location.hash = hash; }
tabLibrary.addEventListener('click', () => {
  if (activeTab === 'library') window.scrollTo({ top: 0, behavior: 'smooth' });
  else go(lastLibraryHash);
});
tabUpdates.addEventListener('click', () => go('#/updates'));
tabs.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = activeTab === 'library' ? tabUpdates : tabLibrary;
  next.click();
  next.focus();
});

/* ---------- Day / night ---------- */
const themeBtn = $('#themeBtn');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#000000' : '#ffffff';
  themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode');
}
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set('theme', next);
});
applyTheme(document.documentElement.dataset.theme);

/* Light that follows the mouse across glass cards. */
document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const card = e.target.closest?.('.sheen');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

/* ---------- Loading ---------- */
async function fetchCatalog() {
  const res = await fetch('/catalog.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return res.json();
}

async function start() {
  try {
    catalog = await fetchCatalog();
  } catch {
    library.replaceChildren(el('div', { class: 'empty' }, el('p', {}, 'The notes could not load. Check your connection.'),
      el('button', { class: 'btn primary', type: 'button', onclick: start }, 'Try again')));
    return;
  }
  seen = readSeen();
  buildMenu();
  updateBadge();
  render({ initial: true });
}

/* Picks up new uploads while the site is left open. */
async function refresh() {
  if (!catalog || document.visibilityState !== 'visible') return;
  try {
    const next = await fetchCatalog();
    if (next.builtAt === catalog.builtAt) return;
    catalog = next;
    buildMenu();
    if (activeTab === 'updates') { markAllRead(); library.dataset.hash = ''; }
    else {
      updateBadge();
      const route = parseRoute(currentHash);
      if (route.page === 'level') {
        if (query) renderResults(route.level);
        else renderLevel(route);
      } else if (route.page === 'pedagogy') renderPedagogy();
      else renderHome();
    }
  } catch { /* try again later */ }
}
window.addEventListener('hashchange', () => { if (catalog && location.hash !== '#main') render(); });
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 5 * 60 * 1000);

start();
