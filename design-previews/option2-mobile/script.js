
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
