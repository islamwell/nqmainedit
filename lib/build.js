const fs = require('fs');
const path = require('path');

const MANIFEST = path.resolve(process.env.MANIFEST_FILE || './data/manifest.json');
const LAYOUT = path.resolve(__dirname, '../templates/layout.html');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDur = s => {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};

const fmtDate = d => {
  if (!d) return '';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(d);
  }
};

function readManifest() {
  try {
    if (!fs.existsSync(MANIFEST)) return [];
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return [];
  }
}

function buildAll(db, { siteDir, base }) {
  const layout = fs.readFileSync(LAYOUT, 'utf8');
  const render = (title, body, description = '') => layout
    .replaceAll('{{title}}', esc(title))
    .replaceAll('{{description}}', esc(description))
    .replace('{{content}}', () => body);

  const audioList = db.audio || [];
  const audioById = new Map(audioList.map(a => [a.id, a]));
  const srcOf = l => (l.audioId && audioById.get(l.audioId)?.url) || l.audioUrl || '';
  
  const player = l => {
    const s = srcOf(l);
    return s ? `<div class="nq-player"><audio controls preload="none" src="${esc(s)}"></audio> <a class="nq-dl" href="${esc(s)}" download>⬇ Download</a></div>` : '';
  };

  const meta = l => [
    (l.number != null && l.number !== '') ? `Lecture ${l.number}` : '',
    l.speaker,
    fmtDate(l.date),
    fmtDur(l.audioId ? audioById.get(l.audioId)?.duration : null)
  ].filter(Boolean).map(esc).join(' · ');

  const out = new Map(); // relative file path -> html content

  // 1. Pages
  const pages = db.pages || [];
  for (const p of pages) {
    if (p.published) {
      const pageHtml = `<article class="nq-page"><h1 dir="auto">${esc(p.title)}</h1><div class="nq-content" dir="auto">${p.content || ''}</div></article>`;
      out.set(`${p.slug}/index.html`, render(p.title, pageHtml, p.description));
    }
  }

  // 2. Courses & Lectures
  const allCourses = db.courses || [];
  const allLectures = db.lectures || [];

  const courses = allCourses
    .filter(c => c.published)
    .sort((a, b) => (b.year || 0) - (a.year || 0) || (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title));

  const lecturesOf = c => allLectures
    .filter(l => l.published && l.courseId === c.id)
    .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.title.localeCompare(b.title));

  const years = [...new Set(courses.map(c => c.year || 'Other'))];
  const index = years.map(y => {
    const list = courses
      .filter(c => (c.year || 'Other') === y)
      .map(c => `<li><a href="/${base}/${c.slug}/" dir="auto">${esc(c.title)}</a> <span>(${lecturesOf(c).length} lectures)</span></li>`)
      .join('');
    return `<h2>${esc(y)}</h2><ul class="nq-courses">${list}</ul>`;
  }).join('');

  out.set(`${base}/index.html`, render('Lectures', `<section class="nq-lectures"><h1>Lectures</h1>${index || '<p>No lectures yet.</p>'}</section>`));

  for (const c of courses) {
    const ls = lecturesOf(c);
    const list = ls.map(l => `<li class="nq-lecture"><h3 dir="auto"><a href="/${base}/${c.slug}/${l.slug}/">${esc(l.title)}</a></h3><div class="nq-meta">${meta(l)}</div>${player(l)}</li>`).join('');
    
    out.set(
      `${base}/${c.slug}/index.html`,
      render(
        c.title,
        `<section class="nq-course"><p><a href="/${base}/">← All lectures</a></p><h1 dir="auto">${esc(c.title)}</h1>${c.description ? `<p dir="auto">${esc(c.description)}</p>` : ''}${list ? `<ol class="nq-list">${list}</ol>` : '<p>No lectures yet.</p>'}</section>`,
        c.description
      )
    );

    ls.forEach((l, i) => {
      const prev = ls[i - 1], next = ls[i + 1];
      const nav = `<nav class="nq-nav">${prev ? `<a href="/${base}/${c.slug}/${prev.slug}/">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="/${base}/${c.slug}/${next.slug}/">${esc(next.title)} →</a>` : ''}</nav>`;
      out.set(
        `${base}/${c.slug}/${l.slug}/index.html`,
        render(
          `${l.title} – ${c.title}`,
          `<article class="nq-lecture-page"><p><a href="/${base}/${c.slug}/">← ${esc(c.title)}</a></p><h1 dir="auto">${esc(l.title)}</h1><div class="nq-meta">${meta(l)}</div>${player(l)}${l.description ? `<div dir="auto" style="margin: 20px 0;">${esc(l.description).replace(/\n/g, '<br>')}</div>` : ''}${nav}</article>`,
          l.description
        )
      );
    });
  }

  // 3. Write files — safeguards against overwriting non-generated WordPress files
  const prev = new Set(readManifest());
  const written = [], conflicts = [];

  for (const [rel, html] of out) {
    const file = path.join(siteDir, rel);
    if (fs.existsSync(file) && !prev.has(rel)) {
      const dirName = path.dirname(rel);
      const urlPath = dirName === '.' ? '/' : `/${dirName}/`;
      conflicts.push(urlPath);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html, 'utf8');
    written.push(rel);
  }

  // 4. Remove pages we generated earlier that were deleted/unpublished (deepest first)
  [...prev].filter(r => !out.has(r))
    .sort((a, b) => b.split('/').length - a.split('/').length)
    .forEach(rel => {
      const file = path.join(siteDir, rel);
      try { fs.rmSync(file, { force: true }); } catch {}
      
      let dir = path.dirname(file);
      while (dir && dir !== siteDir && dir.startsWith(siteDir)) {
        try {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } catch {
          break; // directory is not empty
        }
      }
    });

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(written, null, 2), 'utf8');
  return { conflicts, written };
}

module.exports = { buildAll, readManifest };
