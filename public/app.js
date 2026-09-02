// Zirkel — Frontend-Logik. Vanilla JS + D3 fuer die Graph-Darstellung.
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
  function matchesSearch(p, q) {
    const query = q.toLowerCase();
    return (p.name || '').toLowerCase().includes(query) ||
      categoryName(p.categoryId).toLowerCase().includes(query) ||
      (p.notes || '').toLowerCase().includes(query) ||
      formatBirthday(p.birthDate, true).toLowerCase().includes(query) ||
      (p.birthDate || '').includes(query);
  }
  function metaLine(p) {
    const parts = [categoryName(p.categoryId)];
    if (p.birthDate) parts.push(formatBirthday(p.birthDate, false));
    return parts.join(' · ');
  }
  function connectionsFor(personId) {
    return state.connections.filter((c) => c.a === personId || c.b === personId);
  }
  function otherPersonInConnection(c, personId) { return c.a === personId ? c.b : c.a; }
  function neighborsOf(personId) {
    return new Set(connectionsFor(personId).map((c) => otherPersonInConnection(c, personId)));
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

  // ---------------------------------------------------------- auth screen
  async function initAuthScreen(prefillError) {
    document.getElementById('app').hidden = true;
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
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app').hidden = false;
    await loadNetwork();
    wireAppEventsOnce();
    initServiceWorker();
    // Kein staendiges Polling - die Ansicht wird beim Oeffnen (Start, erneutes
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
        ? `Keine Treffer fuer „${escapeHtml(searchQuery)}“.`
        : 'Keine Personen in den ausgewaehlten Kategorien sichtbar.';
      list.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
      return;
    }
    list.innerHTML = people.map((p) => `
      <button type="button" class="person-row ${p.id === selectedPersonId ? 'selected' : ''}" data-id="${p.id}">
        <span class="avatar" style="background:${categoryColor(p.categoryId)}">${escapeHtml((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <span class="meta">
          <span class="name">${highlightMatch(p.name || '(ohne Namen)', searchQuery)}</span>
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
      .force('link', d3.forceLink().id((d) => d.id).distance(105).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('collide', d3.forceCollide(NODE_R + 26))
      .force('center', d3.forceCenter())
      .on('tick', ticked);

    dragBehavior = d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
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

  function egoSetFor(id) {
    if (!id) return null;
    return new Set([id, ...neighborsOf(id)]);
  }

  function renderGraph(structural) {
    if (!simulation) initGraph();

    const ego = egoSetFor(selectedPersonId);
    function nodeVisible(d) {
      if (hiddenCategoryIds.has(d.categoryId || '__none__')) return false;
      if (searchQuery && !matchesSearch(d, searchQuery)) return false;
      if (ego && !ego.has(d.id)) return false;
      return true;
    }

    const linkObjs = state.connections.map((c) => ({ id: c.id, source: c.a, target: c.b, label: c.label || '' }));
    simulation.nodes(state.people);
    simulation.force('link').links(linkObjs);
    if (structural) simulation.alpha(0.6).restart();

    function linkVisible(l) {
      const s = typeof l.source === 'object' ? l.source : personById(l.source);
      const t = typeof l.target === 'object' ? l.target : personById(l.target);
      if (!s || !t) return false;
      return nodeVisible(s) && nodeVisible(t);
    }
    function linkTouchesSelection(l) {
      if (!selectedPersonId) return false;
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      return sId === selectedPersonId || tId === selectedPersonId;
    }

    const linkSel = linksLayer.selectAll('g.link-g').data(linkObjs, (d) => d.id);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('g').attr('class', 'link-g');
    linkEnter.append('line').attr('class', 'link-line');
    linkEnter.append('text').attr('class', 'link-label').attr('text-anchor', 'middle');
    linkSelRef = linkEnter.merge(linkSel);
    linkSelRef.select('text.link-label').text((d) => d.label);
    linkSelRef.classed('dim', (d) => !linkVisible(d));
    linkSelRef.select('line.link-line').classed('active', linkTouchesSelection);

    const nodeSel = nodesLayer.selectAll('g.node-g').data(state.people, (d) => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('g').attr('class', 'node-g').call(dragBehavior);
    nodeEnter.append('circle').attr('class', 'node-circle').attr('r', NODE_R);
    nodeEnter.append('text').attr('class', 'node-label');
    nodeEnter.on('click', (event, d) => { event.stopPropagation(); selectPerson(d.id); });
    nodeEnter.on('dblclick', (event, d) => { event.stopPropagation(); d.fx = null; d.fy = null; simulation.alpha(0.4).restart(); scheduleSave(); });
    nodeSelRef = nodeEnter.merge(nodeSel);
    nodeSelRef.select('circle.node-circle')
      .attr('fill', (d) => categoryColor(d.categoryId))
      .classed('selected', (d) => d.id === selectedPersonId);
    nodeSelRef.select('text.node-label')
      .attr('dx', NODE_R + 6).attr('dy', 4)
      .text((d) => d.name || '(ohne Namen)');
    nodeSelRef.classed('dim', (d) => !nodeVisible(d));

    ticked();
  }

  function ticked() {
    if (linkSelRef) {
      linkSelRef.select('line.link-line')
        .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      linkSelRef.select('text.link-label')
        .attr('x', (d) => (d.source.x + d.target.x) / 2)
        .attr('y', (d) => (d.source.y + d.target.y) / 2 - 5);
    }
    if (nodeSelRef) nodeSelRef.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);
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
        <label class="field"><span>Geburtstag <span class="field-hint" id="f-birthdate-hint">${p.birthDate && ageFromBirthDate(p.birthDate) != null ? `(${ageFromBirthDate(p.birthDate)} Jahre)` : ''}</span></span><input type="date" id="f-birthdate" value="${p.birthDate || ''}" max="${new Date().toISOString().slice(0, 10)}"></label>
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
            <select id="conn-person-select">
              <option value="">Person waehlen…</option>
              ${candidates.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
            </select>
            <input type="text" id="conn-label-input" placeholder="Beziehung (optional)" list="relationship-types">
            <button class="btn btn-primary btn-small" id="btn-add-conn">+ Verbindung</button>
          </div>
        </div>
        <button class="btn btn-danger" id="btn-delete-person">Person loeschen</button>
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
      if (hint) hint.textContent = (p.birthDate && ageFromBirthDate(p.birthDate) != null) ? `(${ageFromBirthDate(p.birthDate)} Jahre)` : '';
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
        if (c) { c.label = e.target.value; renderGraph(false); scheduleSave(); }
      }, 200));
    });
    document.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.connections = state.connections.filter((c) => c.id !== btn.dataset.remove);
        renderStats(); renderGraph(true); renderDrawer(id); scheduleSave(true);
      });
    });
    document.getElementById('btn-add-conn').addEventListener('click', () => {
      const sel = document.getElementById('conn-person-select');
      const otherId = sel.value;
      if (!otherId) return;
      const label = document.getElementById('conn-label-input').value.trim();
      state.connections.push({ id: uid('e'), a: id, b: otherId, label });
      renderStats(); renderGraph(true); renderDrawer(id); scheduleSave(true);
    });
    wireDangerButton(document.getElementById('btn-delete-person'), 'Person loeschen', 'Wirklich loeschen?', () => {
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
            <button class="conn-remove" data-delcat="${c.id}" title="Kategorie loeschen">×</button>
          </div>`).join('')}
      </div>
      <div class="new-cat-row">
        <input type="color" id="new-cat-color" value="${nextPaletteColor()}">
        <input type="text" id="new-cat-name" placeholder="Neue Kategorie">
        <button class="btn btn-primary btn-small" id="btn-add-cat">Hinzufuegen</button>
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
      if (!confirm('Kategorie wirklich loeschen? Zugeordnete Personen verlieren dann ihre Kategorie.')) return;
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

  function renderAccountModal() {
    document.getElementById('modal-content').innerHTML = `
      <h2>Konto</h2>
      <p>Angemeldet als <strong>${escapeHtml(currentUser.displayName)}</strong> (${escapeHtml(currentUser.username)}).</p>
      ${otherMembers.length ? `<p class="auth-hint">Gemeinsam mit: ${otherMembers.map(escapeHtml).join(', ')}</p>` : '<p class="auth-hint">Noch niemand sonst angemeldet — ladet die zweite Person mit dem Registrieren-Tab ein.</p>'}
      <form id="pw-form" style="display:flex; flex-direction:column; gap:14px; margin-top:16px;">
        <label class="field"><span>Aktuelles Passwort</span><input type="password" id="pw-current" required></label>
        <label class="field"><span>Neues Passwort (mind. 8 Zeichen)</span><input type="password" id="pw-new" minlength="8" required></label>
        <button class="btn btn-primary" type="submit">Passwort aendern</button>
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
      try { parsed = JSON.parse(reader.result); } catch (e) { showToast('Datei ist kein gueltiges JSON.'); return; }
      if (!parsed || !Array.isArray(parsed.people) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.connections)) {
        showToast('Datei hat nicht das erwartete Zirkel-Format.'); return;
      }
      if (!confirm('Das aktuelle Netzwerk durch die importierte Datei ersetzen? Das laesst sich nicht rueckgaengig machen.')) return;
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
  // Nur reload(), wenn WIR das ueber den "Neu laden"-Button ausgeloest haben.
  // Ohne dieses Flag fuehrt der Standard-"controllerchange"-Trick auch beim
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
      const p = { id: uid('p'), name: '', categoryId: null, notes: '', birthDate: null, x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 60 };
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

    document.getElementById('menu-dropdown').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const kind = action.dataset.action;
      if (kind === 'categories') openModal('categories');
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
