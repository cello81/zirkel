// Zirkel — Frontend-Logik. Vanilla JS + D3 für die Graph-Darstellung.
(function () {
  'use strict';

  const NODE_R = 16;
  const PALETTE = ['#d1495b', '#3d8b7a', '#5470c9', '#8a9a3b', '#8a5fbf', '#b8508f', '#3d8bb8', '#4f9d6b', '#c9884a', '#7a6a9e'];

  // ---------------------------------------------------------------- state
  let state = { people: [], categories: [], connections: [] };
  let version = null;
  let currentUser = null;
  let otherMembers = [];
  let selectedPersonId = null;
  let searchQuery = '';
  const hiddenCategoryIds = new Set();

  let dirty = false;
  let saving = false;
  let saveTimer = null;

  // ------------------------------------------------------- install prompt
  // Wird als installierbare PWA betrieben; das Ereignis kann jederzeit
  // (auch schon vor dem Login) feuern, deshalb ganz oben und ausserhalb
  // jeder Funktion registrieren, damit nichts verpasst wird.
  let deferredInstallPrompt = null;
  function isStandaloneDisplay() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }
  function maybeShowInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (!banner) return; // App-Shell noch nicht eingefügt (nicht eingeloggt)
    if (isStandaloneDisplay()) return;
    if (localStorage.getItem('zirkel-install-dismissed') === '1') return;
    if (deferredInstallPrompt || isIOS()) banner.hidden = false;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    maybeShowInstallBanner();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const banner = document.getElementById('install-banner');
    if (banner) banner.hidden = true;
    showToast('Zirkel wurde installiert.');
  });

  // -------------------------------------------------------------- helpers
  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function categoryById(id) { return state.categories.find((c) => c.id === id) || null; }
  function categoryColor(id) { const c = categoryById(id); return c ? c.color : '#8a8f9e'; }
  function categoryName(id) { const c = categoryById(id); return c ? c.name : 'Keine Kategorie'; }
  function personById(id) { return state.people.find((p) => p.id === id); }
  function nextPaletteColor() {
    const used = new Set(state.categories.map((c) => c.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[state.categories.length % PALETTE.length];
  }
  function highlightMatch(name, q) {
    if (!q) return escapeHtml(name);
    const idx = name.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(name);
    return escapeHtml(name.slice(0, idx)) + '<mark>' + escapeHtml(name.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(name.slice(idx + q.length));
  }
  const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function parseBirthDate(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
  }
  function formatBirthday(iso, withYear) {
    const d = parseBirthDate(iso);
    if (!d) return '';
    return `${d.day}. ${MONTH_NAMES[d.month - 1]}` + (withYear ? ` ${d.year}` : '');
  }
  function ageFromBirthDate(iso) {
    const d = parseBirthDate(iso);
    if (!d) return null;
    const today = new Date();
    let age = today.getFullYear() - d.year;
    const hadBirthdayThisYear = (today.getMonth() + 1 > d.month) || (today.getMonth() + 1 === d.month && today.getDate() >= d.day);
    if (!hadBirthdayThisYear) age -= 1;
    return age;
  }
  function ageAtDate(birthIso, atIso) {
    const b = parseBirthDate(birthIso);
    const a = parseBirthDate(atIso);
    if (!b || !a) return null;
    let age = a.year - b.year;
    const hadBirthday = (a.month > b.month) || (a.month === b.month && a.day >= b.day);
    if (!hadBirthday) age -= 1;
    return age;
  }
  // Bei Verstorbenen zeigen wir das Alter beim Tod statt des (irreführenden)
  // aktuellen Alters — ohne bekanntes Todesdatum wird gar keine Zahl gezeigt.
  function displayAge(p) {
    if (!p.birthDate) return null;
    if (p.deceased) return p.deathDate ? ageAtDate(p.birthDate, p.deathDate) : null;
    return ageFromBirthDate(p.birthDate);
  }
  function displayName(p) {
    const name = p.name || '(ohne Namen)';
    return p.deceased ? `✝ ${name}` : name;
  }
  function matchesSearch(p, q) {
    const query = q.toLowerCase();
    return (p.name || '').toLowerCase().includes(query) ||
      categoryName(p.categoryId).toLowerCase().includes(query) ||
      (p.notes || '').toLowerCase().includes(query) ||
      formatBirthday(p.birthDate, true).toLowerCase().includes(query) ||
      (p.birthDate || '').includes(query) ||
      (p.deathDate || '').includes(query);
  }
  function metaLine(p) {
    const parts = [categoryName(p.categoryId)];
    if (p.deceased) {
      const by = p.birthDate ? parseBirthDate(p.birthDate).year : null;
      const dy = p.deathDate ? parseBirthDate(p.deathDate).year : null;
      parts.push(by || dy ? `${by || '?'}–${dy || '?'}` : 'verstorben');
    } else if (p.birthDate) {
      parts.push(formatBirthday(p.birthDate, false));
    }
    return parts.join(' · ');
  }
  function connectionsFor(personId) {
    return state.connections.filter((c) => c.a === personId || c.b === personId);
  }
  function otherPersonInConnection(c, personId) { return c.a === personId ? c.b : c.a; }
  function neighborsOf(personId) {
    return new Set(connectionsFor(personId).map((c) => otherPersonInConnection(c, personId)));
  }
  function isPartnerLabel(label) { return /partner/i.test(label || ''); }
  function isChildLabel(label) { return /kind/i.test(label || ''); }
  function partnersOf(personId) {
    return connectionsFor(personId)
      .filter((c) => isPartnerLabel(c.label))
      .map((c) => otherPersonInConnection(c, personId));
  }
  // Kinder gelten standardmässig als mit beiden Partnern verbunden: sobald
  // eine Kind-Beziehung zu einem Elternteil eingetragen wird, wird automatisch
  // dieselbe Beziehung zu dessen Partner/in ergänzt (falls noch keine besteht).
  function ensureChildLinkedToPartners(parentId, childId, label) {
    partnersOf(parentId).forEach((partnerId) => {
      if (partnerId === childId) return;
      const alreadyLinked = state.connections.some((c) =>
        (c.a === partnerId && c.b === childId) || (c.a === childId && c.b === partnerId));
      if (!alreadyLinked) state.connections.push({ id: uid('e'), a: partnerId, b: childId, label });
    });
  }
  function parentsOf(personId) {
    return state.connections
      .filter((c) => isChildLabel(c.label) && (c.a === personId || c.b === personId))
      .map((c) => otherPersonInConnection(c, personId));
  }
  // Geschwister-Erkennung: sobald zwei Personen dieselben (mindestens zwei)
  // Elternteile eingetragen haben, wird automatisch eine Geschwister-
  // Verbindung ergänzt (nur wenn noch gar keine Verbindung zwischen ihnen
  // besteht, damit bestehende, abweichende Angaben nicht überschrieben werden).
  function ensureSiblingLinks() {
    const childrenByParentPair = new Map();
    state.people.forEach((p) => {
      const parents = parentsOf(p.id);
      if (parents.length < 2) return;
      const key = parents.slice().sort().join('|');
      if (!childrenByParentPair.has(key)) childrenByParentPair.set(key, []);
      childrenByParentPair.get(key).push(p.id);
    });
    childrenByParentPair.forEach((childIds) => {
      for (let i = 0; i < childIds.length; i++) {
        for (let j = i + 1; j < childIds.length; j++) {
          const a = childIds[i], b = childIds[j];
          const exists = state.connections.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
          if (!exists) state.connections.push({ id: uid('e'), a, b, label: 'Geschwister' });
        }
      }
    });
  }

  function showToast(msg, ms) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  // -------------------------------------------------------------- theme
  function initTheme() {
    const saved = localStorage.getItem('zirkel-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('zirkel-theme', next);
  }

  // ------------------------------------------------ app shell (nach Login)
  // Der komplette Inhalt der eigentlichen App wird bewusst NICHT im
  // ausgelieferten HTML mitgeschickt, sondern erst per JS eingefügt, nachdem
  // eine gültige Session bestätigt wurde (startApp()). So steht im
  // ausgeloggten Zustand (z. B. im "View Source" oder bei einem Crawler, der
  // robots.txt ignoriert) nichts über Zweck/Inhalt der App im Dokument.
  const APP_SHELL_HTML = `
    <header class="topbar">
      <button id="btn-sidebar-toggle" class="btn btn-ghost sidebar-toggle" aria-label="Personenliste">☰</button>
      <div class="brand">
        <svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="2.4" opacity="0.35"/>
          <circle cx="24" cy="12" r="4" fill="currentColor"/>
          <circle cx="13" cy="31" r="4" fill="currentColor"/>
          <circle cx="35" cy="31" r="4" fill="currentColor"/>
          <path d="M24 16 L15 27.5 M24 16 L33 27.5 M17 31 H31" stroke="currentColor" stroke-width="1.6" opacity="0.6"/>
        </svg>
        <span class="brand-name">Zirkel</span>
      </div>

      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 14 L18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input id="search" type="search" placeholder="Namen suchen… ( / )" autocomplete="off" aria-label="Namen suchen">
      </div>

      <div class="topbar-actions">
        <span id="save-status" class="save-status" data-state="saved">Gespeichert</span>
        <button id="btn-add-person" class="btn btn-primary">+ Person</button>
        <div class="menu-wrap">
          <button id="btn-menu" class="btn btn-ghost" aria-haspopup="true" aria-expanded="false">⋯</button>
          <div id="menu-dropdown" class="menu-dropdown" hidden>
            <button type="button" data-action="bulk" class="desktop-only-item">Mehrere Personen erfassen</button>
            <button type="button" data-action="categories">Kategorien verwalten</button>
            <button type="button" data-action="export">Als JSON exportieren</button>
            <label class="menu-item-file">Aus JSON importieren<input id="import-file" type="file" accept="application/json" hidden></label>
            <button type="button" data-action="theme">Hell / Dunkel umschalten</button>
            <button type="button" data-action="account">Konto &amp; Passwort</button>
            <hr>
            <button type="button" data-action="logout">Abmelden</button>
          </div>
        </div>
      </div>
    </header>

    <div id="update-banner" class="update-banner" hidden>
      <span>Es gibt eine neue Version von Zirkel.</span>
      <button id="btn-update-reload" class="btn btn-primary btn-small">Neu laden</button>
    </div>

    <div id="install-banner" class="update-banner install-banner" hidden>
      <span>Zirkel lässt sich als App installieren - für schnelleren Zugriff.</span>
      <button id="btn-install" class="btn btn-primary btn-small">Installieren</button>
      <button id="btn-install-dismiss" class="btn btn-ghost btn-small">Später</button>
    </div>

    <div class="layout">
      <div id="sidebar-scrim" class="sidebar-scrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-stats" id="sidebar-stats"></div>
        <div class="legend" id="legend"></div>
        <div class="people-list" id="people-list"></div>
        <div class="empty-state" id="empty-state" hidden>
          <p>Noch keine Personen im Netzwerk.</p>
          <button class="btn btn-primary" id="btn-add-first">Erste Person hinzufügen</button>
        </div>
      </aside>

      <main class="canvas-wrap">
        <svg id="graph"></svg>
        <div class="canvas-hint">Ziehen zum Verschieben · Scrollen zum Zoomen</div>
        <div class="canvas-empty" id="canvas-empty" hidden>
          <p>Euer Netzwerk ist noch leer.</p>
        </div>
      </main>
    </div>

    <aside class="drawer" id="drawer" hidden>
      <div id="drawer-content"></div>
    </aside>

    <div class="modal-overlay" id="modal-overlay" hidden>
      <div class="modal" id="modal-content" role="dialog" aria-modal="true"></div>
    </div>

    <div class="toast" id="toast" hidden></div>

    <datalist id="relationship-types">
      <option value="Partner/in">
      <option value="Kind">
      <option value="Elternteil">
      <option value="Geschwister">
      <option value="Grosseltern">
      <option value="Enkel/in">
      <option value="Cousin/Cousine">
      <option value="Freund/in">
      <option value="Kolleg/in">
      <option value="Chef/in">
      <option value="Nachbar/in">
      <option value="Bekannte/r">
      <option value="Mentor/in">
    </datalist>`;

  function ensureAppShell() {
    let appEl = document.getElementById('app');
    if (appEl) return appEl;
    appEl = document.createElement('div');
    appEl.id = 'app';
    appEl.hidden = true;
    appEl.innerHTML = APP_SHELL_HTML;
    document.body.appendChild(appEl);
    return appEl;
  }

  // ---------------------------------------------------------- auth screen
  async function initAuthScreen(prefillError) {
    const appEl = document.getElementById('app');
    if (appEl) appEl.hidden = true;
    document.getElementById('auth-screen').hidden = false;
    let setup = { userCount: 2, canRegister: false };
    try {
      const r = await fetch('/api/setup.php');
      setup = await r.json();
    } catch (e) { /* Server evtl. kurz nicht erreichbar */ }

    const tabs = document.getElementById('auth-tabs');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const hint = document.getElementById('register-hint');

    function activate(tab) {
      loginForm.hidden = tab !== 'login';
      registerForm.hidden = tab !== 'register';
      tabs.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    }

    if (setup.userCount === 0) {
      tabs.hidden = true;
      activate('register');
      hint.textContent = 'Richtet das erste von zwei Konten ein.';
    } else if (setup.canRegister) {
      tabs.hidden = false;
      activate('login');
      hint.textContent = 'Richtet das zweite Konto ein, damit ihr zu zweit Zugriff habt.';
      tabs.querySelectorAll('.auth-tab').forEach((b) => (b.onclick = () => activate(b.dataset.tab)));
    } else {
      tabs.hidden = true;
      registerForm.hidden = true;
      activate('login');
    }

    if (prefillError) showAuthError('login-error', prefillError);
  }

  function showAuthError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.hidden = false;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    document.getElementById('login-error').hidden = true;
    try {
      const res = await fetch('/api/login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), remember: fd.get('remember') === 'on' })
      });
      const json = await res.json();
      if (!res.ok) return showAuthError('login-error', json.message || 'Anmeldung fehlgeschlagen.');
      currentUser = json.user;
      await startApp();
    } catch (err) {
      showAuthError('login-error', 'Server nicht erreichbar. Bitte erneut versuchen.');
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    document.getElementById('register-error').hidden = true;
    try {
      const res = await fetch('/api/register.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), displayName: fd.get('displayName') })
      });
      const json = await res.json();
      if (!res.ok) return showAuthError('register-error', json.message || 'Registrierung fehlgeschlagen.');
      currentUser = json.user;
      await startApp();
    } catch (err) {
      showAuthError('register-error', 'Server nicht erreichbar. Bitte erneut versuchen.');
    }
  });

  // ------------------------------------------------------------ app boot
  async function startApp() {
    ensureAppShell();
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app').hidden = false;
    await loadNetwork();
    wireAppEventsOnce();
    initServiceWorker();
    maybeShowInstallBanner();
    // Kein ständiges Polling - die Ansicht wird beim Öffnen (Start, erneutes
    // Sichtbarwerden des Tabs bzw. Fokus, z. B. nach dem Wechsel zur App) neu geladen.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) backgroundRefresh(); });
    window.addEventListener('focus', backgroundRefresh);
  }

  async function loadNetwork() {
    const res = await fetch('/api/network.php');
    if (res.status === 401) { await initAuthScreen(); return; }
    const json = await res.json();
    state = json.data;
    state.people = state.people || [];
    state.categories = state.categories || [];
    state.connections = state.connections || [];
    version = json.version;
    renderAll(true);
  }

  async function backgroundRefresh() {
    if (dirty || saving) return;
    try {
      const res = await fetch('/api/network.php');
      if (res.status === 401) { await initAuthScreen(); return; }
      const json = await res.json();
      if (json.version !== version) {
        state = json.data;
        version = json.version;
        renderAll(true);
      }
    } catch (e) { /* still offline, egal */ }
  }

  // ------------------------------------------------------------- saving
  function setSaveStatus(stateName, label) {
    const el = document.getElementById('save-status');
    el.dataset.state = stateName;
    el.textContent = label;
  }

  function scheduleSave(structural) {
    dirty = true;
    setSaveStatus('unsaved', 'Ungespeichert…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1600);
  }

  async function saveNow() {
    if (saving) { saveTimer = setTimeout(saveNow, 800); return; }
    saving = true;
    setSaveStatus('saving', 'Speichert…');
    try {
      const res = await fetch('/api/network.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: state, version })
      });
      if (res.status === 401) { saving = false; await initAuthScreen('Sitzung abgelaufen. Bitte erneut anmelden.'); return; }
      if (res.status === 409) {
        const json = await res.json();
        state = json.data;
        version = json.version;
        dirty = false;
        saving = false;
        renderAll(true);
        showToast('Jemand anderes hat gerade gespeichert — Ansicht aktualisiert.');
        setSaveStatus('saved', 'Gespeichert');
        return;
      }
      if (!res.ok) throw new Error('save_failed');
      const json = await res.json();
      version = json.version;
      dirty = false;
      saving = false;
      setSaveStatus('saved', 'Gespeichert');
    } catch (err) {
      saving = false;
      setSaveStatus('error', 'Fehler — erneuter Versuch…');
      saveTimer = setTimeout(saveNow, 4000);
    }
  }

  // ------------------------------------------------------------- render
  function renderAll(structural) {
    renderStats();
    renderLegend();
    renderPeopleList();
    renderGraph(structural);
    if (selectedPersonId && !personById(selectedPersonId)) closeDrawer();
    else if (selectedPersonId) renderDrawer(selectedPersonId);
  }

  function renderStats() {
    const p = state.people.length;
    const c = state.connections.length;
    document.getElementById('sidebar-stats').textContent =
      `${p} ${p === 1 ? 'Person' : 'Personen'} · ${c} ${c === 1 ? 'Verbindung' : 'Verbindungen'}`;
  }

  function renderLegend() {
    const legend = document.getElementById('legend');
    const counts = {};
    state.people.forEach((p) => { counts[p.categoryId || '__none__'] = (counts[p.categoryId || '__none__'] || 0) + 1; });
    const chips = state.categories.map((c) => `
      <button type="button" class="legend-chip ${hiddenCategoryIds.has(c.id) ? 'off' : ''}" data-cat="${c.id}" title="Kategorie ein-/ausblenden">
        <span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)} (${counts[c.id] || 0})
      </button>`).join('');
    const noneCount = counts['__none__'] || 0;
    const noneChip = noneCount > 0 ? `
      <button type="button" class="legend-chip ${hiddenCategoryIds.has('__none__') ? 'off' : ''}" data-cat="__none__" title="Kategorie ein-/ausblenden">
        <span class="dot" style="background:${categoryColor(null)}"></span>Ohne Kategorie (${noneCount})
      </button>` : '';
    const resetChip = hiddenCategoryIds.size > 0 ? `<button type="button" class="legend-reset" id="btn-legend-reset">Alle anzeigen</button>` : '';
    legend.innerHTML = chips + noneChip + resetChip +
      `<button type="button" class="legend-manage" id="btn-legend-manage">Verwalten</button>`;
    legend.querySelectorAll('.legend-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cat;
        if (hiddenCategoryIds.has(id)) hiddenCategoryIds.delete(id); else hiddenCategoryIds.add(id);
        renderLegend();
        renderPeopleList();
        renderGraph(false);
      });
    });
    const resetBtn = document.getElementById('btn-legend-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      hiddenCategoryIds.clear();
      renderLegend();
      renderPeopleList();
      renderGraph(false);
    });
    document.getElementById('btn-legend-manage').addEventListener('click', () => openModal('categories'));
  }

  function renderPeopleList() {
    const list = document.getElementById('people-list');
    const empty = document.getElementById('empty-state');
    const canvasEmpty = document.getElementById('canvas-empty');
    if (state.people.length === 0) {
      list.innerHTML = '';
      empty.hidden = false;
      canvasEmpty.hidden = false;
      return;
    }
    empty.hidden = true;
    canvasEmpty.hidden = true;
    let people = state.people.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
    if (searchQuery) people = people.filter((p) => matchesSearch(p, searchQuery));
    people = people.filter((p) => !hiddenCategoryIds.has(p.categoryId || '__none__'));
    if (people.length === 0) {
      const msg = searchQuery
        ? `Keine Treffer für «${escapeHtml(searchQuery)}».`
        : 'Keine Personen in den ausgewählten Kategorien sichtbar.';
      list.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
      return;
    }
    list.innerHTML = people.map((p) => `
      <button type="button" class="person-row ${p.id === selectedPersonId ? 'selected' : ''}" data-id="${p.id}">
        <span class="avatar" style="background:${categoryColor(p.categoryId)}">${escapeHtml((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <span class="meta">
          <span class="name">${highlightMatch(displayName(p), searchQuery)}</span>
          <span class="cat">${escapeHtml(metaLine(p))}</span>
        </span>
      </button>`).join('');
    list.querySelectorAll('.person-row').forEach((row) => {
      row.addEventListener('click', () => selectPerson(row.dataset.id));
    });
  }

  // ------------------------------------------------------------- graph
  let svg, viewport, linksLayer, nodesLayer, simulation, dragBehavior;
  let linkSelRef = null, nodeSelRef = null;

  function initGraph() {
    svg = d3.select('#graph');
    viewport = svg.append('g').attr('class', 'viewport');
    linksLayer = viewport.append('g').attr('class', 'links-layer');
    nodesLayer = viewport.append('g').attr('class', 'nodes-layer');

    const zoom = d3.zoom().scaleExtent([0.25, 3]).on('zoom', (event) => {
      viewport.attr('transform', event.transform);
    });
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', () => selectPerson(null));

    simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id((d) => d.id).distance((d) => isPartnerLabel(d.label) ? 46 : 105).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('collide', d3.forceCollide(NODE_R + 26))
      .force('center', d3.forceCenter())
      .on('tick', ticked);

    dragBehavior = d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        d.a.fx = d.a.x; d.a.fy = d.a.y;
        if (d.type === 'pair') { d.b.fx = d.b.x; d.b.fy = d.b.y; }
      })
      .on('drag', (event, d) => {
        d.a.fx = event.x; d.a.fy = event.y;
        if (d.type === 'pair') { d.b.fx = event.x; d.b.fy = event.y; }
      })
      .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); scheduleSave(); });

    resizeGraph();
    window.addEventListener('resize', debounce(resizeGraph, 200));
  }

  function resizeGraph() {
    const wrap = document.querySelector('.canvas-wrap');
    const w = wrap.clientWidth || 800;
    const h = wrap.clientHeight || 600;
    svg.attr('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);
    simulation.force('center').x(0).y(0);
    simulation.alpha(0.1).restart();
  }

  // Verpartnerte Personen werden nicht als zwei Kreise dargestellt, sondern
  // als ein gemeinsamer Herz-Knoten. Jede Person ist höchstens in einem
  // solchen "gesperrten" Paar (die erste gefundene Partner-Verbindung
  // gewinnt) — weitere Partner-Verbindungen (z. B. Ex-Partner) fallen auf
  // die alte Darstellung (Linie + Herz-Symbol) zurück.
  function computeLockedPairs() {
    const pairOfPerson = new Map();
    const used = new Set();
    state.connections.forEach((c) => {
      if (!isPartnerLabel(c.label)) return;
      if (used.has(c.a) || used.has(c.b)) return;
      if (!personById(c.a) || !personById(c.b) || c.a === c.b) return;
      used.add(c.a); used.add(c.b);
      pairOfPerson.set(c.a, c.b);
      pairOfPerson.set(c.b, c.a);
    });
    return pairOfPerson;
  }
  function pairKeyOf(personId, pairOfPerson) {
    const partnerId = pairOfPerson.get(personId);
    return partnerId ? [personId, partnerId].sort().join('|') : null;
  }
  function resolvedKey(personId, pairOfPerson) {
    return pairKeyOf(personId, pairOfPerson) || personId;
  }
  function keyToIds(key) { return key.indexOf('|') !== -1 ? key.split('|') : [key]; }
  function positionOfKey(key) {
    const ids = keyToIds(key);
    if (ids.length === 1) { const p = personById(ids[0]); return { x: (p && p.x) || 0, y: (p && p.y) || 0 }; }
    const [p1, p2] = ids.map(personById);
    if (!p1 || !p2) return { x: 0, y: 0 };
    return { x: ((p1.x || 0) + (p2.x || 0)) / 2, y: ((p1.y || 0) + (p2.y || 0)) / 2 };
  }
  function heartPath(r) {
    return `M0,${r * 0.3} C${-r},${-r * 0.4} ${-r * 1.6},${r * 0.6} 0,${r * 1.6} ` +
      `C${r * 1.6},${r * 0.6} ${r},${-r * 0.4} 0,${r * 0.3} Z`;
  }
  // Baut aus den rohen Verbindungen die anzuzeigenden Linien: Verbindungen,
  // deren beide Enden im selben gesperrten Paar liegen, werden unterdrückt
  // (das Paar wird ja schon als Herz dargestellt); Verbindungen zum selben
  // Ziel-Schlüssel (z. B. zwei "Kind"-Verbindungen zu beiden Elternteilen
  // eines Paares) werden zu einer einzigen Linie zusammengefasst.
  function buildDisplayLinks(pairOfPerson) {
    const map = new Map();
    const order = [];
    state.connections.forEach((c) => {
      if (!personById(c.a) || !personById(c.b)) return;
      const aKey = resolvedKey(c.a, pairOfPerson);
      const bKey = resolvedKey(c.b, pairOfPerson);
      if (aKey === bKey) return;
      const dedupeKey = [aKey, bKey].sort().join('~~');
      let entry = map.get(dedupeKey);
      if (!entry) {
        entry = { id: 'dl:' + dedupeKey, sourceKey: aKey, targetKey: bKey, labels: [] };
        map.set(dedupeKey, entry);
        order.push(entry);
      }
      if (c.label && !entry.labels.includes(c.label)) entry.labels.push(c.label);
    });
    return order;
  }

  function egoSetFor(id, pairOfPerson) {
    if (!id) return null;
    const set = new Set([id, ...neighborsOf(id)]);
    const partnerId = pairOfPerson.get(id);
    if (partnerId) set.add(partnerId);
    return set;
  }

  function renderGraph(structural) {
    if (!simulation) initGraph();

    const pairOfPerson = computeLockedPairs();
    const ego = egoSetFor(selectedPersonId, pairOfPerson);
    function nodeVisible(d) {
      if (!d) return false;
      if (hiddenCategoryIds.has(d.categoryId || '__none__')) return false;
      if (searchQuery && !matchesSearch(d, searchQuery)) return false;
      if (ego && !ego.has(d.id)) return false;
      return true;
    }
    function keyVisible(key) { return keyToIds(key).map(personById).some(nodeVisible); }
    function keyTouchesSelection(key) { return !!selectedPersonId && keyToIds(key).includes(selectedPersonId); }

    // Physik-Simulation läuft weiterhin auf den echten Personen-Knoten und
    // allen rohen Verbindungen (inkl. der gespiegelten Kind-Verbindungen) —
    // das zieht z. B. Kinder zu beiden Elternteilen hin. Nur die Darstellung
    // (unten) gruppiert Paare und dedupliziert Linien.
    const linkObjs = state.connections.map((c) => ({ id: c.id, source: c.a, target: c.b, label: c.label || '' }));
    simulation.nodes(state.people);
    simulation.force('link').links(linkObjs);
    if (structural) simulation.alpha(0.6).restart();

    const displayLinks = buildDisplayLinks(pairOfPerson);
    const linkSel = linksLayer.selectAll('g.link-g').data(displayLinks, (d) => d.id);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('g').attr('class', 'link-g');
    linkEnter.append('line').attr('class', 'link-line');
    linkEnter.append('text').attr('class', 'link-label').attr('text-anchor', 'middle');
    linkEnter.append('text').attr('class', 'link-heart').attr('text-anchor', 'middle');
    linkSelRef = linkEnter.merge(linkSel);
    linkSelRef.select('text.link-label').text((d) => d.labels.some(isPartnerLabel) ? '' : d.labels.join(' / '));
    linkSelRef.select('text.link-heart').text((d) => d.labels.some(isPartnerLabel) ? '♥' : '');
    linkSelRef.classed('dim', (d) => !(keyVisible(d.sourceKey) && keyVisible(d.targetKey)));
    linkSelRef.select('line.link-line')
      .classed('active', (d) => keyTouchesSelection(d.sourceKey) || keyTouchesSelection(d.targetKey))
      .classed('is-partner', (d) => d.labels.some(isPartnerLabel));

    // Sichtbare Knoten: verpartnerte Personen werden zu einem Herz-Knoten
    // zusammengefasst (ein Eintrag pro gesperrtem Paar statt zwei Kreisen).
    const pairKeysSeen = new Set();
    const visualNodes = [];
    state.people.forEach((p) => {
      const partnerId = pairOfPerson.get(p.id);
      if (partnerId) {
        const key = [p.id, partnerId].sort().join('|');
        if (pairKeysSeen.has(key)) return;
        pairKeysSeen.add(key);
        const [leftId, rightId] = key.split('|');
        visualNodes.push({ id: 'pair:' + key, type: 'pair', a: personById(leftId), b: personById(rightId) });
      } else {
        visualNodes.push({ id: p.id, type: 'single', a: p });
      }
    });
    function visualNodeVisible(d) { return d.type === 'pair' ? (nodeVisible(d.a) || nodeVisible(d.b)) : nodeVisible(d.a); }

    const nodeSel = nodesLayer.selectAll('g.node-g').data(visualNodes, (d) => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('g').attr('class', 'node-g').call(dragBehavior);
    nodeEnter.filter((d) => d.type === 'single').append('circle').attr('class', 'node-circle').attr('r', NODE_R);
    nodeEnter.filter((d) => d.type === 'single').append('text').attr('class', 'node-age').attr('text-anchor', 'middle').attr('dy', '0.32em');
    nodeEnter.filter((d) => d.type === 'pair').append('path').attr('class', 'heart-shape').attr('d', heartPath(NODE_R));
    nodeEnter.filter((d) => d.type === 'pair').append('text').attr('class', 'node-age-half node-age-a').attr('text-anchor', 'middle')
      .attr('dx', -NODE_R * 0.55).attr('dy', NODE_R * 0.15 + 4);
    nodeEnter.filter((d) => d.type === 'pair').append('text').attr('class', 'node-age-half node-age-b').attr('text-anchor', 'middle')
      .attr('dx', NODE_R * 0.55).attr('dy', NODE_R * 0.15 + 4);
    nodeEnter.append('text').attr('class', 'node-label').attr('text-anchor', (d) => d.type === 'pair' ? 'middle' : 'start');
    nodeEnter.on('click', (event, d) => {
      event.stopPropagation();
      if (d.type === 'pair') {
        const [lx] = d3.pointer(event, event.currentTarget);
        selectPerson(lx < 0 ? d.a.id : d.b.id);
      } else {
        selectPerson(d.a.id);
      }
    });
    nodeEnter.on('dblclick', (event, d) => {
      event.stopPropagation();
      d.a.fx = null; d.a.fy = null;
      if (d.type === 'pair') { d.b.fx = null; d.b.fy = null; }
      simulation.alpha(0.4).restart(); scheduleSave();
    });
    nodeSelRef = nodeEnter.merge(nodeSel);
    nodeSelRef.select('circle.node-circle')
      .attr('fill', (d) => categoryColor(d.a.categoryId))
      .classed('selected', (d) => d.a.id === selectedPersonId)
      .classed('deceased', (d) => !!d.a.deceased);
    nodeSelRef.select('path.heart-shape')
      .classed('selected', (d) => d.a.id === selectedPersonId || d.b.id === selectedPersonId);
    nodeSelRef.select('text.node-label')
      .attr('dx', (d) => d.type === 'pair' ? 0 : NODE_R + 6)
      .attr('dy', (d) => d.type === 'pair' ? NODE_R * 1.6 + 14 : 4)
      .text((d) => d.type === 'pair' ? `${displayName(d.a)} & ${displayName(d.b)}` : displayName(d.a));
    nodeSelRef.select('text.node-age')
      .text((d) => { const age = displayAge(d.a); return age != null ? age : ''; });
    nodeSelRef.select('text.node-age-a')
      .text((d) => { const age = displayAge(d.a); return age != null ? age : ''; });
    nodeSelRef.select('text.node-age-b')
      .text((d) => { const age = displayAge(d.b); return age != null ? age : ''; });
    nodeSelRef.classed('dim', (d) => !visualNodeVisible(d));

    ticked();
  }

  function ticked() {
    if (linkSelRef) {
      linkSelRef.select('line.link-line')
        .attr('x1', (d) => positionOfKey(d.sourceKey).x).attr('y1', (d) => positionOfKey(d.sourceKey).y)
        .attr('x2', (d) => positionOfKey(d.targetKey).x).attr('y2', (d) => positionOfKey(d.targetKey).y);
      linkSelRef.select('text.link-label').attr('x', (d) => {
        const s = positionOfKey(d.sourceKey), t = positionOfKey(d.targetKey);
        return (s.x + t.x) / 2;
      }).attr('y', (d) => {
        const s = positionOfKey(d.sourceKey), t = positionOfKey(d.targetKey);
        return (s.y + t.y) / 2 - 5;
      });
      linkSelRef.select('text.link-heart').attr('x', (d) => {
        const s = positionOfKey(d.sourceKey), t = positionOfKey(d.targetKey);
        return (s.x + t.x) / 2;
      }).attr('y', (d) => {
        const s = positionOfKey(d.sourceKey), t = positionOfKey(d.targetKey);
        return (s.y + t.y) / 2 + 4;
      });
    }
    if (nodeSelRef) {
      nodeSelRef.attr('transform', (d) => {
        if (d.type === 'pair') {
          const x = ((d.a.x || 0) + (d.b.x || 0)) / 2;
          const y = ((d.a.y || 0) + (d.b.y || 0)) / 2;
          return `translate(${x},${y})`;
        }
        return `translate(${d.a.x || 0},${d.a.y || 0})`;
      });
    }
  }

  function selectPerson(id) {
    selectedPersonId = id;
    if (id) openDrawer(id); else closeDrawer();
    renderPeopleList();
    renderGraph(false);
  }

  // ------------------------------------------------------------- drawer
  function openDrawer(id) {
    document.getElementById('drawer').hidden = false;
    renderDrawer(id);
  }
  function closeDrawer() {
    document.getElementById('drawer').hidden = true;
    selectedPersonId = null;
  }

  function renderDrawer(id) {
    const p = personById(id);
    if (!p) { closeDrawer(); return; }
    const conns = connectionsFor(id);
    const others = state.people.filter((o) => o.id !== id).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const connectedIds = new Set(conns.map((c) => otherPersonInConnection(c, id)));
    const candidates = others.filter((o) => !connectedIds.has(o.id));

    document.getElementById('drawer-content').innerHTML = `
      <div class="drawer-header"><h2>Person</h2><button class="drawer-close" id="drawer-close" aria-label="Schliessen">×</button></div>
      <div class="drawer-body">
        <label class="field"><span>Name</span><input type="text" id="f-name" value="${escapeHtml(p.name)}" placeholder="Name"></label>
        <label class="field"><span>Geburtstag <span class="field-hint" id="f-birthdate-hint">${p.birthDate && displayAge(p) != null ? `(${displayAge(p)} Jahre)` : ''}</span></span><input type="date" id="f-birthdate" value="${p.birthDate || ''}" max="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="check"><input type="checkbox" id="f-deceased" ${p.deceased ? 'checked' : ''}><span>Verstorben</span></label>
        <label class="field" id="f-deathdate-wrap" ${p.deceased ? '' : 'hidden'}><span>Todesdatum (optional)</span><input type="date" id="f-deathdate" value="${p.deathDate || ''}" max="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="field"><span>Kategorie</span>
          <select id="f-category">
            <option value="">Keine Kategorie</option>
            ${state.categories.map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Notizen</span><textarea id="f-notes" placeholder="z. B. wie ihr euch kennt, Geburtstag, …">${escapeHtml(p.notes || '')}</textarea></label>
        <div>
          <span class="field-label">Verbindungen (${conns.length})</span>
          <div id="conn-list">
            ${conns.map((c) => {
              const other = personById(otherPersonInConnection(c, id));
              if (!other) return '';
              return `<div class="conn-row" data-cid="${c.id}">
                <span class="conn-dot" style="background:${categoryColor(other.categoryId)}"></span>
                <span class="conn-name" data-goto="${other.id}">${escapeHtml(other.name)}</span>
                <input type="text" class="conn-label-edit" data-cid="${c.id}" value="${escapeHtml(c.label || '')}" placeholder="Beziehung" list="relationship-types">
                <button class="conn-remove" data-remove="${c.id}" title="Verbindung entfernen">×</button>
              </div>`;
            }).join('') || '<p class="auth-hint">Noch keine Verbindungen.</p>'}
          </div>
          <div class="add-conn-row">
            <div class="person-search" id="conn-person-search-wrap">
              <input type="text" id="conn-person-search" placeholder="Person suchen oder neu anlegen…" autocomplete="off">
              <div class="person-search-list" id="conn-person-list" hidden></div>
            </div>
            <input type="text" id="conn-label-input" placeholder="Beziehung (optional)" list="relationship-types">
            <button class="btn btn-primary btn-small" id="btn-add-conn">+ Verbindung</button>
          </div>
        </div>
        <button class="btn btn-danger" id="btn-delete-person">Person löschen</button>
      </div>`;

    document.getElementById('drawer-close').addEventListener('click', () => selectPerson(null));
    document.getElementById('f-name').addEventListener('input', debounce((e) => {
      p.name = e.target.value;
      renderPeopleList(); renderLegend(); renderGraph(false); scheduleSave();
    }, 150));
    document.getElementById('f-birthdate').addEventListener('change', (e) => {
      p.birthDate = e.target.value || null;
      renderPeopleList(); scheduleSave();
      const hint = document.getElementById('f-birthdate-hint');
      if (hint) hint.textContent = (p.birthDate && displayAge(p) != null) ? `(${displayAge(p)} Jahre)` : '';
    });
    document.getElementById('f-deceased').addEventListener('change', (e) => {
      p.deceased = e.target.checked;
      if (!p.deceased) p.deathDate = null;
      renderPeopleList(); renderGraph(false); scheduleSave();
      renderDrawer(id);
    });
    const deathdateEl = document.getElementById('f-deathdate');
    if (deathdateEl) deathdateEl.addEventListener('change', (e) => {
      p.deathDate = e.target.value || null;
      renderPeopleList(); renderGraph(false); scheduleSave();
      const hint = document.getElementById('f-birthdate-hint');
      if (hint) hint.textContent = (p.birthDate && displayAge(p) != null) ? `(${displayAge(p)} Jahre)` : '';
    });
    document.getElementById('f-category').addEventListener('change', (e) => {
      p.categoryId = e.target.value || null;
      renderPeopleList(); renderLegend(); renderGraph(false); scheduleSave();
      renderDrawer(id);
    });
    document.getElementById('f-notes').addEventListener('input', debounce((e) => {
      p.notes = e.target.value;
      scheduleSave();
    }, 250));
    document.querySelectorAll('.conn-name').forEach((el) => {
      el.addEventListener('click', () => selectPerson(el.dataset.goto));
    });
    document.querySelectorAll('.conn-label-edit').forEach((el) => {
      el.addEventListener('input', debounce((e) => {
        const c = state.connections.find((x) => x.id === e.target.dataset.cid);
        if (!c) return;
        c.label = e.target.value;
        if (isChildLabel(c.label)) {
          ensureChildLinkedToPartners(id, otherPersonInConnection(c, id), c.label);
          ensureSiblingLinks();
          renderAll(true); scheduleSave(true); return;
        }
        renderGraph(false); scheduleSave();
      }, 200));
    });
    document.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.connections = state.connections.filter((c) => c.id !== btn.dataset.remove);
        renderStats(); renderGraph(true); renderDrawer(id); scheduleSave(true);
      });
    });
    // Personensuche für neue Verbindung: Buchstaben eintippen filtert die
    // Auswahl live; Klick auf einen Treffer wählt ihn, sonst kann direkt
    // eine neue Person mit dem eingetippten Namen angelegt werden.
    const personSearchInput = document.getElementById('conn-person-search');
    const personSearchList = document.getElementById('conn-person-list');
    let connSelectedId = null;

    function closePersonSearch() { personSearchList.hidden = true; }
    function renderPersonSearch() {
      const q = personSearchInput.value.trim();
      const ql = q.toLowerCase();
      const matches = (ql ? candidates.filter((o) => o.name.toLowerCase().includes(ql)) : candidates)
        .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
        .slice(0, 40);
      const rows = matches.map((o) => `<button type="button" class="person-search-item" data-id="${o.id}">${highlightMatch(o.name, q)}</button>`).join('');
      const newLabel = q ? `+ Neue Person «${escapeHtml(q)}» anlegen` : '+ Neue Person anlegen';
      const emptyHint = (!matches.length && q) ? `<div class="person-search-empty">Keine Treffer für «${escapeHtml(q)}».</div>` : '';
      personSearchList.innerHTML = emptyHint + rows + `<button type="button" class="person-search-item person-search-new" data-new="1">${newLabel}</button>`;
      personSearchList.hidden = false;
      personSearchList.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const other = personById(btn.dataset.id);
          if (!other) return;
          connSelectedId = other.id;
          personSearchInput.value = other.name;
          closePersonSearch();
        });
      });
      personSearchList.querySelector('[data-new]').addEventListener('click', () => {
        connSelectedId = null;
        closePersonSearch();
        addConnection(true);
      });
    }
    personSearchInput.addEventListener('input', () => { connSelectedId = null; renderPersonSearch(); });
    personSearchInput.addEventListener('focus', renderPersonSearch);
    personSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePersonSearch(); personSearchInput.blur(); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = personSearchList.querySelector('.person-search-item');
        if (first) first.click();
      }
    });
    function addConnection(createNew) {
      const label = document.getElementById('conn-label-input').value.trim();
      let otherId = connSelectedId;
      if (createNew || !otherId) {
        const name = personSearchInput.value.trim();
        if (!name) { personSearchInput.focus(); return; }
        const newP = { id: uid('p'), name, categoryId: p.categoryId || null, notes: '', birthDate: null, deceased: false, deathDate: null, x: (p.x || 0) + (Math.random() - 0.5) * 60, y: (p.y || 0) + (Math.random() - 0.5) * 60 };
        state.people.push(newP);
        otherId = newP.id;
      }
      state.connections.push({ id: uid('e'), a: id, b: otherId, label });
      if (isChildLabel(label)) { ensureChildLinkedToPartners(id, otherId, label); ensureSiblingLinks(); }
      renderAll(true); scheduleSave(true);
    }
    document.getElementById('btn-add-conn').addEventListener('click', () => addConnection(false));
    wireDangerButton(document.getElementById('btn-delete-person'), 'Person löschen', 'Wirklich löschen?', () => {
      state.people = state.people.filter((x) => x.id !== id);
      state.connections = state.connections.filter((c) => c.a !== id && c.b !== id);
      closeDrawer();
      renderAll(true);
      scheduleSave(true);
    });
  }

  function wireDangerButton(btn, idleLabel, confirmLabel, onConfirm) {
    let armed = false;
    let t = null;
    btn.textContent = idleLabel;
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        btn.textContent = confirmLabel;
        btn.classList.add('confirming');
        t = setTimeout(() => { armed = false; btn.textContent = idleLabel; btn.classList.remove('confirming'); }, 4000);
      } else {
        clearTimeout(t);
        onConfirm();
      }
    });
  }

  // ------------------------------------------------------------- modal
  function openModal(kind) {
    document.getElementById('modal-overlay').hidden = false;
    if (kind === 'categories') renderCategoriesModal();
    if (kind === 'bulk') renderBulkModal();
    if (kind === 'account') renderAccountModal();
  }
  function closeModal() { document.getElementById('modal-overlay').hidden = true; }

  function renderCategoriesModal() {
    const counts = {};
    state.people.forEach((p) => { counts[p.categoryId || ''] = (counts[p.categoryId || ''] || 0) + 1; });
    document.getElementById('modal-content').innerHTML = `
      <h2>Kategorien verwalten</h2>
      <div id="cat-rows">
        ${state.categories.map((c) => `
          <div class="cat-row" data-id="${c.id}">
            <input type="color" class="cat-color" data-id="${c.id}" value="${c.color}">
            <input type="text" class="cat-name" data-id="${c.id}" value="${escapeHtml(c.name)}">
            <span class="auth-hint">${counts[c.id] || 0}×</span>
            <button class="conn-remove" data-delcat="${c.id}" title="Kategorie löschen">×</button>
          </div>`).join('')}
      </div>
      <div class="new-cat-row">
        <input type="color" id="new-cat-color" value="${nextPaletteColor()}">
        <input type="text" id="new-cat-name" placeholder="Neue Kategorie">
        <button class="btn btn-primary btn-small" id="btn-add-cat">Hinzufügen</button>
      </div>
      <div style="margin-top:18px; text-align:right;"><button class="btn btn-ghost" id="modal-close">Schliessen</button></div>`;

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.querySelectorAll('.cat-color').forEach((el) => el.addEventListener('input', (e) => {
      const c = categoryById(e.target.dataset.id); if (!c) return;
      c.color = e.target.value; renderLegend(); renderGraph(false); scheduleSave();
    }));
    document.querySelectorAll('.cat-name').forEach((el) => el.addEventListener('input', debounce((e) => {
      const c = categoryById(e.target.dataset.id); if (!c) return;
      c.name = e.target.value; renderLegend(); renderPeopleList(); scheduleSave();
    }, 200)));
    document.querySelectorAll('[data-delcat]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.delcat;
      if (!confirm('Kategorie wirklich löschen? Zugeordnete Personen verlieren dann ihre Kategorie.')) return;
      state.categories = state.categories.filter((c) => c.id !== id);
      state.people.forEach((p) => { if (p.categoryId === id) p.categoryId = null; });
      hiddenCategoryIds.delete(id);
      renderAll(false);
      scheduleSave();
      renderCategoriesModal();
    }));
    document.getElementById('btn-add-cat').addEventListener('click', () => {
      const nameEl = document.getElementById('new-cat-name');
      const colorEl = document.getElementById('new-cat-color');
      const name = nameEl.value.trim();
      if (!name) { nameEl.focus(); return; }
      state.categories.push({ id: uid('cat'), name, color: colorEl.value });
      renderAll(false);
      scheduleSave();
      renderCategoriesModal();
    });
  }

  // ------------------------------------------------------- bulk-erfassung
  // Für die Erfassung am PC: eine Person pro Zeile, "Name; Kategorie;
  // Geburtstag; Beziehungen" — alles ausser dem Namen optional. Nur im
  // Desktop-Layout im Menü sichtbar (siehe .desktop-only-item in
  // styles.css), da Copy-Paste und mehrzeilige Texteingabe am Handy
  // unpraktisch sind.
  function parseBulkBirthDate(raw) {
    if (!raw) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (m) return raw;
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }
  function findOrCreateCategoryByName(name) {
    if (!name) return null;
    const existing = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const cat = { id: uid('cat'), name, color: nextPaletteColor() };
    state.categories.push(cat);
    return cat.id;
  }
  // Beziehungen werden als 4. Feld angegeben: "Beziehung: Zielname", mehrere
  // durch Komma getrennt, z. B. "Partner/in: Anna Muster, Kind: Lisa Muster".
  // Das Ziel kann eine bereits bestehende Person oder eine andere Zeile
  // desselben Stapels sein. Personen mit einer Beziehung zueinander werden
  // direkt nebeneinander platziert statt zufällig verteilt.
  function parseBulkRelations(raw) {
    return (raw || '').split(',').map((s) => s.trim()).filter(Boolean).map((spec) => {
      const colonIdx = spec.indexOf(':');
      if (colonIdx === -1) return null;
      const label = spec.slice(0, colonIdx).trim();
      const targetName = spec.slice(colonIdx + 1).trim();
      if (!label || !targetName) return null;
      return { label, targetName };
    }).filter(Boolean);
  }
  function importBulkPeople(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const created = [];
    let skipped = 0;
    lines.forEach((line, idx) => {
      const [namePart, categoryPart, birthPart, relPart] = line.split(';').map((s) => (s || '').trim());
      if (!namePart) { skipped++; return; }
      const person = {
        id: uid('p'),
        name: namePart,
        categoryId: findOrCreateCategoryByName(categoryPart),
        notes: '',
        birthDate: parseBulkBirthDate(birthPart),
        deceased: false,
        deathDate: null,
        x: (idx % 6) * 70 + (Math.random() - 0.5) * 20,
        y: Math.floor(idx / 6) * 90 + (Math.random() - 0.5) * 20
      };
      state.people.push(person);
      created.push({ person, relSpecs: parseBulkRelations(relPart) });
    });

    function findTargetByName(name) {
      const ql = name.toLowerCase();
      const inBatch = created.find((c) => c.person.name.toLowerCase() === ql);
      if (inBatch) return inBatch.person;
      return state.people.find((p) => p.name.toLowerCase() === ql) || null;
    }
    function hasConnection(idA, idB) {
      return state.connections.some((c) => (c.a === idA && c.b === idB) || (c.a === idB && c.b === idA));
    }

    let relationsAdded = 0, relationsSkipped = 0;
    created.forEach(({ person, relSpecs }) => {
      const targets = [];
      relSpecs.forEach(({ label, targetName }) => {
        const target = findTargetByName(targetName);
        if (!target || target.id === person.id) { relationsSkipped++; return; }
        if (!hasConnection(person.id, target.id)) {
          state.connections.push({ id: uid('e'), a: person.id, b: target.id, label });
          relationsAdded++;
          if (isChildLabel(label)) ensureChildLinkedToPartners(person.id, target.id, label);
        }
        targets.push(target);
      });
      if (targets.length) {
        person.x = targets.reduce((sum, t) => sum + (t.x || 0), 0) / targets.length + (Math.random() - 0.5) * 40;
        person.y = targets.reduce((sum, t) => sum + (t.y || 0), 0) / targets.length + (Math.random() - 0.5) * 40;
      }
    });
    ensureSiblingLinks();

    return { added: created.length, skipped, relationsAdded, relationsSkipped };
  }
  function renderBulkModal() {
    document.getElementById('modal-content').innerHTML = `
      <h2>Mehrere Personen erfassen</h2>
      <p class="auth-hint">Eine Person pro Zeile: <strong>Name; Kategorie; Geburtstag; Beziehungen</strong>. Alles ausser dem Namen ist optional (Geburtstag als JJJJ-MM-TT oder TT.MM.JJJJ). Beziehungen als «Beziehung: Name» angeben, mehrere durch Komma trennen — das Ziel kann eine bestehende Person oder eine andere Zeile hier sein. Verbundene Personen werden direkt nebeneinander platziert; unbekannte Kategorien werden automatisch angelegt.</p>
      <textarea id="bulk-textarea" rows="10" placeholder="Anna Muster; Freundin; 1990-04-12
Peter Beispiel; Kollege; ; Partner/in: Anna Muster
Lisa Muster; ; 2015-06-01; Kind: Anna Muster, Kind: Peter Beispiel"></textarea>
      <div style="margin-top:18px; display:flex; justify-content:flex-end; gap:10px;">
        <button class="btn btn-ghost" id="modal-close">Abbrechen</button>
        <button class="btn btn-primary" id="btn-bulk-submit">Personen anlegen</button>
      </div>`;
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('bulk-textarea').focus();
    document.getElementById('btn-bulk-submit').addEventListener('click', () => {
      const { added, skipped, relationsAdded, relationsSkipped } = importBulkPeople(document.getElementById('bulk-textarea').value);
      closeModal();
      if (added > 0) { renderAll(true); scheduleSave(true); }
      const skippedTotal = skipped + relationsSkipped;
      showToast(added > 0
        ? `${added} ${added === 1 ? 'Person' : 'Personen'} hinzugefügt` +
          (relationsAdded ? `, ${relationsAdded} ${relationsAdded === 1 ? 'Beziehung' : 'Beziehungen'} angelegt` : '') +
          (skippedTotal ? ` (${skippedTotal} übersprungen)` : '') + '.'
        : 'Keine Personen erkannt.');
    });
  }

  function renderAccountModal() {
    document.getElementById('modal-content').innerHTML = `
      <h2>Konto</h2>
      <p>Angemeldet als <strong>${escapeHtml(currentUser.displayName)}</strong> (${escapeHtml(currentUser.username)}).</p>
      ${otherMembers.length ? `<p class="auth-hint">Gemeinsam mit: ${otherMembers.map(escapeHtml).join(', ')}</p>` : '<p class="auth-hint">Noch niemand sonst angemeldet — ladet die zweite Person mit dem Registrieren-Tab ein.</p>'}
      <form id="pw-form" style="display:flex; flex-direction:column; gap:14px; margin-top:16px;">
        <label class="field"><span>Aktuelles Passwort</span><input type="password" id="pw-current" required></label>
        <label class="field"><span>Neues Passwort (mind. 8 Zeichen)</span><input type="password" id="pw-new" minlength="8" required></label>
        <button class="btn btn-primary" type="submit">Passwort ändern</button>
        <p class="auth-error" id="pw-error" hidden></p>
        <p class="auth-hint" id="pw-success" hidden>Passwort aktualisiert.</p>
      </form>
      <div style="margin-top:18px; text-align:right;"><button class="btn btn-ghost" id="modal-close">Schliessen</button></div>`;
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('pw-current').value;
      const newPassword = document.getElementById('pw-new').value;
      document.getElementById('pw-error').hidden = true;
      document.getElementById('pw-success').hidden = true;
      try {
        const res = await fetch('/api/password.php', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const json = await res.json();
        if (!res.ok) { document.getElementById('pw-error').textContent = json.message || 'Fehler.'; document.getElementById('pw-error').hidden = false; return; }
        document.getElementById('pw-success').hidden = false;
        e.target.reset();
      } catch (err) {
        document.getElementById('pw-error').textContent = 'Server nicht erreichbar.';
        document.getElementById('pw-error').hidden = false;
      }
    });
  }

  // -------------------------------------------------------- import/export
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `zirkel-export-${date}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) { showToast('Datei ist kein gültiges JSON.'); return; }
      if (!parsed || !Array.isArray(parsed.people) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.connections)) {
        showToast('Datei hat nicht das erwartete Zirkel-Format.'); return;
      }
      if (!confirm('Das aktuelle Netzwerk durch die importierte Datei ersetzen? Das lässt sich nicht rückgängig machen.')) return;
      state = parsed;
      selectedPersonId = null;
      closeDrawer();
      renderAll(true);
      scheduleSave(true);
      showToast('Import erfolgreich.');
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------ service worker
  let swRegistration = null;
  // Nur reload(), wenn WIR das über den "Neu laden"-Button ausgelöst haben.
  // Ohne dieses Flag führt der Standard-"controllerchange"-Trick auch beim
  // allerersten Aktivieren des Service Workers (clients.claim() beim ersten
  // Login) zu einem ungewollten Reload, der gerade angefangene Eingaben
  // (z. B. eine frisch angelegte, noch unbenannte Person) verwirft.
  let userInitiatedSwUpdate = false;
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      swRegistration = reg;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('update-banner').hidden = false;
          }
        });
      });
      setInterval(() => reg.update().catch(() => {}), 60000);
    }).catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !userInitiatedSwUpdate) return;
      refreshing = true;
      window.location.reload();
    });
  }

  // -------------------------------------------------------------- wiring
  function wireAppEventsOnce() {
    if (wireAppEventsOnce._done) return;
    wireAppEventsOnce._done = true;

    document.getElementById('search').addEventListener('input', debounce((e) => {
      searchQuery = e.target.value.trim();
      renderPeopleList();
      renderGraph(false);
    }, 80));

    function newPerson() {
      const p = { id: uid('p'), name: '', categoryId: null, notes: '', birthDate: null, deceased: false, deathDate: null, x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 60 };
      state.people.push(p);
      renderAll(true);
      selectPerson(p.id);
      scheduleSave(true);
      setTimeout(() => { const el = document.getElementById('f-name'); if (el) el.focus(); }, 30);
    }
    document.getElementById('btn-add-person').addEventListener('click', newPerson);
    document.getElementById('btn-add-first').addEventListener('click', newPerson);

    document.getElementById('btn-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('menu-dropdown');
      dd.hidden = !dd.hidden;
      document.getElementById('btn-menu').setAttribute('aria-expanded', String(!dd.hidden));
    });
    document.addEventListener('click', () => { document.getElementById('menu-dropdown').hidden = true; });

    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('conn-person-search-wrap');
      const list = document.getElementById('conn-person-list');
      if (wrap && list && !wrap.contains(e.target)) list.hidden = true;
    });

    document.getElementById('menu-dropdown').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const kind = action.dataset.action;
      if (kind === 'categories') openModal('categories');
      if (kind === 'bulk') openModal('bulk');
      if (kind === 'account') openModal('account');
      if (kind === 'export') exportJSON();
      if (kind === 'theme') toggleTheme();
      if (kind === 'logout') doLogout();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importJSON(file);
      e.target.value = '';
    });

    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    document.getElementById('btn-update-reload').addEventListener('click', () => {
      userInitiatedSwUpdate = true;
      if (swRegistration && swRegistration.waiting) swRegistration.waiting.postMessage('SKIP_WAITING');
      else window.location.reload();
    });

    document.getElementById('btn-install').addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (e) {}
        deferredInstallPrompt = null;
        document.getElementById('install-banner').hidden = true;
      } else if (isIOS()) {
        showToast('Installieren: Teilen-Symbol antippen, dann «Zum Home-Bildschirm».');
      }
    });
    document.getElementById('btn-install-dismiss').addEventListener('click', () => {
      document.getElementById('install-banner').hidden = true;
      localStorage.setItem('zirkel-install-dismissed', '1');
    });

    const sidebarToggle = document.getElementById('btn-sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('sidebar-scrim');
    sidebarToggle.addEventListener('click', () => { sidebar.classList.toggle('open'); scrim.classList.toggle('open'); });
    scrim.addEventListener('click', () => { sidebar.classList.remove('open'); scrim.classList.remove('open'); });

    document.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('search').focus(); }
      if (e.key === 'Escape') {
        if (!document.getElementById('modal-overlay').hidden) closeModal();
        else if (!document.getElementById('drawer').hidden) selectPerson(null);
        sidebar.classList.remove('open'); scrim.classList.remove('open');
      }
    });
  }

  async function doLogout() {
    try { await fetch('/api/logout.php', { method: 'POST' }); } catch (e) {}
    state = { people: [], categories: [], connections: [] };
    selectedPersonId = null;
    await initAuthScreen();
  }

  // -------------------------------------------------------------- boot
  (async function boot() {
    initTheme();
    try {
      const meRes = await fetch('/api/me.php');
      if (meRes.ok) {
        const me = await meRes.json();
        currentUser = me.user;
        otherMembers = me.otherMembers || [];
        await startApp();
        return;
      }
    } catch (e) { /* Server evtl. offline, unten Login zeigen */ }
    await initAuthScreen();
  })();
})();
