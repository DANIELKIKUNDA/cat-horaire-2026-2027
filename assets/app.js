const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const EXPLICIT_LOGOUT_KEY = "horaire-pro-explicit-logout";
let scrollToggleTimer = null;

const state = {
  data: null,
  profile: null,
  client: null,
  platform: null,
  school: null,
  academicYears: [],
  timetables: [],
  activeTimetable: null,
  clockTimer: null,
  liveToken: "",
  workspaceMode: "",
  mobileDay: "",
  view: "dashboard",
  quickType: "class",
  selectedClass: localStorage.getItem("cat-selected-class") || "",
  selectedTeacher: localStorage.getItem("cat-selected-teacher") || "",
};

const managerRoles = new Set(["direction", "admin", "scheduler", "viewer"]);
const profileRoles = () => state.profile?.roles || (state.profile?.role === "director" ? ["direction"] : ["teacher"]);
const normalizedPosition = () => String(state.profile?.position_title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const isPromoterAssistant = () => /assistant.*promoteur|promoteur.*assistant/.test(normalizedPosition());
const isHrViewer = () => /(^|\s)drh($|\s)|ressources humaines/.test(normalizedPosition());
const isFocusedObserver = () => isPromoterAssistant() || isHrViewer();
const isSystemAdmin = () => Boolean(state.profile?.is_system_admin);
const canManageSchool = () => isSystemAdmin() || profileRoles().some((role) => managerRoles.has(role));
const canManageAccounts = () => isSystemAdmin() || profileRoles().some((role) => ["direction", "admin"].includes(role));
const canOperateSchool = () => isDirector() && (isSystemAdmin() || profileRoles().some((role) => ["direction", "admin", "scheduler"].includes(role)));
const canManageSchoolContent = () => isDirector() && (isSystemAdmin() || profileRoles().some((role) => ["direction", "admin"].includes(role)));
const hasScheduleAccess = () => isSystemAdmin() || Boolean(state.profile?.teacher_id) || profileRoles().some((role) => managerRoles.has(role));
const canAccessIntendance = () => Boolean(state.profile?.is_system_admin) || profileRoles().some((role) => ["direction", "admin", "intendant", "intendance_viewer"].includes(role));
const canWriteIntendance = () => Boolean(state.profile?.is_system_admin) || profileRoles().some((role) => ["direction", "admin", "intendant"].includes(role));
const isDualRole = () => canManageSchool() && Boolean(state.profile?.teacher_id) && (isSystemAdmin() || profileRoles().includes("teacher"));
const workspaceStorageKey = () => `horaire-pro-workspace:${state.profile?.id || "guest"}:${state.platform?.selected_school_id || "legacy"}`;
const workspaceMode = () => {
  if (!canManageSchool()) return "teacher";
  if (!isDualRole()) return "direction";
  return state.workspaceMode === "teacher" ? "teacher" : "direction";
};
const isDirector = () => workspaceMode() === "direction";

function setWorkspaceMode(mode, remember = true) {
  if (!isDualRole()) mode = canManageSchool() ? "direction" : "teacher";
  state.workspaceMode = mode === "teacher" ? "teacher" : "direction";
  if (remember) localStorage.setItem(workspaceStorageKey(), state.workspaceMode);
  if (state.data) {
    renderPortal();
    setView("dashboard", false);
    showToast(state.workspaceMode === "teacher" ? "Espace enseignant activé" : "Espace Direction activé");
  }
}

function loginEmails(value) {
  const input = value.trim().toLowerCase();
  return input.includes("@") ? [input] : [`${input}@cat-horaire.local`, `${input}@apn-horaire.local`];
}

function showLogin(message = "", success = false) {
  $("#loading-screen").hidden = true;
  $("#app-shell").hidden = true;
  $("#auth-screen").hidden = false;
  const status = $("#login-status");
  status.textContent = message;
  status.classList.toggle("success", success);
}

function showPortal() {
  $("#loading-screen").hidden = true;
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
}

function updateScrollToggle(wake = false) {
  const button = $("#page-scroll-toggle");
  if (!button) return;
  const root = document.documentElement;
  const scrollable = root.scrollHeight > window.innerHeight + 80;
  button.hidden = !scrollable || $("#app-shell")?.hidden;
  if (button.hidden) return;
  const goesUp = window.scrollY > Math.max(180, window.innerHeight * .35);
  button.dataset.direction = goesUp ? "up" : "down";
  button.querySelector("span").textContent = goesUp ? "↑" : "↓";
  button.setAttribute("aria-label", goesUp ? "Remonter en haut de la page" : "Descendre dans la page");
  if (wake) {
    button.classList.add("visible");
    clearTimeout(scrollToggleTimer);
    scrollToggleTimer = setTimeout(() => button.classList.remove("visible"), 2600);
  }
}

function bindScrollToggle() {
  const button = $("#page-scroll-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    const target = button.dataset.direction === "up" ? 0 : Math.min(document.documentElement.scrollHeight, window.scrollY + window.innerHeight * .82);
    window.scrollTo({top: target, behavior: "smooth"});
    updateScrollToggle(true);
  });
  window.addEventListener("scroll", () => updateScrollToggle(true), {passive:true});
  window.addEventListener("resize", () => updateScrollToggle(true));
}

