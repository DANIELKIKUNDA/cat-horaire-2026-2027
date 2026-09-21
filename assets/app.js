const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  profile: null,
  client: null,
  view: "dashboard",
  quickType: "class",
  selectedClass: localStorage.getItem("cat-selected-class") || "",
  selectedTeacher: localStorage.getItem("cat-selected-teacher") || "",
};

const isDirector = () => state.profile?.role === "director";

function loginEmail(value) {
  const input = value.trim().toLowerCase();
  return input.includes("@") ? input : `${input}@cat-horaire.local`;
}

function showLogin(message = "", success = false) {
  $("#app-shell").hidden = true;
  $("#auth-screen").hidden = false;
  const status = $("#login-status");
  status.textContent = message;
  status.classList.toggle("success", success);
}

function showPortal() {
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
}

const titles = {
  dashboard: "Tableau de bord",
  classes: "Horaire des classes",
  teachers: "Horaire des enseignants",
  operations: "Centre des opérations",
  changes: "Changements intelligents",
  announcements: "Annonces et alertes",
  assistant: "Assistant CAT",
  stats: "Statistiques",
  accounts: "Comptes et accès",
  documents: "Documents officiels",
  settings: "Mon compte",
};

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(0)} Ko`;

function kinshasaNow() {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Kinshasa", weekday: "long", day: "2-digit", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map(({type, value}) => [type, value]));
}

function normalizeDay(day) {
  return day ? day.charAt(0).toUpperCase() + day.slice(1).toLowerCase() : "";
}

function timeToMinutes(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function liveContext() {
  const now = kinshasaNow();
  const day = normalizeDay(now.weekday);
  const minute = Number(now.hour) * 60 + Number(now.minute);
  const periods = state.data.periods[day] || [];
  const current = periods.find((p) => {
    const [start, end] = p.time.split("-").map(timeToMinutes);
    return minute >= start && minute < end;
  });
  const next = periods.find((p) => timeToMinutes(p.time.split("-")[0]) > minute);
  return { now, day, current, next };
}

function allPhysicalAt(day, period) {
  const seen = new Map();
  Object.values(state.data.teacherSchedule).forEach((schedule) => {
    (schedule[`${day}:${period}`] || []).forEach((entry) => seen.set(entry.assignmentId, entry));
  });
  return [...seen.values()];
}

function populateSelect(select, items, valueKey = "id") {
  select.innerHTML = items.map((item) => `<option value="${esc(item[valueKey])}">${esc(item[valueKey])}</option>`).join("");
}

function setView(view, updateHash = true) {
  if (!titles[view]) view = "dashboard";
  if (!isDirector() && ["classes", "operations", "changes", "stats", "accounts", "documents"].includes(view)) view = "teachers";
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`));
  $$(".main-nav a").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  $("#page-title").textContent = titles[view];
  $("#sidebar").classList.remove("open");
  if (updateHash && location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  window.scrollTo({top: 0, behavior: "smooth"});
}

function renderStats() {
  const m = state.data.meta;
  if (!isDirector()) {
    const teacher = state.data.teachers[0];
    const occupied = Object.keys(state.data.teacherSchedule[teacher.id] || {}).length;
    const today = liveContext().day;
    const todayCount = Object.keys(state.data.teacherSchedule[teacher.id] || {}).filter((slot) => slot.startsWith(`${today}:`)).length;
    const stats = [
      ["✓", `${teacher.hours} h`, "Charge pédagogique"],
      ["◷", occupied, "Créneaux de la semaine"],
      ["◆", todayCount, "Cours aujourd’hui"],
    ];
    $("#stats-grid").innerHTML = stats.map(([icon, value, label]) => `
      <article class="stat-card"><span class="stat-icon">${icon}</span><div><strong>${esc(value)}</strong><small>${esc(label)}</small></div></article>
    `).join("");
    return;
  }
  const stats = [
    ["▦", m.classCount, "Classes publiées"],
    ["♙", m.teacherCount, "Enseignants"],
    ["✓", `${m.classesAt42} / ${m.classCount}`, "Classes à 42 h"],
    ["⌂", `${m.maximumRooms} / ${m.roomLimit}`, "Locaux maximum"],
  ];
  $("#stats-grid").innerHTML = stats.map(([icon, value, label]) => `
    <article class="stat-card"><span class="stat-icon">${icon}</span><div><strong>${esc(value)}</strong><small>${esc(label)}</small></div></article>
  `).join("");
}

