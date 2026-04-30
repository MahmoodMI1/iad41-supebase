/**
 * app.js — IAD41 Location Manager
 * Features: entries, completed tab, inline notes, change log
 * Backend: Supabase
 */

const SUPABASE_URL = "https://vgezwoyljequmkrqwwfo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnZXp3b3lsamVxdW1rcnF3d2ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzE3NTgsImV4cCI6MjA5MjkwNzc1OH0.af20wi_HLdvcfkhYXee9WPM4PDrCdDaeCGRDGMpInRE";

const TYPE_LABEL = {
  dc:"Data center", mep:"MEP room", storage:"Storage", office:"Office",
  rack:"Rack / cabinet", cage:"Cage", loading:"Loading dock", pop:"POP room",
  parking:"Parking", other:"Other",
};

const App = (() => {

  let data      = [];
  let activeTab = "entries";
  let openNoteId = null;

  // ── Supabase ───────────────────────────────────────────────
  async function sb(path, method = "GET", body = null) {
    const opts = {
      method,
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": method === "POST" ? "return=representation" : "",
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, opts);
    if (!res.ok) throw new Error(await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ── Tabs ───────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    openNoteId = null;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.getElementById("view-entries").style.display   = tab === "entries"   ? "block" : "none";
    document.getElementById("view-completed").style.display = tab === "completed" ? "block" : "none";
    document.getElementById("view-log").style.display       = tab === "log"       ? "block" : "none";
    if (tab === "log") loadLog();
    if (tab === "completed") renderCompleted();
    if (tab === "entries") render();
  }

  // ── Helpers ────────────────────────────────────────────────
  function sections(subset) {
    return [...new Set(subset.map(d => d.section))].sort((a, b) => {
      if (a === "Other") return 1; if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }

  function filtered() {
    const q  = document.getElementById("q").value.toLowerCase();
    const sf = document.getElementById("sec-filter").value;
    const tf = document.getElementById("type-filter").value;
    return data.filter(({ section: s, name: n, type: t, completed: c }) =>
      !c &&
      (!sf || s === sf) && (!tf || t === tf) &&
      (!q  || s.toLowerCase().includes(q) || n.toLowerCase().includes(q) || (TYPE_LABEL[t]||"").toLowerCase().includes(q))
    );
  }

  function populateFilters() {
    const active = data.filter(d => !d.completed);
    const sf = document.getElementById("sec-filter");
    const tf = document.getElementById("type-filter");
    const sv = sf.value, tv = tf.value;
    sf.innerHTML = '<option value="">All sections</option>' +
      sections(active).map(s => `<option value="${s}"${s===sv?" selected":""}>${s}</option>`).join("");
    tf.innerHTML = '<option value="">All types</option>' +
      [...new Set(active.map(d=>d.type))].sort().map(t => `<option value="${t}"${t===tv?" selected":""}>${TYPE_LABEL[t]||t}</option>`).join("");
  }

  // ── Row HTML ───────────────────────────────────────────────
  function rowHTML(row, isCompleted) {
    const { id, section: s, name: n, type: t, note } = row;
    const notePreview = note ? `<span class="note-preview" onclick="App.toggleNote(${id})" title="${note}">📝 <em style="font-size:11px;color:var(--muted-fg);font-style:normal;">${note.length > 30 ? note.slice(0,30)+"…" : note}</em></span>` : "";
    const noteBox = openNoteId === id ? `
      <tr class="note-row" id="note-row-${id}">
        <td colspan="5">
          <div class="note-editor">
            <textarea id="note-input-${id}" placeholder="Write a note...">${note||""}</textarea>
            <div class="note-actions">
              <button onclick="App.saveNote(${id})">Save</button>
              <button class="btn-cancel" onclick="App.closeNote()">Cancel</button>
            </div>
          </div>
        </td>
      </tr>` : "";

    return `
      <tr>
        <td style="color:var(--muted-fg);font-size:12px;">${s}</td>
        <td title="${n}">${n} ${notePreview}</td>
        <td><span class="tag tag-${t}">${TYPE_LABEL[t]||t}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" onclick="App.toggleNote(${id})" title="Note">✏️</button>
            <button class="icon-btn" onclick="App.toggleComplete(${id})" title="${isCompleted?"Reopen":"Complete"}">
              ${isCompleted ? "↩" : "✓"}
            </button>
            <button class="del-btn" onclick="App.remove(${id})">×</button>
          </div>
        </td>
      </tr>
      ${noteBox}`;
  }

  // ── Render entries ─────────────────────────────────────────
  function render() {
    const rows = filtered();
    let html = "", lastSection = null;
    rows.forEach(row => {
      if (row.section !== lastSection) {
        html += `<tr class="sec-hdr"><td colspan="4">${row.section}</td></tr>`;
        lastSection = row.section;
      }
      html += rowHTML(row, false);
    });
    if (!html) html = `<tr class="empty-row"><td colspan="4">No entries match your filter.</td></tr>`;
    document.getElementById("tbody").innerHTML = html;
    const completed = data.filter(d => d.completed).length;
    document.getElementById("entry-count").textContent = rows.length + " of " + data.filter(d=>!d.completed).length + " entries";
    document.getElementById("completed-count").textContent = completed || "";
  }

  // ── Render completed ───────────────────────────────────────
  function renderCompleted() {
    const rows = data.filter(d => d.completed).sort((a,b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
    let html = "", lastSection = null;
    rows.forEach(row => {
      if (row.section !== lastSection) {
        html += `<tr class="sec-hdr"><td colspan="4">${row.section}</td></tr>`;
        lastSection = row.section;
      }
      html += rowHTML(row, true);
    });
    if (!html) html = `<tr class="empty-row"><td colspan="4">No completed entries yet.</td></tr>`;
    document.getElementById("completed-tbody").innerHTML = html;
  }

  // ── Toggle complete ────────────────────────────────────────
  async function toggleComplete(id) {
    const entry = data.find(d => d.id === id);
    if (!entry) return;
    const newVal = !entry.completed;
    await sb("locations?id=eq." + id, "PATCH", { completed: newVal });
    await sb("changelog", "POST", {
      action: newVal ? "completed" : "reopened",
      name: entry.name, section: entry.section, type: entry.type
    });
    await loadLocations(false);
    if (activeTab === "completed") renderCompleted();
    else render();
  }

  // ── Notes ──────────────────────────────────────────────────
  function toggleNote(id) {
    openNoteId = openNoteId === id ? null : id;
    if (activeTab === "completed") renderCompleted();
    else render();
    if (openNoteId) {
      setTimeout(() => {
        const el = document.getElementById("note-input-" + id);
        if (el) el.focus();
      }, 50);
    }
  }

  function closeNote() {
    openNoteId = null;
    if (activeTab === "completed") renderCompleted();
    else render();
  }

  async function saveNote(id) {
    const input = document.getElementById("note-input-" + id);
    if (!input) return;
    const note = input.value.trim();
    await sb("locations?id=eq." + id, "PATCH", { note });
    // Update local data so re-render shows the note immediately
    const entry = data.find(d => d.id === id);
    if (entry) entry.note = note;
    openNoteId = null;
    if (activeTab === "completed") renderCompleted();
    else render();
  }

  // ── Log ────────────────────────────────────────────────────
  async function loadLog() {
    const tbody = document.getElementById("log-tbody");
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Loading...</td></tr>`;
    try {
      const log = await sb("changelog?order=id.desc&limit=200");
      if (!log.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No changes yet.</td></tr>`; return; }
      tbody.innerHTML = log.map(e => {
        const fmt = new Date(e.time).toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
        const cls = e.action === "added" ? "log-added" : e.action === "completed" ? "log-completed" : e.action === "reopened" ? "log-reopened" : "log-deleted";
        return `<tr>
          <td><span class="log-badge ${cls}">${e.action}</span></td>
          <td title="${e.name}">${e.name}</td>
          <td style="color:var(--muted-fg);font-size:12px;">${e.section}</td>
          <td style="color:var(--muted-fg);font-size:12px;font-family:var(--font-mono);">${fmt}</td>
        </tr>`;
      }).join("");
    } catch(e) { tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Failed to load log.</td></tr>`; }
  }

  // ── Load all ───────────────────────────────────────────────
  async function loadLocations(showStatus = true) {
    if (showStatus) setStatus("Loading...");
    try {
      let results = await sb("locations?order=section,name");
      if (results.length === 0) {
        setStatus("Setting up for first time...");
        const rows = LOCATIONS.map(([section, name, type]) => ({ section, name, type }));
        for (let i = 0; i < rows.length; i += 50) {
          await sb("locations", "POST", rows.slice(i, i + 50));
        }
        results = await sb("locations?order=section,name");
      }
      data = results;
      populateFilters();
      render();
      setStatus("");
    } catch(e) { setStatus("Error: " + e.message); }
  }

  function setStatus(msg) {
    if (msg) document.getElementById("tbody").innerHTML = `<tr class="empty-row"><td colspan="4">${msg}</td></tr>`;
  }

  // ── Add ────────────────────────────────────────────────────
  async function add() {
    const sec  = document.getElementById("new-section").value.trim();
    const name = document.getElementById("new-name").value.trim();
    const type = document.getElementById("new-type").value;
    if (!sec || !name) { alert("Please fill in both Section and Full name."); return; }
    const btn = document.querySelector(".add-fields button");
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      await sb("locations", "POST", { section: sec, name, type });
      await sb("changelog", "POST", { action: "added", name, section: sec, type });
      document.getElementById("new-section").value = "";
      document.getElementById("new-name").value = "";
      await loadLocations(false);
    } catch(e) { alert("Failed to add: " + e.message); }
    btn.disabled = false; btn.textContent = "+ Add entry";
  }

  // ── Remove ─────────────────────────────────────────────────
  async function remove(id) {
    const entry = data.find(d => d.id === id);
    if (!entry || !confirm(`Remove "${entry.name}"?`)) return;
    try {
      await sb("changelog", "POST", { action: "deleted", name: entry.name, section: entry.section, type: entry.type });
      await sb("locations?id=eq." + id, "DELETE");
      await loadLocations(false);
    } catch(e) { alert("Failed to remove: " + e.message); }
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    loadLocations();
  }

  document.addEventListener("DOMContentLoaded", init);
  return { render, add, remove, toggleComplete, toggleNote, closeNote, saveNote, switchTab };

})();
