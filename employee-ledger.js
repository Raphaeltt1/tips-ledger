/* Employee Ledger: private health-card expiry and published Excel schedules.
   Production data access remains constrained by Supabase RLS + management RPCs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const teamRoles = ['runner','host_hostess','counter','expo','kitchen_crew'];
  const admin = () => ['admin','superuser'].includes(state.profile?.role);
  const state = {db:null, profile:null, api:null, wired:false, health:[], people:[], filter:'all',
    dept:'FOH', week:null, manualWeek:false, published:[], draft:null, drafts:{}, scheduleLoading:false};
  const toast = (message,bad=false) => state.api?.toast?.(message,bad);
  function todayBeirut() {
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const pick=t=>parts.find(p=>p.type===t)?.value;
    return pick('year')+'-'+pick('month')+'-'+pick('day');
  }
  function dayDelta(day) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return NaN;
    return Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(todayBeirut()+'T00:00:00Z'))/86400000);
  }
  function mondayISO(day) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return todayBeirut();
    const date = new Date(day+'T00:00:00Z');
    if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==day) return todayBeirut();
    const offset = (date.getUTCDay()+6)%7;
    date.setUTCDate(date.getUTCDate()-offset);
    return date.toISOString().slice(0,10);
  }
  function cardById(id){return state.health.find(h=>h.employee_id===id)}
  function peopleForHealth() {
    return state.people.filter(p=>p.active && p.role!=='superuser');
  }
  function getHealthGroup(id) {
    const date=cardById(id)?.expires_on;
    if(!date)return 'missing';
    const days=dayDelta(date);
    return days<0?'expired':days<=10?'near':'valid';
  }
  function healthLabel(id) {
    const h=cardById(id),date=h?.expires_on,group=getHealthGroup(id);
    if(group==='missing') return 'Health card: Not set';
    if(group==='expired') return 'Health card expired · '+date;
    if(group==='near') return 'Health card due in '+dayDelta(date)+' days · '+date;
    return 'Health card valid until '+date;
  }
  function renderHealth() {
    if(!admin())return;
    const active=peopleForHealth();
    const near=active.filter(p=>getHealthGroup(p.id)==='near').length;
    const expired=active.filter(p=>getHealthGroup(p.id)==='expired').length;
    const metrics=$('tlHomeHero')?.querySelector('.noir-metrics');
    if(metrics){
      metrics.querySelectorAll('.el-health-metric').forEach(x=>x.remove());
      const box=document.createElement('div');
      box.innerHTML='<button type="button" class="noir-metric el-health-metric '+(near?'el-near':'el-zero')+'" data-health-jump="near" aria-label="View '+near+' health cards near expiry"><span class="noir-metric-head"><span class="noir-metric-label">Health Cards Near Expiry</span><span class="noir-metric-icon">♡</span></span><span class="noir-metric-value">'+near+'</span><span class="noir-metric-foot">'+(near?'Due within 10 days · View employees':'All health cards clear · View employees')+'</span></button>'
        +(expired?'<button type="button" class="noir-metric el-health-metric el-expired" data-health-jump="expired" aria-label="View '+expired+' expired health cards"><span class="noir-metric-head"><span class="noir-metric-label">Expired Health Cards</span><span class="noir-metric-icon">!</span></span><span class="noir-metric-value">'+expired+'</span><span class="noir-metric-foot">Critical · View expired cards</span></button>':'');
      while(box.firstChild)metrics.appendChild(box.firstChild);
    }
    const select=$('elHealthEmployee');
    if(select){
      const selected=select.value;
      select.innerHTML='<option value="">Select an employee</option>'+active.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.full_name)+'</option>').join('');
      if(active.some(p=>p.id===selected))select.value=selected;
    }
    const people=$('people');
    if(people){
      people.querySelectorAll('.employee-entry').forEach(el=>{
        el.querySelectorAll('.el-health-tag,.el-health-edit').forEach(x=>x.remove());
        const button=el.querySelector('button[data-employee]');
        const id=button?.dataset.employee;
        if(!id || !active.some(p=>p.id===id))return;
        const group=getHealthGroup(id);
        el.dataset.healthGroup=group;
        const label=document.createElement('span');
        label.className='el-health-tag el-health-'+group;
        label.textContent=healthLabel(id);
        el.appendChild(label);
        const edit=document.createElement('button');
        edit.type='button'; edit.className='tl-secondary-button el-health-edit';
        edit.dataset.healthEdit=id;edit.textContent='Edit health card';
        el.appendChild(edit);
      });
    }
    applyHealthFilter();
    const summary=$('elHealthEditorSummary');
    if(summary)summary.textContent=near+' near expiry · '+expired+' expired · '+active.length+' active team members';
  }
  function applyHealthFilter() {
    const people=$('people');
    if(!people)return;
    const q=($('tlTeamSearch')?.value||'').trim().toLowerCase();
    people.querySelectorAll('.employee-entry').forEach(el=>{
      const matchesText=!q||el.textContent.toLowerCase().includes(q);
      const matchesGroup=state.filter==='all'||el.dataset.healthGroup===state.filter;
      el.classList.toggle('hidden',!matchesText||!matchesGroup);
    });
    const banner=$('elHealthFilterBanner');
    if(banner){
      banner.classList.toggle('hidden',state.filter==='all');
      if(state.filter!=='all') $('elHealthFilterDescription').textContent='Showing '+(state.filter==='near'?'near-expiry':'expired')+' health cards only';
    }
  }
  async function onRefresh() {
    if(!admin())return;
    const [people,health]=await Promise.all([
      state.db.from('profiles').select('id,full_name,role,active').order('full_name'),
      state.db.from('employee_health_cards').select('employee_id,expires_on,updated_at')
    ]);
    if(people.error||health.error){
      toast('Health card records could not be loaded: '+(people.error?.message||health.error?.message),true);
      return;
    }
    state.people=people.data||[];state.health=health.data||[];
    renderHealth();
  }
  function editHealth(id) {
    const p=state.people.find(x=>x.id===id);
    if(!p)return;
    $('elHealthEmployee').value=id;
    $('elHealthDate').value=cardById(id)?.expires_on||'';
    $('elHealthForm').scrollIntoView({behavior:'smooth',block:'center'});
    $('elHealthDate').focus();
  }
  async function saveHealth(clear=false) {
    if(!admin())return;
    const id=$('elHealthEmployee').value;
    const date=clear?null:($('elHealthDate').value||null);
    if(!id){toast('Select an employee first.',true);return}
    if(!clear&&!date){toast('Choose an expiry date, or select Clear date.',true);return}
    const b=$('elHealthSave');b.disabled=true;$('elHealthClear').disabled=true;
    try{
      const r=await state.db.rpc('set_employee_health_card_expiry',{p_employee_id:id,p_expiry_date:date});
      if(r.error)throw r.error;
      await onRefresh();
      if(clear)$('elHealthDate').value='';
      toast(date?'Health card expiry updated. Old reminders were cleared.':'Health card expiry cleared. Old reminders were cleared.');
      await state.api?.loadNotifications?.();
    }catch(e){toast('Could not update health card: '+(e.message||'Please retry.'),true)}
    finally{b.disabled=false;$('elHealthClear').disabled=false}
  }
  function addHealthEditor() {
    if(!$('people')||$('elHealthForm'))return;
    const section=document.createElement('section');
    section.className='el-health-editor';
    section.innerHTML='<div class="el-section-intro"><div><strong>Health Card Expiry</strong><p class="muted" id="elHealthEditorSummary">Loading health cards…</p></div></div>'
      +'<form id="elHealthForm"><div class="row"><div class="field"><label for="elHealthEmployee">Employee</label><select id="elHealthEmployee" required><option value="">Select an employee</option></select></div><div class="field"><label for="elHealthDate">Expiry date</label><input id="elHealthDate" type="date"></div></div>'
      +'<div class="row"><button type="submit" id="elHealthSave">Save expiry date</button><button type="button" id="elHealthClear" class="tl-secondary-button">Clear date</button></div></form>'
      +'<div id="elHealthFilterBanner" class="el-filter-banner hidden"><span id="elHealthFilterDescription"></span><button type="button" id="elHealthFilterReset" class="tl-secondary-button">Show all employees</button></div>';
    $('people').parentNode.insertBefore(section,$('people'));
    $('elHealthForm').addEventListener('submit',e=>{e.preventDefault();saveHealth(false)});
    $('elHealthClear').addEventListener('click',()=>{
      if(!confirm('Remove the saved expiry date and all expiry reminders for this employee?'))return;
      saveHealth(true);
    });
    $('elHealthEmployee').addEventListener('change',()=>{$('elHealthDate').value=cardById($('elHealthEmployee').value)?.expires_on||''});
    $('elHealthFilterReset').addEventListener('click',()=>{state.filter='all';applyHealthFilter()});
  }
  function healthJump(group) {
    state.filter=group;
    $('tlTeamSearch').value='';
    state.api?.setTab?.('employees');
    renderHealth();
    $('tlEmployeeHeader')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function ensureExcel() {
    if(window.ExcelJS?.Workbook)return window.ExcelJS;
    if(!window.__employeeLedgerExcelPromise){
      window.__employeeLedgerExcelPromise=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.async=true;
        script.src='https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
        const timeout=setTimeout(()=>{script.remove();reject(Error('Excel reader timed out. Check internet connection.'))},20000);
        script.onload=()=>{clearTimeout(timeout);window.ExcelJS?.Workbook?resolve(window.ExcelJS):reject(Error('Excel reader could not start.'))};
        script.onerror=()=>{clearTimeout(timeout);reject(Error('Excel reader could not be downloaded.'))};
        document.head.appendChild(script);
      }).catch(e=>{window.__employeeLedgerExcelPromise=null;throw e});
    }
    return window.__employeeLedgerExcelPromise;
  }
  function cellText(cell) {
    let value=cell?.value;
    if(value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Date)){
      if(value.result!==undefined && value.result!==null) value=value.result;
      else if(value.richText) value=value.richText.map(t=>t.text||'').join('');
      else if(value.text!==undefined)value=value.text;
      else value='';
    }
    if(value instanceof Date)return value.toLocaleDateString('en-GB',{timeZone:'UTC'});
    return String(value??'').trim().slice(0,150);
  }

  // The restaurant Excel format uses three subcolumns for each day. Collapse
  // those display-only cells into one day per column for the selected Design B.
  // Every nonempty shift remains visible; the workbook is never edited.
  function normalizeScheduleRows(rows) {
    const top=rows[0]||[];
    const days=['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
    const starts=days.map(day=>top.findIndex(v=>String(v||'').toUpperCase()===day));
    if(starts.some(i=>i<2)||starts.some((pos,i)=>
      top.slice(pos,pos+3).some(value=>String(value||'').toUpperCase()!==days[i])
    ))return rows;
    const dates=rows[1]||[];
    const hoursCol=dates.findIndex(v=>/^total\s*hours$/i.test(String(v||'')));
    const dateSuffix=value=>{
      const x=String(value||'').trim();
      if(/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(x))return x.split('-').slice(0,2).join(' ');
      if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(x))return x.slice(0,5);
      return '';
    };
    const headings=['Employee','Position',...days.map((day,i)=>
      day.slice(0,1)+day.slice(1,3).toLowerCase()+(dateSuffix(dates[starts[i]])?'\n'+dateSuffix(dates[starts[i]]):'')
    ),'Total Hours','Staff ID'];
    const normalized=[[String(top[1]||'Weekly Schedule')],headings];
    let section='';
    for(const row of rows.slice(2)){
      const id=String(row[0]||'').trim(),name=String(row[1]||'').trim();
      if(!name)continue;
      const shifts=starts.map(i=>[...new Set(row.slice(i,i+3).map(x=>String(x||'').trim()).filter(Boolean))].join(' / '));
      const total=hoursCol>=0?String(row[hoursCol]||'').trim():'';
      const groupName=/^(manager on duty|floor supervisors?|waiters?|runners?|host(?:ess)?es?|counter|cashiers?|expo|kitchen(?: crew)?|baristas?|hosts?|support|delivery)$/i.test(name);
      const isSection=groupName && (!id || shifts.every(x=>!x||/^\d+(?:\s*\/\s*\d+)?$/.test(x)));
      if(isSection){section=name;normalized.push([name,'',...shifts,total,id]);continue;}
      normalized.push([name,section,...shifts,total,id]);
    }
    return normalized.length>2?normalized:rows;
  }
  async function parseExcel(file,dept) {
    if(!/\.xlsx$/i.test(file?.name||''))throw Error('Please select an Excel .xlsx workbook.');
    if(file.size>6*1024*1024)throw Error('The Excel workbook must be under 6 MB.');
    const Excel=await ensureExcel(),wb=new Excel.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheets=wb.worksheets.filter(ws=>ws.state!=='veryHidden'&&ws.state!=='hidden');
    const named=sheets.find(ws=>new RegExp('\\b'+dept+'\\b','i').test(ws.name));
    if(!named && sheets.some(ws=>/\\b(?:FOH|BOH)\\b/i.test(ws.name)))
      throw Error('No '+dept+' worksheet found. Choose the matching department workbook.');
    const selected=named||sheets[0];
    if(!selected)throw Error('No visible worksheet in this Excel workbook.');
    if(selected.rowCount>500)throw Error('The schedule worksheet has too many rows; keep it to 180 lines.');
    const raw=[];
    const totalCols=Math.min(Math.max(7,selected.actualColumnCount||7),28);
    for(let i=1;i<=selected.rowCount;i++){
      const row=selected.getRow(i);
      const values=Array.from({length:totalCols},(_,j)=>cellText(row.getCell(j+1)));
      while(values.length>0&&!values.at(-1))values.pop();
      raw.push(values);
    }
    while(raw.length&&!raw[0].some(Boolean))raw.shift();
    while(raw.length&&!raw.at(-1).some(Boolean))raw.pop();
    if(raw.length<2||!raw.some(r=>r.filter(Boolean).length>=2))throw Error('No readable weekly schedule grid was found in this workbook.');
    if(raw.length>180)throw Error('A schedule must have no more than 180 rows.');
    if(raw.reduce((n,row)=>n+row.join('').length,0)>150000)throw Error('The schedule is too large to save.');
    return {rows:normalizeScheduleRows(raw), sheet:selected.name};
  }
  function dateLabel(date) {
    if(!date)return 'No week selected';
    const monday=new Date(date+'T00:00:00Z'),sunday=new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate()+6);
    return 'Week of '+monday.toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'})
      +' – '+sunday.toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
  }
  function tableMarkup(rows) {
    if(!Array.isArray(rows)||!rows.length)return '<p class="muted">No schedule rows found.</p>';
    const dayNames=/\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b/i;
    const head=Math.max(0,rows.findIndex(r=>Array.isArray(r)&&r.filter(x=>dayNames.test(String(x||''))).length>=2));
    const cols=Math.max(1,...rows.map(r=>r.length));
    const banner=rows.slice(0,head).flat().filter(Boolean).slice(0,3).join(' · ');
    const dayColumns=new Set(Array.from({length:cols},(_,i)=>dayNames.test(String(rows[head][i]||''))?i:-1).filter(i=>i>=0));
    const heads=Array.from({length:cols},(_,i)=>'<th>'+esc(rows[head][i]||'')+'</th>').join('');
    const tbody=rows.slice(head+1).map(row=>{
      const section=cols>=10 && /^(manager on duty|floor supervisors?|waiters?|runners?|host(?:ess)?es?|counter|cashiers?|expo|kitchen(?: crew)?|baristas?|hosts?|support|delivery)$/i.test(String(row[0]||'').trim()) && String(row[1]||'').trim()==='';
      return '<tr'+(section?' class="el-section-row"':'')+'>'+Array.from({length:cols},(_,i)=>{
        const str=String(row[i]||'').trim(),off=/^off$/i.test(str);
        if(!section && dayColumns.has(i) && str)
          return '<td class="el-day-cell'+(off?' el-day-off':'')+'"><span class="el-shift-pill '+(off?'el-off':'el-on')+'">'+esc(str)+'</span></td>';
        return '<td>'+esc(str)+'</td>';
      }).join('')+'</tr>';
    }).join('');
    return (banner?'<p class="el-schedule-caption">'+esc(banner)+'</p>':'')
      +'<div class="el-schedule-scroll" tabindex="0" aria-label="Scrollable weekly schedule"><table class="el-schedule-table"><thead><tr>'+heads+'</tr></thead><tbody>'+tbody+'</tbody></table></div>';
  }
  async function loadScheduleIndex() {
    if(!state.db||!state.profile)return;
    if(state.scheduleLoading)return;
    state.scheduleLoading=true;
    $('elScheduleStatus').textContent='Loading published schedules…';
    try{
      const r=await state.db.from('schedule_publications')
        .select('id,department,week_start,original_filename,workbook_rows,published_at')
        .eq('status','published').order('published_at',{ascending:false}).limit(120);
      if(r.error)throw r.error;
      state.published=r.data||[];
      state.drafts={};
      if(admin()){
        const d=await state.db.from('schedule_publications')
          .select('id,department,week_start,original_filename,workbook_rows,created_at')
          .eq('status','draft').order('created_at',{ascending:false}).limit(80);
        if(d.error)throw d.error;
        for(const draft of d.data||[]){
          if(state.drafts[draft.department])continue;
          const newerPublished=state.published.find(p=>p.department===draft.department &&
            p.week_start===draft.week_start && new Date(p.published_at)>=new Date(draft.created_at));
          if(newerPublished)continue;
          state.drafts[draft.department]={id:draft.id,department:draft.department,
            week:draft.week_start,filename:draft.original_filename,rows:draft.workbook_rows};
        }
      }
      state.draft=state.drafts[state.dept]||null;
      if(!state.week){
        const latest=state.published.find(x=>x.department===state.dept);
        state.week=state.draft?.week||latest?.week_start||mondayISO(todayBeirut());
      }
      renderSchedule();
    }catch(e){$('elScheduleStatus').textContent='Could not open schedules: '+(e.message||'Try refreshing');toast('Could not load schedule: '+e.message,true)}
    finally{state.scheduleLoading=false}
  }
  function latestForWeek() {
    return state.published.find(x=>x.department===state.dept&&x.week_start===state.week);
  }
  function scheduleWeeks() {
    return [...new Set(state.published.filter(x=>x.department===state.dept).map(x=>x.week_start))].sort((a,b)=>b.localeCompare(a));
  }
  function renderSchedule() {
    if(!$('elScheduleTable'))return;
    $('elScheduleFoh').classList.toggle('selected',state.dept==='FOH');
    $('elScheduleBoh').classList.toggle('selected',state.dept==='BOH');
    const weeks=scheduleWeeks();
    if(!state.week||(!weeks.includes(state.week) && weeks.length && !state.draft && !state.manualWeek)){
      state.week=weeks[0];
    }
    const week=$('elScheduleWeek');
    week.value=state.week||mondayISO(todayBeirut());
    $('elScheduleWeekLabel').textContent=dateLabel(week.value);
    $('elScheduleUploadWeek').value=week.value;
    $('elScheduleUploadDept').textContent=state.dept;
    const selected=latestForWeek();
    $('elScheduleStatus').textContent=selected
      ?state.dept+' · Published '+new Date(selected.published_at).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'})+' · '+selected.original_filename
      :'No '+state.dept+' schedule published for this week.';
    $('elScheduleTable').innerHTML=selected?tableMarkup(selected.workbook_rows):
      '<div class="el-empty">No published '+state.dept+' schedule for '+esc(dateLabel(week.value))+'.</div>';
    $('elSchedulePrev').disabled=!weeks.some(x=>x<state.week);
    $('elScheduleNext').disabled=!weeks.some(x=>x>state.week);
    $('elScheduleDraft').classList.toggle('hidden',!admin()||!state.draft||state.draft.department!==state.dept);
    if(state.draft&&state.draft.department===state.dept){
      $('elScheduleDraftTable').innerHTML=tableMarkup(state.draft.rows);
      $('elScheduleDraftName').textContent='Not published · '+state.draft.filename+' · '+dateLabel(state.draft.week);
    }
    $('elScheduleManagement').classList.toggle('hidden',!admin());
  }
  async function importSchedule() {
    if(!admin())return;
    const file=$('elScheduleFile').files?.[0];
    if(!file){toast('Choose an Excel .xlsx file first.',true);return}
    const week=mondayISO($('elScheduleUploadWeek').value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(week)){toast('Choose a valid schedule week.',true);return}
    const b=$('elScheduleImport');b.disabled=true;b.textContent='Importing…';
    try{
      const data=await parseExcel(file,state.dept);
      const created=await state.db.from('schedule_publications').insert({
        department:state.dept,week_start:week,original_filename:file.name.slice(0,160),
        workbook_rows:data.rows,created_by:state.profile.id,status:'draft'
      }).select('id').single();
      if(created.error)throw created.error;
      state.draft={id:created.data.id,department:state.dept,week,filename:file.name,rows:data.rows};
      state.drafts[state.dept]=state.draft;
      state.week=week;
      $('elScheduleFile').value='';
      renderSchedule();
      $('elScheduleDraft').scrollIntoView({behavior:'smooth',block:'nearest'});
      toast('Excel imported as a draft. Employees are NOT notified until you press Publish.');
    }catch(e){toast('Excel import failed: '+(e.message||'Please retry.'),true)}
    finally{b.disabled=false;b.textContent='Import Excel'}
  }
  async function publishSchedule() {
    if(!admin()||!state.draft||state.draft.department!==state.dept)return;
    const draft={...state.draft};
    if(!confirm('Publish the '+draft.department+' schedule for '+draft.week+' and notify all active employees?'))return;
    const b=$('elSchedulePublish');b.disabled=true;b.textContent='Publishing…';
    try{
      const r=await state.db.rpc('publish_employee_schedule',{p_publication_id:draft.id});
      if(r.error)throw r.error;
      state.draft=null;
      delete state.drafts[draft.department];
      state.week=draft.week;
      await loadScheduleIndex();
      await state.api?.loadNotifications?.();
      const push=await state.db.functions.invoke('send-push',{body:{
        event_type:'schedule_published',schedule_publication_id:draft.id
      }});
      if(push.error||push.data?.error){
        toast('Schedule published. All employees have in-app alerts, but push delivery needs a retry.',true);
      }else{
        toast('Schedule published. All active employees received an in-app alert'+(push.data?.sent?' and '+push.data.sent+' push delivery attempt(s) succeeded.':'.'));
      }
    }catch(e){toast('Schedule was not published: '+(e.message||'Please retry.'),true)}
    finally{b.disabled=false;b.textContent='Publish schedule'}
  }
  function showDept(dept){
    state.dept=dept;state.week=null;state.manualWeek=false;
    state.draft=state.drafts[dept]||null;
    const first=state.published.find(x=>x.department===dept);
    state.week=state.draft?.week||first?.week_start||mondayISO(todayBeirut());
    renderSchedule();
  }
  function wire() {
    if(state.wired)return;state.wired=true;
    addHealthEditor();
    $('tlHomeHero').addEventListener('click',e=>{
      const b=e.target.closest('[data-health-jump]');
      if(b&&admin())healthJump(b.dataset.healthJump);
    });
    $('people').addEventListener('click',e=>{
      const b=e.target.closest('[data-health-edit]');
      if(b&&admin())editHealth(b.dataset.healthEdit);
    });
    $('tlTeamSearch').addEventListener('input',applyHealthFilter);
    $('elScheduleFoh').onclick=()=>showDept('FOH');
    $('elScheduleBoh').onclick=()=>showDept('BOH');
    $('elScheduleRefresh').onclick=loadScheduleIndex;
    $('elScheduleWeek').onchange=()=>{
      state.week=mondayISO($('elScheduleWeek').value);state.manualWeek=true;renderSchedule();
    };
    $('elSchedulePrev').onclick=()=>{const x=scheduleWeeks().filter(w=>w<state.week);if(x.length){state.week=x[0];renderSchedule()}};
    $('elScheduleNext').onclick=()=>{const x=scheduleWeeks().filter(w=>w>state.week);if(x.length){state.week=x.at(-1);renderSchedule()}};
    $('elScheduleImport').onclick=importSchedule;
    $('elSchedulePublish').onclick=publishSchedule;
    $('noticeList').addEventListener('click',e=>{
      if(e.target.closest('[data-open-schedule]'))state.api?.setTab?.('schedule');
    });
  }
  function init({db,profile,setTab,toast,loadNotifications}){
    state.db=db;state.profile=profile;state.api={setTab,toast,loadNotifications};
    state.filter='all';state.dept='FOH';state.week=null;state.manualWeek=false;state.published=[];state.draft=null;state.drafts={};
    wire();
    $('elScheduleManagement').classList.toggle('hidden',!admin());
    if($('elHealthForm'))$('elHealthForm').closest('.el-health-editor').classList.toggle('hidden',!admin());
  }
  window.EmployeeLedger=Object.freeze({init,onRefresh,openSchedule:loadScheduleIndex});
})();