function renderLive() {
  const {day, current, next} = liveContext();
  const target = $("#live-content");
  if (!state.data.days.includes(day)) {
    target.innerHTML = `<div class="empty-state"><strong>École au repos</strong><br>Les cours reprennent lundi.</div>`;
    return;
  }
  const rows = [];
  if (current) rows.push(["En cours", current]);
  if (next) rows.push([current ? "Ensuite" : "Prochaine", next]);
  if (!rows.length) {
    target.innerHTML = `<div class="empty-state"><strong>Journée terminée</strong><br>Consultez les horaires de demain dans les vues détaillées.</div>`;
    return;
  }
  target.innerHTML = rows.map(([label, period]) => {
    const sessions = allPhysicalAt(day, period.id);
    return `<div class="live-row"><div class="live-time">${esc(label)}<br>${esc(period.time)}</div><div><strong>${esc(day)} · ${esc(period.id)}</strong><small>${sessions.length} séances physiques programmées</small></div><span class="live-count">${sessions.length} cours</span></div>`;
  }).join("");
}

function renderDayStrip() {
  const {day: today} = liveContext();
  $("#day-strip").innerHTML = state.data.days.map((day) => {
    const count = state.data.periods[day].length;
    return `<div class="day-pill ${day === today ? "today" : ""}"><span>${day === today ? "Aujourd’hui" : "Journée"}</span><strong>${esc(day.slice(0,3))}</strong><span>${count} périodes</span></div>`;
  }).join("");
  $("#week-range").textContent = "Lundi à samedi · 42 périodes";
}

function scheduleEntries(type, owner, day, period) {
  if (window.CATSmart && state.data?.features) return window.CATSmart.scheduleEntries(type, owner, day, period);
  const key = `${day}:${period}`;
  if (type === "class") {
    const item = state.data.classSchedule[owner]?.[key];
    return item ? [item] : [];
  }
  return state.data.teacherSchedule[owner]?.[key] || [];
}

function lessonHtml(entry, type, isLive) {
  const detail = type === "class" ? entry.teacher : entry.classes.join(", ");
  return `<div class="lesson ${isLive ? "is-live" : ""} ${entry.changed ? "is-changed" : ""}"><strong>${esc(entry.course)}${entry.changed ? ' <i>Modifié</i>' : ''}</strong><span>${esc(detail)}</span></div>`;
}

function emptyHtml(day, period, type) {
  if (type === "teacher") return `<div class="free-slot">DISPONIBLE</div>`;
  const messe = day === "Vendredi" && ["P1", "P2"].includes(period);
  return `<div class="free-slot ${messe ? "messe" : ""}">${messe ? "MESSE" : "LIBRE"}</div>`;
}

