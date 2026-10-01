// ---------- State and Helper Functions ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = { pages: [], courses: [], lectures: [], audio: [], me: {} };

const today = () => new Date().toISOString().slice(0, 10);

const fmtSize = b => {
  if (!b) return '0 KB';
  return b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
};

const fmtDur = s => {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};

const niceTitle = n => n.replace(/\.mp3$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

const courseName = id => S.courses.find(c => c.id === id)?.title || '—';

const audioOf = l => S.audio.find(a => a.id === l.audioId);

const pill = p => p ? '<span class="pill ok">Live</span>' : '<span class="pill">Draft</span>';

const siteLink = rel => {
  const base = S.me.siteUrl || '';
  const cleanRel = String(rel || '').replace(/^\/+/, '');
  return (base ? base.replace(/\/+$/, '') : '') + '/' + cleanRel;
};

const sortedCourses = () => [...S.courses].sort((a, b) => (b.year || 0) - (a.year || 0) || (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title));

const courseOptions = sel => sortedCourses().map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc((c.year ? c.year + ' – ' : '') + c.title)}</option>`).join('');

const nextNumber = courseId => {
  const nums = S.lectures.filter(l => l.courseId === courseId && l.number != null).map(l => Number(l.number) || 0);
  return nums.length ? Math.max(0, ...nums) + 1 : 1;
};

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch('/api' + url, {
    ...opts,
    credentials: 'same-origin',
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
    body: opts.body && !isForm ? JSON.stringify(opts.body) : opts.body,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && url !== '/login') {
    showLogin();
    throw new Error('Please sign in');
  }

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  if (data.conflicts && data.conflicts.length) {
    toast('⚠ Skipped, an existing page was found at: ' + data.conflicts.join(', '), true);
  }

  return data;
}

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.className = '';
  }, 4500);
}

async function loadAll() {
  const [pages, courses, lectures, audio] = await Promise.all(
    ['pages', 'courses', 'lectures', 'audio'].map(c => api('/' + c))
  );
  Object.assign(S, { pages, courses, lectures, audio });
}

async function refresh() {
  await loadAll();
  route();
}

// ---------- Authentication Handlers ----------
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

async function start() {
  try {
    S.me = await api('/me');
  } catch {
    return showLogin();
  }

  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await loadAll();
  route();
}

$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/login', { method: 'POST', body });
    start();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
};

$('#logoutBtn').onclick = async () => {
  try {
    await api('/logout', { method: 'POST' });
  } finally {
    showLogin();
  }
};

$('#publishBtn').onclick = async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Publishing…';

  try {
    const res = await api('/publish', { method: 'POST' });
    toast(res.message || '✓ Site published successfully!');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ---------- Router ----------
const VIEWS = { dashboard, lectures, courses, pages, audio: audioView, bookmarklet: bookmarkletView };

$$('aside nav a').forEach(a => (a.href = '#' + a.dataset.view));
window.onhashchange = route;

function route() {
  const v = location.hash.slice(1) || 'dashboard';
  $$('aside nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  (VIEWS[v] || dashboard)();
}

// ---------- Audio Utilities ----------
function getDuration(file) {
  return new Promise(resolve => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      resolve(a.duration);
      URL.revokeObjectURL(a.src);
    };
    a.onerror = () => resolve(null);
    a.src = URL.createObjectURL(file);
  });
}

async function uploadMp3(file, onProgress) {
  const duration = await getDuration(file);
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('title', niceTitle(file.name));
    fd.append('duration', duration || '');
    fd.append('file', file); // file must be appended

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/audio');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status < 300) {
        S.audio.unshift(d);
        resolve(d);
      } else {
        reject(new Error(d.error || 'Upload failed'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}

function dropZone(el, cb) {
  el.ondragover = e => {
    e.preventDefault();
    el.classList.add('over');
  };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = e => {
    e.preventDefault();
    el.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(f => /\.mp3$/i.test(f.name));
    if (files.length) {
      cb(files);
    } else {
      toast('Please drop .mp3 audio files', true);
    }
  };
}

// ---------- Modal & Reusable Forms ----------
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBody').innerHTML = '';
}

$('#modal').onclick = e => {
  if (e.target === $('#modal')) closeModal();
};

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) {
    closeModal();
  }
});

const fieldHtml = item => f => {
  const v = item[f.name] ?? f.default ?? '';
  const help = f.help ? `<small>${esc(f.help)}</small>` : '';

  switch (f.type) {
    case 'checkbox':
      return `<label class="check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'textarea':
      return `<label>${esc(f.label)}<textarea name="${f.name}" rows="3" dir="auto">${esc(v)}</textarea>${help}</label>`;
    case 'select':
      return `<label>${esc(f.label)}<select name="${f.name}">${f.options}</select>${help}</label>`;
    case 'html':
      return `<label>${esc(f.label)}</label><div class="editor" data-name="${f.name}"></div>`;
    case 'audio':
      return audioFieldHtml(item);
    default:
      return `<label>${esc(f.label)}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" dir="auto" ${f.required ? 'required' : ''}>${help}</label>`;
  }
};

