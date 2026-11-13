window.ScheduleEditor = (() => {
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const blank=()=>days.map(()=>['','','']);
  const node=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;return x;};
  const button=(text,click)=>{const x=node('button',text);x.type='button';x.onclick=click;return x;};
  function normalize(value){
    return value.trim().toUpperCase().split(/\s*\/\s*/).map(part=>
      part.replace(/\s*[-–—]+\s*|\s+/g,'-')
    ).join(' / ');
  }
  function hours(value){
    const shift=normalize(value);
    if(!shift||shift==='OFF')return 0;
    const parts=shift.split(' / ');
    if(parts.length>2)return NaN;
    let minutes=0;
    for(const part of parts){
      const m=/^(\d{1,2})(?::([0-5]\d))?-(\d{1,2})(?::([0-5]\d))?$/.exec(part);
      if(!m)return NaN;
      const start=Number(m[1])*60+Number(m[2]||0),end=Number(m[3])*60+Number(m[4]||0);
      if(start>=1440||end>1440||start===end)return NaN;
      minutes+=end>start?end-start:1440+end-start;
    }
    return minutes/60;
  }
  function upgradeLegacy(value){
    if(!value||value==='OFF')return value;
    return value.split(' / ').map(part=>{
      const [from,to]=part.split('-').map(t=>t.split(':').map(Number));
      const start=(from[0]<9?from[0]+12:from[0])*60+(from[1]||0);
      const delta=((to[0]-from[0])*60+(to[1]||0)-(from[1]||0)+1440)%720||720;
      const clock=min=>String(Math.floor(min/60)%24)+(min%60?':'+String(min%60).padStart(2,'0'):'');
      return clock(start)+'-'+clock(start+delta);
    }).join(' / ');
  }
  function loadRoster(sheet){
    if(!sheet)return [];
    if(sheet.time_format===24)return sheet.roster;
    return sheet.roster.map(p=>({...p,days:p.days.map(([l,s,r])=>[l,upgradeLegacy(s),r])}));
  }
  const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  function dayTitle(day,i,week){
    const date=new Date(week+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+i);
    return day+' · '+date.toLocaleDateString('en-GB',{month:'short',day:'numeric',timeZone:'UTC'});
  }
  function safe(text){return String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function published(rows,week){
    const groups=new Map();
    for(const r of rows.slice(2)){if(!groups.has(r[2]))groups.set(r[2],[]);groups.get(r[2]).push(r);}
    const headings=days.map((d,i)=>'<th colspan="3">'+safe(dayTitle(d,i,week))+'</th>').join('');
    let html='';
    for(const [group,people] of groups){
      if(group)html+='<tr class="se-group"><th colspan="23">'+safe(group)+'</th></tr>';
      for(const r of people)html+='<tr><td>'+safe(r[0])+'</td><th>'+safe(r[1])+'</th>'+r.slice(3).map(([l,s,b])=>'<td class="se-code '+(l?'marked':'')+'">'+safe(l)+'</td><td class="'+(s==='OFF'?'se-off':'')+'">'+safe(s)+'</td><td class="se-code '+(b?'marked':'')+'">'+safe(b)+'</td>').join('')+'</tr>';
    }
    return '<div class="scroll"><table class="se-table"><thead><tr><th>ID</th><th>Name</th>'+headings+'</tr></thead><tbody>'+html+'</tbody></table></div>';
  }
  let ctx,active='',epoch=0;const cache=new Map();
  function init(context){ctx=context;active='';++epoch;cache.clear();document.getElementById('scheduleStudio').replaceChildren();}
  async function show(dept,week){
    const host=document.getElementById('scheduleStudio');
    if(!ctx||!['manager','admin','superuser'].includes(ctx.profile.role)){host.replaceChildren();return;}
    const key=dept+'/'+week;
    if(active===key)return;
    active=key;const token=++epoch;
    host.textContent='Loading schedule editor…';
    try{
      let model=cache.get(key);
      if(!model){
        const table=()=>ctx.db.from('schedule_workweeks').select('*').eq('department',dept);
        const [current,previous]=await Promise.all([table().eq('week_start',week).maybeSingle(),table().lt('week_start',week).not('sales','is',null).order('week_start',{ascending:false}).limit(1).maybeSingle()]);
        if(current.error||previous.error)throw current.error||previous.error;
        let seed=previous.data;
        if(!current.data&&!seed){const other=await table().order('week_start',{ascending:false}).limit(1).maybeSingle();if(other.error)throw other.error;seed=other.data;}
        model=current.data||{revision:0,sales:'',target:'',warned:false,roster:(seed?.roster||[]).map(r=>({...r,days:blank()}))};
        if(current.data){model.roster=loadRoster(current.data);model.sales??='';model.target??='';}
        model.previous=loadRoster(previous.data);model.dept=dept;model.week=week;
        if(token!==epoch)return;
        cache.set(key,model);
      }
      if(token===epoch)draw(host,model,token);
    }catch(e){if(token===epoch){host.textContent=e.message;host.append(button('Retry',()=>{active='';show(dept,week);}));}}
  }
  function draw(host,m,token){
    host.replaceChildren();
    const form=node('form'),fieldset=node('fieldset'),top=node('div'),budget=node('div'),stats=node('strong'),message=node('p');
    fieldset.style.cssText='border:0;padding:0;min-width:0';top.className='se-top';budget.className='se-budget';message.setAttribute('role','status');
    const title=node('div');title.append(node('h2',m.dept+' schedule editor'),node('p','Week of '+m.week+' · Enter 24-hour shifts, e.g. 10-14, 16-23, 12-00 or OFF.'));
    function input(type,value,label,change){
      const x=node('input');x.type=type;x.setAttribute('aria-label',label);
      if(type==='checkbox')x.checked=value;else x.value=value??'';
      x.oninput=()=>{change(type==='checkbox'?x.checked:x.value);calculate();};return x;
    }
    for(const [key,label] of [['sales','Expected weekly sales ($)'],['target','Variable labor budget (%)']]){
      const l=node('label',label),x=input('number',m[key],label,v=>m[key]=v);
      x.required=true;x.min=key==='sales'?'0.01':'0';x.step='any';if(key==='target')x.max=100;l.append(x);budget.append(l);
    }
    budget.append(stats);top.append(title,budget);
    const wrap=node('div'),table=node('table');wrap.className='scroll';table.className='se-table se-edit';
    const head=table.createTHead().insertRow();for(const h of ['Staff ID','Name','Position','Rate $/h','In budget',...days.map((d,i)=>dayTitle(d,i,m.week)),'']){const th=node('th',h);head.append(th);}
    const tbody=table.createTBody();wrap.append(table);
    const shiftInputs=[], canSchedule=()=>Number(m.sales)>0&&m.target!==''&&Number(m.target)>=0&&Number(m.target)<=100;
    const warnKey='schedule-budget:'+ctx.profile.id+':'+m.dept+':'+m.week;
    function calculate(){
      const ready=canSchedule();
      shiftInputs.forEach(x=>x.disabled=!ready);copy.disabled=!ready||!m.previous.length;
      let cost=0;
      for(const p of m.roster)if(p.counted)cost+=p.days.reduce((sum,d)=>sum+hours(d[1]),0)*Number(p.rate);
      const limit=Number(m.sales)*Number(m.target)/100;
      if(!ready){stats.textContent='Enter sales and target to enable shifts.';return;}
      if(!Number.isFinite(cost)){stats.textContent='Check the shift times to calculate cost.';return;}
      stats.textContent='Scheduled labor cost '+usd.format(cost)+' · Budget '+usd.format(limit)+' · '+(100*cost/m.sales).toFixed(2)+'% · '+(cost>limit?'Over target':'Within target');
      if(cost>limit&&!m.warned){
        m.warned=true;let seen=false;try{seen=localStorage.getItem(warnKey)==='1';localStorage.setItem(warnKey,'1');}catch{}
        if(!seen){const dlg=node('dialog');dlg.append(node('h2','Above labor budget'),node('p','Scheduled labor exceeds your budget by '+usd.format(cost-limit)+'.'),button('OK',()=>dlg.close()));dlg.onclose=()=>dlg.remove();host.append(dlg);dlg.showModal();}
      }
    }
    function rows(){
      tbody.replaceChildren();shiftInputs.length=0;
      let lastGroup=null;
      for(const p of m.roster){
        if(p.position && p.position!==lastGroup){const band=tbody.insertRow();band.className='se-group';const h=node('th',p.position);h.colSpan=13;band.append(h);}
        lastGroup=p.position;
        const tr=tbody.insertRow();
        for(const [key,label] of [['id','Staff ID'],['name','Name'],['position','Position'],['rate','Rate'],['counted','In budget']]){
          const x=input(key==='counted'?'checkbox':key==='rate'?'number':'text',p[key],label,v=>p[key]=v);
          if(key==='id'||key==='name'||key==='rate')x.required=true;
          if(key==='rate'){x.min=0;x.step='any';}tr.insertCell().append(x);
        }
        p.days.forEach((d,i)=>{
          const group=node('div');group.className='se-triplet';tr.insertCell().append(group);
          d.forEach((v,j)=>{const x=input('text',v,days[i]+' '+['left section','shift','right section'][j],value=>{
            d[j]=value;if(j===1)x.setCustomValidity(Number.isFinite(hours(value))?'':'Use 24-hour times, e.g. 10-14, 18-00, OFF or two shifts separated by /.');
            x.classList.toggle('marked',j!==1&&!!value);x.classList.toggle('se-off',j===1&&normalize(value)==='OFF');
          });
          if(j!==1){x.maxLength=2;x.classList.toggle('marked',!!v);}else x.classList.toggle('se-off',v==='OFF');
          group.append(x);shiftInputs.push(x);});
        });
        tr.insertCell().append(button('Remove',()=>{m.dirty=true;m.roster.splice(m.roster.indexOf(p),1);rows();calculate();}));
      }
    }
    const add=button('Add employee',()=>{m.dirty=true;m.roster.push({id:'',name:'',position:'',rate:'',counted:true,days:blank()});rows();calculate();tbody.lastChild.querySelector('input').focus();});
    const copy=button('Copy last schedule',()=>{
      if(m.roster.some(p=>p.days.some(d=>d.some(Boolean)))&&!confirm('Replace this week’s shifts and sections with the previous schedule?'))return;
      m.dirty=true;const prev=new Map(m.previous.map(p=>[p.id,p.days]));for(const p of m.roster)if(prev.has(p.id))p.days=structuredClone(prev.get(p.id));
      rows();calculate();
    });
    async function save(publish){
      if(!form.reportValidity()||!canSchedule())return;
      if(publish&&!confirm('Publish this schedule and notify employees?'))return;
      fieldset.disabled=true;
      try{
        const roster=m.roster.map(p=>({...p,id:p.id.trim(),name:p.name.trim(),rate:Number(p.rate),days:p.days.map(([l,s,r])=>[l.trim(),normalize(s),r.trim()])}));
        const result=await ctx.db.rpc('save_schedule_week_24',{p_department:m.dept,p_week:m.week,p_revision:m.revision,p_sales:Number(m.sales),p_target:Number(m.target),p_roster:roster,p_warned:m.warned,p_publish:publish});
        if(result.error)throw result.error;
        m.revision=result.data.revision;
        for(const [k,other] of cache)if(other!==m&&other.dept===m.dept&&other.week>m.week&&!other.dirty)cache.delete(k);
        m.dirty=false;
        if(publish){const push=await ctx.db.functions.invoke('send-push',{body:{event_type:'schedule_published',schedule_publication_id:result.data.publication}});
          if(token===epoch){message.textContent=push.error||push.data?.error?'Published with in-app alerts. Device push could not be confirmed.':'Published. Employees have been notified.';await ctx.refresh();}
        }else message.textContent='Draft saved.';
      }catch(e){message.textContent=e.message;}finally{fieldset.disabled=false;}
    }
    async function deleteSchedule(){
      if(!confirm('Delete the '+m.dept+' schedule for '+m.week+', including its published versions? The saved staff roster will be kept.'))return;
      fieldset.disabled=true;
      try{
        const result=await ctx.db.rpc('delete_schedule_week',{p_department:m.dept,p_week:m.week,p_revision:m.revision});
        if(result.error)throw result.error;
        m.revision=result.data;m.sales='';m.target='';m.warned=false;m.dirty=false;
        m.roster.forEach(p=>p.days=blank());
        try{localStorage.removeItem(warnKey);}catch{}
        for(const [key,other] of cache)if(other!==m&&other.dept===m.dept&&!other.dirty)cache.delete(key);
        if(token===epoch){draw(host,m,token);await ctx.refresh();}
      }catch(e){message.textContent=e.message;}finally{fieldset.disabled=false;}
    }
    form.oninput=()=>{m.dirty=true;};form.onsubmit=e=>e.preventDefault();
    const actions=node('div');actions.className='row';actions.append(add,copy,button('Save draft',()=>save(false)),button('Publish and notify',()=>save(true)),button('Delete schedule',deleteSchedule),button('Reload saved version',()=>{if(confirm('Reload and discard unsaved changes?')){cache.delete(active);active='';show(m.dept,m.week);}}));
    fieldset.append(top,wrap,actions,message);form.append(fieldset);host.append(form);rows();calculate();
  }
  return {init,show,published,hours};
})();
