/* ==========================================================================
   NQ In-Page Editor Script (NurulQuran Real WYSIWYG, Menu Manager & Bunny CDN)
   Version: v1.0.4
   Works embedded in local site pages AND injected via bookmarklet into
   live WordPress exports (fast.nurulquran.com / nurulquran.com).
   ========================================================================== */
(function() {
  if (window.__NQ_INPAGE_EDITOR_LOADED__) return;
  window.__NQ_INPAGE_EDITOR_LOADED__ = true;

  // Auto-detect where the admin server is.
  // When injected via bookmarklet into a remote site, determine origin from the script tag.
  // Fall back to http://localhost:3000 if running on a remote domain.
  const ADMIN_BASE = (function() {
    try {
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        const url = new URL(s.src, location.href);
        if (url.pathname.includes('inpage.js') && url.hostname !== location.hostname) {
          return url.origin; // e.g. "http://localhost:3000"
        }
      }
    } catch (e) {}
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return 'http://localhost:3000';
    }
    return ''; // same-origin
  })();

  const IS_CROSS_ORIGIN = Boolean(ADMIN_BASE);

  // Fetch wrapper: always includes credentials and routes to ADMIN_BASE
  function apiFetch(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    return fetch(ADMIN_BASE + path, {
      ...opts,
      credentials: 'include',
      headers: opts.headers || (isForm ? {} : (opts.body ? { 'Content-Type': 'application/json' } : {})),
    });
  }

  let sessionUser = null;
  let isEditing = false;
  let activeElement = null;
  let currentSelectionRange = null;
  let bunnyStatus = { configured: false, cdnUrl: '' };

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

  // Inject UI Styles
  const style = document.createElement('style');
  style.id = 'nq-inpage-styles';
  style.textContent = `
    /* Top Admin Bar */
    #nq-admin-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 46px;
      background: #0f4c3a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 2147483640;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      user-select: none;
    }
    #nq-admin-bar * {
      box-sizing: border-box;
    }
    #nq-admin-bar .nq-brand {
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ffffff;
      text-decoration: none;
    }
    #nq-admin-bar .nq-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nq-btn {
      background: rgba(255,255,255,0.14);
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.25);
      padding: 5px 11px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
      text-decoration: none;
      line-height: 1.4;
    }
    .nq-btn:hover {
      background: rgba(255,255,255,0.25);
      color: #ffffff;
    }
    .nq-btn-primary {
      background: #10b981 !important;
      border-color: #059669 !important;
      color: #064e3b !important;
      font-weight: 700 !important;
    }
    .nq-btn-primary:hover {
      background: #34d399 !important;
    }
    .nq-btn-save {
      background: #f59e0b !important;
      border-color: #d97706 !important;
      color: #78350f !important;
      font-weight: 700 !important;
    }
    .nq-btn-save:hover {
      background: #fbbf24 !important;
    }
    .nq-btn-danger {
      background: #ef4444 !important;
      border-color: #dc2626 !important;
      color: #ffffff !important;
    }
    .nq-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(255,255,255,0.15);
      color: #d1fae5;
    }

    body.nq-has-admin-bar {
      padding-top: 46px !important;
    }

    /* Editable Element Highlighting */
    .nq-editable-hover {
      outline: 2px dashed #10b981 !important;
      outline-offset: 3px;
      cursor: text !important;
    }
    .nq-editing-active {
      outline: 2px solid #2563eb !important;
      outline-offset: 3px;
      background-color: rgba(37, 99, 235, 0.03) !important;
    }

    /* Floating WYSIWYG Formatting Toolbar */
    #nq-float-toolbar {
      position: absolute;
      display: none;
      background: #1e293b;
      color: #ffffff;
      padding: 5px 8px;
      border-radius: 8px;
      gap: 4px;
      z-index: 2147483642;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      align-items: center;
      flex-wrap: nowrap;
    }
    #nq-float-toolbar button {
      background: #334155;
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 4px 7px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      min-width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    #nq-float-toolbar button:hover {
      background: #475569;
    }
    #nq-float-toolbar select {
      background: #334155;
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      padding: 3px 5px;
      font-size: 11px;
      height: 26px;
    }
    .nq-sep {
      width: 1px;
      height: 18px;
      background: rgba(255,255,255,0.2);
      margin: 0 3px;
    }

    /* Inline Link & Menu Balloon */
    #nq-link-balloon {
      position: absolute;
      display: none;
      background: #ffffff;
      color: #1e293b;
      padding: 12px 14px;
      border-radius: 8px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.25);
      border: 1px solid #cbd5e1;
      z-index: 2147483643;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      width: 320px;
    }
    #nq-link-balloon label {
      display: block;
      margin-bottom: 4px;
      font-weight: 600;
      color: #475569;
    }
    #nq-link-balloon input[type="text"] {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      margin-bottom: 8px;
      font-size: 12px;
      box-sizing: border-box;
    }

    /* Block Actions Hover Pill */
    #nq-block-pill {
      position: absolute;
      display: none;
      background: #0f4c3a;
      color: #ffffff;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      z-index: 2147483641;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      cursor: pointer;
      gap: 6px;
      align-items: center;
    }
    #nq-block-pill span:hover {
      text-decoration: underline;
    }

    /* Generic Modal Dialog */
    #nq-inpage-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(2px);
      z-index: 2147483645;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #nq-inpage-modal .nq-modal-card {
      background: #ffffff;
      color: #1e293b;
      border-radius: 12px;
      width: 100%;
      max-width: 620px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0,0,0,0.35);
      overflow: hidden;
    }
    .nq-modal-header {
      padding: 16px 20px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .nq-modal-header h3 {
      margin: 0;
      font-size: 16px;
      color: #0f4c3a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nq-modal-close {
      background: transparent;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #64748b;
      line-height: 1;
    }
    .nq-modal-close:hover {
      color: #0f172a;
    }
    .nq-modal-body {
      padding: 20px;
      overflow-y: auto;
      font-size: 13.5px;
      line-height: 1.5;
    }
    .nq-modal-footer {
      padding: 14px 20px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    /* Modal Form Controls */
    .nq-modal-body label {
      display: block;
      margin: 12px 0 4px;
      font-weight: 600;
      font-size: 13px;
      color: #334155;
    }
    .nq-modal-body input[type="text"],
    .nq-modal-body input[type="url"],
    .nq-modal-body input[type="number"],
    .nq-modal-body select,
    .nq-modal-body textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 13px;
      box-sizing: border-box;
      font-family: inherit;
    }
    .nq-modal-tabs {
      display: flex;
      gap: 8px;
      border-bottom: 2px solid #e2e8f0;
      margin-bottom: 18px;
    }
    .nq-modal-tab {
      padding: 8px 14px;
      background: transparent;
      border: none;
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
    }
    .nq-modal-tab.active {
      color: #0f4c3a;
      border-bottom-color: #0f4c3a;
    }
    .nq-dropzone {
      border: 2px dashed #94a3b8;
      border-radius: 8px;
      padding: 24px 16px;
      text-align: center;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .nq-dropzone:hover, .nq-dropzone.dragover {
      border-color: #10b981;
      background: #ecfdf5;
    }

    /* Menu Item List in Modal */
    .nq-menu-list {
      list-style: none;
      margin: 0 0 16px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .nq-menu-item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: #f1f5f9;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }
    .nq-menu-item-row input {
      margin: 0 !important;
    }

    /* Toast Notification */
    #nq-inpage-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13.5px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 2147483647;
      display: none;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      max-width: 380px;
      line-height: 1.4;
    }
    #nq-inpage-toast.bad {
      background: #dc2626;
    }
    #nq-inpage-toast.good {
      background: #059669;
    }
  `;
  document.head.appendChild(style);

  // Toast Helper
  const toast = document.createElement('div');
  toast.id = 'nq-inpage-toast';
  document.body.appendChild(toast);

  function showToast(msg, type = 'info') {
    toast.textContent = msg;
    toast.className = type === true || type === 'bad' ? 'bad' : (type === 'good' ? 'good' : '');
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 4500);
  }

  // Floating WYSIWYG Formatting Toolbar
  const floatBar = document.createElement('div');
  floatBar.id = 'nq-float-toolbar';
  floatBar.innerHTML = `
    <select id="nq-block-format" title="Paragraph or Heading">
      <option value="p">Paragraph</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
      <option value="h4">Heading 4</option>
      <option value="blockquote">Quote</option>
    </select>
    <div class="nq-sep"></div>
    <button data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
    <button data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
    <button data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
    <button data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
    <div class="nq-sep"></div>
    <button data-color="#0f4c3a" title="Green Text" style="color:#10b981;">A</button>
    <button data-color="#b45309" title="Gold Text" style="color:#f59e0b;">A</button>
    <button data-color="#dc2626" title="Red Text" style="color:#ef4444;">A</button>
    <button data-color="#1e293b" title="Dark Text" style="color:#94a3b8;">A</button>
    <button data-hilite="#fef08a" title="Yellow Highlight" style="background:#fef08a; color:#000;">🖍️</button>
    <div class="nq-sep"></div>
    <button data-cmd="justifyLeft" title="Align Left">⇤</button>
    <button data-cmd="justifyCenter" title="Align Center">⇹</button>
    <button data-cmd="justifyRight" title="Align Right">⇥</button>
    <div class="nq-sep"></div>
    <button data-cmd="insertUnorderedList" title="Bulleted List">• List</button>
    <button data-cmd="insertOrderedList" title="Numbered List">1. List</button>
    <div class="nq-sep"></div>
    <button id="nq-btn-insert-link" title="Insert / Edit Link">🔗</button>
    <button id="nq-btn-insert-audio-inline" title="Insert Bunny CDN Audio Player">🎵 Audio</button>
    <button data-cmd="removeFormat" title="Clear Formatting">Tx</button>
  `;
  document.body.appendChild(floatBar);

  floatBar.querySelectorAll('button[data-cmd]').forEach(btn => {
    btn.onmousedown = e => {
      e.preventDefault();
      document.execCommand(btn.dataset.cmd, false, null);
    };
  });

  floatBar.querySelectorAll('button[data-color]').forEach(btn => {
    btn.onmousedown = e => {
      e.preventDefault();
      document.execCommand('foreColor', false, btn.dataset.color);
    };
  });

  floatBar.querySelectorAll('button[data-hilite]').forEach(btn => {
    btn.onmousedown = e => {
      e.preventDefault();
      document.execCommand('hiliteColor', false, btn.dataset.hilite);
    };
  });

  const blockSelect = document.getElementById('nq-block-format');
  blockSelect.onchange = () => {
    const val = blockSelect.value;
    document.execCommand('formatBlock', false, val);
  };

  document.getElementById('nq-btn-insert-link').onmousedown = e => {
    e.preventDefault();
    saveSelection();
    const url = prompt('Enter link URL (e.g. /about/ or https://...):', 'https://');
    restoreSelection();
    if (url) {
      document.execCommand('createLink', false, url);
    }
  };

  document.getElementById('nq-btn-insert-audio-inline').onmousedown = e => {
    e.preventDefault();
    saveSelection();
    openAudioModal();
  };

  // Inline Link & Menu Item Balloon
  const linkBalloon = document.createElement('div');
  linkBalloon.id = 'nq-link-balloon';
  linkBalloon.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <strong id="nq-balloon-heading">Edit Link</strong>
      <span id="nq-balloon-menu-badge" class="nq-badge" style="background:#0f4c3a; color:#fff; display:none;">Menu Item</span>
    </div>
    <label>Link Text</label>
    <input type="text" id="nq-balloon-text">
    <label>URL (href)</label>
    <input type="text" id="nq-balloon-href">
    <label style="display:flex; align-items:center; gap:6px; margin-bottom:10px; cursor:pointer;">
      <input type="checkbox" id="nq-balloon-target"> Open in new tab (_blank)
    </label>
    <div style="display:flex; justify-content:space-between; gap:6px; margin-top:8px;">
      <div id="nq-balloon-menu-actions" style="display:none; gap:4px;">
        <button class="nq-btn" id="nq-balloon-add-after" style="background:#0f4c3a; padding:4px 8px; font-size:11px;">➕ Add Next</button>
        <button class="nq-btn nq-btn-danger" id="nq-balloon-del-menu" style="padding:4px 8px; font-size:11px;">🗑️ Delete</button>
      </div>
      <div style="display:flex; gap:6px; margin-left:auto;">
        <button class="nq-btn" id="nq-balloon-close" style="background:#e2e8f0; color:#334155; padding:4px 8px;">Close</button>
        <button class="nq-btn nq-btn-primary" id="nq-balloon-save" style="padding:4px 10px;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(linkBalloon);

  let currentEditingLink = null;

  function showLinkBalloon(linkEl) {
    currentEditingLink = linkEl;
    const isMenuItem = Boolean(linkEl.closest('nav, .menu, .nav, .menu-item, ul'));
    
    document.getElementById('nq-balloon-heading').textContent = isMenuItem ? 'Edit Menu Item Link' : 'Edit Link';
    document.getElementById('nq-balloon-menu-badge').style.display = isMenuItem ? 'inline-flex' : 'none';
    document.getElementById('nq-balloon-menu-actions').style.display = isMenuItem ? 'flex' : 'none';

    document.getElementById('nq-balloon-text').value = linkEl.textContent.trim();
    document.getElementById('nq-balloon-href').value = linkEl.getAttribute('href') || '';
    document.getElementById('nq-balloon-target').checked = linkEl.getAttribute('target') === '_blank';

    const rect = linkEl.getBoundingClientRect();
    linkBalloon.style.top = Math.max(50, (window.scrollY + rect.bottom + 8)) + 'px';
    linkBalloon.style.left = Math.min(window.innerWidth - 340, Math.max(10, window.scrollX + rect.left)) + 'px';
    linkBalloon.style.display = 'block';
  }

  document.getElementById('nq-balloon-close').onclick = () => {
    linkBalloon.style.display = 'none';
    currentEditingLink = null;
  };

  document.getElementById('nq-balloon-save').onclick = () => {
    if (!currentEditingLink) return;
    const txt = document.getElementById('nq-balloon-text').value.trim();
    const href = document.getElementById('nq-balloon-href').value.trim();
    const isBlank = document.getElementById('nq-balloon-target').checked;

    if (txt) currentEditingLink.textContent = txt;
    currentEditingLink.setAttribute('href', href || '#');
    if (isBlank) {
      currentEditingLink.setAttribute('target', '_blank');
    } else {
      currentEditingLink.removeAttribute('target');
    }

    linkBalloon.style.display = 'none';
    currentEditingLink = null;
    showToast('Link updated ✓', 'good');
  };

  document.getElementById('nq-balloon-add-after').onclick = () => {
    if (!currentEditingLink) return;
    const parentLi = currentEditingLink.closest('li');
    const parentMenu = currentEditingLink.closest('ul, ol, nav');
    
    const newText = prompt('Enter New Menu Item Label (e.g. Ramadan Portal):', 'New Item');
    if (!newText) return;
    const newHref = prompt('Enter URL (e.g. /ramadan/ or https://...):', '/');
    if (!newHref) return;

    if (parentLi) {
      const newLi = parentLi.cloneNode(true);
      const a = newLi.querySelector('a') || newLi;
      a.textContent = newText;
      a.setAttribute('href', newHref);
      parentLi.parentNode.insertBefore(newLi, parentLi.nextSibling);
    } else if (parentMenu) {
      const newA = currentEditingLink.cloneNode(true);
      newA.textContent = newText;
      newA.setAttribute('href', newHref);
      parentMenu.appendChild(newA);
    }
    linkBalloon.style.display = 'none';
    showToast('Menu item added ✓', 'good');
  };

  document.getElementById('nq-balloon-del-menu').onclick = () => {
    if (!currentEditingLink) return;
    if (!confirm('Delete this menu item?')) return;
    const parentLi = currentEditingLink.closest('li');
    if (parentLi) {
      parentLi.remove();
    } else {
      currentEditingLink.remove();
    }
    linkBalloon.style.display = 'none';
    currentEditingLink = null;
    showToast('Menu item removed', 'info');
  };

  // Block Hover Pill (Insert / HTML edit / Delete)
  const blockPill = document.createElement('div');
  blockPill.id = 'nq-block-pill';
  blockPill.innerHTML = `
    <span id="nq-pill-add" title="Insert element below">➕ Add</span>
    <span style="opacity:0.4;">|</span>
    <span id="nq-pill-code" title="Edit HTML source">💻 HTML</span>
    <span style="opacity:0.4;">|</span>
    <span id="nq-pill-del" title="Delete element" style="color:#fca5a5;">🗑️</span>
  `;
  document.body.appendChild(blockPill);

  let currentPillElement = null;

  document.getElementById('nq-pill-add').onclick = () => {
    if (!currentPillElement) return;
    const type = prompt('Insert below: type "p" (paragraph), "h2", "h3", "btn" (button), or "audio":', 'p');
    if (!type) return;

    let el;
    if (type === 'h2') {
      el = document.createElement('h2');
      el.textContent = 'New Heading';
    } else if (type === 'h3') {
      el = document.createElement('h3');
      el.textContent = 'New Subheading';
    } else if (type === 'btn') {
      el = document.createElement('div');
      el.innerHTML = '<a href="/" class="btn button nq-btn-primary" style="display:inline-block; padding:10px 20px; border-radius:6px; font-weight:700; text-decoration:none; margin:10px 0;">Click Here →</a>';
      el = el.firstElementChild;
    } else if (type === 'audio') {
      openAudioModal();
      return;
    } else {
      el = document.createElement('p');
      el.textContent = 'New paragraph text... Click to edit.';
    }

    currentPillElement.parentNode.insertBefore(el, currentPillElement.nextSibling);
    enableElementEditing(el);
    el.focus();
    showToast('Element inserted below ✓', 'good');
  };

  document.getElementById('nq-pill-code').onclick = () => {
    if (!currentPillElement) return;
    openHtmlCodeModal(currentPillElement);
  };

  document.getElementById('nq-pill-del').onclick = () => {
    if (!currentPillElement) return;
    if (!confirm('Delete this element?')) return;
    currentPillElement.remove();
    blockPill.style.display = 'none';
    currentPillElement = null;
    showToast('Element deleted', 'info');
  };

  // Reusable Modal
  const modal = document.createElement('div');
  modal.id = 'nq-inpage-modal';
  modal.innerHTML = `
    <div class="nq-modal-card">
      <div class="nq-modal-header">
        <h3 id="nq-modal-title">Modal Title</h3>
        <button class="nq-modal-close" id="nq-modal-close-btn">&times;</button>
      </div>
      <div class="nq-modal-body" id="nq-modal-body"></div>
      <div class="nq-modal-footer" id="nq-modal-footer"></div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('nq-modal-close-btn').onclick = () => {
    modal.style.display = 'none';
  };

  // Top Admin Bar
  const adminUrl = (ADMIN_BASE || '') + '/admin/';
  const bar = document.createElement('div');
  bar.id = 'nq-admin-bar';
  bar.innerHTML = `
    <div class="nq-group">
      <a href="${adminUrl}#dashboard" class="nq-brand" target="_blank">📖 NurulQuran Admin</a>
      <span id="nq-bar-status" class="nq-badge">Checking login...</span>
    </div>
    <div class="nq-group" id="nq-bar-actions">
      <!-- Injected based on state -->
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
        bunnyStatus = {
          configured: Boolean(data.bunnyConfigured),
          cdnUrl: data.bunnyCdnUrl || ''
        };
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
      <a href="${adminUrl}#login" class="nq-btn nq-btn-primary" target="_blank">Sign in to Edit</a>
    `;
  }

  function renderLoggedInBar() {
    document.body.classList.add('nq-has-admin-bar');
    const bunnyIndicator = bunnyStatus.configured ? '☁️ Bunny Active' : '📁 Local Storage';
    document.getElementById('nq-bar-status').innerHTML = `🟢 ${sessionUser} &bull; <span title="Audio Storage Status">${bunnyIndicator}</span>`;
    updateActionButtons();
  }

  function updateActionButtons() {
    const actions = document.getElementById('nq-bar-actions');
    if (!isEditing) {
      actions.innerHTML = `
        <button class="nq-btn nq-btn-primary" id="nq-btn-toggle-edit">✏️ Edit Page</button>
        <button class="nq-btn" id="nq-btn-menu-mgr">🍔 Menu Manager</button>
        <button class="nq-btn" id="nq-btn-audio-mgr">🎵 Audio / Bunny CDN</button>
        <button class="nq-btn" id="nq-btn-new-page">➕ New Page</button>
        <button class="nq-btn" id="nq-btn-publish">🚀 Publish</button>
        <a href="${adminUrl}#dashboard" class="nq-btn" target="_blank">Admin Panel</a>
      `;
    } else {
      actions.innerHTML = `
        <button class="nq-btn nq-btn-save" id="nq-btn-save-page">💾 Save Changes</button>
        <button class="nq-btn nq-btn-danger" id="nq-btn-cancel-edit">❌ Cancel</button>
        <div class="nq-sep"></div>
        <button class="nq-btn" id="nq-btn-undo" title="Undo">↩ Undo</button>
        <button class="nq-btn" id="nq-btn-redo" title="Redo">↪ Redo</button>
        <button class="nq-btn" id="nq-btn-menu-mgr">🍔 Menu Items</button>
        <button class="nq-btn" id="nq-btn-audio-mgr">🎵 Audio / Bunny</button>
        <button class="nq-btn" id="nq-btn-html-page" title="Edit Full Page HTML">💻 HTML</button>
      `;
    }
    bindBarEvents();
  }

  function bindBarEvents() {
    const toggleBtn = document.getElementById('nq-btn-toggle-edit');
    if (toggleBtn) toggleBtn.onclick = () => enableEditing();

    const saveBtn = document.getElementById('nq-btn-save-page');
    if (saveBtn) saveBtn.onclick = () => savePageChanges();

    const cancelBtn = document.getElementById('nq-btn-cancel-edit');
    if (cancelBtn) cancelBtn.onclick = () => disableEditing(true);

    const undoBtn = document.getElementById('nq-btn-undo');
    if (undoBtn) undoBtn.onclick = () => document.execCommand('undo');

    const redoBtn = document.getElementById('nq-btn-redo');
    if (redoBtn) redoBtn.onclick = () => document.execCommand('redo');

    const menuBtn = document.getElementById('nq-btn-menu-mgr');
    if (menuBtn) menuBtn.onclick = () => openMenuManagerModal();

    const audioBtn = document.getElementById('nq-btn-audio-mgr');
    if (audioBtn) audioBtn.onclick = () => openAudioModal();

    const newPageBtn = document.getElementById('nq-btn-new-page');
    if (newPageBtn) newPageBtn.onclick = () => openNewPageModal();

    const htmlBtn = document.getElementById('nq-btn-html-page');
    if (htmlBtn) htmlBtn.onclick = () => openPageHtmlModal();

    const pubBtn = document.getElementById('nq-btn-publish');
    if (pubBtn) {
      pubBtn.onclick = async () => {
        pubBtn.disabled = true;
        pubBtn.textContent = 'Publishing...';
        try {
          const res = await apiFetch('/api/publish', { method: 'POST' });
          const d = await res.json();
          showToast(d.message || 'Published to live site successfully!', 'good');
        } catch (e) {
          showToast('Publish failed: ' + e.message, 'bad');
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
      'main', 'article', '.nq-wrap', '.entry-content', '#content',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'blockquote', 'li', 'td', 'th',
      '.card', '.so-panel', '.widget', '.panel-grid-cell',
      'header h1', 'header p', 'footer p',
      '.hero', '.features', 'div[class*="text"]', 'div[class*="desc"]'
    ];
    const set = new Set();
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (!el.closest('#nq-admin-bar') && !el.closest('#nq-float-toolbar') && !el.closest('#nq-inpage-modal') && !el.closest('#nq-link-balloon')) {
          set.add(el);
        }
      });
    });
    return Array.from(set);
  }

  function enableElementEditing(el) {
    el.setAttribute('contenteditable', 'true');
    el.addEventListener('focus', onElementFocus);
    el.addEventListener('blur', onElementBlur);
    el.addEventListener('mouseover', onElementHover);
    el.addEventListener('mouseout', onElementUnhover);
  }

  function enableEditing() {
    isEditing = true;
    updateActionButtons();
    showToast('Edit mode ON: Click any text, heading, or menu to edit.', 'good');

    const elements = getEditableElements();
    elements.forEach(enableElementEditing);

    // Prevent navigation on all links while in edit mode; show link balloon instead
    document.querySelectorAll('a').forEach(a => {
      if (!a.closest('#nq-admin-bar') && !a.closest('#nq-inpage-modal')) {
        a._origClick = a.onclick;
        a.onclick = e => {
          if (isEditing) {
            e.preventDefault();
            e.stopPropagation();
            showLinkBalloon(a);
          }
        };
      }
    });

    document.addEventListener('selectionchange', handleSelectionChange);
  }

  function disableEditing(rollback = false) {
    isEditing = false;
    floatBar.style.display = 'none';
    linkBalloon.style.display = 'none';
    blockPill.style.display = 'none';

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

    document.querySelectorAll('a').forEach(a => {
      if (a._origClick !== undefined) {
        a.onclick = a._origClick;
        delete a._origClick;
      }
    });

    document.removeEventListener('selectionchange', handleSelectionChange);
    updateActionButtons();
  }

  function onElementHover(e) {
    if (!isEditing) return;
    const el = e.currentTarget;
    el.classList.add('nq-editable-hover');

    // Position block actions pill
    currentPillElement = el;
    const rect = el.getBoundingClientRect();
    blockPill.style.top = Math.max(50, (window.scrollY + rect.top - 24)) + 'px';
    blockPill.style.left = Math.max(10, (window.scrollX + rect.right - 140)) + 'px';
    blockPill.style.display = 'flex';
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

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      currentSelectionRange = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    if (currentSelectionRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(currentSelectionRange);
    }
  }

  function handleSelectionChange() {
    if (!isEditing) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      floatBar.style.top = Math.max(50, (window.scrollY + rect.top - 46)) + 'px';
      floatBar.style.left = Math.min(window.innerWidth - 450, Math.max(10, window.scrollX + rect.left)) + 'px';
      floatBar.style.display = 'flex';
    } else {
      floatBar.style.display = 'none';
    }
  }

  // =========================================================================
  // Menu Manager Modal ("add menu items")
  // =========================================================================
  function findNavigationMenus() {
    const menus = [];
    const candidates = document.querySelectorAll('nav, ul.menu, ul.nav, .navbar-nav, #menu-main, [class*="menu-wrap"] ul, header ul');
    candidates.forEach((ul, index) => {
      if (ul.closest('#nq-admin-bar') || ul.closest('#nq-inpage-modal')) return;
      const items = ul.querySelectorAll(':scope > li, :scope > a');
      if (items.length > 0) {
        const title = ul.getAttribute('id') || ul.getAttribute('aria-label') || ul.className || `Menu #${index + 1}`;
        menus.push({ element: ul, title: `Navigation: ${title.slice(0, 30)}`, items: Array.from(items) });
      }
    });
    return menus;
  }

  function openMenuManagerModal() {
    const menus = findNavigationMenus();
    const modalTitle = document.getElementById('nq-modal-title');
    const modalBody = document.getElementById('nq-modal-body');
    const modalFooter = document.getElementById('nq-modal-footer');

    modalTitle.innerHTML = '🍔 Menu Manager — Add & Edit Navigation Items';

    if (menus.length === 0) {
      modalBody.innerHTML = `
        <p style="color:#64748b;">No navigation menus automatically detected on this page.</p>
        <p>You can also edit any link directly: While editing the page, simply click any menu link to change its text, URL, or add a menu item next to it.</p>
      `;
      modalFooter.innerHTML = `<button class="nq-btn" onclick="document.getElementById('nq-inpage-modal').style.display='none'">Close</button>`;
      modal.style.display = 'flex';
      return;
    }

    let selectedMenuIndex = 0;

    function renderMenuRows() {
      const activeMenu = menus[selectedMenuIndex];
      const items = Array.from(activeMenu.element.querySelectorAll(':scope > li, :scope > a'));

      let menuSelectorHtml = '';
      if (menus.length > 1) {
        menuSelectorHtml = `
          <label>Select Menu to Edit</label>
          <select id="nq-modal-menu-select">
            ${menus.map((m, i) => `<option value="${i}" ${i === selectedMenuIndex ? 'selected' : ''}>${m.title}</option>`).join('')}
          </select>
        `;
      }

      modalBody.innerHTML = `
        ${menuSelectorHtml}
        <h4 style="margin:16px 0 8px; color:#0f4c3a;">Current Menu Items (${items.length})</h4>
        <div class="nq-menu-list" id="nq-menu-items-container">
          ${items.map((item, idx) => {
            const a = item.tagName === 'A' ? item : (item.querySelector('a') || item);
            const text = a.textContent.trim();
            const href = a.getAttribute('href') || '';
            return `
              <div class="nq-menu-item-row" data-index="${idx}">
                <span style="font-weight:700; color:#94a3b8; width:20px;">${idx + 1}.</span>
                <input type="text" class="nq-item-label" value="${text.replace(/"/g, '&quot;')}" style="flex:1;" placeholder="Label">
                <input type="text" class="nq-item-href" value="${href.replace(/"/g, '&quot;')}" style="flex:1;" placeholder="URL / Slug">
                <button class="nq-btn nq-move-up" data-idx="${idx}" title="Move Up" style="background:#cbd5e1; color:#1e293b; padding:4px 7px;">⬆️</button>
                <button class="nq-btn nq-move-down" data-idx="${idx}" title="Move Down" style="background:#cbd5e1; color:#1e293b; padding:4px 7px;">⬇️</button>
                <button class="nq-btn nq-btn-danger nq-del-item" data-idx="${idx}" title="Delete" style="padding:4px 8px;">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-top:16px;">
          <h4 style="margin:0 0 10px; color:#0f4c3a;">➕ Add New Menu Item</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="margin:0 0 4px;">Item Label</label>
              <input type="text" id="nq-new-menu-label" placeholder="e.g. Ramadan Portal 2026">
            </div>
            <div>
              <label style="margin:0 0 4px;">Link URL</label>
              <input type="text" id="nq-new-menu-href" placeholder="e.g. /ramadan/ or https://...">
            </div>
          </div>
          <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button class="nq-btn nq-btn-primary" id="nq-btn-add-menu-row">➕ Add to Menu</button>
          </div>
        </div>
      `;

      if (document.getElementById('nq-modal-menu-select')) {
        document.getElementById('nq-modal-menu-select').onchange = e => {
          selectedMenuIndex = Number(e.target.value);
          renderMenuRows();
        };
      }

      // Add item button
      document.getElementById('nq-btn-add-menu-row').onclick = () => {
        const lbl = document.getElementById('nq-new-menu-label').value.trim();
        const href = document.getElementById('nq-new-menu-href').value.trim();
        if (!lbl) return alert('Please enter an item label');

        const activeMenu = menus[selectedMenuIndex];
        const existingItems = activeMenu.element.querySelectorAll(':scope > li');
        let newEl;
        if (existingItems.length > 0) {
          newEl = existingItems[0].cloneNode(true);
          const a = newEl.querySelector('a') || newEl;
          a.textContent = lbl;
          a.setAttribute('href', href || '#');
        } else {
          newEl = document.createElement('li');
          newEl.innerHTML = `<a href="${href || '#'}">${lbl}</a>`;
        }

        activeMenu.element.appendChild(newEl);
        showToast('Menu item added to page! Click Save Changes when done.', 'good');
        renderMenuRows();
      };

      // Move Up / Down / Delete events
      modalBody.querySelectorAll('.nq-move-up').forEach(btn => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.idx);
          const activeMenu = menus[selectedMenuIndex];
          const items = Array.from(activeMenu.element.querySelectorAll(':scope > li, :scope > a'));
          if (idx > 0) {
            activeMenu.element.insertBefore(items[idx], items[idx - 1]);
            renderMenuRows();
          }
        };
      });

      modalBody.querySelectorAll('.nq-move-down').forEach(btn => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.idx);
          const activeMenu = menus[selectedMenuIndex];
          const items = Array.from(activeMenu.element.querySelectorAll(':scope > li, :scope > a'));
          if (idx < items.length - 1) {
            activeMenu.element.insertBefore(items[idx + 1], items[idx]);
            renderMenuRows();
          }
        };
      });

      modalBody.querySelectorAll('.nq-del-item').forEach(btn => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.idx);
          const activeMenu = menus[selectedMenuIndex];
          const items = Array.from(activeMenu.element.querySelectorAll(':scope > li, :scope > a'));
          if (confirm('Delete this menu item?')) {
            items[idx].remove();
            renderMenuRows();
          }
        };
      });
    }

    modalFooter.innerHTML = `
      <button class="nq-btn" id="nq-modal-menu-close" style="background:#e2e8f0; color:#334155;">Cancel</button>
      <button class="nq-btn nq-btn-primary" id="nq-modal-menu-apply">Apply & Done</button>
    `;

    renderMenuRows();
    modal.style.display = 'flex';

    document.getElementById('nq-modal-menu-close').onclick = () => {
      modal.style.display = 'none';
    };

    document.getElementById('nq-modal-menu-apply').onclick = () => {
      // Sync all text/href inputs back to DOM
      const activeMenu = menus[selectedMenuIndex];
      const items = Array.from(activeMenu.element.querySelectorAll(':scope > li, :scope > a'));
      const rows = modalBody.querySelectorAll('.nq-menu-item-row');

      rows.forEach((row, i) => {
        if (items[i]) {
          const a = items[i].tagName === 'A' ? items[i] : (items[i].querySelector('a') || items[i]);
          const newLabel = row.querySelector('.nq-item-label').value.trim();
          const newHref = row.querySelector('.nq-item-href').value.trim();
          if (newLabel) a.textContent = newLabel;
          a.setAttribute('href', newHref || '#');
        }
      });

      modal.style.display = 'none';
      showToast('Menu updated ✓ Click "Save Changes" on the top bar to persist to static files.', 'good');
    };
  }

  // =========================================================================
  // Audio & Bunny CDN Manager ("upload audio. -the actual files are on bunny cdn")
  // =========================================================================
  function openAudioModal() {
    const modalTitle = document.getElementById('nq-modal-title');
    const modalBody = document.getElementById('nq-modal-body');
    const modalFooter = document.getElementById('nq-modal-footer');

    modalTitle.innerHTML = '🎵 Audio Manager & Bunny CDN Upload';

    modalBody.innerHTML = `
      <div class="nq-modal-tabs">
        <button class="nq-modal-tab active" data-tab="upload">☁️ Upload to Bunny CDN</button>
        <button class="nq-modal-tab" data-tab="insert">🔗 Insert from Bunny URL</button>
        <button class="nq-modal-tab" data-tab="settings">⚙️ Bunny CDN Settings</button>
      </div>

      <!-- Tab 1: Upload MP3 -->
      <div id="nq-tab-upload">
        <div class="nq-dropzone" id="nq-audio-dropzone">
          <p style="font-size:28px; margin:0 0 8px;">🎧</p>
          <strong style="font-size:14px; color:#0f4c3a;">Drag and drop an .MP3 audio lecture here</strong>
          <p style="margin:4px 0 12px; color:#64748b; font-size:12px;">or click to browse from your computer (up to 500MB)</p>
          <input type="file" id="nq-audio-file-input" accept=".mp3,audio/mpeg" style="display:none;">
          <button class="nq-btn nq-btn-primary" type="button" onclick="document.getElementById('nq-audio-file-input').click()">Select MP3 File</button>
        </div>

        <div id="nq-upload-details" style="display:none; margin-top:16px;">
          <label>Lecture / Audio Title</label>
          <input type="text" id="nq-audio-title" placeholder="e.g. Surah Al-Baqarah Lesson 1">
          
          <div style="margin: 10px 0; font-size:12px; color:#64748b;" id="nq-audio-file-meta"></div>

          <div style="background:#e2e8f0; height:8px; border-radius:4px; overflow:hidden; margin:12px 0; display:none;" id="nq-upload-bar-wrap">
            <div id="nq-upload-bar" style="background:#10b981; width:0%; height:100%; transition:width 0.2s;"></div>
          </div>

          <button class="nq-btn nq-btn-primary" id="nq-btn-start-upload" style="width:100%; justify-content:center; padding:10px;">
            ☁️ Upload to Bunny CDN & Insert
          </button>
        </div>

        <div id="nq-upload-success" style="display:none; margin-top:16px; background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:14px;">
          <h4 style="margin:0 0 6px; color:#15803d;">✓ Upload Complete!</h4>
          <p style="font-size:12px; color:#166534; margin:0 0 8px; word-break:break-all;" id="nq-uploaded-url"></p>
          <audio id="nq-uploaded-preview" controls style="width:100%; margin:8px 0;"></audio>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="nq-btn nq-btn-primary" id="nq-btn-insert-uploaded" style="flex:1; justify-content:center;">🎵 Insert Player into Page</button>
            <button class="nq-btn" id="nq-btn-copy-uploaded" style="background:#0f4c3a; color:#fff;">📋 Copy Link</button>
          </div>
        </div>
      </div>

      <!-- Tab 2: Insert from Bunny CDN URL -->
      <div id="nq-tab-insert" style="display:none;">
        <label>Bunny CDN Audio URL</label>
        <input type="url" id="nq-direct-audio-url" placeholder="https://audio.nurulquran.com/... or https://...b-cdn.net/...">
        <p style="font-size:11px; color:#64748b; margin:4px 0 10px;">Paste the link to an MP3 file hosted on Bunny CDN or any CDN.</p>

        <label>Audio Title / Lecture Name</label>
        <input type="text" id="nq-direct-audio-title" placeholder="e.g. Tafseer Surah Al-Baqarah Night 01">

        <label>Audio Player Style</label>
        <select id="nq-player-style">
          <option value="card">Modern Audio Card (Title + Player + Bunny CDN Download Button)</option>
          <option value="wordpress">WordPress Theme Style (Compatible with uoc-theme audio)</option>
          <option value="minimal">Minimal HTML5 Audio Player</option>
        </select>

        <div style="margin-top:18px;">
          <button class="nq-btn nq-btn-primary" id="nq-btn-insert-direct" style="width:100%; justify-content:center; padding:10px;">
            ➕ Insert Audio Player into Page
          </button>
        </div>
      </div>

      <!-- Tab 3: Bunny CDN Settings -->
      <div id="nq-tab-settings" style="display:none;">
        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px; margin-bottom:14px; font-size:12.5px; color:#1e40af;">
          <strong>💡 About Bunny CDN Storage:</strong><br>
          Files uploaded here are stored in your Bunny Storage Zone and served worldwide via Bunny Pull Zone CDN.
        </div>

        <label>Storage Zone Name</label>
        <input type="text" id="nq-bunny-storage-zone" placeholder="e.g. nurulquran or nq-audio">

        <label>Storage API Key / Password</label>
        <input type="text" id="nq-bunny-api-key" placeholder="Enter Bunny Storage Access Key">

        <label>Pull Zone / CDN Domain URL</label>
        <input type="text" id="nq-bunny-cdn-url" placeholder="e.g. https://audio.nurulquran.com or https://nurulquran.b-cdn.net">

        <label>Storage Region Hostname</label>
        <input type="text" id="nq-bunny-hostname" value="storage.bunnycdn.com">

        <div style="margin-top:16px;">
          <button class="nq-btn nq-btn-primary" id="nq-btn-save-bunny-config" style="width:100%; justify-content:center; padding:9px;">
            💾 Save Bunny CDN Settings
          </button>
        </div>
      </div>
    `;

    modalFooter.innerHTML = `<button class="nq-btn" id="nq-audio-modal-close" style="background:#e2e8f0; color:#334155;">Close</button>`;
    modal.style.display = 'flex';

    document.getElementById('nq-audio-modal-close').onclick = () => {
      modal.style.display = 'none';
    };

    // Tabs switching
    modalBody.querySelectorAll('.nq-modal-tab').forEach(tab => {
      tab.onclick = () => {
        modalBody.querySelectorAll('.nq-modal-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById('nq-tab-upload').style.display = target === 'upload' ? 'block' : 'none';
        document.getElementById('nq-tab-insert').style.display = target === 'insert' ? 'block' : 'none';
        document.getElementById('nq-tab-settings').style.display = target === 'settings' ? 'block' : 'none';

        if (target === 'settings') loadBunnySettings();
      };
    });

    // File selection & drop handling
    let selectedAudioFile = null;
    let selectedDuration = null;

    const fileInput = document.getElementById('nq-audio-file-input');
    const dropzone = document.getElementById('nq-audio-dropzone');

    dropzone.onclick = () => fileInput.click();
    dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleSelectedFile(e.dataTransfer.files[0]);
    };
    fileInput.onchange = e => {
      if (e.target.files.length) handleSelectedFile(e.target.files[0]);
    };

    function handleSelectedFile(file) {
      if (!/\.mp3$/i.test(file.name)) {
        return alert('Please select an .mp3 audio file.');
      }
      selectedAudioFile = file;
      document.getElementById('nq-upload-details').style.display = 'block';
      const cleanTitle = file.name.replace(/\.mp3$/i, '').replace(/[-_]+/g, ' ').trim();
      document.getElementById('nq-audio-title').value = cleanTitle;

      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      document.getElementById('nq-audio-file-meta').textContent = `File: ${file.name} (${sizeMB} MB) — Calculating duration...`;

      // Read audio duration
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        selectedDuration = audio.duration;
        const mins = Math.floor(selectedDuration / 60);
        const secs = Math.floor(selectedDuration % 60);
        document.getElementById('nq-audio-file-meta').textContent = `File: ${file.name} (${sizeMB} MB) • Duration: ${mins}:${String(secs).padStart(2, '0')}`;
        URL.revokeObjectURL(audio.src);
      };
    }

    // Upload Execution
    document.getElementById('nq-btn-start-upload').onclick = async () => {
      if (!selectedAudioFile) return alert('Please choose a file');
      const title = document.getElementById('nq-audio-title').value.trim() || selectedAudioFile.name;

      const barWrap = document.getElementById('nq-upload-bar-wrap');
      const bar = document.getElementById('nq-upload-bar');
      barWrap.style.display = 'block';
      bar.style.width = '30%';

      const form = new FormData();
      form.append('file', selectedAudioFile);
      form.append('title', title);
      if (selectedDuration) form.append('duration', selectedDuration);

      try {
        bar.style.width = '65%';
        const res = await apiFetch('/api/bunny/upload', {
          method: 'POST',
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        bar.style.width = '100%';
        setTimeout(() => { barWrap.style.display = 'none'; }, 500);

        // Show success
        document.getElementById('nq-upload-details').style.display = 'none';
        const successBox = document.getElementById('nq-upload-success');
        successBox.style.display = 'block';
        document.getElementById('nq-uploaded-url').textContent = data.url;
        document.getElementById('nq-uploaded-preview').src = data.url;

        if (data.warning) {
          showToast(data.warning, 'info');
        } else {
          showToast('Uploaded to Bunny CDN successfully! ✓', 'good');
        }

        // Insert Button
        document.getElementById('nq-btn-insert-uploaded').onclick = () => {
          insertAudioPlayerToPage(data.url, title, 'card');
          modal.style.display = 'none';
        };

        // Copy Button
        document.getElementById('nq-btn-copy-uploaded').onclick = () => {
          navigator.clipboard.writeText(data.url);
          showToast('Bunny CDN link copied to clipboard ✓', 'good');
        };

      } catch (err) {
        barWrap.style.display = 'none';
        alert('Upload Error: ' + err.message);
      }
    };

    // Tab 2 Direct Insert
    document.getElementById('nq-btn-insert-direct').onclick = () => {
      const url = document.getElementById('nq-direct-audio-url').value.trim();
      const title = document.getElementById('nq-direct-audio-title').value.trim() || 'Audio Lecture';
      const styleType = document.getElementById('nq-player-style').value;
      if (!url) return alert('Please enter an audio URL');

      insertAudioPlayerToPage(url, title, styleType);
      modal.style.display = 'none';
    };

    // Tab 3 Load & Save Settings
    async function loadBunnySettings() {
      try {
        const res = await apiFetch('/api/bunny/status');
        if (res.ok) {
          const d = await res.json();
          document.getElementById('nq-bunny-storage-zone').value = d.storageZone || '';
          document.getElementById('nq-bunny-cdn-url').value = d.cdnUrl || '';
          document.getElementById('nq-bunny-hostname').value = d.storageHostname || 'storage.bunnycdn.com';
        }
      } catch (e) {}
    }

    document.getElementById('nq-btn-save-bunny-config').onclick = async () => {
      const storageZone = document.getElementById('nq-bunny-storage-zone').value.trim();
      const apiKey = document.getElementById('nq-bunny-api-key').value.trim();
      const cdnUrl = document.getElementById('nq-bunny-cdn-url').value.trim();
      const storageHostname = document.getElementById('nq-bunny-hostname').value.trim();

      try {
        const res = await apiFetch('/api/bunny/config', {
          method: 'POST',
          body: JSON.stringify({ storageZone, apiKey, cdnUrl, storageHostname })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Failed to save Bunny CDN settings');

        bunnyStatus.configured = Boolean(d.config.apiKey && d.config.storageZone);
        bunnyStatus.cdnUrl = d.config.cdnUrl;
        showToast('Bunny CDN settings saved! ✓', 'good');
      } catch (e) {
        alert(e.message);
      }
    };
  }

  function insertAudioPlayerToPage(url, title, styleType = 'card') {
    let playerHtml = '';
    const safeTitle = (title || 'Audio Lecture').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeUrl = url.replace(/"/g, '&quot;');

    if (styleType === 'wordpress') {
      playerHtml = `
        <div class="wp-audio-shortcode-wrapper" style="margin: 20px 0;">
          <h4 style="margin: 0 0 8px 0; color: #0f4c3a;">${safeTitle}</h4>
          <audio class="wp-audio-shortcode" preload="none" controls="controls" style="width: 100%;">
            <source type="audio/mpeg" src="${safeUrl}">
            <a href="${safeUrl}">Download Audio</a>
          </audio>
        </div>
      `;
    } else if (styleType === 'minimal') {
      playerHtml = `
        <div class="nq-audio-minimal" style="margin: 16px 0;">
          <audio controls preload="none" style="width: 100%;" src="${safeUrl}"></audio>
        </div>
      `;
    } else {
      // Modern Card
      playerHtml = `
        <div class="nq-audio-card" style="margin: 24px 0; padding: 18px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
          <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 10px; color: #0f4c3a; display: flex; align-items: center; gap: 8px;">
            <span>🎧</span> ${safeTitle}
          </div>
          <audio controls preload="none" style="width: 100%; border-radius: 8px; margin-bottom: 8px;" src="${safeUrl}"></audio>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #64748b; margin-top: 4px;">
            <span>☁️ Hosted on Bunny CDN</span>
            <a href="${safeUrl}" download target="_blank" style="color: #0f4c3a; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">⬇️ Download MP3</a>
          </div>
        </div>
      `;
    }

    // Insert into DOM
    const wrapper = document.createElement('div');
    wrapper.innerHTML = playerHtml.trim();
    const node = wrapper.firstElementChild;

    if (activeElement && activeElement.parentNode) {
      activeElement.parentNode.insertBefore(node, activeElement.nextSibling);
    } else {
      const container = document.querySelector('main, article, .entry-content, #content, body');
      container.appendChild(node);
    }

    enableElementEditing(node);
    showToast('Audio player inserted into page! ✓ Remember to click Save Changes.', 'good');
  }

  // =========================================================================
  // Raw HTML Code Modal
  // =========================================================================
  function openHtmlCodeModal(targetElement) {
    const modalTitle = document.getElementById('nq-modal-title');
    const modalBody = document.getElementById('nq-modal-body');
    const modalFooter = document.getElementById('nq-modal-footer');

    modalTitle.innerHTML = '💻 Edit Block HTML Source';
    modalBody.innerHTML = `
      <p style="font-size:12px; color:#64748b; margin:0 0 8px;">Edit the raw HTML for this element directly:</p>
      <textarea id="nq-block-html-code" style="width:100%; height:280px; font-family:monospace; font-size:12px; border:1px solid #cbd5e1; border-radius:6px; padding:10px; resize:vertical;"></textarea>
    `;
    modalFooter.innerHTML = `
      <button class="nq-btn" id="nq-code-cancel" style="background:#e2e8f0; color:#334155;">Cancel</button>
      <button class="nq-btn nq-btn-primary" id="nq-code-save">Update Element</button>
    `;

    document.getElementById('nq-block-html-code').value = targetElement.outerHTML;
    modal.style.display = 'flex';

    document.getElementById('nq-code-cancel').onclick = () => modal.style.display = 'none';
    document.getElementById('nq-code-save').onclick = () => {
      const newHtml = document.getElementById('nq-block-html-code').value.trim();
      if (!newHtml) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = newHtml;
      const newEl = tmp.firstElementChild;
      if (newEl && targetElement.parentNode) {
        targetElement.parentNode.replaceChild(newEl, targetElement);
        enableElementEditing(newEl);
        showToast('Element HTML updated ✓', 'good');
      }
      modal.style.display = 'none';
    };
  }

  function openPageHtmlModal() {
    const modalTitle = document.getElementById('nq-modal-title');
    const modalBody = document.getElementById('nq-modal-body');
    const modalFooter = document.getElementById('nq-modal-footer');

    modalTitle.innerHTML = '💻 Edit Entire Page HTML Source';
    modalBody.innerHTML = `
      <p style="font-size:12px; color:#64748b; margin:0 0 8px;">Direct source code of the entire page:</p>
      <textarea id="nq-full-html-code" style="width:100%; height:340px; font-family:monospace; font-size:11px; border:1px solid #cbd5e1; border-radius:6px; padding:10px; resize:vertical;"></textarea>
    `;
    modalFooter.innerHTML = `
      <button class="nq-btn" id="nq-full-cancel" style="background:#e2e8f0; color:#334155;">Cancel</button>
      <button class="nq-btn nq-btn-primary" id="nq-full-save">Apply HTML to Page</button>
    `;

    // Strip in-page elements before presenting
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('#nq-admin-bar, #nq-float-toolbar, #nq-inpage-modal, #nq-inpage-toast, #nq-inpage-styles, #nq-link-balloon, #nq-block-pill').forEach(el => el.remove());
    clone.classList.remove('nq-has-admin-bar');
    clone.querySelectorAll('[contenteditable]').forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('nq-editable-hover', 'nq-editing-active');
    });

    document.getElementById('nq-full-html-code').value = '<!doctype html>\n' + clone.outerHTML;
    modal.style.display = 'flex';

    document.getElementById('nq-full-cancel').onclick = () => modal.style.display = 'none';
    document.getElementById('nq-full-save').onclick = async () => {
      const code = document.getElementById('nq-full-html-code').value.trim();
      if (!code) return;
      modal.style.display = 'none';

      // Save directly to static HTML
      const relPath = getCurrentPageRelPath();
      try {
        const res = await apiFetch('/api/inpage/save', {
          method: 'POST',
          body: JSON.stringify({ path: relPath, html: code })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Failed to save');
        showToast('✓ Page saved to static HTML! Reloading...', 'good');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showToast('Error saving: ' + err.message, 'bad');
      }
    };
  }

  // =========================================================================
  // New Page Modal
  // =========================================================================
  function openNewPageModal() {
    const modalTitle = document.getElementById('nq-modal-title');
    const modalBody = document.getElementById('nq-modal-body');
    const modalFooter = document.getElementById('nq-modal-footer');

    modalTitle.innerHTML = '➕ Create New Static Page';
    modalBody.innerHTML = `
      <label>Page Title</label>
      <input id="nq-new-title" placeholder="e.g. Ramadan Portal 2026" required>
      <label>URL Slug (folder path)</label>
      <input id="nq-new-slug" placeholder="e.g. ramadan-portal">
      <p style="font-size:11px; color:#64748b; margin:4px 0 0;">Will be generated at /ramadan-portal/index.html</p>
    `;

    modalFooter.innerHTML = `
      <button class="nq-btn" id="nq-modal-cancel" style="background:#e2e8f0; color:#334155;">Cancel</button>
      <button class="nq-btn nq-btn-primary" id="nq-modal-submit">Create Page</button>
    `;

    modal.style.display = 'flex';

    document.getElementById('nq-modal-cancel').onclick = () => modal.style.display = 'none';
    document.getElementById('nq-modal-submit').onclick = async () => {
      const title = document.getElementById('nq-new-title').value.trim();
      const slug = document.getElementById('nq-new-slug').value.trim();
      if (!title) return alert('Please enter a title');

      try {
        const res = await apiFetch('/api/pages', {
          method: 'POST',
          body: JSON.stringify({
            title,
            slug,
            content: '<h1>' + title + '</h1><p>Start editing this page content here...</p>',
            published: true,
          })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Page creation failed');

        modal.style.display = 'none';
        showToast('Page created successfully! ✓', 'good');
        setTimeout(() => {
          window.open(ADMIN_BASE + '/admin/#pages', '_blank');
        }, 600);
      } catch (err) {
        alert(err.message);
      }
    };
  }

  // =========================================================================
  // Save Changes Directly to Static HTML
  // =========================================================================
  async function savePageChanges() {
    disableEditing(false);
    showToast('Saving page changes to static HTML...', 'info');

    const relPath = getCurrentPageRelPath();

    // Clone the document to clean injected toolbar & editor elements
    const clone = document.documentElement.cloneNode(true);
    const toRemove = clone.querySelectorAll('#nq-admin-bar, #nq-float-toolbar, #nq-inpage-modal, #nq-inpage-toast, #nq-inpage-styles, #nq-link-balloon, #nq-block-pill');
    toRemove.forEach(el => el.remove());

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

      showToast('✓ Page saved to static HTML! Click "Publish" to deploy live.', 'good');
    } catch (err) {
      showToast('Error saving: ' + err.message, 'bad');
    }
  }

  // Initialize
  checkAuth();
})();
