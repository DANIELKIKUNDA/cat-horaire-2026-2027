(() => {
  "use strict";
  const DB_NAME = "horaire-pro";
  const DB_VERSION = 4;
  const STORE = "snapshots";
  const TIMETABLE_STORE = "timetables";
  const LAST_CONTEXT = "horaire-pro-last-context";
  let ctx;
  let selectedDate = new Date();
  let weekMode = false;
  let selectedYearId = null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const h = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {keyPath:"key"});
          store.createIndex("savedAt", "savedAt");
          store.createIndex("userId", "userId");
        }
        if (!db.objectStoreNames.contains(TIMETABLE_STORE)) db.createObjectStore(TIMETABLE_STORE, {keyPath:"key"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function idbPut(record) {
    if (!("indexedDB" in window)) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  async function idbGet(key) {
    if (!("indexedDB" in window)) return null;
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
    });
    db.close(); return value;
  }
  async function timetablePut(record) {
    const db=await openDb();await new Promise((resolve,reject)=>{const tx=db.transaction(TIMETABLE_STORE,"readwrite");tx.objectStore(TIMETABLE_STORE).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  }
  async function timetableGet(key) {
    const db=await openDb();const value=await new Promise((resolve,reject)=>{const request=db.transaction(TIMETABLE_STORE).objectStore(TIMETABLE_STORE).get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});db.close();return value;
  }

  function platformKey(userId, schoolId) { return `${userId}:${schoolId}`; }
  function isMissingRpc(error) { return /get_my_platform_bootstrap|schema cache|could not find/i.test(error?.message || ""); }

  async function fetchPayload(client, requestedSchoolId = null, options = {}) {
    const schoolId = requestedSchoolId || localStorage.getItem("horaire-pro-school") || null;
    const session = await client.auth.getSession();
    const sessionUser = session.data.session?.user;
    const userId = sessionUser?.id;
    const cached = userId && schoolId ? await idbGet(platformKey(userId, schoolId)) : null;
    const tokenResult = await client.rpc("get_my_platform_sync_token", {p_school_id:schoolId});
    if (!options.force && !tokenResult.error && cached?.syncToken && cached.syncToken === tokenResult.data) {
      cached.savedAt = Date.now();
      if (sessionUser?.user_metadata && "must_change_password" in sessionUser.user_metadata) cached.payload.profile.must_change_password=Boolean(sessionUser.user_metadata.must_change_password);
      await idbPut(cached);
      localStorage.setItem(LAST_CONTEXT, JSON.stringify({userId:cached.userId,schoolId:cached.schoolId,savedAt:cached.savedAt}));
      return cached.payload;
    }
    const {data, error} = await client.rpc("get_my_platform_bootstrap", {p_school_id:schoolId});
    if (error) {
      if (isMissingRpc(error)) return null;
      throw error;
    }
    const selected = data.platform.selected_school_id;
    if (sessionUser?.user_metadata && "must_change_password" in sessionUser.user_metadata) data.profile.must_change_password=Boolean(sessionUser.user_metadata.must_change_password);
    localStorage.setItem("horaire-pro-school", selected);
    const record = {key:platformKey(data.profile.id, selected), userId:data.profile.id, schoolId:selected,
      revision:data.active_timetable?.revision || 0, syncToken:tokenResult.error?null:tokenResult.data, savedAt:Date.now(), payload:data};
    await idbPut(record);
    localStorage.setItem(LAST_CONTEXT, JSON.stringify({userId:data.profile.id,schoolId:selected,savedAt:record.savedAt}));
    return data;
  }

  async function loadOffline() {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_CONTEXT) || "null");
      if (!last) return null;
      return await idbGet(platformKey(last.userId, last.schoolId));
    } catch { return null; }
  }

  function roles() { return ctx?.state.profile?.roles || []; }
  function canManage() { return roles().some((role) => ["direction","admin","scheduler"].includes(role)); }
  function schoolList() { return ctx?.state.platform?.schools || []; }
  function currentSchool() { return ctx?.state.school || null; }
  function formatDate(date) { return new Intl.DateTimeFormat("fr-FR", {weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(date); }
  function isoDate(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
  function weekdayNumber(date) { const day=date.getDay(); return day===0?7:day; }
  function schoolLabel(id) { return schoolList().find((school)=>school.id===id)?.short_name || "École"; }

  function renderSchoolControls() {
    const schools = schoolList();
    const selected = ctx.state.platform.selected_school_id;
    const options = schools.map((school)=>`<option value="${h(school.id)}">${h(school.short_name)} · ${h(school.name)}</option>`).join("");
    const sidebarSelect = $("#school-switcher");
    const dashboardSelect = $("#dashboard-school-switcher");
    for (const select of [sidebarSelect,dashboardSelect].filter(Boolean)) {
      select.innerHTML = options;
      select.value = selected;
      select.disabled = false;
    }
    $("#school-switcher-wrap").hidden = !schools.length;
    if ($("#dashboard-school-switcher-wrap")) $("#dashboard-school-switcher-wrap").hidden = schools.length < 2;
    $("#sidebar-school-name").textContent = currentSchool()?.name || "Horaire Pro";
    const agendaFilter = $("#agenda-school-filter");
    const agendaValue = agendaFilter.value || "all";
    agendaFilter.innerHTML = `<option value="all">Toutes les écoles</option>${schools.map((school)=>`<option value="${h(school.id)}">${h(school.short_name)}</option>`).join("")}`;
    agendaFilter.value = schools.some((school)=>school.id===agendaValue) ? agendaValue : "all";
    const modal = $("#school-modal");
    const remembered = localStorage.getItem("horaire-pro-school-confirmed");
    if (schools.length > 1 && !remembered) {
      $("#school-modal-list").innerHTML = schools.map((school)=>`<button type="button" data-choose-school="${h(school.id)}"><span>${h(school.short_name)}</span><strong>${h(school.name)}</strong><small>${h(school.roles.join(" · "))}</small></button>`).join("");
      modal.hidden = false;
    } else modal.hidden = true;
  }

  function sessionCard(session, date) {
    const time = session.start_time ? `${String(session.start_time).slice(0,5)}–${String(session.end_time || "").slice(0,5)}` : session.period;
    return `<article class="aggregate-session"><span class="school-token">${h(session.school_short_name || schoolLabel(session.school_id))}</span><div class="aggregate-time"><strong>${h(time)}</strong><small>${h(session.period)}</small></div><div><h4>${h(session.course)}</h4><p>${h((session.classes || []).join(" · "))}${session.room?` · Local ${h(session.room)}`:""}</p><small>${h(session.school_name || "")}</small></div><time>${h(isoDate(date))}</time></article>`;
  }

  function renderAgenda() {
    if (!ctx.state.platform) return;
    const host=$("#aggregate-agenda-list"); const filter=$("#agenda-school-filter").value || "all";
    $("#platform-agenda").hidden=false;
    $("#agenda-date-title").textContent=weekMode?`Semaine du ${formatDate(selectedDate)}`:formatDate(selectedDate);
    const dates=[];
    if (weekMode) {
      const monday=new Date(selectedDate); monday.setDate(monday.getDate()-(weekdayNumber(monday)-1));
      for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(monday.getDate()+i);dates.push(d);}
    } else dates.push(new Date(selectedDate));
    const sessions=ctx.state.platform.aggregate_sessions || [];
    const changes=ctx.state.platform.aggregate_changes || [];
    const blocks=dates.map((date)=>{
      const datedChanges=changes.filter((change)=>change.effective_date===isoDate(date));
      const removed=new Set(datedChanges.map((change)=>change.source_entry_id).filter(Boolean));
      const dateKey=isoDate(date);
      const items=sessions.filter((session)=>!removed.has(session.entry_id)&&session.valid_from<=dateKey&&(!session.valid_until||session.valid_until>=dateKey)&&Number(session.day_of_week)===weekdayNumber(date)&&(filter==="all"||session.school_id===filter));
      for(const change of datedChanges.filter((item)=>item.change_type==="move"&&Number(item.new_day_of_week)===weekdayNumber(date)&&(filter==="all"||item.school_id===filter))){
        const source=sessions.find((item)=>item.entry_id===change.source_entry_id);
        if(source)items.push({...source,period:change.new_period,room:change.new_room||source.room,course:change.course||source.course,classes:change.classes||source.classes,changed:true});
      }
      items.sort((a,b)=>String(a.start_time||a.period).localeCompare(String(b.start_time||b.period)));
      return `<section class="agenda-day"><h4>${h(formatDate(date))}<span>${items.length} séance${items.length>1?"s":""}</span></h4>${items.length?items.map((item)=>sessionCard(item,date)).join(""):`<div class="empty-state">Aucun cours prévu.</div>`}</section>`;
    });
    host.innerHTML=blocks.join("");
    const last=JSON.parse(localStorage.getItem(LAST_CONTEXT)||"null");
    $("#agenda-sync-state").textContent=last?.savedAt?`Synchronisé ${new Date(last.savedAt).toLocaleString("fr-FR")}`:"Synchronisation active";
  }

  function renderHistory() {
    if (!ctx.state.platform) return;
    const years=ctx.state.academicYears || []; const timetables=ctx.state.timetables || [];
    if(!selectedYearId||!years.some((year)=>year.id===selectedYearId)) selectedYearId=years.find((year)=>year.is_current)?.id||years[0]?.id||null;
    $("#year-tabs").innerHTML=years.map((year)=>`<button type="button" class="${year.id===selectedYearId?"active":""}" data-year="${h(year.id)}">${h(year.label)}${year.is_current?" · actuelle":""}</button>`).join("");
    const visible=timetables.filter((tt)=>!selectedYearId||tt.academic_year_id===selectedYearId);
    $("#timetable-history").innerHTML=visible.map((tt)=>`<article class="history-card"><div><span class="status-pill ${h(tt.status)}">${h(tt.status)}</span><small>Version ${tt.version_number} · révision ${tt.revision}</small></div><h3>${h(tt.title)}</h3><p>Valable dès le ${new Date(`${tt.valid_from}T12:00:00`).toLocaleDateString("fr-FR")}${tt.valid_until?` jusqu’au ${new Date(`${tt.valid_until}T12:00:00`).toLocaleDateString("fr-FR")}`:""}</p>${tt.cloned_from_timetable_id?"<small>Créé depuis une version précédente</small>":""}<button type="button" data-open-timetable="${h(tt.id)}">Consulter cette version</button>${canManage()&&tt.status==="draft"?`<div class="publish-row"><input type="date" value="${h(tt.valid_from)}" aria-label="Date de publication"><button type="button" data-publish-timetable="${h(tt.id)}">Publier</button></div>`:""}</article>`).join("") || `<div class="empty-state">Aucune version disponible pour cette année.</div>`;
    $("#clone-timetable-form").hidden=!canManage()||!timetables.length||!years.length;
    if(canManage()&&timetables.length&&years.length){
      $("#clone-source").innerHTML=timetables.map((tt)=>`<option value="${h(tt.id)}">${h(tt.title)} · v${tt.version_number}</option>`).join("");
      $("#clone-year").innerHTML=years.map((year)=>`<option value="${h(year.id)}">${h(year.label)}</option>`).join("");
    }
  }

  function renderRoles() {
    const labels={teacher:"Enseignant",direction:"Direction",admin:"Admin",scheduler:"Planificateur",viewer:"Lecteur"};
    const roleText=roles().map((role)=>labels[role]||role).join(" · ");
    const position=ctx.state.profile?.position_title?.trim();
    const dual=roles().includes("teacher")&&roles().some((role)=>["direction","admin","scheduler","viewer"].includes(role))&&Boolean(ctx.state.profile?.teacher_id);
    if(roleText&&!dual)$("#account-role").textContent=position?`${position} · ${roleText}`:roleText;
    $$('[data-manager-only]').forEach((node)=>{node.hidden=!canManage();});
    $$('[data-system-admin-only]').forEach((node)=>{node.hidden=!ctx.state.profile?.is_system_admin;});
  }

  function setConnectivity() {
    const banner=$("#connectivity-banner");
    if(navigator.onLine){banner.hidden=true;return;}
    const last=JSON.parse(localStorage.getItem(LAST_CONTEXT)||"null");
    banner.hidden=false;banner.textContent=`Hors ligne — dernière synchronisation : ${last?.savedAt?new Date(last.savedAt).toLocaleString("fr-FR"):"indisponible"}`;
  }

  async function switchSchool(schoolId) {
    if (!schoolId || schoolId === ctx.state.platform?.selected_school_id) return;
    const previous = ctx.state.platform?.selected_school_id;
    const controls = [$("#school-switcher"),$("#dashboard-school-switcher")].filter(Boolean);
    controls.forEach((control)=>{control.disabled=true;control.value=schoolId;});
    document.body.classList.add("school-switching");
    ctx.showToast(`Ouverture de ${schoolLabel(schoolId)}…`);
    try {
      const loaded = await ctx.reload({schoolId,force:true});
      if (!loaded || ctx.state.platform?.selected_school_id !== schoolId) throw new Error("Établissement non chargé");
      localStorage.setItem("horaire-pro-school",schoolId);
      localStorage.setItem("horaire-pro-school-confirmed","1");
      $("#school-modal").hidden=true;
      ctx.showToast(`${schoolLabel(schoolId)} activé`);
    } catch(error) {
      controls.forEach((control)=>{control.value=previous||"";});
      ctx.showToast("Impossible de changer d’établissement");
      console.error(error);
    } finally {
      controls.forEach((control)=>{control.disabled=false;});
      document.body.classList.remove("school-switching");
    }
  }
  async function cloneTimetable(event) {
    event.preventDefault(); const status=$("#clone-status");status.textContent="Création…";
    const {error}=await ctx.state.client.rpc("clone_timetable",{p_source_timetable_id:$("#clone-source").value,p_target_academic_year_id:$("#clone-year").value,p_title:$("#clone-title").value.trim()});
    status.textContent=error?error.message:"Nouvelle version créée.";if(!error)await ctx.reload({schoolId:ctx.state.platform.selected_school_id});
  }
  async function openTimetable(timetableId) {
    const key=`${ctx.state.profile.id}:${ctx.state.platform.selected_school_id}:${timetableId}`;
    try {
      const {data,error}=await ctx.state.client.rpc("get_authorized_timetable",{p_timetable_id:timetableId});
      if(error)throw error;await timetablePut({key,savedAt:Date.now(),payload:data});ctx.displayTimetable(data.data,data.timetable);
    } catch(error) {
      const cached=await timetableGet(key);if(cached){ctx.displayTimetable(cached.payload.data,cached.payload.timetable);ctx.showToast("Version hors ligne");}
      else ctx.showToast(error.message||"Version indisponible hors ligne");
    }
  }
  async function publishTimetable(button) {
    if(!confirm("Publier cette version et clôturer la version active à la date choisie ?"))return;
    const validFrom=button.parentElement.querySelector('input[type="date"]').value;
    button.disabled=true;button.textContent="Publication…";
    const {error}=await ctx.state.client.rpc("publish_timetable",{p_timetable_id:button.dataset.publishTimetable,p_valid_from:validFrom,p_valid_until:null});
    if(error){button.disabled=false;button.textContent="Publier";ctx.showToast(error.message);return;}
    await ctx.reload({schoolId:ctx.state.platform.selected_school_id});ctx.showToast("Nouvelle version publiée");
  }
  async function inviteMember(event) {
    event.preventDefault();const status=$("#membership-status");
    const selected=$$('input[name="membership-role"]:checked').map((input)=>input.value);
    if(!selected.length){status.textContent="Sélectionnez au moins un rôle.";return;}
    status.textContent="Invitation…";
    const {error}=await ctx.state.client.functions.invoke("manage-membership",{body:{action:"invite",school_id:ctx.state.platform.selected_school_id,email:$("#membership-email").value.trim(),full_name:$("#membership-name").value.trim(),teacher_ref:$("#membership-teacher-ref").value.trim()||null,position_title:$("#membership-position").value.trim()||null,roles:selected}});
    status.textContent=error?error.message:"Invitation envoyée et adhésion créée.";if(!error){event.target.reset();await ctx.reload({schoolId:ctx.state.platform.selected_school_id});}
  }
  async function createAcademicYear(event) {
    event.preventDefault();const status=$("#academic-year-status");status.textContent="Création…";
    const {error}=await ctx.state.client.rpc("create_academic_year",{
      p_school_id:ctx.state.platform.selected_school_id,p_label:$("#academic-year-label").value.trim(),
      p_start_date:$("#academic-year-start").value,p_end_date:$("#academic-year-end").value,
      p_is_current:$("#academic-year-current").checked,
    });
    status.textContent=error?error.message:"Année scolaire créée.";
    if(!error){event.target.reset();await ctx.reload({schoolId:ctx.state.platform.selected_school_id});}
  }
  async function createSchool(event) {
    event.preventDefault();const status=$("#school-form-status");status.textContent="Création…";
    const label=$("#school-year-label").value.trim();
    const body={action:"create",name:$("#school-name").value.trim(),short_name:$("#school-short-name").value.trim(),address:$("#school-address").value.trim(),
      academic_year:label?{label,start_date:$("#school-year-start").value,end_date:$("#school-year-end").value}:null};
    const {data,error}=await ctx.state.client.functions.invoke("manage-school",{body});
    status.textContent=error?error.message:"Établissement créé.";
    if(!error&&data?.school?.id){event.target.reset();await switchSchool(data.school.id);}
  }

  function openMembership(userId) {
    const member=(ctx.state.data.features?.profiles||[]).find((item)=>item.id===userId);if(!member)return;
    $("#membership-edit-user").value=member.id;$("#membership-edit-id").value=member.membership_id||"";
    $("#membership-edit-name").textContent=member.full_name;$("#membership-edit-teacher").value=member.teacher_id||"";$("#membership-edit-position").value=member.position_title||"";
    const assigned=new Set(member.roles||[]);
    $$('input[name="membership-edit-role"]').forEach((input)=>{input.checked=assigned.has(input.value);});
    $("#membership-edit-status").textContent="";$("#membership-temporary-password").hidden=true;$("#membership-temporary-password-value").textContent="";$("#membership-modal").hidden=false;
  }
  async function saveMembership(event) {
    event.preventDefault();const status=$("#membership-edit-status");const roles=$$('input[name="membership-edit-role"]:checked').map((input)=>input.value);
    if(!roles.length){status.textContent="Sélectionnez au moins un rôle.";return;}
    status.textContent="Enregistrement…";
    const {error}=await ctx.state.client.functions.invoke("manage-membership",{body:{action:"update",school_id:ctx.state.platform.selected_school_id,
      user_id:$("#membership-edit-user").value,teacher_ref:$("#membership-edit-teacher").value.trim()||null,position_title:$("#membership-edit-position").value.trim()||null,roles,status:"active"}});
    status.textContent=error?error.message:"Adhésion mise à jour.";if(!error){$("#membership-modal").hidden=true;await ctx.reload({schoolId:ctx.state.platform.selected_school_id});}
  }
  async function removeMembership() {
    if(!confirm("Retirer cette personne de l’établissement sans supprimer son compte global ?"))return;
    const status=$("#membership-edit-status");status.textContent="Retrait…";
    const {error}=await ctx.state.client.functions.invoke("manage-membership",{body:{action:"remove",school_id:ctx.state.platform.selected_school_id,user_id:$("#membership-edit-user").value,roles:[]}});
    status.textContent=error?error.message:"Personne retirée.";if(!error){$("#membership-modal").hidden=true;await ctx.reload({schoolId:ctx.state.platform.selected_school_id});}
  }

  async function resetMemberPassword() {
    if(!confirm("Créer un mot de passe temporaire pour ce compte ? L’ancien mot de passe cessera immédiatement de fonctionner."))return;
    const status=$("#membership-edit-status"),button=$("#membership-reset-password");status.textContent="Réinitialisation sécurisée…";button.disabled=true;
    const {data,error}=await ctx.state.client.functions.invoke("manage-membership",{body:{action:"reset_password",school_id:ctx.state.platform.selected_school_id,user_id:$("#membership-edit-user").value}});
    button.disabled=false;
    if(error||!data?.temporary_password){status.textContent=error?.message||"Réinitialisation impossible.";return;}
    $("#membership-temporary-password-value").textContent=data.temporary_password;$("#membership-temporary-password").hidden=false;status.textContent="Mot de passe temporaire créé. Copiez-le maintenant : il ne sera plus affiché ensuite.";
  }
  async function copyTemporaryPassword(){const value=$("#membership-temporary-password-value").textContent;if(!value)return;await navigator.clipboard.writeText(value);ctx.showToast("Mot de passe temporaire copié");}

  function render(context) { ctx=context; if(!ctx.state.platform)return; renderSchoolControls();renderAgenda();renderHistory();renderRoles();setConnectivity(); }
  function bind(context) {
    ctx=context;
    $("#school-switcher")?.addEventListener("change",(event)=>switchSchool(event.target.value));
    $("#dashboard-school-switcher")?.addEventListener("change",(event)=>switchSchool(event.target.value));
    $("#school-modal-list")?.addEventListener("click",(event)=>{const button=event.target.closest("[data-choose-school]");if(button)switchSchool(button.dataset.chooseSchool);});
    $("#agenda-prev")?.addEventListener("click",()=>{selectedDate.setDate(selectedDate.getDate()-(weekMode?7:1));renderAgenda();});
    $("#agenda-next")?.addEventListener("click",()=>{selectedDate.setDate(selectedDate.getDate()+(weekMode?7:1));renderAgenda();});
    $("#agenda-today")?.addEventListener("click",()=>{selectedDate=new Date();weekMode=false;renderAgenda();});
    $("#agenda-week")?.addEventListener("click",()=>{weekMode=!weekMode;$("#agenda-week").classList.toggle("active",weekMode);renderAgenda();});
    $("#agenda-school-filter")?.addEventListener("change",renderAgenda);
    $("#year-tabs")?.addEventListener("click",(event)=>{const button=event.target.closest("[data-year]");if(button){selectedYearId=button.dataset.year;renderHistory();}});
    $("#timetable-history")?.addEventListener("click",(event)=>{const open=event.target.closest("[data-open-timetable]");if(open)openTimetable(open.dataset.openTimetable);const publish=event.target.closest("[data-publish-timetable]");if(publish)publishTimetable(publish);});
    $("#clone-timetable-form")?.addEventListener("submit",cloneTimetable);
    $("#membership-form")?.addEventListener("submit",inviteMember);
    $("#academic-year-form")?.addEventListener("submit",createAcademicYear);
    $("#school-form")?.addEventListener("submit",createSchool);
    $("#membership-edit-form")?.addEventListener("submit",saveMembership);
    $("#membership-edit-close")?.addEventListener("click",()=>{$("#membership-modal").hidden=true;});
    $("#membership-remove")?.addEventListener("click",removeMembership);
    $("#membership-reset-password")?.addEventListener("click",resetMemberPassword);
    $("#membership-copy-password")?.addEventListener("click",copyTemporaryPassword);
    window.addEventListener("online",()=>{setConnectivity();ctx.reload({schoolId:ctx.state.platform.selected_school_id,silent:true});});
    window.addEventListener("offline",setConnectivity);
  }

  window.HoraireProPlatform={fetchPayload,loadOffline,render,bind,canManage,openMembership};
})();
