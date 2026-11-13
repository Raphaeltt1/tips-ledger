/* Employee Ledger — private Mystery Shopper report archive.
   Server RLS + private Storage enforce record/file ownership. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {db:null,profile:null,notify:null,employees:[],reports:[],
    page:0,hasMore:false,loading:false,wired:false,filter:'',previewUrl:null};
  const PAGE_SIZE = 20;
  const BUCKET = 'mystery-shopper-reports';
  const TYPES = {pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
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
      const note=r.notes?'<p class="ms-notes">'+esc(r.notes)+'</p>':'';
      const safeId=esc(r.id);
      return '<article class="ms-report">'+
        '<div class="ms-report-top"><div><span class="ms-report-date">'+esc(dateText(r.report_date))+'</span>'+
        '<h3>'+esc(r.title)+'</h3>'+name+'</div><span class="ms-file-type">'+
        esc(r.mime_type==='application/pdf'?'PDF':'Image')+'</span></div>'+
        note+'<p class="ms-file-name">'+esc(r.original_filename)+'</p>'+
        '<div class="ms-report-actions"><button type="button" data-ms-download="'+safeId+'">View report</button>'+
        (isAdmin()?'<button type="button" class="ms-delete" data-ms-delete="'+safeId+'">Delete</button>':'')+
        '</div></article>';
    }).join(''):'<div class="ms-empty">No Mystery Shopper reports available yet.</div>';
    more.classList.toggle('hidden',!state.hasMore);
    $('msReportCount').textContent=state.reports.length+
      ' report'+(state.reports.length===1?'':'s')+' loaded';
  }
  async function loadReports(reset=true) {
    if(!state.db||state.loading)return;
    state.loading=true;
    const more=$('msLoadMore');more.disabled=true;
    if(reset){state.page=0;state.reports=[];state.hasMore=false}
    status('Loading Mystery Shopper reports…');
    try{
      let q=state.db.from('mystery_shopper_reports')
        .select('id,employee_id,report_date,title,notes,original_filename,file_path,mime_type,file_size,created_at')
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
      status('Private reports — visible only to the assigned employee and Restaurant Manager/Superuser.');
    }catch(error){
      render();
      toast('Could not load reports: '+(error.message||'Please try again.'),true);
    }finally{state.loading=false;more.disabled=false}
  }
  async function uploadReport(event) {
    event.preventDefault();
    if(!isAdmin())return;
    const employeeId=$('msEmployee').value, file=$('msFile').files?.[0];
    const target=state.employees.find(p=>p.id===employeeId&&p.active);
    const title=$('msTitle').value.trim(),note=$('msNotes').value.trim();
    const reportDate=$('msDate').value;
    if(!target){toast('Choose an active employee.',true);return}
    if(!title||title.length>160||note.length>1500||!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)){
      toast('Enter a valid report title, date, and optional notes.',true);return;
    }
    if(!file){toast('Choose a PDF or image report.',true);return}
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    const mime=TYPES[ext];
    if(!mime||file.type&&file.type!==mime||file.size<1||file.size>12582912){
      toast('Choose a PDF, JPG, PNG or WebP file up to 12 MB.',true);return;
    }
    const button=$('msUpload');button.disabled=true;button.textContent='Uploading…';
    const id=crypto.randomUUID(),path=employeeId+'/'+id+'.'+ext;
    let uploaded=false;
    try{
      const storage=state.db.storage.from(BUCKET);
      const result=await storage.upload(path,file,{contentType:mime,upsert:false,cacheControl:'0'});
      if(result.error)throw result.error;
      uploaded=true;
      const record=await state.db.from('mystery_shopper_reports').insert({
        id,employee_id:employeeId,report_date:reportDate,title,notes:note,
        original_filename:file.name.slice(0,200),file_path:path,
        mime_type:mime,file_size:file.size,uploaded_by:state.profile.id
      });
      if(record.error)throw record.error;
      uploaded=false;
      $('msUploadForm').reset();
      $('msDate').value=todayBeirut();
      await loadReports(true);
      toast('Mystery Shopper report saved privately for '+target.full_name+'.');
    }catch(error){
      if(uploaded) {
        const cleanup=await state.db.storage.from(BUCKET).remove([path]);
        if(cleanup.error)console.error('Failed to clean up orphan report object',cleanup.error);
      }
      toast('Report upload failed: '+(error.message||'Please retry.'),true);
    }finally{button.disabled=false;button.textContent='Upload report'}
  }
  function closePreview() {
    $('msPreview').classList.add('hidden');
    $('msPreviewBody').replaceChildren();
    $('msSaveReport').removeAttribute('href');
    if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl=null}
  }
  async function downloadReport(id,button){
    const report=state.reports.find(x=>x.id===id);
    if(!report)return;
    button.disabled=true;button.textContent='Preparing…';
    try{
      const {data,error}=await state.db.storage.from(BUCKET).download(report.file_path);
      if(error)throw error;
      closePreview();
      const url=URL.createObjectURL(data);
      state.previewUrl=url;
      const viewer=document.createElement(report.mime_type==='application/pdf'?'iframe':'img');
      viewer.src=url;
      if(report.mime_type==='application/pdf'){
        viewer.title='Mystery Shopper PDF report';
        viewer.className='ms-preview-frame';
      }else{
        viewer.alt=report.title;
        viewer.className='ms-preview-image';
      }
      $('msPreviewBody').appendChild(viewer);
      $('msPreviewName').textContent=report.title;
      const download=$('msSaveReport');
      download.href=url;
      download.download=report.original_filename;
      $('msPreview').classList.remove('hidden');
      $('msClosePreview').focus();
      status('Report opened. Choose Save file to keep a copy on your device.');
    }catch(error){toast('Could not open the report: '+(error.message||'Access denied.'),true)}
    finally{button.disabled=false;button.textContent='View report'}
  }
  async function deleteReport(id,button){
    if(!isAdmin())return;
    const report=state.reports.find(x=>x.id===id);
    if(!report||!confirm('Permanently delete "'+report.title+'" for '+nameOf(report.employee_id)+'? This cannot be undone.'))return;
    button.disabled=true;
    try{
      // First remove the private object, then remove its metadata.
      const r=await state.db.storage.from(BUCKET).remove([report.file_path]);
      if(r.error)throw r.error;
      const result=await state.db.from('mystery_shopper_reports').delete().eq('id',id).select('id');
      if(result.error)throw result.error;
      if(!result.data?.length)throw Error('The report record was not deleted. Contact an administrator.');
      await loadReports(true);
      toast('Mystery Shopper report deleted.');
    }catch(error){toast('Could not delete report: '+(error.message||'Please retry.'),true)}
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
    $('msDate').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Beirut'});
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