function preventPullToRefresh() {
  let startY=0,startX=0,startedAtTop=false;
  document.addEventListener("touchstart",event=>{
    if(event.touches.length!==1){startedAtTop=false;return;}
    startY=event.touches[0].clientY;startX=event.touches[0].clientX;startedAtTop=window.scrollY<=0;
  },{passive:true});
  document.addEventListener("touchmove",event=>{
    if(!startedAtTop||event.touches.length!==1)return;
    const deltaY=event.touches[0].clientY-startY,deltaX=Math.abs(event.touches[0].clientX-startX);
    if(deltaY>8&&deltaY>deltaX)event.preventDefault();
  },{passive:false});
  document.addEventListener("touchend",()=>{startedAtTop=false;},{passive:true});
  document.addEventListener("touchcancel",()=>{startedAtTop=false;},{passive:true});
}

function setSidebarOpen(open) {
  const sidebar=$("#sidebar"),backdrop=$("#sidebar-backdrop");
  sidebar.classList.toggle("open",Boolean(open));
  backdrop.hidden=!open;
  document.body.classList.toggle("menu-open",Boolean(open));
  $("#menu-button")?.setAttribute("aria-expanded",String(Boolean(open)));
}

const titles = {
  dashboard: "Tableau de bord",
  agenda: "Agenda multi-écoles",
  classes: "Horaire des classes",
  teachers: "Horaire des enseignants",
  operations: "Centre des opérations",
  changes: "Changements intelligents",
  announcements: "Annonces et alertes",
  assistant: "Assistant CAT",
  stats: "Statistiques",
  intendance: "Intendance",
  accounts: "Comptes et accès",
  history: "Années et versions",
  documents: "Documents officiels",
  settings: "Mon compte",
};

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(0)} Ko`;

function schoolTimeZone() {
  const configured = state.school?.timezone;
  return !configured || configured === "Africa/Kinshasa" ? "Africa/Lubumbashi" : configured;
}

function schoolNow() {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: schoolTimeZone(), weekday: "long", day: "2-digit", month: "long",
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
  const now = schoolNow();
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
  if (isPromoterAssistant() && !["dashboard","intendance","teachers","classes","settings"].includes(view)) view = "dashboard";
  if (isHrViewer() && !["dashboard","teachers","settings"].includes(view)) view = "dashboard";
  if (view === "intendance" && !canAccessIntendance()) view = "dashboard";
  if (!hasScheduleAccess() && ["agenda", "classes", "teachers", "operations", "changes", "assistant", "stats", "history", "documents"].includes(view)) view = canAccessIntendance() ? "intendance" : "dashboard";
  if (view === "agenda" && (state.platform?.schools || []).length < 2) view = "dashboard";
  if (!isDirector() && ["classes", "operations", "changes", "stats", "accounts", "history", "documents"].includes(view)) view = "teachers";
  if (view === "operations" && !canOperateSchool()) view = "dashboard";
  if (view === "changes" && !canOperateSchool()) view = "dashboard";
  if (["stats", "documents"].includes(view) && !canManageSchoolContent()) view = "dashboard";
  if (view === "accounts" && !canManageAccounts()) view = "dashboard";
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`));
  $$(".main-nav a").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  $$("#mobile-bottom-nav [data-mobile-go]").forEach((button) => button.classList.toggle("active", button.dataset.mobileGo === view));
  $("#page-title").textContent = titles[view];
  setSidebarOpen(false);
  if (updateHash && location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  window.scrollTo({top: 0, behavior: "smooth"});
  setTimeout(() => updateScrollToggle(true), 180);
}

