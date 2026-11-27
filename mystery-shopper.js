/* Employee Ledger — private NO-only evaluations. Source PDFs stay in browser memory. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {db:null,profile:null,notify:null,employees:[],reports:[],
    page:0,hasMore:false,loading:false,wired:false,filter:'',previewUrl:null};
  const PAGE_SIZE = 20;
  const TABLE = 'mystery_shopper_summaries';
  const isAdmin = () => ['admin','superuser'].includes(state.profile?.role);
  const status = (s,bad=false) => {const el=$('msStatus');if(el){el.textContent=s;el.classList.toggle('ms-error',bad)}};
  const toast = (s,bad=false) => {status(s,bad);state.notify?.(s,bad)};
  const dateText = date => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return String(date||'');
    return new Date(date+'T00:00:00Z').toLocaleDateString('en-GB',
      {timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
  };
  function todayBeirut() {
    const parts=new Intl.DateTimeFormat('en-GB',
      {timeZone:'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=t=>parts.find(p=>p.type===t)?.value;
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function nameOf(id) {
    if(id===state.profile?.id)return state.profile.full_name||'You';
    return state.employees.find(p=>p.id===id)?.full_name||'Employee';
  }
  async function loadEmployees() {
    if(!isAdmin())return;
    const {data,error}=await state.db.from('profiles')
      .select('id,full_name,role,management_position,active').neq('role','superuser').order('full_name');
    if(error){toast('Could not load the employee list: '+error.message,true);return}
    state.employees=data||[];
    const target=$('msEmployee'),filter=$('msEmployeeFilter');
    const previousTarget=target.value,previousFilter=filter.value;
    target.innerHTML='<option value="">Choose an employee</option>'+
      state.employees.filter(p=>p.active)
        .map(p=>'<option value="'+esc(p.id)+'">'+esc(p.full_name)+' · '+esc(p.management_position?p.management_position.replaceAll('_',' ').replace(/\b[a-z]/g,c=>c.toUpperCase()).replace(' On ',' on '):({admin:'Restaurant Manager',manager:'Management',waiter_waitress:'Waiter / Waitress'})[p.role]||p.role.replaceAll('_',' '))+'</option>').join('');
    filter.innerHTML='<option value="">All employees</option>'+
      state.employees.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.full_name)+(p.active?'':' · inactive')+'</option>').join('');
    if(state.employees.some(p=>p.id===previousTarget&&p.active))target.value=previousTarget;
    if(state.employees.some(p=>p.id===previousFilter))filter.value=previousFilter;
    state.filter=filter.value;
  }
  function render() {
    const out=$('msReports'),more=$('msLoadMore');
    if(!out)return;
    out.innerHTML=state.reports.length?state.reports.map(r=>{
      const name=isAdmin()?'<span class="ms-employee">'+esc(nameOf(r.employee_id))+'</span>':'';
      const safeId=esc(r.id),grade=Number(r.total_grade).toFixed(2),count=r.no_points.length;
      return '<article class="ms-report"><div class="ms-report-top"><div><span class="ms-report-date">'+esc(dateText(r.report_date))+'</span><h3>Mystery Shopper Evaluation</h3>'+name+'</div><span class="ms-file-type">SUMMARY</span></div>'+
        '<div class="ms-score"><strong>'+grade+'%</strong><span>Total grade · '+count+' NO point'+(count===1?'':'s')+'</span></div>'+
        '<div class="ms-report-actions"><button type="button" data-ms-download="'+safeId+'">View evaluation</button>'+
        (isAdmin()?'<button type="button" class="ms-delete" data-ms-delete="'+safeId+'">Delete</button>':'')+'</div></article>';
    }).join(''):'<div class="ms-empty">No Mystery Shopper evaluations available yet.</div>';
    more.classList.toggle('hidden',!state.hasMore);
    $('msReportCount').textContent=state.reports.length+' evaluation'+(state.reports.length===1?'':'s')+' loaded';
  }
  async function loadReports(reset=true) {
    if(!state.db||state.loading)return;
    state.loading=true;
    const more=$('msLoadMore');more.disabled=true;
    if(reset){state.page=0;state.reports=[];state.hasMore=false}
    status('Loading Mystery Shopper reports…');
    try{
      let q=state.db.from(TABLE)
        .select('id,employee_id,report_date,total_grade,no_points,created_at')
        .order('report_date',{ascending:false})
        .order('created_at',{ascending:false})
        .range(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE-1);
      if(isAdmin()&&state.filter)q=q.eq('employee_id',state.filter);
      const {data,error}=await q;
      if(error)throw error;
      state.reports.push(...(data||[]));
      state.hasMore=(data||[]).length===PAGE_SIZE;
      state.page++;
      render();
      status('Private evaluations — only NO points and the total visit grade. No source file is saved.');
    }catch(error){
      render();
      toast('Could not load reports: '+(error.message||'Please try again.'),true);
    }finally{state.loading=false;more.disabled=false}
  }
  async function uploadReport(event) {
    event.preventDefault();
    if(!isAdmin())return;
    const employeeId=$('msEmployee').value,file=$('msFile').files?.[0];
    const target=state.employees.find(p=>p.id===employeeId&&p.active);
    if(!target){toast('Choose an active employee.',true);return}
    if(!file||!file.name.toLowerCase().endsWith('.pdf')||(file.type&&file.type!=='application/pdf')||file.size<1||file.size>12582912){toast('Choose an original PDF report up to 12 MB.',true);return}
    const button=$('msUpload');button.disabled=true;button.textContent='Reading PDF…';
    const db=state.db,actor=state.profile.id;
    let saved=false;
    try{
      const summary=await window.MysteryPDF.parse(file);
      if(state.profile?.id!==actor||!isAdmin())throw Error('Your session changed. Please try again.');
      button.textContent='Publishing…';
      const id=crypto.randomUUID();
      const result=await db.from(TABLE).insert({id,employee_id:employeeId,report_date:summary.date,total_grade:summary.grade,no_points:summary.noPoints,uploaded_by:actor});
      if(result.error)throw result.error;
      saved=true;
      $('msUploadForm').reset();
      await loadReports(true);
      let push;
      try{push=await db.functions.invoke('send-push',{body:{event_type:'mystery_published',mystery_summary_id:id}})}catch(e){console.warn('Evaluation push failed',e)}
      const delivered=!push?.error&&!push?.data?.error&&push?.data?.sent>0;
      toast('Evaluation published for '+target.full_name+'. '+(delivered?'Push submitted to registered device(s).':'In-app notification saved; push not confirmed. Check device registration.'),!delivered);
    }catch(error){toast((saved?'Evaluation saved. ':'Nothing published: ')+(error.message||'Please retry.'),true)}
    finally{button.disabled=false;button.textContent='Extract & publish';$('msFile').value=''}
  }
  function closePreview() {
    $('msPreview').classList.add('hidden');
    $('msPreviewBody').replaceChildren();
    $('msSaveReport').removeAttribute('href');
    if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl=null}
  }
  function downloadReport(id,button){
    const report=state.reports.find(x=>x.id===id);
    if(!report)return;
    button.disabled=true;
    try{
      closePreview();
      const container=document.createElement('div');
      container.className='ms-summary-document';
      const score=document.createElement('div');score.className='ms-score ms-score-large';
      score.innerHTML='<strong>'+Number(report.total_grade).toFixed(2)+'%</strong><span>Total visit grade</span>';
      container.appendChild(score);
      const heading=document.createElement('h3');heading.textContent='Points requiring improvement';container.appendChild(heading);
      if(!report.no_points.length){const p=document.createElement('p');p.textContent='No points marked NO.';container.appendChild(p)}
      for(const q of report.no_points){
        const block=document.createElement('div');block.className='ms-no-point';
        const label=document.createElement('strong');label.textContent=q.code+' · '+q.section+' · NO';
        const text=document.createElement('p');text.textContent=q.text;block.append(label,text);container.appendChild(block);
      }
      $('msPreviewBody').appendChild(container);
      $('msPreviewName').textContent='Mystery Shopper · '+dateText(report.report_date);
      const blob=window.MysteryWord.create(report,nameOf(report.employee_id));
      state.previewUrl=URL.createObjectURL(blob);
      const download=$('msSaveReport');download.href=state.previewUrl;download.download='Mystery-Shopper-'+report.report_date+'.docx';
      $('msPreview').classList.remove('hidden');$('msClosePreview').focus();
    }catch(error){toast('Could not open the evaluation: '+(error.message||'Try again.'),true)}
    finally{button.disabled=false}
  }
  async function deleteReport(id,button){
    if(!isAdmin())return;
    const report=state.reports.find(x=>x.id===id);
    if(!report||!confirm('Permanently delete the evaluation for '+nameOf(report.employee_id)+' on '+dateText(report.report_date)+'?'))return;
    button.disabled=true;
    try{
      const result=await state.db.from(TABLE).delete().eq('id',id).select('id');
      if(result.error)throw result.error;
      if(!result.data?.length)throw Error('Evaluation not deleted.');
      await loadReports(true);toast('Mystery Shopper evaluation deleted.');
    }catch(error){toast('Could not delete evaluation: '+(error.message||'Please retry.'),true)}
    finally{button.disabled=false}
  }
  function wire(){
    if(state.wired)return;
    state.wired=true;
    $('msUploadForm').addEventListener('submit',uploadReport);
    $('msClosePreview').addEventListener('click',closePreview);
    $('msPreview').addEventListener('click',event=>{if(event.target===$('msPreview'))closePreview()});
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!$('msPreview').classList.contains('hidden'))closePreview();
    });
    $('msEmployeeFilter').addEventListener('change',()=>{
      state.filter=$('msEmployeeFilter').value;loadReports(true);
    });
    $('msReload').addEventListener('click',()=>loadReports(true));
    $('msLoadMore').addEventListener('click',()=>loadReports(false));
    $('msReports').addEventListener('click',event=>{
      const target=event.target.closest('button');
      if(!target)return;
      if(target.dataset.msDownload)downloadReport(target.dataset.msDownload,target);
      if(target.dataset.msDelete)deleteReport(target.dataset.msDelete,target);
    });
  }
  function init({db,profile,toast}){
    state.db=db;state.profile=profile;state.notify=toast;
    closePreview();
    state.reports=[];state.employees=[];state.page=0;state.filter='';state.hasMore=false;
    $('msManagement').classList.toggle('hidden',!isAdmin());
    $('msEmployeeFilterField').classList.toggle('hidden',!isAdmin());

    wire();
    if(isAdmin())loadEmployees();
  }
  function open(){
    if(!state.profile)return;
    if(isAdmin())loadEmployees();
    loadReports(true);
  }
  window.MysteryShopper=Object.freeze({init,open,refreshEmployees:loadEmployees});
})();
