/**
 * app.js – ColdChain Sentinel Dashboard Logic
 * Fetches live data from Supabase and drives real-time UI updates.
 * Uses Web Audio API for browser alert sounds (no external files needed).
 */

"use strict";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
// ✅ Web dashboard uses the ANON key (safe for browser — read-only via RLS)
// Find it in: Supabase Dashboard → Settings → API → Project API Keys
// ⚠️  Do NOT paste the service role key here.
const SUPABASE_URL = "https://qcojndalmzrlhfhcinhk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjb2puZGFsbXpybGhmaGNpbmhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMTg3MTAsImV4cCI6MjA4OTc5NDcxMH0.OipZIfHCuui32ltsKmKe7LmRpvOwsvJqORKcu_qxk2s";   // ✅ Anon key — dashboard reads only

const ENV_POLL_MS   = 5_000;  // Environmental data refresh interval
const ALERT_POLL_MS = 8_000;  // Alert log refresh interval

// ─── AUTH GUARD ───────────────────────────────────────────────────────────────
const token = sessionStorage.getItem("sb_access_token");
if (!token) {
  window.location.href = "/index.html";
}

document.getElementById("userTag").textContent =
  sessionStorage.getItem("sb_user_email") || "User";

document.getElementById("logoutBtn").addEventListener("click", () => {
  sessionStorage.clear();
  window.location.href = "/index.html";
});


// ─── SUPABASE FETCH HELPER ────────────────────────────────────────────────────
async function sbFetch(path, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}


// ─── WEB AUDIO ALERT SOUND ───────────────────────────────────────────────────
let _audioCtx = null;
let _alertPlaying = false;

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playAlertBeep() {
  if (_alertPlaying) return;
  _alertPlaying = true;

  const ctx  = getAudioCtx();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = "square";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.5);

  osc.onended = () => { _alertPlaying = false; };
}


// ─── UI HELPERS ──────────────────────────────────────────────────────────────