function renderStats() {
  const m = state.data.meta;
  if (!isDirector()) {
    const teacherId = state.profile?.teacher_id || state.data.teachers[0]?.id;
    const teacher = state.data.teachers.find((item) => item.id === teacherId) || state.data.teachers[0];
    if (!teacher) {
      const role = profileRoles().includes("intendant") ? "Gestionnaire" : "Consultation";
      $("#stats-grid").innerHTML = [["◫", "Intendance", "Centre de travail"], ["✓", role, "Niveau d’accès"], ["◎", state.school?.short_name || "École", "Établissement actif"]].map(([icon,value,label]) => `<article class="stat-card"><span class="stat-icon">${icon}</span><div><strong>${esc(value)}</strong><small>${esc(label)}</small></div></article>`).join("");
      return;
    }
    const occupied = state.data.days.reduce((total, day) => total + state.data.periods[day].filter((period) => scheduleEntries("teacher", teacher.id, day, period.id).length).length, 0);
    const today = liveContext().day;
    const todayCount = state.data.periods[today]?.filter((period) => scheduleEntries("teacher", teacher.id, today, period.id).length).length || 0;
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
  if (!isDirector() && state.profile?.teacher_id) {
    const teacherId=state.profile.teacher_id;
    const overview=state.data.days.map((day)=>{
      const slots=state.data.periods[day].filter((period)=>scheduleEntries("teacher",teacherId,day,period.id).length).map((period)=>period.id);
      return {day,slots};
    });
    const total=overview.reduce((sum,item)=>sum+item.slots.length,0);
    $("#day-strip").innerHTML=overview.map(({day,slots})=>`<div class="day-pill ${day===today?"today":""}"><span>${day===today?"Aujourd’hui":"Journée"}</span><strong>${esc(day.slice(0,3))}</strong><span>${slots.length} ${slots.length>1?"périodes":"période"}</span><small>${slots.length?esc(slots.join(" · ")):"Aucun cours"}</small></div>`).join("");
    $("#week-range").textContent=`Lundi à samedi · ${total} périodes enseignées`;
    return;
  }
  const overview=state.data.days.map((day)=>({day,count:state.data.periods[day].reduce((sum,period)=>sum+allPhysicalAt(day,period.id).length,0)}));
  const total=overview.reduce((sum,item)=>sum+item.count,0);
  $("#day-strip").innerHTML=overview.map(({day,count})=>`<div class="day-pill ${day===today?"today":""}"><span>${day===today?"Aujourd’hui":"Établissement"}</span><strong>${esc(day.slice(0,3))}</strong><span>${count} ${count>1?"séances":"séance"}</span><small>Programmées</small></div>`).join("");
  $("#week-range").textContent=`Lundi à samedi · ${total} séances programmées`;
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

function pedagogicalDayFor(teacherId) {
  const direct = state.data?.jp?.[teacherId];
  if (direct) return direct;
  const wanted = String(teacherId || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const match = Object.entries(state.data?.jp || {}).find(([name]) => String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === wanted);
  return match?.[1] || "";
}

function emptyHtml(day, period, type, owner) {
  if (type === "teacher") {
    if (pedagogicalDayFor(owner) === day) return `<div class="free-slot pedagogical">JOURNÉE<br>PÉDAGOGIQUE</div>`;
    return `<div class="free-slot">LIBRE</div>`;
  }
  const messe = day === "Vendredi" && ["P1", "P2"].includes(period);
  return `<div class="free-slot ${messe ? "messe" : ""}">${messe ? "MESSE" : "LIBRE"}</div>`;
}

function recessAfter(periodIds, index) {
  const nextId = periodIds[index + 1];
  if (!nextId) return "";
  const gaps = state.data.days.map((day) => {
    const periods = state.data.periods[day] || [];
    const current = periods.find((item) => item.id === periodIds[index]);
    const next = periods.find((item) => item.id === nextId);
    if (!current || !next) return null;
    const end = current.time.split("-")[1];
    const start = next.time.split("-")[0];
    return timeToMinutes(start) > timeToMinutes(end) ? {day,end,start} : null;
  }).filter(Boolean);
  if (!gaps.length) return "";
  const weekday = gaps.filter((gap) => gap.day !== "Samedi").map((gap) => `${gap.end}–${gap.start}`)[0];
  const saturday = gaps.find((gap) => gap.day === "Samedi");
  const detail = [weekday ? `Lun–Ven ${weekday}` : "", saturday ? `Sam. ${saturday.end}–${saturday.start}` : ""].filter(Boolean).join(" · ");
  return `<tr class="recess-row"><td colspan="${state.data.days.length + 1}"><div class="recess-bar"><span></span>Récréation <small>${esc(detail)}</small><span></span></div></td></tr>`;
}

function renderSchedule(hostSelector, type, owner) {
  const data = state.data;
  const {day: liveDay, current} = liveContext();
  if (!state.mobileDay || !data.days.includes(state.mobileDay)) state.mobileDay = data.days.includes(liveDay) ? liveDay : data.days[0];
  const periodIds = data.periods[data.days[0]].map((p) => p.id);
  const header = data.days.map((day) => `<th>${esc(day)}</th>`).join("");
  const rows = periodIds.map((period,index) => {
    const weekdayTime = data.periods.Lundi.find((p) => p.id === period)?.time || "";
    const saturdayTime = data.periods.Samedi.find((p) => p.id === period)?.time || "";
    const cells = data.days.map((day) => {
      const entries = scheduleEntries(type, owner, day, period);
      const live = day === liveDay && current?.id === period;
      return `<td>${entries.length ? entries.map((e) => lessonHtml(e, type, live)).join("") : emptyHtml(day, period, type, owner)}</td>`;
    }).join("");
    return `<tr><td class="period-cell"><strong>${period}</strong><small>Lun–Ven ${weekdayTime}<br>Sam. ${saturdayTime}</small></td>${cells}</tr>${recessAfter(periodIds,index)}`;
  }).join("");
  const desktop = `<div class="schedule-scroll"><table class="schedule-table"><thead><tr><th>Période</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const selectedDay=state.mobileDay;
  const dayLessons=data.periods[selectedDay].map((period)=>({period,entries:scheduleEntries(type,owner,selectedDay,period.id)})).filter(item=>item.entries.length);
  const mobileEmpty=type==="teacher"&&pedagogicalDayFor(owner)===selectedDay?`<div class="mobile-agenda-empty pedagogical"><span>◆</span><strong>Journée pédagogique</strong><p>Cette journée est réservée à vos activités pédagogiques.</p></div>`:`<div class="mobile-agenda-empty"><span>☀</span><strong>Journée libre</strong><p>Aucun cours n’est programmé pour cette journée.</p></div>`;
  const mobile = `<div class="schedule-mobile"><div class="mobile-day-tabs">${data.days.map(day=>{const count=data.periods[day].filter(period=>scheduleEntries(type,owner,day,period.id).length).length;return `<button type="button" data-mobile-day="${esc(day)}" class="${day===selectedDay?"active":""}"><span>${esc(day.slice(0,3))}</span><small>${count}</small></button>`;}).join("")}</div><section class="mobile-agenda"><header><div><small>Programme du jour</small><h4>${esc(selectedDay)}</h4></div><span>${dayLessons.length} cours</span></header><div class="mobile-agenda-list">${dayLessons.length?dayLessons.map(({period,entries})=>{const live=selectedDay===liveDay&&current?.id===period.id;return `<article class="mobile-agenda-item ${live?"is-live":""}"><div class="mobile-agenda-time"><strong>${esc(period.time.split("-")[0])}</strong><small>${esc(period.time.split("-")[1])}</small></div><span class="mobile-agenda-line"></span><div class="mobile-agenda-lesson">${entries.map(entry=>lessonHtml(entry,type,live)).join("")}<small>${esc(period.id)}</small></div></article>`;}).join(""):mobileEmpty}</div></section></div>`;
  const host=$(hostSelector);host.innerHTML = desktop + mobile;
  $$('[data-mobile-day]',host).forEach(button=>button.addEventListener("click",()=>{state.mobileDay=button.dataset.mobileDay;renderSchedule(hostSelector,type,owner);}));
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
  const preferred = state.profile?.teacher_id && state.data.teachers.some((teacher) => teacher.id === state.profile.teacher_id)
    ? state.profile.teacher_id : "";
  const id = state.selectedTeacher || preferred || state.data.teachers[0].id;
  state.selectedTeacher = id;
  localStorage.setItem("cat-selected-teacher", id);
  $("#teacher-select").value = id;
  const item = state.data.teachers.find((t) => t.id === id);
  const pedagogicalDay = pedagogicalDayFor(id);
  $("#teacher-summary").innerHTML = `
    <div class="summary-card"><small>Enseignant</small><strong>${esc(id)}</strong></div>
    <div class="summary-card"><small>Charge pédagogique</small><strong>${item.hours} heures</strong></div>
    <div class="summary-card"><small>Créneaux physiques</small><strong>${item.physicalSlots} périodes</strong></div>
    <div class="summary-card"><small>Journée pédagogique</small><strong>${esc(pedagogicalDay || "Non renseignée")}</strong></div>`;
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
  const classes = (isHrViewer()?[]:state.data.classes).filter((c) => c.id.toLocaleLowerCase("fr").includes(q)).slice(0,5)
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
  const now = schoolNow();
  $("#today-label").textContent = `${normalizeDay(now.weekday)} ${now.day} ${now.month}`;
  $("#clock").textContent = `${now.hour}:${now.minute}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function smartContext() {
  return {state, isDirector, canManageSchool, canManageAccounts, canOperateSchool, canManageSchoolContent, hasScheduleAccess, canAccessIntendance, canWriteIntendance, isDualRole, workspaceMode, setWorkspaceMode, setView, renderTeacher, renderClass, showToast, esc, populateSelect, liveContext, scheduleEntries,
    reload: loadPortal,
    displayTimetable: (data, timetable) => {
      state.data = data; state.activeTimetable = timetable; state.selectedClass = ""; state.selectedTeacher = state.profile?.teacher_id || "";
      renderPortal(); setView(isDirector() ? "classes" : "teachers"); showToast(`Version ouverte · ${timetable.title}`);
    },
  };
}


async function openDocument(path) {
  if (!isDirector()) return;
  const {data, error} = await state.client.storage.from("official-documents").createSignedUrl(path, 90);
  if (error) { showToast("Document indisponible"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

function renderMobileNav() {
  const host=$("#mobile-bottom-nav");if(!host)return;
  const roles=profileRoles();const multi=(state.platform?.schools||[]).length>1;let items;
  if(isPromoterAssistant()) items=[["dashboard","⌂","Accueil"],["intendance","◫","Intendance"],["teachers","♙","Enseignants"],["classes","▦","Classes"],["settings","◎","Compte"]];
  else if(isHrViewer()) items=[["dashboard","⌂","Accueil"],["teachers","♙","Enseignants"],["settings","◎","Compte"]];
  else if(!hasScheduleAccess()&&canAccessIntendance()) items=[["dashboard","⌂","Accueil"],["intendance","◫","Intendance"],["announcements","◈","Annonces"],["settings","◎","Compte"],["menu","☰","Plus"]];
  else if(!isDirector()) items=[["dashboard","⌂","Accueil"],["teachers","▤","Mon horaire"],[multi?"agenda":"assistant",multi?"▣":"✦",multi?"Agenda":"Assistant"],["announcements","◈","Annonces"],["settings","◎","Compte"]];
  else if(roles.includes("viewer")&&!roles.some(role=>["direction","admin","scheduler"].includes(role))) items=[["dashboard","⌂","Accueil"],["classes","▦","Classes"],[multi?"agenda":"teachers",multi?"▣":"♙",multi?"Agenda":"Profs"],["announcements","◈","Annonces"],["settings","◎","Compte"]];
  else if(roles.includes("scheduler")&&!roles.some(role=>["direction","admin"].includes(role))) items=[["dashboard","⌂","Accueil"],["classes","▦","Classes"],[multi?"agenda":"changes",multi?"▣":"⇄",multi?"Agenda":"Modifier"],["announcements","◈","Annonces"],["menu","☰","Plus"]];
  else items=[["dashboard","⌂","Accueil"],["classes","▦","Classes"],[multi?"agenda":"operations",multi?"▣":"◉",multi?"Agenda":"En direct"],["announcements","◈","Annonces"],["menu","☰","Plus"]];
  host.style.setProperty("--mobile-nav-count",String(items.length));
  host.innerHTML=items.map(([view,icon,label])=>`<button type="button" ${view==="menu"?'data-mobile-menu':`data-mobile-go="${view}"`} class="${state.view===view?"active":""}"><i>${icon}</i><span>${label}</span>${view==="announcements"?'<b id="mobile-announcement-badge" hidden>0</b>':""}</button>`).join("");
  $$('[data-mobile-go]',host).forEach(button=>button.addEventListener("click",()=>setView(button.dataset.mobileGo)));
  $('[data-mobile-menu]',host)?.addEventListener("click",()=>setSidebarOpen(true));
}

function applyRole() {
  const director = isDirector();
  const position = state.profile.position_title?.trim();
  const roles = profileRoles();
  const viewerOnly = !isSystemAdmin() && roles.includes("viewer") && !roles.some((role) => ["direction","admin","scheduler"].includes(role));
  const managementLabel = isSystemAdmin() ? "Administrateur système" : position || (roles.includes("admin") ? "Administration" : roles.includes("scheduler") ? "Planification" : roles.includes("viewer") ? "Consultation" : "Direction");
  document.body.dataset.workspace = director ? "direction" : "teacher";
  document.body.dataset.primaryRole = isSystemAdmin() ? "system-admin" : isPromoterAssistant() ? "promoter-assistant" : isHrViewer() ? "hr" : (profileRoles().includes("viewer") && !profileRoles().some(role => ["direction","admin","scheduler"].includes(role)) ? "viewer" : (profileRoles().includes("scheduler") && !profileRoles().some(role => ["direction","admin"].includes(role)) ? "scheduler" : (director ? "management" : "teacher")));
  $$('[data-director-only]').forEach((element) => { element.hidden = !director; });
  $$('[data-full-schedule]').forEach((element) => { element.hidden = !director; });
  $$('[data-operations]').forEach((element) => { element.hidden = !canOperateSchool(); });
  $$('[data-scheduler]').forEach((element) => { element.hidden = !canOperateSchool(); });
  $$('[data-management]').forEach((element) => { element.hidden = !canManageSchoolContent(); });
  $$('[data-history]').forEach((element) => { element.hidden = !director; });
  $$('[data-multi-school]').forEach((element) => { element.hidden = (state.platform?.schools || []).length < 2; });
  $$('[data-account-manager-only]').forEach((element) => { element.hidden = !director || !canManageAccounts(); });
  $$('[data-intendance]').forEach((element) => { element.hidden = !canAccessIntendance(); });
  $$('[data-intendance-write]').forEach((element) => { element.hidden = !canWriteIntendance(); });
  $$('[data-schedule-access]').forEach((element) => { if (!hasScheduleAccess()) element.hidden = true; });
  if (isFocusedObserver()) {
    const allowed = new Set(isPromoterAssistant() ? ["dashboard","intendance","teachers","classes","settings"] : ["dashboard","teachers","settings"]);
    $$(".main-nav [data-view]").forEach((link) => { link.hidden = !allowed.has(link.dataset.view); });
  }
  $("#account-name").textContent = state.profile.full_name;
  $("#account-role").textContent = isDualRole()
    ? (director ? `${managementLabel} + enseignant · espace ${managementLabel}` : `${managementLabel} + enseignant · espace personnel`)
    : (isPromoterAssistant() ? "Assistant du promoteur · pilotage en lecture" : isHrViewer() ? "DRH · suivi des enseignants" : (profileRoles().includes("intendant") ? "Intendant · gestion opérationnelle" : profileRoles().includes("intendance_viewer") ? "Intendance · lecture seule" : (viewerOnly ? `${managementLabel} · consultation complète` : (director ? `${managementLabel} · accès de gestion` : "Enseignant · accès personnel"))));
  $("#account-avatar").textContent = state.profile.full_name.charAt(0).toUpperCase();
  titles.teachers = director ? "Horaire des enseignants" : "Mon horaire";
  titles.assistant = director ? "Assistant de l’école" : "Mon assistant horaire";
  $("#teacher-nav-label").textContent = director ? "Horaire des enseignants" : "Mon horaire";
  $("#teacher-context-label").textContent = director ? `${state.data.teachers.length} enseignants` : "Espace enseignant";
  $("#view-dashboard .week-preview .eyebrow").textContent = director ? "Vue de l’établissement" : "Ma semaine";
  $("#view-dashboard .week-preview h3").textContent = director ? "Activité hebdomadaire" : "Mes périodes réelles";
  $("#primary-schedule-button").dataset.go = director ? "classes" : "teachers";
  $("#primary-schedule-button").textContent = director ? "Voir les horaires" : "Voir mon horaire";
  $("#view-teachers .section-intro h2").textContent = director ? "Horaire des enseignants" : "Mon horaire personnel";
  $("#view-teachers .section-intro p").textContent = director
    ? "Consultez chaque service hebdomadaire publié."
    : "Votre semaine de cours certifiée par la direction.";
  $("#view-teachers .entity-picker").hidden = !director;
  $("#global-search").closest(".global-search").hidden = !director || isFocusedObserver();
  const focused=isFocusedObserver();
  $("#smart-focus").hidden=focused;$("#stats-grid").hidden=focused;$("#dashboard-alerts").hidden=focused;$("#view-dashboard .dashboard-grid").hidden=focused;
  $("#dashboard-intendance-summary").hidden=!canAccessIntendance();
  $("#dashboard-hr-summary").hidden=!isHrViewer();
  const hero=$("#view-dashboard .hero-card"),kicker=$(".hero-kicker",hero),title=$(".hero-copy h2",hero),description=$(".hero-copy p",hero),secondary=$(".secondary-button",hero);
  if(isPromoterAssistant()){
    kicker.innerHTML="<i></i> Pilotage logistique APN";title.innerHTML="Les ressources de l’école,<br><em>sous contrôle.</em>";description.textContent="Suivez les stocks, les mouvements et le patrimoine, puis consultez les services des enseignants lorsque nécessaire.";$("#primary-schedule-button").dataset.go="intendance";$("#primary-schedule-button").textContent="Ouvrir l’Intendance";secondary.hidden=true;
  }else if(isHrViewer()){
    kicker.innerHTML="<i></i> Suivi administratif";title.innerHTML="Chaque service enseignant,<br><em>clair et vérifiable.</em>";description.textContent="Contrôlez les heures d’arrivée et de sortie prévues à partir de l’horaire officiel publié.";$("#primary-schedule-button").dataset.go="teachers";$("#primary-schedule-button").textContent="Suivre les enseignants";secondary.hidden=true;
  }else{
    kicker.innerHTML="<i></i> Horaire officiel publié";title.innerHTML="Une semaine scolaire claire,<br><em>accessible partout.</em>";description.textContent="Consultez les cours par classe ou par enseignant, suivez la période en cours et téléchargez les documents certifiés.";secondary.hidden=!canManageSchoolContent();
  }
  const switcher = $("#workspace-switcher");
  if (switcher) {
    switcher.hidden = !isDualRole();
    const directionButton = $('[data-workspace="direction"]', switcher);
    if (directionButton) directionButton.textContent = `◆ ${managementLabel}`;
    $$('[data-workspace]', switcher).forEach((button) => button.classList.toggle("active", button.dataset.workspace === workspaceMode()));
  }
  const directionChoice = $("#workspace-direction-label");
  if (directionChoice) directionChoice.textContent = `Espace ${managementLabel}`;
  if (!director) {
    state.selectedTeacher = state.profile.teacher_id || state.selectedTeacher;
  }
  renderMobileNav();
}

function renderHrDashboard(){
  const host=$("#dashboard-hr-content");if(!host||!isHrViewer())return;
  const live=liveContext(),periods=state.data.periods[live.day]||[];let slots=0;
  const services=state.data.teachers.map(teacher=>{const occupied=periods.filter(period=>scheduleEntries("teacher",teacher.id,live.day,period.id).length);slots+=occupied.length;if(!occupied.length)return null;const first=occupied[0],last=occupied.at(-1),current=live.current&&occupied.some(period=>period.id===live.current.id);const now=timeToMinutes(`${live.now.hour}:${live.now.minute}`),end=timeToMinutes(last.time.split("-")[1]);return {teacher,first,last,count:occupied.length,status:current?"En cours":now>=end?"Terminé":"À venir"};}).filter(Boolean).sort((a,b)=>timeToMinutes(a.first.time.split("-")[0])-timeToMinutes(b.first.time.split("-")[0])||a.teacher.id.localeCompare(b.teacher.id,"fr"));
  const active=services.filter(service=>service.status==="En cours").length;
  host.innerHTML=`<div class="dashboard-module-kpis"><div><strong>${state.data.teachers.length}</strong><small>Enseignants suivis</small></div><div><strong>${services.length}</strong><small>Attendus aujourd’hui</small></div><div><strong>${active}</strong><small>En cours planifié</small></div><div><strong>${slots}</strong><small>Créneaux du jour</small></div></div><div class="hr-service-list">${services.slice(0,8).map(service=>{const statusClass=service.status==="En cours"?"en-cours":service.status==="Terminé"?"termine":"a-venir";return `<article><span>${esc(service.teacher.id.split(/\s+/).slice(0,2).map(part=>part[0]).join(""))}</span><div><strong>${esc(service.teacher.id)}</strong><small>${service.first.time.split("-")[0]} → ${service.last.time.split("-")[1]} · ${service.count} période${service.count>1?"s":""}</small></div><em class="${statusClass}">${service.status}</em></article>`;}).join("")||'<div class="dashboard-module-empty">Aucun service enseignant programmé aujourd’hui.</div>'}</div>`;
}

let pendingServiceWorker=null,updateAnnounced=false;
function announceUpdate(){
  if(updateAnnounced)return;updateAnnounced=true;
  try{if("speechSynthesis" in window){const message=new SpeechSynthesisUtterance("Une nouvelle version de Horaire Pro est disponible. Vous pouvez la mettre à jour maintenant.");message.lang="fr-FR";message.rate=.96;window.speechSynthesis.speak(message);}}catch{}
}
function showAppUpdate(worker){pendingServiceWorker=worker||null;const banner=$("#app-update-banner");if(!banner)return;banner.hidden=false;announceUpdate();}
async function setupServiceWorker(){
  if(!("serviceWorker" in navigator)||location.protocol==="file:")return;
  try{
    const registration=await navigator.serviceWorker.register("sw.js");
    if(registration.waiting&&navigator.serviceWorker.controller)showAppUpdate(registration.waiting);
    registration.addEventListener("updatefound",()=>{const worker=registration.installing;if(!worker)return;worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller)showAppUpdate(worker);});});
    setInterval(()=>registration.update().catch(()=>{}),15*60*1000);
  }catch{}
}

function bindEvents() {
  $$(".main-nav a").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault(); setView(link.dataset.view);
  }));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  $("#menu-button").addEventListener("click", () => setSidebarOpen(!$("#sidebar").classList.contains("open")));
  $("#sidebar-backdrop").addEventListener("click",()=>setSidebarOpen(false));
  document.addEventListener("keydown",event=>{if(event.key==="Escape")setSidebarOpen(false);});
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
    localStorage.setItem(EXPLICIT_LOGOUT_KEY, "1");
    try { await state.client.auth.signOut({scope:"local"}); } catch (error) { console.warn("Déconnexion locale", error); }
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
  $$('[data-workspace]').forEach((button) => button.addEventListener("click", () => setWorkspaceMode(button.dataset.workspace)));
  $$('[data-workspace-choice]').forEach((button) => button.addEventListener("click", () => {
    $("#workspace-modal").hidden = true;
    setWorkspaceMode(button.dataset.workspaceChoice);
  }));
  window.addEventListener("hashchange", () => setView(location.hash.slice(1) || "dashboard", false));
  window.CATSmart?.bind(smartContext());
  window.HoraireProPlatform?.bind(smartContext());
  window.HoraireProIntendance?.bind(smartContext());
}

function assignPayload(payload) {
  state.data = payload.data;
  state.profile = payload.profile;
  state.platform = payload.platform || null;
  state.school = payload.school || null;
  state.academicYears = payload.academic_years || [];
  state.timetables = payload.timetables || [];
  state.activeTimetable = payload.active_timetable || null;
  const savedMode = localStorage.getItem(workspaceStorageKey());
  state.workspaceMode = isDualRole() ? (savedMode || "") : (canManageSchool() ? "direction" : "teacher");
}

function renderPortal() {
  if (isDirector() && (!state.selectedClass || !state.data.classes.some((item) => item.id === state.selectedClass))) state.selectedClass = state.data.classes[0]?.id || "";
  const personalTeacher = state.profile?.teacher_id;
  if (!isDirector() && personalTeacher) state.selectedTeacher = personalTeacher;
  if (!state.selectedTeacher || !state.data.teachers.some((item) => item.id === state.selectedTeacher)) state.selectedTeacher = personalTeacher || state.data.teachers[0]?.id || "";
  if ($("#side-solution")) $("#side-solution").textContent = state.activeTimetable?.title || state.data.meta?.solutionId || "Horaire publié";
  $("#brand-context").textContent = state.school?.short_name || state.school?.name || "Portail scolaire";
  if (isDirector()) populateSelect($("#class-select"), state.data.classes);
  populateSelect($("#teacher-select"), state.data.teachers);
  if (isDirector()) populateSelect($("#announcement-teacher"), state.data.teachers);
  applyRole();
  renderStats(); renderLive(); renderDayStrip(); renderHrDashboard();
  if (state.selectedTeacher) renderTeacher();
  if (isDirector()) { renderQuickOptions(); renderClass(); renderDocuments(); }
  window.CATSmart?.render(smartContext());
  window.HoraireProPlatform?.render(smartContext());
  window.HoraireProIntendance?.render(smartContext());
  updateClock();
  clearInterval(state.clockTimer);
  const updateLiveExperience = () => {
    updateClock();
    const live = liveContext();
    const token = `${live.day}:${live.current?.id || "none"}:${live.next?.id || "none"}`;
    if (token !== state.liveToken) {
      state.liveToken = token;
      renderLive();
    }
    window.CATSmart?.tick(smartContext(), token);
  };
  state.liveToken = "";
  updateLiveExperience();
  state.clockTimer = setInterval(updateLiveExperience, 1_000);
  showPortal();
  const requestedView = location.hash.slice(1) || (!hasScheduleAccess() && canAccessIntendance() ? "intendance" : "dashboard");
  setView(requestedView, false);
  if (isDualRole() && !localStorage.getItem(workspaceStorageKey())) $("#workspace-modal").hidden = false;
  setTimeout(() => updateScrollToggle(true), 180);
}

async function loadPortal(options = {}) {
  try {
    let payload = await window.HoraireProPlatform?.fetchPayload(state.client, options.schoolId, {force:Boolean(options.force)});
    if (!payload) {
      const legacy = await state.client.rpc("get_my_portal_data");
      if (legacy.error) throw legacy.error;
      payload = legacy.data;
    }
    if (options.schoolId && payload.platform?.selected_school_id !== options.schoolId) throw new Error("L’établissement demandé n’a pas été chargé.");
    assignPayload(payload);
    renderPortal();
    if (!options.silent) showToast(state.platform ? "Horaire synchronisé" : "Portail chargé");
    return true;
  } catch (error) {
    console.error(error);
    if (options.force) {
      showToast("Changement d’établissement impossible");
      return false;
    }
    const platformOffline = await window.HoraireProPlatform?.loadOffline();
    const username = $("#login-id").value.trim().toLowerCase() || "";
    const legacyOffline = window.CATSmart?.loadOffline(username);
    const payload = platformOffline?.payload || legacyOffline;
    if (payload) { assignPayload(payload); renderPortal(); showToast("Mode hors connexion · dernière synchronisation"); return true; }
    showLogin("Impossible de charger votre horaire. Contactez la direction.");
    return false;
  }
}

async function init() {
  bindEvents();
  bindScrollToggle();
  preventPullToRefresh();
  setupServiceWorker();
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
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:"horaire-pro-auth"},
  });
  $$('[data-password-visibility]').forEach((button) => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordVisibility);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Voir" : "Masquer";
    button.setAttribute("aria-label", `${input.type === "password" ? "Afficher" : "Masquer"} le mot de passe`);
  }));
  $("#apply-app-update")?.addEventListener("click",()=>{pendingServiceWorker?.postMessage({type:"SKIP_WAITING"});setTimeout(()=>location.reload(),180);});
  $("#dismiss-app-update")?.addEventListener("click",()=>{$("#app-update-banner").hidden=true;});
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("#login-status").textContent = "Vérification…";
    let error = null;
    for (const email of loginEmails($("#login-id").value)) {
      const result = await state.client.auth.signInWithPassword({email,password:$("#login-password").value});
      error = result.error;
      if (!error) break;
    }
    button.disabled = false;
    if (error) { showLogin("Identifiant ou mot de passe incorrect."); return; }
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    $("#login-status").textContent = "";
    await loadPortal();
  });
  let session = null;
  try {
    const result = await state.client.auth.getSession();
    session = result.data.session;
  } catch (error) {
    console.warn("Session réseau indisponible, ouverture de la copie locale", error);
  }
  if (session) {
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    const cached=await window.HoraireProPlatform?.loadOffline();
    if(cached?.payload?.profile?.id===session.user.id){assignPayload(cached.payload);renderPortal();showToast("Ouverture instantanée · actualisation en cours");}
    await loadPortal({silent:Boolean(cached?.payload)});
  } else if (localStorage.getItem(EXPLICIT_LOGOUT_KEY) !== "1") {
    const platformOffline = await window.HoraireProPlatform?.loadOffline();
    const cachedPayload = platformOffline?.payload || window.CATSmart?.loadOffline();
    if (cachedPayload) {
      assignPayload(cachedPayload);
      renderPortal();
      showToast("Mode hors connexion · session conservée");
    } else {
      showLogin();
    }
  } else {
    showLogin();
  }
}

init();
