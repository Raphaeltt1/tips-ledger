
(function(){
"use strict";
// DEMO ONLY: fictional in-memory data, no network requests or persistence.
const people=[
{id:"su",name:"Raphael",role:"superuser",active:true,rate:null},
{id:"ad",name:"Lea Mansour",role:"admin",active:true,rate:null},
{id:"mg",name:"Omar Haddad",role:"manager",active:true,rate:null},
{id:"mg2",name:"Talia Nassar",role:"manager",active:true,rate:null},
{id:"r1",name:"Maya Salem",role:"runner",active:true,rate:4.5},
{id:"r2",name:"Nour Farah",role:"runner",active:true,rate:4.25},
{id:"r3",name:"Samir Karam",role:"runner",active:true,rate:4.75},
{id:"r4",name:"Dina Khalil",role:"runner",active:true,rate:4.2},
{id:"r5",name:"Jad Youssef",role:"runner",active:false,rate:4}
];
let payments=[
["r1","2026-10-26",38,720,55,"received"],
["r2","2026-10-26",36,580,0,"published"],
["r3","2026-10-26",40,680,50,"received"],
["r4","2026-10-26",30,425,20,"draft"],
["r1","2026-10-19",37,670,40,"received"],
["r2","2026-10-19",40,635,0,"received"],
["r3","2026-10-19",36,590,25,"received"],
["r4","2026-10-19",32,470,0,"received"],
["r1","2026-10-12",39,545,0,"received"],
["r2","2026-10-12",35,595,45,"received"],
["r3","2026-10-12",35,605,0,"received"],
["r1","2026-10-05",41,610,60,"received"],
["r2","2026-10-05",36,550,15,"received"],
["r1","2026-09-28",34,520,0,"received"],
["r3","2026-09-28",37,640,30,"received"],
["r1","2026-09-21",38,485,20,"received"],
["r4","2026-09-21",31,455,0,"received"]
].map((a,i)=>({id:"p"+i,runnerId:a[0],week:a[1],hours:a[2],tips:a[3],advance:a[4],status:a[5],rate:people.find(p=>p.id===a[0]).rate}));
const acts=["payment.published","payment.receipt_confirmed","payment.draft_created","hourly_rate.update","employee.activated","payment.edited","employee.created","employee.deactivated"];
let audit=Array.from({length:37},(_,i)=>({id:"a"+i,date:new Date(Date.UTC(2026,9,31,9,0)-i*43200000).toISOString(),actorId:["su","ad","mg","su","ad","mg","su","ad"][i%8],targetId:["r2","r1","r4","r3","r5","r2","r4","mg2"][i%8],action:acts[i%8],note:"Sample activity · fictional data"}));
let notifications=[
{id:1,title:"Payment confirmed",body:"Maya Salem confirmed her weekly payment.",read:false},
{id:2,title:"Payment published",body:"Nour Farah's weekly payment was published.",read:false},
{id:3,title:"Rate updated",body:"A sample hourly rate was updated.",read:true}
];
const personas={superuser:"su",admin:"ad",manager:"mg",runner:"r1"};
let role="superuser",page="home",statusFilter="",auditLimit=10,sheetMode="",sheetId="",graphRange=6,tableMode=false,timer=0;
const $=id=>document.getElementById(id);
const person=id=>people.find(p=>p.id===id);
const self=()=>person(personas[role]);
const roleName=r=>({superuser:"Superuser",admin:"Admin",manager:"Manager",runner:"Runner"}[r]||r);
const money=n=>"$"+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ico=(name,extra="")=>'<svg class="i '+extra+'" aria-hidden="true"><use href="#ic-'+name+'"></use></svg>';
const initials=s=>String(s).split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
const day=s=>new Date(s+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
const privileged=()=>role==="superuser"||role==="admin";
const canManage=p=>!!p&&p.id!==self().id&&(role==="superuser"?["admin","manager","runner"].includes(p.role):role==="admin"?["manager","runner"].includes(p.role):false);
const visiblePayment=p=>role!=="runner"||(p.runnerId===self().id&&p.status!=="draft");
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(timer);timer=setTimeout(()=>$("toast").classList.remove("show"),2900)}
function go(where){
 if((where==="team"||where==="audit")&&!privileged()){toast("This screen is unavailable to "+roleName(role)+".");return}
 page=where;
 document.querySelectorAll(".screen-page").forEach(x=>x.classList.toggle("active",x.id==="screen-"+where));
 document.querySelectorAll(".nav-item").forEach(x=>{let on=x.dataset.page===where;x.classList.toggle("active",on);if(on)x.setAttribute("aria-current","page");else x.removeAttribute("aria-current")});
 $("scroller").scrollTop=0;
}
function pushAudit(action,id,note){audit.unshift({id:"new"+Date.now(),date:new Date().toISOString(),actorId:self().id,targetId:id,action,note:note||"Sample change"});auditLimit=10}
function paymentStatus(p){return p.status[0].toUpperCase()+p.status.slice(1)}
function cardPayment(p,compact=false){
 const remaining=p.tips-p.advance,runner=person(p.runnerId);
 let buttons="";
 if(!compact){
  if(role==="runner"&&p.status==="published")buttons='<button class="btn-primary brand-btn btn-small" data-act="confirm" data-id="'+p.id+'">'+ico("check-circle","sm")+' Confirm payment received</button>';
  if(role!=="runner"&&p.status==="draft")buttons='<button class="btn-primary brand-btn btn-small" data-act="publish" data-id="'+p.id+'">'+ico("send","sm")+' Publish payment</button>';
  if(privileged()&&p.status!=="received")buttons+='<button class="btn-soft btn-small" data-act="edit" data-id="'+p.id+'">'+ico("edit","sm")+' Edit</button>';
 }
 return '<article class="payment-card"><div class="payment-head"><div class="row" style="align-items:start"><span class="payment-icon">'+ico("receipt")+'</span><div><div class="payment-name">'+esc(role==="runner"?"My payout":runner?runner.name:"Former Runner")+'</div><div class="payment-date">Week of '+day(p.week)+' · '+p.hours+' hours</div></div></div><span class="pill '+p.status+'"><i></i>'+paymentStatus(p)+'</span></div><div class="row space"><div><span class="small-sub">Remaining tips</span><div class="payment-amount">'+money(remaining)+'</div></div><div style="text-align:right"><span class="small-sub">Rate at time</span><div class="payment-name" style="margin-top:4px">'+money(p.rate)+'/hr</div></div></div>'+(!compact?'<div class="payment-separator"></div><div class="payment-breakdown"><div><span>Tips</span><strong>'+money(p.tips)+'</strong></div><div><span>Advance</span><strong>'+money(p.advance)+'</strong></div><div><span>Hours</span><strong>'+p.hours+'</strong></div></div>':"")+(buttons?'<div class="payment-actions">'+buttons+'</div>':"")+'</article>';
}
function chart(){
 const groups={};payments.filter(p=>p.status!=="draft"&&(role!=="runner"||p.runnerId===self().id)).forEach(p=>groups[p.week]=(groups[p.week]||0)+p.tips);
 const data=Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).slice(-graphRange);
 if(!data.length)return "";
 const high=Math.max(...data.map(x=>x[1]))*1.15;
 const points=data.map((x,i)=>[data.length===1?175:38+290*i/(data.length-1),139-120*x[1]/high,x[0]]);
 const path=points.length===1?"M "+(points[0][0]-14)+" "+points[0][1]+" h28":"M "+points.map(p=>p[0]+" "+p[1]).join(" L ");
 const area=points.length>1?'<path fill="var(--teal-light)" d="'+path+" L "+points.at(-1)[0]+" 139 L "+points[0][0]+' 139 Z"/>':"";
 const marks=points.map(p=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4.2" stroke="var(--paper)" stroke-width="2" fill="var(--svg-line)"/>').join("");
 const labels=points.map(p=>'<text class="graph-axis" x="'+p[0]+'" y="160" text-anchor="middle">'+day(p[2])+"</text>").join("");
 return '<div class="card graph-card"><div class="row space"><div><div class="page-overline">PERFORMANCE</div><h2 class="section-title">'+(role==="runner"?"Your tips trend":"Weekly tips trend")+'</h2></div><span class="pill received">'+ico("chart","sm")+' Published</span></div><div class="row space" style="margin:10px 0"><span class="small-sub">Tips before advances</span><button class="btn-quiet" data-act="graphRange">'+(graphRange===6?"Last 6 weeks":"All weeks")+" "+ico("chevron-down","sm")+'</button></div><svg class="graph-svg" viewBox="0 0 350 168" role="img" aria-label="Sample weekly published tips line graph"><path class="graph-grid" d="M38 139H328M38 79H328M38 19H328"/>'+area+'<path class="chart-line" d="'+path+'"/>'+marks+labels+'</svg><div class="small-sub" style="text-align:center;padding:4px 0 10px">Real trend lines connect actual published weeks only.</div></div>';
}
function renderHome(){
 const last=payments.filter(p=>visiblePayment(p)&&p.week==="2026-10-26");
 const net=last.reduce((sum,p)=>sum+p.tips-p.advance,0);
 const published=last.filter(p=>p.status!=="draft"),received=last.filter(p=>p.status==="received"),pending=last.filter(p=>p.status==="published");
 const pc=published.length?Math.round(100*received.length/published.length):0;
 const runner=role==="runner";
 let out='<div class="hero"><div class="hero-row"><span class="micro">'+(runner?"YOUR WEEKLY TIPS":"THIS WEEK'S TEAM TIPS")+'</span><span class="hero-pill">Week of Oct 26</span></div><div class="value">'+money(net)+'</div><div class="hero-row"><span class="small-white">Tips after advances</span><span class="hero-pill">'+(runner?"Your payment summary":received.length+" of "+published.length+" receipts confirmed")+'</span></div><div class="progress-track"><span style="width:'+pc+'%"></span></div><div class="small-white">'+(runner?"Based on your published payments":pc+"% of published payments received")+'</div></div>';
 const metrics=runner?[["Hours worked",last[0]?last[0].hours:"—","Latest published week","clock"],["Hourly rate",money(self().rate),"Read-only for Runners","wallet"]]:[["Awaiting receipt",pending.length,"Published but unconfirmed","clock"],["Active runners",people.filter(p=>p.role==="runner"&&p.active).length,"Sample team members","users"]];
 out+='<div class="metrics-two">'+metrics.map(m=>'<div class="metric-tile"><div class="icon-box">'+ico(m[3])+'</div><div class="label">'+m[0]+'</div><div class="value">'+m[1]+'</div><span class="caption">'+m[2]+'</span></div>').join("")+'</div>';
 out+='<div class="heading-row section-gap"><h2 class="section-title">Quick actions</h2><span class="demo-only">Tap to try</span></div><div class="quick-row">';
 let quick=runner?[["My payments","wallet","page","payments"],["My account","user","page","profile"],["Notifications","bell","act","notifications"]]:[["New draft","plus","act","newDraft"],["Pending","clock","act","pending"],[privileged()?"Audit log":"Payments",privileged()?"activity":"wallet","page",privileged()?"audit":"payments"]];
 out+=quick.map(q=>'<button class="quick" '+(q[2]==="page"?'data-page="':'data-act="')+q[3]+'"><span class="quick-ico">'+ico(q[1])+'</span>'+q[0]+'</button>').join("")+'</div><div class="section-gap">'+chart()+'</div>';
 out+='<div class="heading-row section-gap"><h2 class="section-title">'+(runner?"My latest payments":"Recent payments")+'</h2><button class="btn-quiet" data-page="payments">See all '+ico("arrow-right","sm")+'</button></div>';
 const recent=payments.filter(visiblePayment).sort((a,b)=>b.week.localeCompare(a.week)).slice(0,2);
 out+='<div class="stack">'+recent.map(p=>cardPayment(p,true)).join("")+'</div>';
 if(!runner)out+='<p class="section-note section-gap">Draft payments stay hidden from Runners until published. Published payouts can be confirmed by the Runner.</p>';
 $("homeContent").innerHTML=out;
}
function renderPayments(){
 const runners=people.filter(p=>p.role==="runner"),old=$("paymentRunner").value;
 $("paymentRunner").innerHTML='<option value="">All runners</option>'+runners.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join("");
 if(runners.some(p=>p.id===old))$("paymentRunner").value=old;
 const all=payments.filter(visiblePayment),pending=all.filter(p=>p.status==="published").length,drafts=all.filter(p=>p.status==="draft").length;
 $("paymentTopSummary").innerHTML='<div class="split-banner" style="margin-top:16px"><div><strong>'+all.length+' payment records</strong><small>'+pending+' awaiting receipt'+(role==="runner"?"":" · "+drafts+" drafts")+'</small></div><span class="setting-icon">'+ico("wallet")+'</span></div>';
 const from=$("paymentFrom").value,to=$("paymentTo").value,rid=$("paymentRunner").value;
 const filtered=all.filter(p=>(!statusFilter||p.status===statusFilter)&&(!from||p.week>=from)&&(!to||p.week<=to)&&(role==="runner"||!rid||rid===p.runnerId)).sort((a,b)=>b.week.localeCompare(a.week));
 $("paymentsCount").textContent=filtered.length+" matching";
 document.querySelectorAll("[data-status]").forEach(b=>b.classList.toggle("selected",b.dataset.status===statusFilter));
 if(!filtered.length){$("paymentList").innerHTML='<div class="empty">'+ico("search")+'<strong>No matching payments</strong><p>Try another status, date or runner.</p></div>';return}
 if(tableMode){
  $("paymentList").innerHTML='<div class="card" style="overflow:auto"><table style="width:100%;min-width:560px;border-collapse:collapse;font-size:11px"><thead><tr><th>Week</th><th>Runner</th><th>Tips</th><th>Advance</th><th>Remaining</th><th>Status</th></tr></thead><tbody>'+filtered.map(p=>'<tr><td>'+day(p.week)+'</td><td>'+esc(person(p.runnerId)?.name||"—")+'</td><td>'+money(p.tips)+'</td><td>'+money(p.advance)+'</td><td>'+money(p.tips-p.advance)+'</td><td>'+paymentStatus(p)+'</td></tr>').join("")+'</tbody></table></div><button class="btn-soft" data-act="viewToggle">Switch to cards</button>';
 }else $("paymentList").innerHTML=filtered.map(p=>cardPayment(p)).join("")+'<button class="btn-soft" data-act="viewToggle" style="justify-content:center">'+ico("activity","sm")+' Switch to table view</button>';
}


function renderTeam(){
 if(!privileged())return;
 const targets=people.filter(canManage),text=$("teamSearch").value.trim().toLowerCase();
 const filtered=targets.filter(p=>p.name.toLowerCase().includes(text)||p.role.includes(text));
 const active=people.filter(p=>p.role==="runner"&&p.active).length;
 $("teamStats").innerHTML='<div class="metrics-two"><div class="metric-tile"><div class="label">Active Runners</div><div class="value">'+active+'</div><span class="caption">Eligible for weekly tips</span></div><div class="metric-tile"><div class="label">Manageable accounts</div><div class="value">'+targets.length+'</div><span class="caption">'+roleName(role)+' permissions</span></div></div>';
 $("teamCount").textContent=filtered.length+" team members";
 $("teamList").innerHTML=filtered.length?filtered.map(p=>'<div class="person-row"><div class="avatar">'+initials(p.name)+'</div><div class="person-data"><div class="person-name">'+esc(p.name)+'</div><div class="person-meta">'+roleName(p.role)+(p.role==="runner"?" · "+money(p.rate)+"/hr":"")+'</div><div class="actions"><button class="btn-soft btn-small" data-act="manage" data-id="'+p.id+'">Manage '+ico("chevron-right","sm")+'</button>'+(p.role==="runner"?'<button class="btn-quiet" data-act="rate" data-id="'+p.id+'">Edit rate</button>':"")+'</div></div><div class="right"><span class="pill '+(p.active?"active":"inactive")+'"><i></i>'+(p.active?"Active":"Inactive")+'</span></div></div>').join(""):'<div class="empty">'+ico("users")+'<strong>No matches</strong><p>Try a different name or role.</p></div>';
}
const actionNames={"employee.created":"Employee created","employee.activated":"Employee activated","employee.deactivated":"Employee deactivated","employee.permanently_deleted":"Employee permanently deleted","payment.draft_created":"Payment draft created","payment.edited":"Payment edited","payment.published":"Payment published","payment.receipt_confirmed":"Payment receipt confirmed","hourly_rate.update":"Hourly rate updated"};
function updateAuditSelectors(){
 const oldActor=$("auditActor").value,oldTarget=$("auditEmployee").value;
 const actors=people.filter(p=>["superuser","admin","manager"].includes(p.role));
 const targets=people.filter(p=>p.role!=="superuser");
 $("auditActor").innerHTML='<option value="">All Managers, Admins &amp; Superuser</option>'+actors.map(p=>'<option value="'+p.id+'">'+esc(p.name)+' · '+roleName(p.role)+'</option>').join("");
 $("auditEmployee").innerHTML='<option value="">All employees (except Superuser)</option>'+targets.map(p=>'<option value="'+p.id+'">'+esc(p.name)+' · '+roleName(p.role)+'</option>').join("");
 if(actors.some(p=>p.id===oldActor))$("auditActor").value=oldActor;
 if(targets.some(p=>p.id===oldTarget))$("auditEmployee").value=oldTarget;
}
function filteredAudit(){
 const a=$("auditAction").value,actorFilter=$("auditActor").value,target=$("auditEmployee").value,from=$("auditFrom").value,to=$("auditTo").value;
 return audit.filter(l=>(!a||l.action===a)&&(!actorFilter||l.actorId===actorFilter)&&(!target||l.targetId===target)&&(!from||l.date.slice(0,10)>=from)&&(!to||l.date.slice(0,10)<=to)).sort((a,b)=>b.date.localeCompare(a.date));
}
function renderAudit(){
 if(!privileged())return;
 updateAuditSelectors();
 const matched=filteredAudit(),shown=matched.slice(0,auditLimit);
 $("auditCount").textContent="Showing "+shown.length+" of "+matched.length;
 $("auditShowMore").hidden=shown.length>=matched.length;
 $("auditList").innerHTML=shown.length?shown.map(l=>{
  const actorPerson=person(l.actorId),target=person(l.targetId),when=new Date(l.date).toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return '<div class="audit-entry"><span class="audit-icon">'+ico(l.action.startsWith("employee")?"users":l.action.startsWith("hourly")?"edit":"wallet")+'</span><div class="audit-body"><div class="audit-title">'+esc(actionNames[l.action]||l.action)+'</div><div class="audit-meta">'+esc(actorPerson?.name||"System")+' · '+esc(roleName(actorPerson?.role||""))+'</div><div class="audit-description">Employee: '+esc(target?.name||"Former employee")+'<br>'+esc(l.note)+'</div></div><span class="audit-when">'+when+'</span></div>';
 }).join(""):'<div class="empty">'+ico("search")+'<strong>No matching activity</strong><p>Clear filters or choose another action.</p></div>';
}
function renderProfile(){
 const a=self();
 $("profileCard").innerHTML='<div class="row" style="gap:14px"><div class="avatar" style="height:58px;width:58px;border-radius:18px;font-size:17px">'+initials(a.name)+'</div><div><h2 class="section-title" style="font-size:21px;margin-bottom:5px">'+esc(a.name)+'</h2><span class="pill superuser">'+roleName(a.role)+'</span></div></div>'+(a.role==="runner"?'<div class="ghost-line" style="margin:17px 0"></div><div class="row space"><span class="small-sub">Your hourly rate · Read-only</span><strong>'+money(a.rate)+'/hr</strong></div>':"")+'<div class="ghost-line" style="margin:17px 0"></div><p class="small-sub" style="margin:0">This is a demo persona. Switching roles never changes your real account.</p>';
 const isDark=document.documentElement.dataset.theme==="dark";
 $("themeSwitch").classList.toggle("on",isDark);
 $("themeSwitch").setAttribute("aria-pressed",String(isDark));
}
function renderAll(){
 const a=self();
 $("roleHeader").textContent=roleName(role).toUpperCase()+" WORKSPACE";
 $("profileButton").textContent=initials(a.name);
 $("welcomeTitle").textContent=(role==="runner"?"Hello, ":"Good evening, ")+a.name.split(" ")[0]+" 👋";
 $("welcomeSub").textContent=role==="runner"?"Your tips, hours and receipts in one place.":"Here's where your team stands this week.";
 $("newDraftTop").hidden=role==="runner";
 $("exportButton").hidden=role==="runner";
 $("runnerFilterWrap").hidden=role==="runner";
 $("notificationsButton").querySelector(".dot").style.display=notifications.some(n=>!n.read)?"block":"none";
 document.querySelectorAll(".nav-item").forEach(b=>b.hidden=(b.dataset.page==="team"||b.dataset.page==="audit")&&!privileged());
 if(!privileged()&&(page==="team"||page==="audit"))page="home";
 renderHome();renderPayments();renderTeam();renderAudit();renderProfile();go(page);
}
function closeSheet(){
 $("sheetOverlay").classList.remove("open");
 $("sheetOverlay").setAttribute("aria-hidden","true");
 sheetMode="";sheetId="";
}
function sheet(title,html,mode="",id=""){
 sheetMode=mode;sheetId=id;
 $("sheetTitle").textContent=title;
 $("sheetBody").innerHTML=html;
 $("sheetOverlay").classList.add("open");
 $("sheetOverlay").setAttribute("aria-hidden","false");
 $("sheet").scrollTop=0;
 setTimeout(()=>{const first=$("sheetBody").querySelector("input,select,button");if(first)first.focus()},45);
}
function roleSheet(){
 sheet("Explore each role",'<p class="small-sub">Choose a sample role to see what that person can access. This never signs you into a real account.</p><div class="stack section-gap">'+Object.entries(personas).map(([r,id])=>{const a=person(id);return '<button class="person-row" data-act="role" data-role="'+r+'" style="text-align:left;width:100%"><span class="avatar">'+initials(a.name)+'</span><span class="person-data"><span class="person-name" style="display:block">'+roleName(r)+'</span><span class="person-meta" style="display:block">'+esc(a.name)+'</span></span>'+(r===role?'<span class="pill received">'+ico("check","sm")+' Selected</span>':ico("chevron-right"))+'</button>'}).join("")+'</div>',"role");
}
function notificationSheet(){
 sheet("Notifications",'<p class="small-sub">Sample inbox. No real push alert is sent from this preview.</p><div class="row space section-gap"><h2 class="section-title" style="font-size:14px">Inbox</h2><button class="btn-quiet" data-act="markAll">Mark all read</button></div><div class="stack">'+(notifications.length?notifications.map(n=>'<div class="card" style="padding:14px"><div class="row space"><strong>'+esc(n.title)+'</strong><span class="pill '+(n.read?"inactive":"published")+'">'+(n.read?"Read":"New")+'</span></div><p class="small-sub" style="margin:9px 0">'+esc(n.body)+'</p><button class="btn-quiet" data-act="deleteNotice" data-id="'+n.id+'">Delete</button></div>').join(""):'<div class="empty"><strong>Inbox empty</strong></div>')+'</div>',"notifications");
}
function draftSheet(){
 if(role==="runner")return;
 const active=people.filter(p=>p.role==="runner"&&p.active);
 sheet("Create weekly draft",'<p class="small-sub">New drafts are invisible to Runners until published. All changes in this preview are temporary.</p><form id="draftForm" class="form-stack section-gap"><div class="field"><label for="draftRunner">Runner</label><select id="draftRunner" required>'+active.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join("")+'</select></div><div class="field"><label for="draftWeek">Week starting</label><input id="draftWeek" type="date" value="2026-11-02" required></div><div class="form-grid"><div class="field"><label for="draftHours">Hours worked</label><input id="draftHours" type="number" min="0" step=".25" value="40" required></div><div class="field"><label for="draftTips">Tips ($)</label><input id="draftTips" type="number" min="0" step=".01" value="600" required></div><div class="field"><label for="draftAdvance">Advance ($)</label><input id="draftAdvance" type="number" min="0" step=".01" value="50" required></div><div class="field"><label>Hourly rate</label><div id="draftRate" class="small-sub" style="padding:12px 4px">Based on selected Runner</div></div></div><div class="total-preview"><div><span>Remaining tips</span><p class="small-sub" style="margin:2px 0 0">Tips minus advance</p></div><b id="draftTotal">$550.00</b></div><button type="submit" class="btn-primary brand-btn">Save sample draft</button></form>',"draft");
 updateDraftTotal();
}
function updateDraftTotal(){
 if(!$("draftTotal"))return;
 const runner=person($("draftRunner").value);
 $("draftRate").textContent=runner?money(runner.rate)+"/hr":"—";
 $("draftTotal").textContent=money(Number($("draftTips").value||0)-Number($("draftAdvance").value||0));
}
function paymentSheet(type,id){
 const p=payments.find(x=>x.id===id);
 if(!p)return;
 const runner=person(p.runnerId);
 if(type==="publish"&&role!=="runner"&&p.status==="draft"){
  sheet("Publish payment",'<p class="small-sub">In the real app, publishing makes this visible to the Runner and can send a push notification.</p><div class="card section-gap"><strong>'+esc(runner.name)+'</strong><p class="small-sub" style="margin:5px 0">Week of '+day(p.week)+'</p><div class="payment-amount">'+money(p.tips-p.advance)+'</div></div><div class="sheet-footer"><button class="btn-soft" data-act="close">Cancel</button><button class="btn-primary brand-btn" data-act="doPublish" data-id="'+id+'">Publish in demo</button></div>',"publish",id);
 }
 if(type==="confirm"&&role==="runner"&&p.runnerId===self().id&&p.status==="published"){
  sheet("Confirm payment received",'<p class="small-sub">Confirming in the real app records the receipt and alerts management.</p><div class="card section-gap"><p class="small-sub">Week of '+day(p.week)+'</p><div class="payment-amount">'+money(p.tips-p.advance)+'</div></div><div class="sheet-footer"><button class="btn-soft" data-act="close">Cancel</button><button class="btn-primary brand-btn" data-act="doConfirm" data-id="'+id+'">Confirm in demo</button></div>',"confirm",id);
 }
 if(type==="edit"&&privileged()&&p.status!=="received"){
  sheet("Edit weekly payment",'<p class="small-sub">Admin/Superuser can edit before the receipt is confirmed. Existing rate is preserved.</p><form class="form-stack section-gap" id="editPaymentForm"><p class="section-note">'+esc(runner.name)+' · Week of '+day(p.week)+'</p><div class="field"><label for="editHours">Hours worked</label><input id="editHours" type="number" min="0" step=".25" value="'+p.hours+'" required></div><div class="field"><label for="editTips">Tips ($)</label><input id="editTips" type="number" min="0" step=".01" value="'+p.tips+'" required></div><div class="field"><label for="editAdvance">Advance ($)</label><input id="editAdvance" type="number" min="0" step=".01" value="'+p.advance+'" required></div><button type="submit" class="btn-primary brand-btn">Save sample changes</button></form>',"edit",id);
 }
}
function employeeSheet(id){
 const p=person(id);
 if(!canManage(p))return;
 sheet("Manage employee",'<div class="row"><div class="avatar" style="width:47px;height:47px">'+initials(p.name)+'</div><div><strong>'+esc(p.name)+'</strong><p class="small-sub" style="margin:4px 0">'+roleName(p.role)+' · '+(p.active?"Active":"Inactive")+'</p></div></div><p class="section-note section-gap">'+roleName(role)+' is permitted to manage this '+roleName(p.role)+' account. All actions below affect fictional data only.</p><div class="stack section-gap"><button class="btn-primary" data-act="toggleEmployee" data-id="'+id+'">'+ico(p.active?"clock":"check-circle")+' '+(p.active?"Deactivate":"Reactivate")+'</button>'+(p.role==="runner"?'<button class="btn-soft" data-act="rate" data-id="'+id+'">'+ico("edit","sm")+' Update hourly rate</button>':"")+'<button class="btn-danger" data-act="deleteEmployee" data-id="'+id+'">'+ico("trash","sm")+' Delete permanently</button></div><p class="small-sub section-gap">The live app requires entering the employee name to confirm deletion.</p>',"employee",id);
}
function rateSheet(id){
 const p=person(id);
 if(!canManage(p)||p.role!=="runner")return;
 sheet("Update hourly rate",'<p class="small-sub">New rates apply to future payment drafts. Previously saved payments retain their rate.</p><form id="rateForm" class="form-stack section-gap"><p class="section-note">'+esc(p.name)+'</p><div class="field"><label for="rateValue">Hourly rate ($)</label><input id="rateValue" type="number" min="0" step=".01" value="'+p.rate+'" required></div><button type="submit" class="btn-primary brand-btn">Save sample rate</button></form>',"rate",id);
}
function deleteSheet(id){
 const p=person(id);
 if(!canManage(p))return;
 sheet("Permanent deletion",'<p class="section-note">In the real app, deleting a Runner also deletes their payment and rate history. Audit history remains. This demo has no real records.</p><form id="deleteForm" class="form-stack section-gap"><div class="field"><label for="deleteName">Type '+esc(p.name)+' exactly</label><input id="deleteName" required autocomplete="off"></div><button class="btn-danger" type="submit">Delete fictional employee</button></form>',"delete",id);
}
function createEmployeeSheet(){
 if(!privileged())return;
 let opts=["runner","manager"].concat(role==="superuser"?["admin"]:[]);
 sheet("Add employee",'<p class="small-sub">Preview-only account creation. The real app requires a unique email and 12-character temporary password.</p><form id="createEmployeeForm" class="form-stack section-gap"><div class="field"><label for="newName">Full name</label><input id="newName" required maxlength="100" placeholder="e.g. Alex Example"></div><div class="field"><label for="newEmail">Email</label><input id="newEmail" type="email" required placeholder="alex@example.com"></div><div class="field"><label for="newRole">Role</label><select id="newRole">'+opts.map(x=>'<option value="'+x+'">'+roleName(x)+'</option>').join("")+'</select></div><div class="field"><label for="temporaryPassword">Temporary password</label><input id="temporaryPassword" type="password" required minlength="12"></div><button type="submit" class="btn-primary brand-btn">Create fictional account</button></form>',"createEmployee");
}
function passwordSheet(){
 sheet("Change password",'<p class="small-sub">This form is for visual exploration only. Your real password is never read or changed.</p><form id="passwordForm" class="form-stack section-gap"><div class="field"><label for="oldPassword">Current password</label><input id="oldPassword" required type="password"></div><div class="field"><label for="newPassword">New password (12+ characters)</label><input id="newPassword" required type="password" minlength="12"></div><div class="field"><label for="confirmNewPassword">Confirm password</label><input id="confirmNewPassword" required type="password" minlength="12"></div><button type="submit" class="btn-primary brand-btn">Preview save</button></form>',"password");
}


function act(type,id,roleChoice){
 if(type==="newDraft"){draftSheet();return}
 if(type==="notifications"){notificationSheet();return}
 if(type==="pending"){statusFilter="published";renderPayments();go("payments");return}
 if(type==="graphRange"){graphRange=graphRange===6?52:6;renderHome();return}
 if(type==="viewToggle"){tableMode=!tableMode;renderPayments();return}
 if(type==="close"){closeSheet();return}
 if(type==="role"){
  if(!personas[roleChoice])return;
  role=roleChoice;page="home";statusFilter="";auditLimit=10;closeSheet();renderAll();
  toast("Now previewing "+roleName(role)+". Real roles unchanged.");return;
 }
 if(type==="markAll"){notifications.forEach(n=>n.read=true);closeSheet();renderAll();toast("Sample notifications marked read.");return}
 if(type==="deleteNotice"){notifications=notifications.filter(n=>String(n.id)!==String(id));notificationSheet();renderAll();return}
 if(type==="publish"||type==="confirm"||type==="edit"){paymentSheet(type,id);return}
 if(type==="doPublish"){
  const p=payments.find(x=>x.id===id);
  if(!p||role==="runner"||p.status!=="draft")return;
  p.status="published";pushAudit("payment.published",p.runnerId,"Fictional payout published");
  closeSheet();renderAll();toast("Sample payment published. No push sent.");return;
 }
 if(type==="doConfirm"){
  const p=payments.find(x=>x.id===id);
  if(!p||role!=="runner"||p.runnerId!==self().id||p.status!=="published")return;
  p.status="received";pushAudit("payment.receipt_confirmed",p.runnerId,"Fictional receipt confirmed");
  closeSheet();renderAll();toast("Sample receipt confirmed. No push sent.");return;
 }
 if(type==="manage"){employeeSheet(id);return}
 if(type==="rate"){rateSheet(id);return}
 if(type==="deleteEmployee"){deleteSheet(id);return}
 if(type==="toggleEmployee"){
  const p=person(id);if(!canManage(p))return;
  p.active=!p.active;pushAudit(p.active?"employee.activated":"employee.deactivated",id,"Fictional employee status");
  closeSheet();renderAll();toast("Sample employee "+(p.active?"reactivated.":"deactivated."));return;
 }
}
document.addEventListener("click",function(e){
 const nav=e.target.closest("[data-page]");
 if(nav){go(nav.dataset.page);return}
 const status=e.target.closest("[data-status]");
 if(status){statusFilter=status.dataset.status;renderPayments();return}
 const button=e.target.closest("[data-act]");
 if(button){act(button.dataset.act,button.dataset.id,button.dataset.role);return}
 const demo=e.target.closest("[data-simulate]");
 if(demo){toast(demo.dataset.simulate)}
});
document.addEventListener("input",function(e){
 if(["draftRunner","draftTips","draftAdvance"].includes(e.target.id))updateDraftTotal();
 if(e.target.id==="teamSearch")renderTeam();
 if(["paymentFrom","paymentTo"].includes(e.target.id))renderPayments();
});
document.addEventListener("change",function(e){
 if(e.target.id==="draftRunner")updateDraftTotal();
 if(e.target.id==="paymentRunner")renderPayments();
});
$("newDraftTop").onclick=draftSheet;
$("addEmployeeButton").onclick=createEmployeeSheet;
$("exportButton").onclick=()=>toast("Excel export is in the real app. Preview doesn't export data.");
$("clearPaymentFilters").onclick=()=>{
 statusFilter="";["paymentFrom","paymentTo","paymentRunner"].forEach(id=>$(id).value="");renderPayments();
};
$("auditSearch").onclick=()=>{auditLimit=10;renderAudit();toast("Sample audit filters applied.")};
$("auditClear").onclick=()=>{
 ["auditAction","auditActor","auditEmployee","auditFrom","auditTo"].forEach(id=>$(id).value="");auditLimit=10;renderAudit();
};
$("auditShowMore").onclick=()=>{auditLimit+=10;renderAudit()};
$("profileButton").onclick=roleSheet;
$("rolePickerButton").onclick=roleSheet;
$("notificationsButton").onclick=notificationSheet;
$("passwordButton").onclick=passwordSheet;
$("signOutButton").onclick=()=>toast("This is a visual preview; no real login session.");
$("themeSwitch").onclick=()=>{
 document.documentElement.dataset.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";
 renderProfile();
};
$("closeSheet").onclick=closeSheet;
$("sheetOverlay").onclick=e=>{if(e.target===$("sheetOverlay"))closeSheet()};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("sheetOverlay").classList.contains("open"))closeSheet()});
document.addEventListener("submit",function(e){
 const form=e.target;if(!form||!form.id)return;e.preventDefault();
 if(form.id==="draftForm"){
  if(role==="runner")return;
  const rid=$("draftRunner").value,week=$("draftWeek").value,hours=Number($("draftHours").value),tips=Number($("draftTips").value),advance=Number($("draftAdvance").value),p=person(rid);
  if(!p||!week||[hours,tips,advance].some(n=>!Number.isFinite(n)||n<0))return;
  if(payments.some(x=>x.runnerId===rid&&x.week===week)){toast("This runner already has a sample record for this week.");return}
  payments.unshift({id:"new-"+Date.now(),runnerId:rid,week,hours,tips,advance,status:"draft",rate:p.rate});
  pushAudit("payment.draft_created",rid,"Fictional weekly draft saved");
  closeSheet();statusFilter="draft";renderAll();go("payments");toast("Sample draft saved, hidden from Runners.");return;
 }
 if(form.id==="editPaymentForm"){
  const p=payments.find(x=>x.id===sheetId);
  if(!p||!privileged()||p.status==="received")return;
  const hours=Number($("editHours").value),tips=Number($("editTips").value),advance=Number($("editAdvance").value);
  if([hours,tips,advance].some(n=>!Number.isFinite(n)||n<0))return;
  p.hours=hours;p.tips=tips;p.advance=advance;pushAudit("payment.edited",p.runnerId,"Fictional payment edited");
  closeSheet();renderAll();toast("Sample payment updated.");return;
 }
 if(form.id==="rateForm"){
  const p=person(sheetId),rate=Number($("rateValue").value);
  if(!canManage(p)||p.role!=="runner"||!Number.isFinite(rate)||rate<0)return;
  p.rate=rate;pushAudit("hourly_rate.update",p.id,"Sample rate updated; saved payments retain original rates");
  closeSheet();renderAll();toast("Sample hourly rate updated.");return;
 }
 if(form.id==="deleteForm"){
  const p=person(sheetId);
  if(!canManage(p))return;
  if($("deleteName").value.trim()!==p.name){toast("Name didn't match. Nothing deleted.");return}
  const id=p.id;
  people.splice(people.findIndex(x=>x.id===id),1);
  payments=payments.filter(x=>x.runnerId!==id);
  pushAudit("employee.permanently_deleted",id,"Fictional account deleted; audit history preserved");
  closeSheet();renderAll();toast("Only the fictional account was deleted.");return;
 }
 if(form.id==="createEmployeeForm"){
  if(!privileged())return;
  const name=$("newName").value.trim(),newRole=$("newRole").value;
  const allowedRoles=["runner","manager"].concat(role==="superuser"?["admin"]:[]);
  if(!name||!allowedRoles.includes(newRole))return;
  const id="demo-"+Date.now();
  people.push({id,name,role:newRole,rate:newRole==="runner"?0:null,active:true});
  pushAudit("employee.created",id,"Fictional user added");
  closeSheet();renderAll();toast("Sample "+roleName(newRole)+" added. No login created.");return;
 }
 if(form.id==="passwordForm"){
  if($("newPassword").value!==$("confirmNewPassword").value){toast("Passwords must match.");return}
  closeSheet();toast("Preview only. Real password unchanged.");return;
 }
});
renderAll();
})();