function renderSchedule(hostSelector, type, owner) {
  const data = state.data;
  const {day: liveDay, current} = liveContext();
  const periodIds = data.periods[data.days[0]].map((p) => p.id);
  const header = data.days.map((day) => `<th>${esc(day)}</th>`).join("");
  const rows = periodIds.map((period) => {
    const weekdayTime = data.periods.Lundi.find((p) => p.id === period)?.time || "";
    const saturdayTime = data.periods.Samedi.find((p) => p.id === period)?.time || "";
    const cells = data.days.map((day) => {
      const entries = scheduleEntries(type, owner, day, period);
      const live = day === liveDay && current?.id === period;
      return `<td>${entries.length ? entries.map((e) => lessonHtml(e, type, live)).join("") : emptyHtml(day, period, type)}</td>`;
    }).join("");
    return `<tr><td class="period-cell"><strong>${period}</strong><small>Lun–Ven ${weekdayTime}<br>Sam. ${saturdayTime}</small></td>${cells}</tr>`;
  }).join("");
  const desktop = `<div class="schedule-scroll"><table class="schedule-table"><thead><tr><th>Période</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const mobile = `<div class="schedule-mobile">${data.days.map((day) => `
    <section class="mobile-day"><h4>${esc(day)}</h4>${data.periods[day].map((p) => {
      const entries = scheduleEntries(type, owner, day, p.id);
      const live = day === liveDay && current?.id === p.id;
      return `<div class="mobile-period"><strong>${p.id}<br>${p.time}</strong><div>${entries.length ? entries.map((e) => lessonHtml(e,type,live)).join("") : emptyHtml(day,p.id,type)}</div></div>`;
    }).join("")}</section>`).join("")}</div>`;
  $(hostSelector).innerHTML = desktop + mobile;
}

function renderClass() {
  if (!isDirector() || !state.data.classes.length) return;
  const id = state.selectedClass || state.data.classes[0].id;
  state.selectedClass = id;
  localStorage.setItem("cat-selected-class", id);
  $("#class-select").value = id;
  const item = state.data.classes.find((c) => c.id === id);
  const free = 42 - item.hours;
  $("#class-summary").innerHTML = `
    <div class="summary-card"><small>Classe sélectionnée</small><strong>${esc(id)}</strong></div>
    <div class="summary-card"><small>Volume hebdomadaire</small><strong>${item.hours} heures</strong></div>
    <div class="summary-card"><small>Périodes libres</small><strong>${free} ${free > 1 ? "périodes" : "période"}</strong></div>`;
  renderSchedule("#class-schedule", "class", id);
}

function renderTeacher() {
  const id = state.selectedTeacher || state.data.teachers[0].id;
  state.selectedTeacher = id;
  localStorage.setItem("cat-selected-teacher", id);
  $("#teacher-select").value = id;
  const item = state.data.teachers.find((t) => t.id === id);
  $("#teacher-summary").innerHTML = `
    <div class="summary-card"><small>Enseignant</small><strong>${esc(id)}</strong></div>
    <div class="summary-card"><small>Charge pédagogique</small><strong>${item.hours} heures</strong></div>
    <div class="summary-card"><small>Créneaux physiques</small><strong>${item.physicalSlots} périodes</strong></div>`;
  renderSchedule("#teacher-schedule", "teacher", id);
  const exceptions = state.data.collisionExceptions.filter((e) => e.teacher_id === id);
  $("#teacher-note").innerHTML = exceptions.length ? `<div class="notice"><strong>Chevauchement institutionnel autorisé :</strong> ${exceptions.map((e) => `${esc(e.slots.join(", "))} · ${esc(e.assignment_ids.join(" + "))}`).join(" ; ")}</div>` : "";
}

function renderDocuments() {
  if (!isDirector()) return;
  $("#document-solution").textContent = state.data.meta.solutionId;
  $("#documents-grid").innerHTML = state.data.documents.map((doc) => `
    <button class="document-card" type="button" data-document-path="${esc(doc.filename)}">
      <span class="document-icon">PDF</span>
      <div><h3>${esc(doc.title)}</h3><div class="document-meta"><span>${doc.pages} pages</span><span>${formatBytes(doc.bytes)}</span><span>Certifié</span></div></div>
      <span class="download-button" aria-label="Télécharger">↓</span>
    </button>`).join("");
  $("#integrity-list").innerHTML = ["CP-SAT OPTIMAL", "Validateur PASS", "0 collision interdite", `${state.data.meta.maximumRooms}/${state.data.meta.roomLimit} locaux`]
    .map((label) => `<span class="integrity-item">✓ ${esc(label)}</span>`).join("");
}

function renderQuickOptions() {
  if (!isDirector()) return;
  const select = $("#quick-select");
  const items = state.quickType === "class" ? state.data.classes : state.data.teachers;
  populateSelect(select, items);
  const saved = state.quickType === "class" ? state.selectedClass : state.selectedTeacher;
  if (saved) select.value = saved;
}

function renderSearch(query) {
  if (!isDirector()) return;
  const host = $("#search-results");
  const q = query.trim().toLocaleLowerCase("fr");
  if (!q) { host.hidden = true; return; }
  const classes = state.data.classes.filter((c) => c.id.toLocaleLowerCase("fr").includes(q)).slice(0,5)
    .map((c) => ({type:"class", id:c.id, meta:`Classe · ${c.hours} h`, icon:"C"}));
  const teachers = state.data.teachers.filter((t) => t.id.toLocaleLowerCase("fr").includes(q)).slice(0,7)
    .map((t) => ({type:"teacher", id:t.id, meta:`Enseignant · ${t.hours} h`, icon:"P"}));
  const results = [...classes, ...teachers].slice(0,9);
  host.innerHTML = results.length ? results.map((r) => `<div class="search-result" data-result-type="${r.type}" data-result-id="${esc(r.id)}"><span>${r.icon}</span><div><strong>${esc(r.id)}</strong><small>${esc(r.meta)}</small></div></div>`).join("") : `<div class="empty-state">Aucun résultat</div>`;
  host.hidden = false;
}

function selectSearchResult(type, id) {
  if (type === "class") { state.selectedClass = id; renderClass(); setView("classes"); }
  else { state.selectedTeacher = id; renderTeacher(); setView("teachers"); }
  $("#global-search").value = "";
  $("#search-results").hidden = true;
}

function updateClock() {
  const now = kinshasaNow();
  $("#today-label").textContent = `${normalizeDay(now.weekday)} ${now.day} ${now.month}`;
  $("#clock").textContent = `${now.hour}:${now.minute}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function smartContext() {
  return {state, isDirector, setView, renderTeacher, renderClass, showToast, esc, populateSelect, liveContext, scheduleEntries, reload: loadPortal};
}


async function openDocument(path) {
  if (!isDirector()) return;
  const {data, error} = await state.client.storage.from("official-documents").createSignedUrl(path, 90);
  if (error) { showToast("Document indisponible"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

function applyRole() {
  const director = isDirector();
  $$('[data-director-only]').forEach((element) => { element.hidden = !director; });
  $("#account-name").textContent = state.profile.full_name;
  $("#account-role").textContent = director ? "Direction · accès complet" : "Enseignant · accès personnel";
  $("#account-avatar").textContent = state.profile.full_name.charAt(0).toUpperCase();
  if (!director) {
    titles.teachers = "Mon horaire";
    $("#primary-schedule-button").dataset.go = "teachers";
    $("#primary-schedule-button").textContent = "Voir mon horaire";
    $("#view-teachers .section-intro h2").textContent = "Mon horaire personnel";
    $("#view-teachers .section-intro p").textContent = "Votre semaine de cours certifiée par la direction.";
    $("#view-teachers .entity-picker").hidden = true;
    $("#global-search").closest(".global-search").hidden = true;
  }
}

function bindEvents() {
  $$(".main-nav a").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault(); setView(link.dataset.view);
  }));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  $("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#class-select").addEventListener("change", (event) => { state.selectedClass = event.target.value; renderClass(); });
  $("#teacher-select").addEventListener("change", (event) => { state.selectedTeacher = event.target.value; renderTeacher(); });
  $$('[data-quick-type]').forEach((button) => button.addEventListener("click", () => {
    state.quickType = button.dataset.quickType;
    $$('[data-quick-type]').forEach((b) => b.classList.toggle("active", b === button));
    renderQuickOptions();
  }));
  $("#quick-open").addEventListener("click", () => {
    const id = $("#quick-select").value;
    if (state.quickType === "class") { state.selectedClass = id; renderClass(); setView("classes"); }
    else { state.selectedTeacher = id; renderTeacher(); setView("teachers"); }
  });
  $("#global-search").addEventListener("input", (event) => renderSearch(event.target.value));
  $("#search-results").addEventListener("click", (event) => {
    const result = event.target.closest("[data-result-id]");
    if (result) selectSearchResult(result.dataset.resultType, result.dataset.resultId);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".global-search")) $("#search-results").hidden = true;
  });
  $("#documents-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-document-path]");
    if (card) openDocument(card.dataset.documentPath);
  });
  $("#logout-button").addEventListener("click", async () => {
    await state.client.auth.signOut();
    state.data = null; state.profile = null;
    history.replaceState(null, "", location.pathname);
    showLogin("Vous êtes déconnecté.", true);
  });
  $("#theme-toggle").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const dark = document.body.classList.contains("dark");
    localStorage.setItem("cat-theme", dark ? "dark" : "light");
    $("#theme-toggle span").textContent = dark ? "Mode clair" : "Mode sombre";
  });
  window.addEventListener("hashchange", () => setView(location.hash.slice(1) || "dashboard", false));
  window.CATSmart?.bind(smartContext());
}

