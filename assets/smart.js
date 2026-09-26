(() => {
  "use strict";
  let ctx;
  let installPrompt = null;
  let realtimeStarted = false;
  let lastAnalysis = null;
  const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const PERIODS = ["P1","P2","P3","P4","P5","P6","P7"];
  const DAY_INDEX = Object.fromEntries(DAYS.map((day,index) => [day,index]));
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const h = (value) => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const features = () => ctx.state.data.features || {announcements:[],changes:[],profiles:[],cells:[],audit:[],readAnnouncements:[]};
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();

  function kinshasaDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Africa/Kinshasa",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
    const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function parseISO(value) { const [y,m,d]=value.split("-").map(Number); return new Date(y,m-1,d,12); }
  function datePlus(date, days) { const d=parseISO(date); d.setDate(d.getDate()+days); return kinshasaDate(d); }
  function formatDate(value, options={weekday:"long",day:"numeric",month:"long"}) {
    return new Intl.DateTimeFormat("fr-FR",options).format(parseISO(value));
  }
  function currentWeekDate(day) {
    const today=kinshasaDate(); const current=parseISO(today); const js=current.getDay();
    const mondayOffset=js===0?-6:1-js; return datePlus(today,mondayOffset+(DAY_INDEX[day] ?? 0));
  }
  function readIds() { return new Set((features().readAnnouncements||[]).map(item => item.id)); }
  function activeChanges() { return (features().changes||[]).filter(c => c.status === "published"); }

  function baseEntries(type, owner, day, period) {
    const key=`${day}:${period}`;
    if (type === "class") {
      const entry=ctx.state.data.classSchedule[owner]?.[key]; return entry ? [entry] : [];
    }
    return [...(ctx.state.data.teacherSchedule[owner]?.[key] || [])];
  }
  function scheduleEntries(type, owner, day, period) {
    const targetDate=currentWeekDate(day);
    let entries=baseEntries(type,owner,day,period);
    const relevant=activeChanges().filter(c => c.effective_date===targetDate && (type==="teacher" ? c.teacher_id===owner : c.class_ids.includes(owner)));
    for (const change of relevant) {
      if (change.original_day===day && change.original_period===period) {
        entries=entries.filter(e => e.assignmentId!==change.assignment_id);
      }
      if (change.change_type==="move" && change.new_day===day && change.new_period===period) {
        entries.push({assignmentId:change.assignment_id,course:change.course,teacher:change.teacher_id,classes:change.class_ids,changed:true,reason:change.reason});
      }
    }
    return entries;
  }
  function allEntriesAt(day, period) {
    const seen=new Map();
    for (const teacher of ctx.state.data.teachers) {
      for (const entry of scheduleEntries("teacher",teacher.id,day,period)) seen.set(`${entry.assignmentId}|${teacher.id}`,entry);
    }
    return [...seen.values()];
  }

  function renderFocus() {
    const host=$("#smart-focus"); if (!host) return;
    const live=ctx.liveContext();
    if (!ctx.state.data.days.includes(live.day)) {
      host.innerHTML=`<article class="focus-card focus-main"><span class="focus-icon">☀</span><div><small>École au repos</small><strong>Profitez de votre journée</strong><p>Le prochain programme est disponible dans votre horaire.</p></div></article>`; return;
    }
    if (ctx.isDirector()) {
      const current=live.current; const sessions=current ? allEntriesAt(live.day,current.id) : [];
      const occupied=new Set(sessions.map(x=>x.teacher));
      const changes=activeChanges().filter(c=>c.effective_date===kinshasaDate());
      host.innerHTML=`
        <article class="focus-card focus-main"><span class="focus-icon pulse">◉</span><div><small>École en direct</small><strong>${current ? `${h(live.day)} · ${h(current.id)} · ${h(current.time)}` : "Hors période de cours"}</strong><p>${sessions.length} séances actives · ${occupied.size} enseignants mobilisés</p></div><button data-go="operations">Ouvrir le centre →</button></article>
        <article class="focus-card"><span class="focus-mini-icon">⇄</span><div><small>Changements aujourd’hui</small><strong>${changes.length}</strong><p>${changes.length ? "Suivi requis" : "Aucun changement"}</p></div></article>`;
      host.querySelector('[data-go]')?.addEventListener("click",()=>ctx.setView("operations"));
      return;
    }
    const teacher=ctx.state.profile.teacher_id;
    const periods=ctx.state.data.periods[live.day]||[];
    const lessons=periods.map(p=>({period:p,entries:scheduleEntries("teacher",teacher,live.day,p.id)})).filter(x=>x.entries.length);
    const current=live.current ? lessons.find(x=>x.period.id===live.current.id) : null;
    const minute=Number(live.now.hour)*60+Number(live.now.minute);
    const next=lessons.find(x=>{
      const [hh,mm]=x.period.time.split("-")[0].split(":").map(Number); return hh*60+mm>minute;
    });
    const primary=current||next;
    host.innerHTML=`
      <article class="focus-card focus-main"><span class="focus-icon ${current?"pulse":""}">${current?"▶":"→"}</span><div><small>${current?"En cours maintenant":"Prochain cours"}</small><strong>${primary?h(primary.entries[0].course):"Journée terminée"}</strong><p>${primary?`${h(primary.period.id)} · ${h(primary.period.time)} · ${h(primary.entries[0].classes.join(", "))}`:"Votre prochain programme est visible dans la semaine."}</p></div><button data-go="teachers">Mon horaire →</button></article>
      <article class="focus-card"><span class="focus-mini-icon">◷</span><div><small>Aujourd’hui</small><strong>${lessons.length} cours</strong><p>${42-(ctx.state.data.teachers[0]?.physicalSlots||0)} créneaux libres par semaine</p></div></article>`;
    host.querySelector('[data-go]')?.addEventListener("click",()=>ctx.setView("teachers"));
  }

  function renderDashboardAlerts() {
    const host=$("#dashboard-alerts"); if (!host) return;
    const reads=readIds();
    const unread=(features().announcements||[]).filter(a=>!reads.has(a.id));
    const todayChanges=activeChanges().filter(c=>c.effective_date===kinshasaDate());
    if (!unread.length && !todayChanges.length) { host.innerHTML=""; return; }
    host.innerHTML=`<div class="smart-alert-row">
      ${unread.length?`<button data-open="announcements"><span>◈</span><div><strong>${unread.length} nouvelle${unread.length>1?"s":""} annonce${unread.length>1?"s":""}</strong><small>Consulter les communications</small></div><b>→</b></button>`:""}
      ${todayChanges.length?`<button data-open="${ctx.isDirector()?"changes":"teachers"}"><span>⇄</span><div><strong>${todayChanges.length} changement${todayChanges.length>1?"s":""} aujourd’hui</strong><small>Votre horaire daté est actualisé</small></div><b>→</b></button>`:""}
    </div>`;
    $$('[data-open]',host).forEach(b=>b.addEventListener("click",()=>ctx.setView(b.dataset.open)));
  }

  function renderNotificationCounts() {
    const reads=readIds(); const count=(features().announcements||[]).filter(a=>!reads.has(a.id)).length;
    for (const id of ["#notification-count","#announcement-nav-badge"]) { const el=$(id); if(el){el.textContent=count;el.hidden=!count;} }
  }

  function renderOperations() {
    if (!ctx.isDirector()) return;
    const live=ctx.liveContext(); const current=live.current;
    const sessions=current?allEntriesAt(live.day,current.id):[];
    const occupiedTeachers=new Set(sessions.map(x=>x.teacher));
    const classes=new Set(sessions.flatMap(x=>x.classes));
    const available=ctx.state.data.teachers.filter(t=>!occupiedTeachers.has(t.id));
    const changes=activeChanges().filter(c=>c.effective_date===kinshasaDate());
    $("#operations-kpis").innerHTML=[
      ["◉",sessions.length,"Séances actives"],["♙",occupiedTeachers.size,"Enseignants occupés"],["▦",classes.size,"Classes en cours"],["⇄",changes.length,"Changements du jour"]
    ].map(([i,v,l])=>`<article class="stat-card"><span class="stat-icon">${i}</span><div><strong>${v}</strong><small>${l}</small></div></article>`).join("");
    $("#operations-period").textContent=current?`${live.day} · ${current.id} · ${current.time}`:"Hors cours";
    $("#operations-live-grid").innerHTML=sessions.length?sessions.map(s=>`<article><span>${h(s.course.charAt(0))}</span><div><strong>${h(s.course)}</strong><small>${h(s.teacher)} · ${h(s.classes.join(", "))}</small></div></article>`).join(""):`<div class="empty-state">Aucune séance active en ce moment.</div>`;
    $("#available-teachers").innerHTML=available.length?available.map(t=>`<span>${h(t.id)}</span>`).join(""):`<span>Tous les enseignants sont occupés</span>`;
    $("#operations-timeline").innerHTML=(ctx.state.data.periods[live.day]||[]).map(p=>{const n=allEntriesAt(live.day,p.id).length;return `<div class="timeline-step ${current?.id===p.id?"active":""}"><span>${p.id}</span><i style="--fill:${Math.min(100,n/24*100)}%"></i><strong>${n}</strong><small>${p.time}</small></div>`}).join("");
  }

  function cellLabel(cell) { return `${cell.teacher_id} · ${cell.day} ${cell.period} · ${cell.course} · ${cell.class_ids.join(", ")}`; }
  function fillChangeSources(query="") {
    const select=$("#change-source"); if(!select) return;
    const q=normalize(query); const cells=(features().cells||[]).filter(c=>!q||normalize(cellLabel(c)).includes(q));
    select.innerHTML=cells.slice(0,500).map(c=>`<option value="${h(ctx.state.platform ? c.entry_id : c.id)}">${h(cellLabel(c))}</option>`).join("");
  }
  function renderChangeAnalysis(result) {
    lastAnalysis=result; const box=$("#change-analysis"); const publish=$("#publish-change");
    if(!result){box.innerHTML="";publish.disabled=true;return;}
    if(result.ok){box.innerHTML=`<div class="analysis-success"><span>✓</span><div><strong>Créneau compatible</strong><p>Aucune collision enseignant ou classe détectée.</p></div></div>${result.suggestions?.length?`<div class="suggestions"><small>Autres créneaux compatibles</small>${result.suggestions.slice(0,6).map(s=>`<button type="button" data-slot="${s.day}|${s.period}">${s.day} ${s.period}</button>`).join("")}</div>`:""}`;publish.disabled=false;}
    else {box.innerHTML=`<div class="analysis-error"><span>!</span><div><strong>${result.conflicts.length} collision${result.conflicts.length>1?"s":""} détectée${result.conflicts.length>1?"s":""}</strong>${result.conflicts.map(c=>`<p>${h(c.kind==="teacher"?"Enseignant":"Classe")} · ${h(c.course)} · ${h(c.teacher)} · ${h(c.classes.join(", "))}</p>`).join("")}</div></div><div class="suggestions"><small>Créneaux recommandés</small>${(result.suggestions||[]).slice(0,8).map(s=>`<button type="button" data-slot="${s.day}|${s.period}">${s.day} ${s.period}</button>`).join("")}</div>`;publish.disabled=true;}
    $$('[data-slot]',box).forEach(b=>b.addEventListener("click",()=>{const [d,p]=b.dataset.slot.split("|");$("#change-day").value=d;$("#change-period").value=p;analyzeChange();}));
  }
  async function analyzeChange() {
    const type=$("#change-type").value; const modern=Boolean(ctx.state.platform);
    const params=modern?{
      p_source_entry_id:$("#change-source").value,p_effective_date:$("#change-date").value,p_change_type:type,
      p_new_day_of_week:type==="move"?DAYS.indexOf($("#change-day").value)+1:null,
      p_new_period:type==="move"?$("#change-period").value:null,p_new_room:null
    }:{p_source_cell_id:$("#change-source").value,p_effective_date:$("#change-date").value,p_change_type:type,
      p_new_day:type==="move"?$("#change-day").value:null,p_new_period:type==="move"?$("#change-period").value:null};
    const {data,error}=await ctx.state.client.rpc(modern?"analyze_timetable_change":"analyze_schedule_change",params);
    if(error){ctx.showToast("Analyse impossible");return;} renderChangeAnalysis(data);
  }
  async function submitChange(event) {
    event.preventDefault(); if(!lastAnalysis?.ok)return;
    const type=$("#change-type").value; const button=$("#publish-change");button.disabled=true;button.textContent="Publication…";
    const modern=Boolean(ctx.state.platform);
    const params=modern?{
      p_source_entry_id:$("#change-source").value,p_effective_date:$("#change-date").value,p_change_type:type,
      p_new_day_of_week:type==="move"?DAYS.indexOf($("#change-day").value)+1:null,
      p_new_period:type==="move"?$("#change-period").value:null,p_new_room:null,p_reason:$("#change-reason").value
    }:{p_source_cell_id:$("#change-source").value,p_effective_date:$("#change-date").value,p_change_type:type,
      p_new_day:type==="move"?$("#change-day").value:null,p_new_period:type==="move"?$("#change-period").value:null,p_reason:$("#change-reason").value};
    const {data,error}=await ctx.state.client.rpc(modern?"create_timetable_change":"create_schedule_change",params);
    button.textContent="Publier le changement";
    if(error||!data?.ok){ctx.showToast("Le changement n’a pas été publié");renderChangeAnalysis(data);return;}
    notifyServer("schedule_change",data.change).catch(()=>{});
    ctx.showToast("Changement publié et notifié"); setTimeout(()=>ctx.reload({schoolId:ctx.state.platform?.selected_school_id}),650);
  }
  async function cancelChange(id) {
    if(!confirm("Annuler ce changement publié ?"))return;
    const {error}=await ctx.state.client.rpc(ctx.state.platform?"set_timetable_change_status":"set_schedule_change_status",{p_id:id,p_status:"cancelled"});
    if(error){ctx.showToast("Annulation impossible");return;} await ctx.reload({schoolId:ctx.state.platform?.selected_school_id});
  }
  function renderChanges() {
    if(!ctx.isDirector())return;
    fillChangeSources($("#change-search")?.value||"");
    $("#change-day").innerHTML=DAYS.map(d=>`<option>${d}</option>`).join("");
    $("#change-period").innerHTML=PERIODS.map(p=>`<option>${p}</option>`).join("");
    if(!$("#change-date").value) $("#change-date").value=datePlus(kinshasaDate(),1);
    const list=$("#changes-list"); const changes=(features().changes||[]);
    list.innerHTML=changes.length?changes.map(c=>`<article class="activity-item ${c.status}"><span class="activity-icon">${c.change_type==="move"?"⇄":"×"}</span><div><strong>${h(c.course)} · ${h(c.teacher_id)}</strong><p>${h(c.class_ids.join(", "))}</p><small>${h(formatDate(c.effective_date))} · ${h(c.original_day)} ${h(c.original_period)} ${c.change_type==="move"?`→ ${h(c.new_day)} ${h(c.new_period)}`:"· Annulé"}${c.reason?` · ${h(c.reason)}`:""}</small></div><span class="status-tag">${h(c.status)}</span>${c.status==="published"?`<button data-cancel-change="${c.id}" title="Annuler">×</button>`:""}</article>`).join(""):`<div class="empty-state">Aucun changement publié.</div>`;
    $$('[data-cancel-change]',list).forEach(b=>b.addEventListener("click",()=>cancelChange(b.dataset.cancelChange)));
  }

  async function markRead(id) {
    const {error}=await ctx.state.client.rpc("mark_announcement_read",{p_id:id}); if(error)return;
    features().readAnnouncements.push({id}); renderAnnouncements();renderNotificationCounts();
  }
  function renderAnnouncements() {
    const host=$("#announcements-list"); if(!host)return; const reads=readIds();
    const items=features().announcements||[];
    host.innerHTML=items.length?items.map(a=>`<article class="announcement-card ${a.level} ${reads.has(a.id)?"read":"unread"}"><div class="announcement-top"><span>${a.level==="urgent"?"!":a.level==="important"?"◆":"i"}</span><div><small>${h(a.level)} · ${new Date(a.published_at).toLocaleDateString("fr-FR")}</small><h3>${h(a.title)}</h3></div>${!reads.has(a.id)?'<i>Nouveau</i>':''}</div><p>${h(a.body)}</p><div class="announcement-footer"><span>${h(a.audience==="all"?"Tout le personnel":a.audience==="teachers"?"Enseignants":"Direction")}</span>${!reads.has(a.id)?`<button data-read="${a.id}">Marquer comme lu</button>`:'<span>✓ Lu</span>'}</div></article>`).join(""):`<div class="empty-state">Aucune annonce en cours.</div>`;
    $$('[data-read]',host).forEach(b=>b.addEventListener("click",()=>markRead(b.dataset.read)));
  }
  async function publishAnnouncement(event) {
    event.preventDefault(); const audience=$("#announcement-audience").value; const specific=audience==="teacher";
    const params={p_title:$("#announcement-title").value,p_body:$("#announcement-body").value,p_level:$("#announcement-level").value,
      p_audience:specific?"teachers":audience,p_teacher_ids:specific?[$("#announcement-teacher").value]:[],p_expires_at:null};
    if(ctx.state.platform){params.p_school_id=ctx.state.platform.selected_school_id;params.p_timetable_id=ctx.state.activeTimetable?.id||null;}
    const {data,error}=await ctx.state.client.rpc(ctx.state.platform?"publish_school_announcement":"publish_announcement",params);
    if(error){ctx.showToast("Publication impossible");return;} notifyServer("announcement",data).catch(()=>{});event.target.reset();ctx.showToast("Annonce publiée");setTimeout(()=>ctx.reload({schoolId:ctx.state.platform?.selected_school_id}),500);
  }

  function assistantAnswer(query) {
    const q=normalize(query); const day=DAYS.find(d=>q.includes(normalize(d))); const period=PERIODS.find(p=>q.includes(p.toLowerCase()));
    const teacher=ctx.state.data.teachers.find(t=>q.includes(normalize(t.id)) || normalize(t.id).split(" ").some(part=>part.length>4&&q.includes(part)));
    const klass=ctx.state.data.classes.find(c=>q.includes(normalize(c.id)));
    if(q.includes("prochain") || q.includes("maintenant")) {
      const live=ctx.liveContext(); const owner=ctx.isDirector()?(teacher?.id||ctx.state.selectedTeacher):ctx.state.profile.teacher_id;
      if(!owner)return "Précisez le nom de l’enseignant.";
      const periods=ctx.state.data.periods[live.day]||[]; const minute=Number(live.now.hour)*60+Number(live.now.minute);
      for(const p of periods){const [hh,mm]=p.time.split("-")[0].split(":").map(Number);const entries=scheduleEntries("teacher",owner,live.day,p.id);if(entries.length&&(q.includes("maintenant")?live.current?.id===p.id:hh*60+mm>minute))return `${owner} : ${entries[0].course}, ${live.day} ${p.id} (${p.time}), avec ${entries[0].classes.join(", ")}.`;}
      return `Aucun autre cours trouvé aujourd’hui pour ${owner}.`;
    }
    if(q.includes("libre") && day && period && ctx.isDirector()) {
      const free=ctx.state.data.teachers.filter(t=>scheduleEntries("teacher",t.id,day,period).length===0).map(t=>t.id);
      return `${free.length} enseignant${free.length>1?"s":""} libre${free.length>1?"s":""} ${day} ${period} : ${free.join(", ") || "aucun"}.`;
    }
    if((q.includes("ou ")||q.includes("où")||q.includes("horaire")||q.includes("cours")) && day && period) {
      if(teacher){const e=scheduleEntries("teacher",teacher.id,day,period);return e.length?`${teacher.id} enseigne ${e.map(x=>x.course).join(" et ")} à ${e.flatMap(x=>x.classes).join(", ")} le ${day} ${period}.`:`${teacher.id} est disponible le ${day} ${period}.`;}
      if(klass&&ctx.isDirector()){const e=scheduleEntries("class",klass.id,day,period);return e.length?`${klass.id} a ${e[0].course} avec ${e[0].teacher} le ${day} ${period}.`:`${klass.id} est libre le ${day} ${period}.`;}
    }
    if(q.includes("charge") && teacher) return `${teacher.id} assure ${teacher.hours} heures pédagogiques sur ${teacher.physicalSlots} créneaux physiques.`;
    const courseMatches=[]; for(const t of ctx.state.data.teachers){for(const [slot,entries] of Object.entries(ctx.state.data.teacherSchedule[t.id]||{})){for(const e of entries){if(normalize(e.course).includes(q)&&!courseMatches.some(x=>x.assignmentId===e.assignmentId&&x.slot===slot))courseMatches.push({...e,slot});}}}
    if(courseMatches.length)return courseMatches.slice(0,6).map(e=>`${e.course} · ${e.teacher} · ${e.classes.join(", ")} · ${e.slot.replace(":"," ")}`).join("\n");
    return "Je n’ai pas compris entièrement. Essayez « mon prochain cours », « qui est libre mardi P5 ? » ou « où est Yves jeudi P3 ? »";
  }
  function addAssistantMessage(role,text){const host=$("#assistant-messages");const article=document.createElement("div");article.className=`assistant-message ${role}`;article.innerHTML=`<span>${role==="bot"?"✦":"Vous"}</span><p>${h(text).replaceAll("\n","<br>")}</p>`;host.appendChild(article);host.scrollTop=host.scrollHeight;}
  function askAssistant(event){event.preventDefault();const input=$("#assistant-query");const query=input.value.trim();if(!query)return;addAssistantMessage("user",query);input.value="";setTimeout(()=>addAssistantMessage("bot",assistantAnswer(query)),220);}
  function renderAssistant(){const suggestions=ctx.isDirector()?["Qui est libre mardi P5 ?","Où est Yves jeudi P3 ?","Charge de Daniel Kikunda","Cours de Français"]:["Mon prochain cours","Mon cours maintenant","Mon horaire lundi","Cours de Français"];$("#assistant-suggestions").innerHTML=suggestions.map(x=>`<button type="button">${h(x)}</button>`).join("");$$('button',$("#assistant-suggestions")).forEach(b=>b.addEventListener("click",()=>{$("#assistant-query").value=b.textContent;$("#assistant-form").requestSubmit();}));}

  function barRows(items,max){const ceiling=Math.max(1,max||0);return items.map(({label,value,meta})=>`<div class="bar-row"><div><strong>${h(label)}</strong><small>${h(meta||`${value} h`)}</small></div><i><span style="width:${Math.max(3,value/ceiling*100)}%"></span></i><b>${value}</b></div>`).join("");}
  function renderStats(){if(!ctx.isDirector())return;const teachers=[...ctx.state.data.teachers].sort((a,b)=>b.hours-a.hours);const avg=teachers.length?(teachers.reduce((s,t)=>s+t.hours,0)/teachers.length).toFixed(1):"0.0";const grouped=new Set((features().cells||[]).filter(c=>c.class_ids.length>1).map(c=>c.assignment_id)).size;$("#stats-kpis").innerHTML=[["♙",avg,"Charge moyenne"],["▲",teachers[0]?.hours||0,"Charge maximale"],["◫",grouped,"Cours groupés"],["✓",ctx.state.data.meta.classCount,"Classes suivies"]].map(([i,v,l])=>`<article class="stat-card"><span class="stat-icon">${i}</span><div><strong>${v}</strong><small>${l}</small></div></article>`).join("");$("#teacher-load-chart").innerHTML=teachers.length?barRows(teachers.map(t=>({label:t.id,value:t.hours})),Math.max(...teachers.map(t=>t.hours))):`<div class="empty-state">Aucun enseignant dans cet horaire.</div>`;const days=DAYS.map(day=>({label:day,value:new Set((features().cells||[]).filter(c=>c.day===day).map(c=>`${c.assignment_id}|${c.period}`)).size,meta:"séances physiques"}));$("#day-load-chart").innerHTML=barRows(days,Math.max(...days.map(d=>d.value)));}

  function renderAccounts(filter=""){if(!ctx.isDirector())return;const q=normalize(filter);const profiles=(features().profiles||[]).filter(p=>!q||normalize(`${p.full_name} ${p.username} ${(p.roles||[p.role]).join(" ")}`).includes(q));$("#account-summary").textContent=`${profiles.filter(p=>p.is_active).length} actifs · ${profiles.filter(p=>!p.is_active).length} suspendus`;$("#accounts-table").innerHTML=`<div class="account-table-head"><span>Compte</span><span>Identifiant</span><span>Rôles</span><span>État</span><span>Actions</span></div>${profiles.map(p=>`<div class="account-table-row"><span><i>${h(p.full_name.charAt(0))}</i><strong>${h(p.full_name)}</strong></span><code>${h(p.username)}</code><span>${h((p.roles||[p.role]).join(" · "))}</span><b class="${p.is_active?"active":"suspended"}">${p.is_active?"Actif":"Suspendu"}</b><span class="account-actions"><button data-profile="${p.id}" data-membership="${p.membership_id||""}" data-roles="${h((p.roles||[p.role]).join(","))}" data-teacher="${h(p.teacher_id||"")}" data-active="${p.is_active}">${p.is_active?"Suspendre":"Réactiver"}</button>${ctx.state.platform?`<button data-edit-profile="${p.id}">Gérer</button>`:""}</span></div>`).join("")}`;$$('[data-profile]',$("#accounts-table")).forEach(b=>b.addEventListener("click",()=>toggleAccount(b.dataset,b.dataset.active!=="true")));$$('[data-edit-profile]',$("#accounts-table")).forEach(b=>b.addEventListener("click",()=>window.HoraireProPlatform?.openMembership(b.dataset.editProfile)));}
  async function toggleAccount(profile,active){const modern=Boolean(ctx.state.platform&&profile.membership);const {error}=modern
    ?await ctx.state.client.rpc("set_membership_state",{p_membership_id:profile.membership,p_status:active?"active":"disabled",p_roles:profile.roles.split(",").filter(Boolean),p_teacher_ref:profile.teacher||null})
    :await ctx.state.client.rpc("set_profile_active",{p_profile_id:profile.profile,p_active:active});
    if(error){ctx.showToast(error.message);return;}await ctx.reload({schoolId:ctx.state.platform?.selected_school_id});}
  function renderAudit(){if(!ctx.isDirector())return;const list=$("#audit-list");const items=features().audit||[];list.innerHTML=items.length?items.map(x=>`<article class="activity-item"><span class="activity-icon">✓</span><div><strong>${h(x.actor)} · ${h(x.event_type)}</strong><p>${h(x.entity_type)}</p><small>${new Date(x.created_at).toLocaleString("fr-FR")}</small></div></article>`).join(""):`<div class="empty-state">Le journal se remplira avec les actions de la Direction.</div>`;}

  function icsEscape(value){return String(value).replaceAll("\\","\\\\").replaceAll(",","\\,").replaceAll(";","\\;").replaceAll("\n","\\n");}
  function exportCalendar(){const teacher=ctx.isDirector()?(ctx.state.selectedTeacher||ctx.state.data.teachers[0].id):ctx.state.profile.teacher_id;const schedule=ctx.state.data.teacherSchedule[teacher]||{};let lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//CAT//Smart Horaire//FR","CALSCALE:GREGORIAN","X-WR-CALNAME:"+icsEscape(`CAT · ${teacher}`)];const startMonday=parseISO(currentWeekDate("Lundi"));for(let week=0;week<16;week++){for(const [slot,entries] of Object.entries(schedule)){const [day,period]=slot.split(":");const p=ctx.state.data.periods[day].find(x=>x.id===period);if(!p)continue;const date=new Date(startMonday);date.setDate(date.getDate()+week*7+DAY_INDEX[day]);const ds=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}`;const [start,end]=p.time.split("-").map(t=>t.replace(":",""));for(const e of entries){lines.push("BEGIN:VEVENT",`UID:${icsEscape(e.assignmentId)}-${ds}-${period}@cat-horaire`,`DTSTART;TZID=Africa/Kinshasa:${ds}T${start}00`,`DTEND;TZID=Africa/Kinshasa:${ds}T${end}00`,`SUMMARY:${icsEscape(e.course)}`,`DESCRIPTION:${icsEscape(e.classes.join(", "))}`,"END:VEVENT");}}}lines.push("END:VCALENDAR");const blob=new Blob([lines.join("\r\n")],{type:"text/calendar;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`CAT_${teacher.replaceAll(" ","_")}.ics`;a.click();URL.revokeObjectURL(a.href);ctx.showToast("Calendrier téléchargé");}
  async function changePassword(event){event.preventDefault();const a=$("#new-password").value,b=$("#confirm-password").value,status=$("#password-status");if(a!==b){status.textContent="Les mots de passe ne correspondent pas.";return;}const {error}=await ctx.state.client.auth.updateUser({password:a});status.textContent=error?error.message:"Mot de passe mis à jour.";status.classList.toggle("success",!error);if(!error)event.target.reset();}

  function vapidBytes(value){const padding="=".repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
  async function subscribePush(){const vapid=window.CAT_CONFIG?.vapidPublicKey;if(!vapid||!("serviceWorker" in navigator))return;const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(vapid)});const json=subscription.toJSON();await ctx.state.client.from("push_subscriptions").upsert({user_id:ctx.state.profile.id,endpoint:subscription.endpoint,p256dh:json.keys.p256dh,auth_key:json.keys.auth,user_agent:navigator.userAgent,updated_at:new Date().toISOString()},{onConflict:"endpoint"});}
  async function enableNotifications(){if(!("Notification" in window)){ctx.showToast("Notifications non prises en charge");return;}const permission=await Notification.requestPermission();if(permission==="granted")await subscribePush();ctx.showToast(permission==="granted"?"Notifications activées":"Autorisation refusée");}
  async function notifyServer(kind,payload){const {error}=await ctx.state.client.functions.invoke("send-push",{body:{kind,payload,school_id:ctx.state.platform?.selected_school_id||null}});if(error)console.warn("Push différé",error.message);}
  function browserNotify(title,body){if("Notification" in window&&Notification.permission==="granted")new Notification(title,{body,icon:"assets/favicon.svg"});}
  function startRealtime(){if(realtimeStarted)return;realtimeStarted=true;const selected=ctx.state.platform?.selected_school_id;const scoped=selected?{filter:`school_id=eq.${selected}`}:{ };ctx.state.client.channel("horaire-pro-private").on("postgres_changes",{event:"INSERT",schema:"public",table:"announcements",...scoped},payload=>{browserNotify("Nouvelle annonce Horaire Pro",payload.new.title||"Une annonce vient d’être publiée");setTimeout(()=>ctx.reload({schoolId:selected,silent:true}),900);}).on("postgres_changes",{event:"INSERT",schema:"public",table:"schedule_changes",...scoped},payload=>{browserNotify("Horaire actualisé",`${payload.new.course||"Un cours"} a été modifié.`);setTimeout(()=>ctx.reload({schoolId:selected,silent:true}),900);}).subscribe();}
  async function installApp(){if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}ctx.showToast("Utilisez le menu du navigateur puis « Installer l’application »");}
  function cacheTeacherData(){if(ctx.isDirector())return;try{localStorage.setItem("cat-offline-last",ctx.state.profile.username);localStorage.setItem(`cat-offline-v2:${ctx.state.profile.username}`,JSON.stringify({savedAt:Date.now(),profile:ctx.state.profile,data:ctx.state.data}));}catch{}}
  function loadOffline(username){try{const key=username||localStorage.getItem("cat-offline-last");return key?JSON.parse(localStorage.getItem(`cat-offline-v2:${key}`)):null;}catch{return null;}}

  function renderSettings(){$("#settings-avatar").textContent=ctx.state.profile.full_name.charAt(0);$("#settings-name").textContent=ctx.state.profile.full_name;$("#settings-role").textContent=ctx.isDirector()?"Direction · accès complet":"Enseignant · accès personnel";}
  function exportStats(){const rows=[["Enseignant","Charge pédagogique","Créneaux physiques"],...ctx.state.data.teachers.map(t=>[t.id,t.hours,t.physicalSlots])];const blob=new Blob(["\ufeff"+rows.map(r=>r.join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="CAT_statistiques_enseignants.csv";a.click();URL.revokeObjectURL(a.href);}

  function render(context){ctx=context;renderFocus();renderDashboardAlerts();renderNotificationCounts();renderOperations();renderChanges();renderAnnouncements();renderAssistant();renderStats();renderAccounts();renderAudit();renderSettings();cacheTeacherData();startRealtime();}
  function bind(context){ctx=context;
    window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;$("#install-app-button")?.classList.add("ready");});
    $("#install-app-button")?.addEventListener("click",installApp);$("#settings-install")?.addEventListener("click",installApp);$("#enable-notifications")?.addEventListener("click",enableNotifications);$("#notification-button")?.addEventListener("click",()=>ctx.setView("announcements"));
    $("#change-search")?.addEventListener("input",e=>fillChangeSources(e.target.value));$("#change-type")?.addEventListener("change",e=>{$$('[data-move-field]').forEach(x=>x.hidden=e.target.value==="cancel");renderChangeAnalysis(null);});$("#analyze-change")?.addEventListener("click",analyzeChange);$("#change-form")?.addEventListener("submit",submitChange);
    $("#announcement-audience")?.addEventListener("change",e=>$("#announcement-teacher-wrap").hidden=e.target.value!=="teacher");$("#announcement-form")?.addEventListener("submit",publishAnnouncement);$("#assistant-form")?.addEventListener("submit",askAssistant);$("#account-search")?.addEventListener("input",e=>renderAccounts(e.target.value));$("#password-form")?.addEventListener("submit",changePassword);$("#export-calendar")?.addEventListener("click",exportCalendar);$("#export-stats")?.addEventListener("click",exportStats);
  }

  window.CATSmart={render,bind,scheduleEntries,loadOffline,kinshasaDate};
})();
