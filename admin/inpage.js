/* ==========================================================================
   NQ In-Page Editor Script (NurulQuran WYSIWYG & Admin Bar)
   Works both embedded in local site/index.html AND injected via bookmarklet
   into fast.nurulquran.com or nurulquran.com.
   ========================================================================== */
(function() {
  if (window.__NQ_INPAGE_EDITOR_LOADED__) return;
  window.__NQ_INPAGE_EDITOR_LOADED__ = true;

  // Auto-detect where the admin server is.
  // When injected via bookmarklet into the live site, this script's src will be
  // http://localhost:3000/admin/inpage.js — so we extract the origin from it.
  // Fall back to same-origin if loaded as part of the local site.
  const ADMIN_BASE = (function() {
    try {
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        const url = new URL(s.src, location.href);
        if (url.pathname.includes('inpage.js') && url.hostname !== location.hostname) {
          return url.origin; // e.g. "http://localhost:3000"
        }
      }
    } catch(e) {}
    return ''; // same-origin
  })();

  const IS_CROSS_ORIGIN = Boolean(ADMIN_BASE);

  // Fetch wrapper: always sends credentials, routes to admin server when cross-origin
  function apiFetch(path, opts = {}) {
    return fetch(ADMIN_BASE + path, {
      ...opts,
      credentials: 'include',
      headers: opts.headers || (opts.body ? { 'Content-Type': 'application/json' } : {}),
    });
  }

  let sessionUser = null;
  let isEditing = false;
  let activeElement = null;
  let originalHtml = '';

  // Determine current relative file path
  function getCurrentPageRelPath() {
    let p = window.location.pathname;
    if (p.endsWith('/')) {
      p += 'index.html';
    } else if (!p.endsWith('.html')) {
      p += '/index.html';
    }
    return p.replace(/^\/+/, '');
  }

  // Create UI styles
  const style = document.createElement('style');
  style.id = 'nq-inpage-styles';
  style.textContent = `
    #nq-admin-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 44px;
      background: #0f4c3a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      z-index: 9999999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    #nq-admin-bar * {
      box-sizing: border-box;
    }
    #nq-admin-bar .nq-bar-brand {
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ffffff;
      text-decoration: none;
    }
    #nq-admin-bar .nq-bar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nq-bar-btn {
      background: rgba(255,255,255,0.15);
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 5px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s ease;
      text-decoration: none;
    }
    .nq-bar-btn:hover {
      background: rgba(255,255,255,0.25);
      color: #ffffff;
      text-decoration: none;
    }
    .nq-bar-btn.nq-btn-primary {
      background: #138a63;
      border-color: #138a63;
    }
    .nq-bar-btn.nq-btn-primary:hover {
      background: #0f7152;
    }
    .nq-bar-btn.nq-btn-danger {
      background: #dc2626;
      border-color: #dc2626;
    }
    .nq-bar-btn.nq-btn-active {
      background: #f59e0b;
      border-color: #f59e0b;
      color: #111827;
      font-weight: 700;
    }
    body.nq-has-admin-bar {
      padding-top: 44px !important;
    }
    .nq-editable-hover {
      outline: 2px dashed #138a63 !important;
      outline-offset: 3px;
      cursor: pointer !important;
    }
    .nq-editing-active {
      outline: 2px solid #2563eb !important;
      outline-offset: 3px;
      background-color: rgba(37, 99, 235, 0.03);
    }
    /* Floating Formatting Toolbar */
    #nq-float-toolbar {
      position: absolute;
      display: none;
      background: #1f2937;
      color: #ffffff;
      padding: 6px;
      border-radius: 8px;
      gap: 4px;
      z-index: 10000000;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      font-family: system-ui, sans-serif;
    }
    #nq-float-toolbar button {
      background: #374151;
      color: #ffffff;
      border: none;
      padding: 5px 9px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    #nq-float-toolbar button:hover {
      background: #4b5563;
    }
    /* Modal styles */
    #nq-inpage-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10000001;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: system-ui, sans-serif;
    }
    #nq-inpage-modal .nq-modal-card {
      background: #ffffff;
      color: #111827;
      border-radius: 12px;
      width: 100%;
      max-width: 500px;
      padding: 24px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    #nq-inpage-modal h3 {
      margin-top: 0;
      color: #0f4c3a;
    }
    #nq-inpage-modal label {
      display: block;
      margin: 12px 0 6px;
      font-weight: 600;
      font-size: 14px;
    }
    #nq-inpage-modal input, #nq-inpage-modal textarea, #nq-inpage-modal select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font: inherit;
    }
    #nq-inpage-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #111827;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: system-ui, sans-serif;
      z-index: 10000002;
      display: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    #nq-inpage-toast.bad {
      background: #dc2626;
    }
  `;
  document.head.appendChild(style);

  // Toast notification
  const toast = document.createElement('div');
  toast.id = 'nq-inpage-toast';
  document.body.appendChild(toast);

  function showToast(msg, isBad = false) {
    toast.textContent = msg;
    toast.className = isBad ? 'bad' : '';
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);
  }

  // Floating text-formatting toolbar
  const floatBar = document.createElement('div');
  floatBar.id = 'nq-float-toolbar';
  floatBar.innerHTML = `
    <button data-cmd="bold" title="Bold"><b>B</b></button>
    <button data-cmd="italic" title="Italic"><i>I</i></button>
    <button data-cmd="underline" title="Underline"><u>U</u></button>
    <button data-cmd="formatBlock" data-val="h2" title="Heading 2">H2</button>
    <button data-cmd="formatBlock" data-val="h3" title="Heading 3">H3</button>
    <button data-cmd="formatBlock" data-val="p" title="Paragraph">P</button>
    <button data-cmd="insertUnorderedList" title="Bullet List">• List</button>
    <button data-cmd="createLink" title="Link">🔗 Link</button>
  `;
  document.body.appendChild(floatBar);

  floatBar.querySelectorAll('button').forEach(btn => {
    btn.onmousedown = e => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      if (cmd === 'createLink') {
        const url = prompt('Enter link URL:', 'https://');
        if (url) document.execCommand(cmd, false, url);
      } else {
        document.execCommand(cmd, false, val);
      }
    };
  });

  // Modal dialog for New Page / Lecture
  const modal = document.createElement('div');
  modal.id = 'nq-inpage-modal';
  modal.innerHTML = `
    <div class="nq-modal-card">
      <h3 id="nq-modal-title">Create New Item</h3>
      <div id="nq-modal-body"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
        <button class="nq-bar-btn" id="nq-modal-cancel" style="background:#e5e7eb; color:#374151;">Cancel</button>
        <button class="nq-bar-btn nq-btn-primary" id="nq-modal-submit">Create & Open</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('nq-modal-cancel').onclick = () => {
    modal.style.display = 'none';
  };

  // Admin Top Bar
  const bar = document.createElement('div');
  bar.id = 'nq-admin-bar';
  const adminUrl = ADMIN_BASE + '/admin/';
  bar.innerHTML = `
    <div style="display:flex; align-items:center; gap:16px;">
      <a href="${adminUrl}#dashboard" class="nq-bar-brand" target="_blank">📖 NurulQuran Admin</a>
      <span id="nq-bar-status" style="color:#d1fae5; font-size:12px;">Checking sign-in...</span>
    </div>
    <div class="nq-bar-actions" id="nq-bar-actions">
      <!-- Injected based on auth status -->
    </div>
  `;
  document.body.appendChild(bar);

  // Check auth session
  async function checkAuth() {
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        sessionUser = data.user;
        renderLoggedInBar();
      } else {
        renderLoggedOutBar();
      }
    } catch (err) {
      renderLoggedOutBar();
    }
  }

  function renderLoggedOutBar() {
    document.getElementById('nq-bar-status').textContent = 'Guest Mode';
    document.getElementById('nq-bar-actions').innerHTML = `
      <a href="${adminUrl}#dashboard" class="nq-bar-btn nq-btn-primary" target="_blank">Sign in to Edit</a>
    `;
  }

  function renderLoggedInBar() {
    document.body.classList.add('nq-has-admin-bar');
    document.getElementById('nq-bar-status').textContent = `Signed in as ${sessionUser}`;
    updateActionButtons();
  }

  function updateActionButtons() {
    const actions = document.getElementById('nq-bar-actions');
    if (!isEditing) {
      actions.innerHTML = `
        <button class="nq-bar-btn nq-btn-primary" id="nq-btn-toggle-edit">✏️ Edit This Page</button>
        <button class="nq-bar-btn" id="nq-btn-new-item">➕ New Item / Page</button>
        <button class="nq-bar-btn" id="nq-btn-publish-site">🚀 Publish</button>
        <a href="${adminUrl}#dashboard" class="nq-bar-btn" target="_blank">Admin Panel</a>
      `;
    } else {
      actions.innerHTML = `
        <button class="nq-bar-btn nq-btn-primary" id="nq-btn-save-page">💾 Save Changes</button>
        <button class="nq-bar-btn nq-btn-danger" id="nq-btn-cancel-edit">❌ Cancel</button>
        <span style="font-size:12px; color:#fde68a;">Click any text on the page to edit directly</span>
      `;
    }
    bindBarEvents();
  }

  function bindBarEvents() {
    const toggleBtn = document.getElementById('nq-btn-toggle-edit');
    if (toggleBtn) {
      toggleBtn.onclick = () => enableEditing();
    }

    const saveBtn = document.getElementById('nq-btn-save-page');
    if (saveBtn) {
      saveBtn.onclick = () => savePageChanges();
    }

    const cancelBtn = document.getElementById('nq-btn-cancel-edit');
    if (cancelBtn) {
      cancelBtn.onclick = () => disableEditing(true);
    }

    const newBtn = document.getElementById('nq-btn-new-item');
    if (newBtn) {
      newBtn.onclick = () => openNewItemModal();
    }

    const pubBtn = document.getElementById('nq-btn-publish-site');
    if (pubBtn) {
      pubBtn.onclick = async () => {
        pubBtn.disabled = true;
        pubBtn.textContent = 'Publishing...';
        try {
          const res = await apiFetch('/api/publish', { method: 'POST' });
          const d = await res.json();
          showToast(d.message || 'Published successfully!');
        } catch (e) {
          showToast(e.message, true);
        } finally {
          pubBtn.disabled = false;
          pubBtn.textContent = '🚀 Publish';
        }
      };
    }
  }

  // Find candidate editable elements on page
  function getEditableElements() {
    const selectors = [
      'main', 'article', '.nq-wrap', '.nq-content', '.hero', '.features',
      'h1', 'h2', 'h3', 'p', '.card', '.entry-content', '#content'
    ];
    const set = new Set();
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (!el.closest('#nq-admin-bar') && !el.closest('#nq-float-toolbar') && !el.closest('#nq-inpage-modal')) {
          set.add(el);
        }
      });
    });
    return Array.from(set);
  }

  function enableEditing() {
    isEditing = true;
    updateActionButtons();
    showToast('Edit mode enabled. Click any section or heading to edit.');

    const elements = getEditableElements();
    elements.forEach(el => {
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('focus', onElementFocus);
      el.addEventListener('blur', onElementBlur);
      el.addEventListener('mouseover', onElementHover);
      el.addEventListener('mouseout', onElementUnhover);
    });

    document.addEventListener('selectionchange', handleSelectionChange);
  }

  function disableEditing(rollback = false) {
    isEditing = false;
    floatBar.style.display = 'none';
    if (rollback) {
      window.location.reload();
      return;
    }
    const elements = getEditableElements();
    elements.forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('nq-editable-hover', 'nq-editing-active');
      el.removeEventListener('focus', onElementFocus);
      el.removeEventListener('blur', onElementBlur);
      el.removeEventListener('mouseover', onElementHover);
      el.removeEventListener('mouseout', onElementUnhover);
    });
    document.removeEventListener('selectionchange', handleSelectionChange);
    updateActionButtons();
  }

  function onElementHover(e) {
    if (!isEditing) return;
    e.currentTarget.classList.add('nq-editable-hover');
  }

  function onElementUnhover(e) {
    e.currentTarget.classList.remove('nq-editable-hover');
  }

  function onElementFocus(e) {
    activeElement = e.currentTarget;
    activeElement.classList.add('nq-editing-active');
  }

  function onElementBlur(e) {
    e.currentTarget.classList.remove('nq-editing-active');
  }

  function handleSelectionChange() {
    if (!isEditing) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      floatBar.style.top = (window.scrollY + rect.top - 46) + 'px';
      floatBar.style.left = Math.max(10, (window.scrollX + rect.left)) + 'px';
      floatBar.style.display = 'flex';
    } else {
      floatBar.style.display = 'none';
    }
  }

  // Save the full current document HTML directly
  async function savePageChanges() {
    disableEditing(false);
    showToast('Saving page to static HTML...');

    const relPath = getCurrentPageRelPath();

    // Clone the document to sanitize injected toolbar elements before writing
    const clone = document.documentElement.cloneNode(true);
    
    // Remove in-page editor elements from saved HTML
    const toRemove = clone.querySelectorAll('#nq-admin-bar, #nq-float-toolbar, #nq-inpage-modal, #nq-inpage-toast, #nq-inpage-styles');
    toRemove.forEach(el => el.remove());

    // Remove editing attributes and classes
    clone.classList.remove('nq-has-admin-bar');
    clone.querySelectorAll('[contenteditable]').forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('nq-editable-hover', 'nq-editing-active');
    });

    const fullHtml = '<!doctype html>\n' + clone.outerHTML;

    try {
      const res = await apiFetch('/api/inpage/save', {
        method: 'POST',
        body: JSON.stringify({ path: relPath, html: fullHtml })
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to save');

      showToast('✓ Page saved to static HTML!');
    } catch (err) {
      showToast('Error saving: ' + err.message, true);
    }
  }

  // New Item Dialog
  function openNewItemModal() {
    const modalBody = document.getElementById('nq-modal-body');
    modalBody.innerHTML = `
      <label>Item Type</label>
      <select id="nq-new-type">
        <option value="page">📄 New Web Page</option>
        <option value="lecture">🎧 New Audio Lecture</option>
        <option value="course">📚 New Course / Series</option>
      </select>

      <div id="nq-fields-page">
        <label>Page Title</label>
        <input id="nq-new-title" placeholder="e.g. Ramadan Schedule 2026" required>
        <label>URL Slug (optional)</label>
        <input id="nq-new-slug" placeholder="e.g. ramadan-schedule">
      </div>
    `;

    modal.style.display = 'flex';

    document.getElementById('nq-modal-submit').onclick = async () => {
      const title = document.getElementById('nq-new-title').value.trim();
      const slug = document.getElementById('nq-new-slug').value.trim();
      const type = document.getElementById('nq-new-type').value;

      if (!title) {
        showToast('Please enter a title', true);
        return;
      }

      try {
        if (type === 'page') {
          const res = await apiFetch('/api/pages', {
            method: 'POST',
            body: JSON.stringify({
              title,
              slug,
              content: '<p>Start typing your content here directly...</p>',
              published: true
            })
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'Creation failed');
          modal.style.display = 'none';
          showToast('Page created! Open the admin panel to view it.');
          // When cross-origin we can't navigate to the new page on a different domain,
          // so just open the admin panel instead.
          setTimeout(() => {
            window.open(ADMIN_BASE + '/admin/#pages', '_blank');
          }, 800);
        } else {
          // Open standard admin panel for complex types
          window.open(`${adminUrl}#${type}s`, '_blank');
          modal.style.display = 'none';
        }
      } catch (err) {
        showToast(err.message, true);
      }
    };
  }

  // Initialize
  checkAuth();
})();