function setCardState(cardId, state) {
  const card = document.getElementById(cardId);
  card.classList.remove("ok", "warn", "alert");
  if (state) card.classList.add(state);
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function badgeClass(eventType) {
  if (!eventType) return "badge-blue";
  if (eventType.includes("GRANTED"))   return "badge-green";
  if (eventType.includes("DENIED"))    return "badge-red";
  if (eventType.includes("INTRUSION")) return "badge-red";
  if (eventType.includes("GAS"))       return "badge-orange";
  if (eventType.includes("CRITICAL"))  return "badge-red";
  if (eventType.includes("POWER"))     return "badge-yellow";
  if (eventType.includes("MOTION"))    return "badge-yellow";
  return "badge-blue";
}

function renderLogRows(container, rows, columns) {
  if (!rows || rows.length === 0) {
    container.innerHTML =
      `<div class="log-row" style="color:var(--text-dim)">
         <span class="log-time">—</span><span>—</span><span>No records</span>
       </div>`;
    return;
  }

  container.innerHTML = rows.map(row => {
    const [c1, c2, c3] = columns.map(fn => fn(row));
    return `<div class="log-row">${c1}${c2}${c3}</div>`;
  }).join("");
}


// ─── ENVIRONMENTAL DATA ───────────────────────────────────────────────────────

let _prevCritical = false;

async function updateEnvironmental() {
  try {
    const rows = await sbFetch("environmental_logs", {
      order: "timestamp.desc",
      limit: 1
    });

    if (!rows || rows.length === 0) return;
    const d = rows[0];

    // Temperature
    const tempOk = d.temperature != null;
    const tempVal = tempOk ? `${d.temperature.toFixed(1)}°` : "--.-°";
    const tempHigh = tempOk && d.temperature > 28;
    document.getElementById("valTemp").textContent = tempVal;
    document.getElementById("valTemp").className = `stat-value ${tempHigh ? "red" : "green"}`;
    setCardState("cardTemp", tempHigh ? "warn" : "ok");

    // Humidity
    const humVal = d.humidity != null ? `${Math.round(d.humidity)}%` : "--%";
    document.getElementById("valHum").textContent = humVal;

    // Gas
    const gasDetected = d.gas_status === "DETECTED";
    document.getElementById("valGas").textContent  = d.gas_status || "---";
    document.getElementById("valGas").className    = `stat-value ${gasDetected ? "red" : "green"}`;
    setCardState("cardGas", gasDetected ? "alert" : "ok");

    // Power
    const onBackup = d.power_source === "BACKUP";
    document.getElementById("valPower").textContent = d.power_source || "---";
    document.getElementById("valPower").className   = `stat-value ${onBackup ? "yellow" : "green"}`;
    document.getElementById("subPower").textContent =
      onBackup ? "⚠ Running on backup power" : "Grid power stable";
    setCardState("cardPower", onBackup ? "warn" : "ok");

    // Fans
    updateFan("fanGasCard",  "fanGasState",  d.fan_gas_on,  "Gas Ventilation");
    updateFan("fanTempCard", "fanTempState", d.fan_temp_on, "Temperature Cooling");

    // Critical banner + audio
    const isCritical = gasDetected && tempHigh;
    document.getElementById("alertBanner").classList.toggle("hidden", !isCritical && !gasDetected && !onBackup);

    if (isCritical) {
      document.getElementById("alertText").textContent =
        "🔴 CRITICAL: High temperature AND gas detected – both fans ON";
      if (!_prevCritical) playAlertBeep();
    } else if (gasDetected) {
      document.getElementById("alertText").textContent =
        "⚠ Gas detected – ventilation fan activated";
      if (!_prevCritical) playAlertBeep();
    } else if (onBackup) {
      document.getElementById("alertText").textContent =
        "⚡ Grid power failure – running on backup battery";
    }

    _prevCritical = isCritical || gasDetected;

    // Last update timestamp
    document.getElementById("lastUpdate").textContent =
      `Updated ${formatTime(d.timestamp)}`;

  } catch (err) {
    console.error("Environmental fetch error:", err);
  }
}

function updateFan(cardId, stateId, isOn, label) {
  const card  = document.getElementById(cardId);
  const state = document.getElementById(stateId);
  card.className  = `fan-card ${isOn ? "on" : "off"}`;
  state.textContent = isOn ? "RUNNING" : "OFF";
}


// ─── ALERTS TABLE ─────────────────────────────────────────────────────────────

async function updateAlerts() {
  try {
    const rows = await sbFetch("alerts", {
      order: "timestamp.desc",
      limit: 10
    });

    document.getElementById("alertCount").textContent = rows ? rows.length : 0;

    renderLogRows(
      document.getElementById("alertList"),
      rows,
      [
        r => `<span class="log-time">${formatTime(r.timestamp)}</span>`,
        r => `<span class="log-badge ${r.severity === "CRITICAL" ? "badge-red" : "badge-orange"}">${r.severity || "HIGH"}</span>`,
        r => `<span>${r.message || r.alert_type || "—"}</span>`
      ]
    );
  } catch (err) {
    console.error("Alerts fetch error:", err);
  }
}


// ─── EVENT LOG (ACCESS + POWER) ───────────────────────────────────────────────

async function updateEventLog() {
  try {
    // Fetch access logs and power logs concurrently
    const [accessRows, powerRows] = await Promise.all([
      sbFetch("access_logs", { order: "timestamp.desc", limit: 15 }),
      sbFetch("power_logs",  { order: "timestamp.desc", limit: 5  })
    ]);

    // Merge and sort by timestamp descending
    const allRows = [
      ...(accessRows || []).map(r => ({ ...r, _source: "access" })),
      ...(powerRows  || []).map(r => ({ ...r, _source: "power"  }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
     .slice(0, 20);

    renderLogRows(
      document.getElementById("eventLog"),
      allRows,
      [
        r => `<span class="log-time">${formatTime(r.timestamp)}</span>`,
        r => `<span class="log-badge ${badgeClass(r.event_type)}">${(r.event_type || "EVENT").replace(/_/g, " ")}</span>`,
        r => {
          if (r._source === "access") {
            const uid = r.uid ? ` — UID: ${r.uid}` : "";
            return `<span>${r.sensor || "RFID"}${uid}</span>`;
          } else {
            const dur = r.outage_duration_seconds ? ` (${r.outage_duration_seconds}s)` : "";
            return `<span>${r.source_before || "—"} → ${r.source_after || "—"}${dur}</span>`;
          }
        }
      ]
    );
  } catch (err) {
    console.error("Event log fetch error:", err);
  }
}


// ─── REFRESH BUTTON ───────────────────────────────────────────────────────────

document.getElementById("refreshLog").addEventListener("click", () => {
  updateEventLog();
  updateAlerts();
});


// ─── REAL-TIME SUBSCRIPTIONS via Supabase Realtime (Channels) ─────────────────

function subscribeRealtime() {
  // Uses Supabase Realtime broadcast channel via EventSource (server-sent events)
  // Supabase Realtime wss channel approach using the JS client would require
  // including @supabase/supabase-js. Here we use HTTP polling as a lightweight
  // fallback. For full realtime, include the Supabase JS SDK:
  //
  //   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  //
  // Then initialise with:
  //   const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  //   sb.channel('env').on('postgres_changes',
  //     { event: 'INSERT', schema: 'public', table: 'environmental_logs' },
  //     () => updateEnvironmental()
  //   ).subscribe();

  console.log("Using polling-based refresh (5s env, 8s alerts)");
}


// ─── STARTUP ─────────────────────────────────────────────────────────────────

(async function init() {
  // Initial data load
  await Promise.all([
    updateEnvironmental(),
    updateAlerts(),
    updateEventLog()
  ]);

  // Start polling intervals
  setInterval(updateEnvironmental, ENV_POLL_MS);
  setInterval(updateAlerts,        ALERT_POLL_MS);
  setInterval(updateEventLog,      ALERT_POLL_MS);

  subscribeRealtime();
})();