async function loadPortal() {
  try {
    const {data: payload, error} = await state.client.rpc("get_my_portal_data");
    if (error) throw error;
    state.data = payload.data;
    state.profile = payload.profile;
    if (isDirector() && (!state.selectedClass || !state.data.classes.some((c) => c.id === state.selectedClass))) state.selectedClass = state.data.classes[0].id;
    if (!state.selectedTeacher || !state.data.teachers.some((t) => t.id === state.selectedTeacher)) state.selectedTeacher = state.data.teachers[0].id;
    $("#side-solution").textContent = state.data.meta.solutionId;
    if (isDirector()) populateSelect($("#class-select"), state.data.classes);
    populateSelect($("#teacher-select"), state.data.teachers);
    if (isDirector()) populateSelect($("#announcement-teacher"), state.data.teachers);
    applyRole();
    renderStats(); renderLive(); renderDayStrip(); renderTeacher();
    if (isDirector()) { renderQuickOptions(); renderClass(); renderDocuments(); }
    window.CATSmart?.render(smartContext());
    updateClock(); setInterval(() => { updateClock(); renderLive(); }, 60_000);
    showPortal();
    setView(location.hash.slice(1) || "dashboard", false);
  } catch (error) {
    console.error(error);
    const username = $("#login-id").value.trim().toLowerCase() || "";
    const offline = window.CATSmart?.loadOffline(username);
    if (offline) {
      state.data = offline.data; state.profile = offline.profile;
      populateSelect($("#teacher-select"), state.data.teachers); applyRole();
      renderStats(); renderLive(); renderDayStrip(); renderTeacher(); window.CATSmart.render(smartContext());
      showPortal(); setView("dashboard", false); showToast("Mode hors connexion · dernière synchronisation");
    } else showLogin("Impossible de charger votre horaire. Contactez la direction.");
  }
}

async function init() {
  bindEvents();
  if (localStorage.getItem("cat-theme") === "dark") {
    document.body.classList.add("dark"); $("#theme-toggle span").textContent = "Mode clair";
  }
  $("#password-toggle").addEventListener("click", () => {
    const input = $("#login-password");
    input.type = input.type === "password" ? "text" : "password";
    $("#password-toggle").textContent = input.type === "password" ? "Voir" : "Masquer";
  });
  const config = window.CAT_CONFIG || {};
  const configured = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes("VOTRE-PROJET");
  if (!configured || !window.supabase) {
    showLogin("Configuration sécurisée en cours. Le portail sera bientôt disponible.");
    $("#login-form button[type=submit]").disabled = true;
    return;
  }
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("#login-status").textContent = "Vérification…";
    const {error} = await state.client.auth.signInWithPassword({
      email: loginEmail($("#login-id").value),
      password: $("#login-password").value,
    });
    button.disabled = false;
    if (error) { showLogin("Identifiant ou mot de passe incorrect."); return; }
    $("#login-status").textContent = "";
    await loadPortal();
  });
  const {data: {session}} = await state.client.auth.getSession();
  if (session) await loadPortal(); else showLogin();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
