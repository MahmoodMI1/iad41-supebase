/**
 * app.js — IAD41 Location Manager
 * Backend: Supabase
 */

const SUPABASE_URL = "https://vgezwoyljequmkrqwwfo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnZXp3b3lsamVxdW1rcnF3d2ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzE3NTgsImV4cCI6MjA5MjkwNzc1OH0.af20wi_HLdvcfkhYXee9WPM4PDrCdDaeCGRDGMpInRE";

const TYPE_LABEL = {
  dc:      "Data center",
  mep:     "MEP room",
  storage: "Storage",
  office:  "Office",
  rack:    "Rack / cabinet",
  cage:    "Cage",
  loading: "Loading dock",
  pop:     "POP room",
  parking: "Parking",
  other:   "Other",
};

const App = (() => {

  let data      = [];
  let activeTab = "entries";

  // ── Supabase fetch helper ──────────────────────────────────
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
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ── Tab switching ──────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    document.getElementById("view-entries").style.display = tab === "entries" ? "block" : "none";
    document.getElementById("view-log").style.display     = tab === "log"     ? "block" : "none";
    if (tab === "log") loadLog();
  }

  // ── Helpers ────────────────────────────────────────────────
  function sections() {
    return [...new Set(data.map(d => d.section))].sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }

  function types() {
    return [...new Set(data.map(d => d.type))].sort();
  }

  function filtered() {
    const q  = document.getElementById("q").value.toLowerCase();
    const sf = document.getElementById("sec-filter").value;
    const tf = document.getElementById("type-filter").value;
    return data.filter(({ section: s, name: n, type: t }) =>
      (!sf || s === sf) &&
      (!tf || t === tf) &&
      (!q  || s.toLowerCase().includes(q) ||
              n.toLowerCase().includes(q)  ||
              (TYPE_LABEL[t] || "").toLowerCase().includes(q))
    );
  }

  // ── Filters ────────────────────────────────────────────────
  function populateFilters() {
    const sf = document.getElementById("sec-filter");
    const tf = document.getElementById("type-filter");
    const sv = sf.value, tv = tf.value;
    sf.innerHTML = '<option value="">All sections</option>' +
      sections().map(s => `<option value="${s}"${s===sv?" selected":""}>${s}</option>`).join("");
    tf.innerHTML = '<option value="">All types</option>' +
      types().map(t => `<option value="${t}"${t===tv?" selected":""}>${TYPE_LABEL[t]||t}</option>`).join("");
  }

  // ── Render table ───────────────────────────────────────────
  function render() {
    const rows = filtered();
    let html = "", lastSection = null;

    rows.forEach(({ id, section: s, name: n, type: t }) => {
      if (s !== lastSection) {
        html += `<tr class="sec-hdr"><td colspan="4">${s}</td></tr>`;
        lastSection = s;
      }
      html += `<tr>
        <td style="color:var(--muted-fg);font-size:12px;">${s}</td>
        <td title="${n}">${n}</td>
        <td><span class="tag tag-${t}">${TYPE_LABEL[t]||t}</span></td>
        <td><button class="del-btn" onclick="App.remove(${id})" title="Remove">×</button></td>
      </tr>`;
    });

    if (!html) html = `<tr class="empty-row"><td colspan="4">No entries match your filter.</td></tr>`;
    document.getElementById("tbody").innerHTML = html;
    document.getElementById("entry-count").textContent = rows.length + " of " + data.length + " entries";
  }

  // ── Load log ───────────────────────────────────────────────
  async function loadLog() {
    const tbody = document.getElementById("log-tbody");
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Loading...</td></tr>`;
    try {
      const log = await sb("changelog?order=id.desc&limit=200");
      if (!log.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No changes yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = log.map(e => {
        const d = new Date(e.time);
        const fmt = d.toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
        return `<tr>
          <td><span class="log-badge log-${e.action}">${e.action}</span></td>
          <td title="${e.name}">${e.name}</td>
          <td style="color:var(--muted-fg);font-size:12px;">${e.section}</td>
          <td style="color:var(--muted-fg);font-size:12px;font-family:var(--font-mono);">${fmt}</td>
        </tr>`;
      }).join("");
    } catch(e) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Failed to load log.</td></tr>`;
    }
  }

  // ── Load locations ─────────────────────────────────────────
  async function loadLocations() {
    setStatus("Loading...");
    try {
      let results = await sb("locations?order=section,name");

      if (results.length === 0) {
        setStatus("Setting up for first time...");
        const rows = LOCATIONS.map(([section, name, type]) => ({ section, name, type }));
        // Batch in chunks of 50
        for (let i = 0; i < rows.length; i += 50) {
          await sb("locations", "POST", rows.slice(i, i + 50));
        }
        results = await sb("locations?order=section,name");
      }

      data = results;
      populateFilters();
      render();
      setStatus("");
    } catch(e) {
      setStatus("Error: " + e.message);
      console.error(e);
    }
  }

  function setStatus(msg) {
    if (msg) {
      document.getElementById("tbody").innerHTML =
        `<tr class="empty-row"><td colspan="4">${msg}</td></tr>`;
    }
  }

  // ── Add ────────────────────────────────────────────────────
  async function add() {
    const sec  = document.getElementById("new-section").value.trim();
    const name = document.getElementById("new-name").value.trim();
    const type = document.getElementById("new-type").value;
    if (!sec || !name) { alert("Please fill in both Section and Full name."); return; }

    const btn = document.querySelector(".add-fields button");
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
      await sb("locations", "POST", { section: sec, name, type });
      await sb("changelog", "POST", { action: "added", name, section: sec, type });
      document.getElementById("new-section").value = "";
      document.getElementById("new-name").value    = "";
      await loadLocations();
    } catch(e) {
      alert("Failed to add: " + e.message);
    }

    btn.disabled = false;
    btn.textContent = "+ Add entry";
  }

  // ── Remove ─────────────────────────────────────────────────
  async function remove(id) {
    const entry = data.find(d => d.id === id);
    if (!entry) return;
    if (!confirm(`Remove "${entry.name}"?`)) return;
    try {
      await sb("changelog", "POST", { action: "deleted", name: entry.name, section: entry.section, type: entry.type });
      await sb("locations?id=eq." + id, "DELETE");
      await loadLocations();
    } catch(e) {
      alert("Failed to remove: " + e.message);
    }
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    loadLocations();
  }

  document.addEventListener("DOMContentLoaded", init);
  return { render, add, remove, switchTab };

})();