function openForm({ col, title, fields, item = {}, afterRender }) {
  const isNew = !item.id;
  openModal(`
    <h2>${esc(title)}</h2>
    <form id="f">
      ${fields.map(fieldHtml(item)).join('')}
      <div class="actions">
        ${!isNew ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}
        <span class="grow"></span>
        <button type="button" class="btn" id="cancel">Cancel</button>
        <button class="btn primary" id="save">${isNew ? 'Save & publish' : 'Save changes'}</button>
      </div>
    </form>
  `);

  const editors = {};
  $$('.editor').forEach(el => {
    const q = new Quill(el, {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'blockquote'],
          ['clean']
        ]
      }
    });

    if (item[el.dataset.name]) {
      q.clipboard.dangerouslyPasteHTML(item[el.dataset.name]);
    }
    editors[el.dataset.name] = q;
  });

  afterRender?.();

  $('#cancel').onclick = closeModal;

  if (!isNew) {
    $('#del').onclick = async () => {
      if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
      try {
        await api(`/${col}/${item.id}`, { method: 'DELETE' });
        toast('Deleted');
        closeModal();
        refresh();
      } catch (e) {
        toast(e.message, true);
      }
    };
  }

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const body = {};

    for (const fl of fields) {
      if (fl.type === 'html') {
        const ed = editors[fl.name];
        body[fl.name] = ed.getSemanticHTML ? ed.getSemanticHTML() : ed.root.innerHTML;
      } else if (fl.type === 'checkbox') {
        body[fl.name] = $(`[name="${fl.name}"]`, e.target).checked;
      } else if (fl.type === 'audio') {
        body.audioId = $('[name=audioId]').value;
        body.audioUrl = $('[name=audioUrl]').value;
      } else {
        body[fl.name] = $(`[name="${fl.name}"]`, e.target).value;
      }
    }

    const saveBtn = $('#save');
    saveBtn.disabled = true;

    try {
      await api(isNew ? `/${col}` : `/${col}/${item.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body
      });
      toast('Saved ✓');
      closeModal();
      refresh();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
    }
  };
}

// ---------- Audio Picker in Lecture Form ----------
function audioFieldHtml(item) {
  return `
    <div class="audio-field">
      <label>Audio (MP3)</label>
      <input type="hidden" name="audioId" value="${esc(item.audioId || '')}">
      <div id="audioCurrent"></div>
      <div class="drop" id="drop">
        <input type="file" id="file" accept=".mp3,audio/mpeg" hidden>
        <b>Drag & drop an MP3 here</b> or <button type="button" class="btn sm" id="pick">Choose file</button>
        <div class="progress hidden"><div></div></div>
      </div>
      <details>
        <summary>Other audio options</summary>
        <label>Pick an already uploaded file
          <select id="libSel">
            <option value="">— Select from Library —</option>
            ${S.audio.map(a => `<option value="${a.id}" ${a.id === item.audioId ? 'selected' : ''}>${esc(a.title)} (${fmtDur(a.duration)})</option>`).join('')}
          </select>
        </label>
        <label>…or paste a direct link to an MP3 hosted on Cloudflare R2 / CDN
          <input name="audioUrl" value="${esc(item.audioUrl || '')}" placeholder="https://...">
        </label>
      </details>
    </div>
  `;
}

function setupAudioField() {
  const idIn = $('[name=audioId]');
  const cur = $('#audioCurrent');
  const file = $('#file');
  const drop = $('#drop');
  const bar = $('.progress', drop);

  const show = () => {
    const a = S.audio.find(x => x.id === idIn.value);
    cur.innerHTML = a ? `
      <div class="current">
        🎧 <b dir="auto">${esc(a.title)}</b> <span>${fmtDur(a.duration)}</span>
        <audio controls preload="none" src="${esc(a.url)}"></audio>
        <button type="button" class="btn sm" id="rmA">Remove</button>
      </div>
    ` : '';
    if (a) {
      $('#rmA').onclick = () => {
        idIn.value = '';
        show();
      };
    }
  };

  const send = async f => {
    bar.classList.remove('hidden');
    $('#save').disabled = true;
    try {
      const a = await uploadMp3(f, p => {
        bar.firstElementChild.style.width = p * 100 + '%';
      });
      idIn.value = a.id;
      const t = $('[name=title]');
      if (!t.value) t.value = niceTitle(f.name);
      show();
      toast('Uploaded ✓');
    } catch (e) {
      toast(e.message, true);
    } finally {
      bar.classList.add('hidden');
      $('#save').disabled = false;
    }
  };

  $('#pick').onclick = () => file.click();
  file.onchange = () => file.files[0] && send(file.files[0]);
  dropZone(drop, files => send(files[0]));

  $('#libSel').onchange = e => {
    if (e.target.value) {
      idIn.value = e.target.value;
      show();
    }
  };

  show();
}

// ---------- Views ----------

// 1. Dashboard View
function dashboard() {
  const recent = [...S.lectures].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8);
  
  $('#main').innerHTML = `
    <h1>Assalamu alaikum 👋</h1>
    <div class="cards">
      <div class="stat"><b>${S.lectures.length}</b>Lectures</div>
      <div class="stat"><b>${S.courses.length}</b>Courses</div>
      <div class="stat"><b>${S.pages.length}</b>Pages</div>
      <div class="stat"><b>${S.audio.length}</b>Audio files</div>
    </div>

    <div class="quick">
      <button class="btn primary big" id="qBulk">⬆ Upload many lectures at once</button>
      <button class="btn big" id="qLec">＋ Add one lecture</button>
      <button class="btn big" id="qCourse">＋ New course</button>
      <button class="btn big" id="qPage">＋ New page</button>
    </div>

    <h2>Recently added lectures</h2>
    ${lectureTable(recent)}
  `;

  $('#qBulk').onclick = () => bulkUpload();
  $('#qLec').onclick = () => editLecture();
  $('#qCourse').onclick = () => editCourse();
  $('#qPage').onclick = () => editPage();
  bindLectureTable();
}

function lectureTable(list) {
  if (!list.length) return '<p class="empty">No lectures found.</p>';
  return `
    <table>
      <thead>
        <tr>
          <th style="width: 50px;">#</th>
          <th>Title</th>
          <th>Course</th>
          <th>Audio</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${list.map(l => `
          <tr>
            <td>${l.number ?? ''}</td>
            <td dir="auto"><b>${esc(l.title)}</b></td>
            <td dir="auto">${esc(courseName(l.courseId))}</td>
            <td>${l.audioId || l.audioUrl ? '🎧 ' + fmtDur(audioOf(l)?.duration) : '<span class="warn">No audio</span>'}</td>
            <td>${pill(l.published)}</td>
            <td class="r"><button class="btn sm" data-edit-lecture="${l.id}">Edit</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function bindLectureTable() {
  $$('[data-edit-lecture]').forEach(b => {
    b.onclick = () => editLecture(S.lectures.find(l => l.id === b.dataset.editLecture));
  });
}

// 2. Lectures View
const lecFilter = { course: '', q: '' };

function lectures() {
  $('#main').innerHTML = `
    <div class="head">
      <h1>Lectures</h1>
      <div>
        <button class="btn" id="bulk">⬆ Bulk upload</button>
        <button class="btn primary" id="add">＋ Add lecture</button>
      </div>
    </div>
    <div class="filters">
      <select id="fc"><option value="">All courses</option>${courseOptions(lecFilter.course)}</select>
      <input id="fq" placeholder="Search by lecture title…" value="${esc(lecFilter.q)}">
    </div>
    <div id="tbl"></div>
  `;

  const draw = () => {
    const q = lecFilter.q.toLowerCase();
    const list = S.lectures
      .filter(l => (!lecFilter.course || l.courseId === lecFilter.course) && (!q || l.title.toLowerCase().includes(q)))
      .sort((a, b) => courseName(a.courseId).localeCompare(courseName(b.courseId)) || (a.number ?? 0) - (b.number ?? 0));
    
    $('#tbl').innerHTML = lectureTable(list);
    bindLectureTable();
  };

  $('#fc').onchange = e => {
    lecFilter.course = e.target.value;
    draw();
  };

  $('#fq').oninput = e => {
    lecFilter.q = e.target.value;
    draw();
  };

  $('#add').onclick = () => editLecture();
  $('#bulk').onclick = () => bulkUpload();
  draw();
}

function editLecture(item = {}) {
  if (!S.courses.length) {
    toast('Please create a course first, e.g. "Ramadan 2026"', true);
    return editCourse();
  }

  const courseId = item.courseId || lecFilter.course || sortedCourses()[0].id;
  item = {
    courseId,
    number: nextNumber(courseId),
    date: today(),
    published: true,
    ...item
  };

  openForm({
    col: 'lectures',
    item,
    title: item.id ? 'Edit lecture' : 'Add lecture',
    fields: [
      { name: 'courseId', label: 'Course', type: 'select', options: courseOptions(item.courseId) },
      { name: 'title', label: 'Lecture title', required: true },
      { name: 'audio', type: 'audio' },
      { name: 'number', label: 'Lecture number', type: 'number', help: 'Lectures are listed in order of this number' },
      { name: 'speaker', label: 'Speaker (optional)' },
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'description', label: 'Notes / description (optional)', type: 'textarea' },
      { name: 'slug', label: 'Web address slug (optional)', help: 'Leave empty to generate automatically' },
      { name: 'published', label: 'Published (visible on website)', type: 'checkbox' },
    ],
    afterRender: () => {
      setupAudioField();
      if (!item.id) {
        $('[name=courseId]').onchange = e => {
          $('[name=number]').value = nextNumber(e.target.value);
        };
      }
    },
  });
}

// 3. Bulk Upload Feature
function bulkUpload() {
  if (!S.courses.length) {
    toast('Please create a course first', true);
    return editCourse();
  }

  openModal(`
    <h2>Bulk Upload Lectures</h2>
    <p>Each MP3 file becomes a numbered lecture. Files are processed in filename order (e.g. <code>01 Surah Al-Fatiha.mp3</code>, <code>02 ...</code>).</p>
    <label>Course
      <select id="bc">${courseOptions(lecFilter.course)}</select>
    </label>
    <label>Speaker (optional)
      <input id="bs" dir="auto" placeholder="e.g. Dr. Idrees Zubair">
    </label>
    <label class="check">
      <input type="checkbox" id="bp" checked> Publish immediately
    </label>
    <div class="drop" id="bdrop">
      <input type="file" id="bfile" accept=".mp3,audio/mpeg" multiple hidden>
      <b>Drag & drop MP3 files here</b> or <button type="button" class="btn sm" id="bpick">Choose files</button>
    </div>
    <ul id="blist" class="blist"></ul>
    <div class="actions">
      <span class="grow"></span>
      <button class="btn" id="bclose">Close</button>
    </div>
  `);

  let busy = false;

  $('#bclose').onclick = () => {
    if (busy && !confirm('Uploads are still in progress. Close anyway?')) return;
    closeModal();
    refresh();
  };

  const run = async files => {
    if (busy) return toast('Please wait for active uploads to finish', true);
    busy = true;

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const courseId = $('#bc').value;
    const speaker = $('#bs').value;
    const published = $('#bp').checked;
    let n = nextNumber(courseId) - 1;

    const rows = files.map(f => {
      const li = document.createElement('li');
      li.innerHTML = `<span dir="auto">${esc(f.name)}</span><div class="progress"><div></div></div><em>waiting</em>`;
      $('#blist').append(li);
      return li;
    });

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const li = rows[i];
      const st = $('em', li);

      try {
        st.textContent = 'uploading…';
        const a = await uploadMp3(f, p => {
          $('.progress div', li).style.width = p * 100 + '%';
        });

        const title = niceTitle(f.name).replace(/^\d+[\s.\-–)]*/, '') || niceTitle(f.name);
        const r = await api('/lectures', {
          method: 'POST',
          body: {
            courseId,
            title,
            number: ++n,
            speaker,
            audioId: a.id,
            published,
            date: today()
          }
        });

        S.lectures.push(r.item);
        st.textContent = '✓ done';
        li.classList.add('ok');
      } catch (e) {
        st.textContent = '✗ ' + e.message;
        li.classList.add('bad');
      }
    }

    busy = false;
    toast('Bulk upload completed ✓');
  };

  $('#bpick').onclick = () => $('#bfile').click();
  $('#bfile').onchange = e => run([...e.target.files]);
  dropZone($('#bdrop'), run);
}

// 4. Courses View
function courses() {
  const list = sortedCourses();
  $('#main').innerHTML = `
    <div class="head">
      <h1>Courses</h1>
      <button class="btn primary" id="add">＋ New course</button>
    </div>
    ${list.length ? `
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th>Course</th>
            <th>Lectures</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(c => `
            <tr>
              <td><b>${c.year || '—'}</b></td>
              <td dir="auto"><b>${esc(c.title)}</b></td>
              <td><a href="#lectures" data-show="${c.id}">${S.lectures.filter(l => l.courseId === c.id).length} lectures</a></td>
              <td>${pill(c.published)}</td>
              <td class="r">
                <a class="btn sm" target="_blank" href="${esc(siteLink(`${S.me.base}/${c.slug}/`))}">View</a>
                <button class="btn sm" data-edit="${c.id}">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">No courses yet. Create one, e.g. “Ramadan Program 2026”.</p>'}
  `;

  $('#add').onclick = () => editCourse();

  $$('[data-edit]').forEach(b => {
    b.onclick = () => editCourse(S.courses.find(c => c.id === b.dataset.edit));
  });

  $$('[data-show]').forEach(a => {
    a.onclick = () => {
      lecFilter.course = a.dataset.show;
    };
  });
}

function editCourse(item = {}) {
  openForm({
    col: 'courses',
    item,
    title: item.id ? 'Edit course' : 'New course',
    fields: [
      { name: 'title', label: 'Course name', required: true },
      { name: 'year', label: 'Year', type: 'number', default: new Date().getFullYear() },
      { name: 'description', label: 'Short description (optional)', type: 'textarea' },
      { name: 'order', label: 'Sort order (optional)', type: 'number', help: 'Lower numbers display first within the same year' },
      { name: 'slug', label: 'Web address slug (optional)', help: 'Leave empty to generate automatically' },
      { name: 'published', label: 'Published (visible on website)', type: 'checkbox', default: true },
    ],
  });
}

// 5. Pages View
function pages() {
  $('#main').innerHTML = `
    <div class="head">
      <h1>Pages</h1>
      <button class="btn primary" id="add">＋ New page</button>
    </div>
    <p class="note">These pages are generated alongside your website. Existing exported WordPress pages remain untouched.</p>
    ${S.pages.length ? `
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Address</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${S.pages.map(p => `
            <tr>
              <td dir="auto"><b>${esc(p.title)}</b></td>
              <td><code>/${esc(p.slug)}/</code></td>
              <td>${pill(p.published)}</td>
              <td class="r">
                <a class="btn sm" target="_blank" href="${esc(siteLink(p.slug + '/'))}">View</a>
                <button class="btn sm" data-edit="${p.id}">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">No custom pages added yet.</p>'}
  `;

  $('#add').onclick = () => editPage();

  $$('[data-edit]').forEach(b => {
    b.onclick = () => editPage(S.pages.find(p => p.id === b.dataset.edit));
  });
}

function editPage(item = {}) {
  openForm({
    col: 'pages',
    item,
    title: item.id ? 'Edit page' : 'New page',
    fields: [
      { name: 'title', label: 'Page title', required: true },
      { name: 'slug', label: 'Web address slug (optional)', help: `Example: "ramadan-2026" → ${S.me.siteUrl || ''}/ramadan-2026/` },
      { name: 'description', label: 'Short summary (shown on Google / WhatsApp previews)', type: 'textarea' },
      { name: 'content', label: 'Content', type: 'html' },
      { name: 'published', label: 'Published (visible on website)', type: 'checkbox', default: true },
    ],
  });
}

// 6. Audio Library View
function audioView() {
  const used = id => S.lectures.filter(l => l.audioId === id).length;

  $('#main').innerHTML = `
    <div class="head">
      <h1>Audio Library</h1>
    </div>
    <div class="drop" id="adrop">
      <input type="file" id="afile" accept=".mp3,audio/mpeg" multiple hidden>
      <b>Drag & drop MP3 files here to upload</b> or <button class="btn sm" id="apick">Choose files</button>
      <div class="progress hidden"><div></div></div>
    </div>
    ${S.audio.length ? `
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Duration</th>
            <th>Size</th>
            <th>Used in</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${S.audio.map(a => `
            <tr>
              <td dir="auto"><b>${esc(a.title)}</b></td>
              <td>${fmtDur(a.duration)}</td>
              <td>${fmtSize(a.size)}</td>
              <td>${used(a.id)} lecture(s)</td>
              <td class="r">
                <button class="btn sm" data-copy="${esc(a.url)}">Copy link</button>
                <button class="btn sm danger" data-del="${a.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="empty">No audio files in library yet.</p>'}
  `;

  const bar = $('#adrop .progress');

  const run = async files => {
    bar.classList.remove('hidden');
    for (const f of files) {
      try {
        await uploadMp3(f, p => {
          bar.firstElementChild.style.width = p * 100 + '%';
        });
      } catch (e) {
        toast(f.name + ': ' + e.message, true);
      }
    }
    toast('Upload finished ✓');
    audioView();
  };

  $('#apick').onclick = () => $('#afile').click();
  $('#afile').onchange = e => run([...e.target.files]);
  dropZone($('#adrop'), run);

  $$('[data-copy]').forEach(b => {
    b.onclick = () => {
      const fullUrl = new URL(b.dataset.copy, S.me.siteUrl || location.origin).href;
      navigator.clipboard.writeText(fullUrl);
      toast('Audio link copied to clipboard');
    };
  });

  $$('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Permanently delete this audio file from disk?')) return;
      try {
        await api('/audio/' + b.dataset.del, { method: 'DELETE' });
        toast('Audio deleted');
        refresh();
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
}

// ---------- Bookmarklet / Live Site Editor View ----------
function bookmarkletView() {
  const origin = location.origin; // e.g. http://localhost:3000
  const bookmarkletCode = `javascript:(function(){var s=document.createElement('script');s.src='${origin}/admin/inpage.js?t='+Date.now();document.head.appendChild(s)})();`;

  $('#main').innerHTML = `
    <div class="list-header"><h2>🔖 Live Site Editor (Bookmarklet)</h2></div>
    <div style="max-width:700px; padding:0 24px 40px;">
      <div style="background:#f0fdf4; border:2px solid #86efac; border-radius:12px; padding:20px 24px; margin-bottom:28px;">
        <h3 style="margin:0 0 8px; color:#15803d;">✅ The easiest and most reliable way to edit nurulquran.com</h3>
        <p style="margin:0; color:#166534; font-size:14px; line-height:1.6;">
          Click the bookmarklet while viewing <strong>fast.nurulquran.com</strong> (or nurulquran.com) in your browser.
          The real page loads with all its theme, fonts, and assets exactly as visitors see it —
          then the NurulQuran editor bar appears at the top so you can click to edit directly.
        </p>
      </div>

      <h3 style="margin:0 0 12px;">Step 1 — Make sure the admin server is running</h3>
      <p style="color:#6b7280; font-size:14px; margin:0 0 20px;">
        The admin server must be running on your computer at <code>${origin}</code>.<br>
        Start it with <code>npm start</code> in the project folder.
      </p>

      <h3 style="margin:0 0 12px;">Step 2 — Add the bookmarklet to your browser</h3>
      <p style="color:#6b7280; font-size:14px; margin:0 0 12px;">
        Drag the green button below to your browser's bookmarks bar:
      </p>
      <div style="margin:0 0 16px;">
        <a id="nq-bookmarklet-link" href="${esc(bookmarkletCode)}"
          style="display:inline-block; background:#0f4c3a; color:#fff; padding:10px 20px; border-radius:8px;
                 font-weight:700; font-size:15px; text-decoration:none; cursor:grab; user-select:none;
                 box-shadow:0 2px 8px rgba(0,0,0,0.2);">
          📖 NQ Edit Page
        </a>
      </div>
      <p style="color:#9ca3af; font-size:13px; margin:0 0 8px;">
        <strong>Can't drag it?</strong> Right-click the button → "Bookmark this link" → Save it to your bookmarks bar.
      </p>
      <details style="margin-bottom:24px;">
        <summary style="cursor:pointer; font-size:13px; color:#6b7280;">Show raw bookmarklet code (for manual copy)</summary>
        <textarea readonly style="width:100%;height:80px;margin-top:8px;font-size:11px;font-family:monospace;
                  border:1px solid #d1d5db; border-radius:6px; padding:8px; resize:none;"
          onclick="this.select()">${esc(bookmarkletCode)}</textarea>
      </details>

      <h3 style="margin:0 0 12px;">Step 3 — Edit the live site</h3>
      <ol style="color:#374151; font-size:14px; line-height:2; padding-left:20px; margin:0 0 24px;">
        <li>Open <a href="https://fast.nurulquran.com" target="_blank" style="color:#0f4c3a;">fast.nurulquran.com</a> in your browser</li>
        <li>Click <strong>📖 NQ Edit Page</strong> in your bookmarks bar</li>
        <li>A green admin bar appears at the top of the page</li>
        <li>Click <strong>✏️ Edit This Page</strong> to enable editing</li>
        <li>Click any heading, paragraph, or section directly to edit it</li>
        <li>Click <strong>💾 Save Changes</strong> — the HTML is saved to your local <code>site/</code> folder</li>
        <li>Click <strong>🚀 Publish</strong> to push changes live to Cloudflare Pages</li>
      </ol>

      <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:16px 20px; margin-bottom:24px;">
        <strong>⚠️ Sign in first!</strong><br>
        <span style="font-size:13px; color:#92400e; line-height:1.6;">
          Before using the bookmarklet, sign in to this admin panel here at <a href="${origin}/admin/" target="_blank">${origin}/admin/</a>.
          Your session is shared automatically when the bookmarklet runs.
          If the green bar shows "Guest Mode", return here, sign in, then click the bookmarklet again.
        </span>
      </div>

      <h3 style="margin:0 0 8px;">How it works (technical)</h3>
      <p style="color:#6b7280; font-size:13px; line-height:1.6; margin:0;">
        The bookmarklet injects <code>/admin/inpage.js</code> from <code>${origin}</code> into the tab.
        All API calls (auth check, save, publish) go to <code>${origin}/api/…</code> using
        <code>credentials: 'include'</code>. CORS is pre-configured on the admin server to allow
        requests from <strong>nurulquran.com</strong> and <strong>fast.nurulquran.com</strong>.
        Saved HTML is written to your local <code>site/</code> folder, then deployed via
        the Publish button (runs the configured deploy command, e.g. <code>wrangler pages deploy</code>).
      </p>
    </div>
  `;
}

// Start application
start();
