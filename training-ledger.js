/* Employee Ledger — private yearly Training Ledger.
 * One assignment persists across calendar years; each year has its own status.
 * Management permissions are enforced by Supabase RLS, not hidden UI alone. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={db:null,profile:null,toast:null,year:0,people:[],courses:[],assignments:[],
    attendance:[],loadId:0,wired:false};
  const admin=()=>['admin','superuser'].includes(state.profile?.role);
  const myYear=()=>Number(new Intl.DateTimeFormat('en-GB',
    {timeZone:'Asia/Beirut',year:'numeric'}).format(new Date()));
  const notice=(message,bad=false)=>{
    const out=$('trStatus');
    if(out){out.textContent=message;out.classList.toggle('tr-error',bad)}
    if(bad)state.toast?.(message,true);
  };
  const roleLabel=role=>({superuser:'Superuser',admin:'Admin',manager:'Manager',
    waiter_waitress:'Waiter / Waitress',host_hostess:'Host/Hostess',runner:'Runner',
    counter:'Counter',expo:'Expo',kitchen_crew:'Kitchen Crew'})[role]||role;
  const courseFor=id=>state.courses.find(c=>c.id===id);
  const attendanceFor=(employeeId,courseId)=>state.attendance.find(a=>
    a.employee_id===employeeId&&a.training_id===courseId);
  const applies=(assignment,year)=>assignment.start_year<=year;
  const employeeName=id=>state.people.find(p=>p.id===id)?.full_name||
    (id===state.profile?.id?state.profile.full_name:'Employee');

  function renderYears(){
    const field=$('trYear');
    const original=state.year||myYear();
    const start=Math.max(2020,Math.min(original,myYear()-3,
      ...state.assignments.map(a=>a.start_year)));
    const end=Math.min(2100,Math.max(myYear()+2,original));
    field.innerHTML=Array.from({length:end-start+1},(_,i)=>{
      const y=end-i;return '<option value="'+y+'">'+y+'</option>';
    }).join('');
    field.value=String(state.year);
    $('trYearNote').textContent='Annual attendance is tracked separately for each calendar year.';
  }
  function renderEmployeeFilter(){
    if(!admin())return;
    const dropdown=$('trFilterEmployee'),before=dropdown.value;
    dropdown.innerHTML='<option value="">All employees</option>'+
      state.people.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.full_name)+
      ' · '+esc(roleLabel(p.role))+(p.active?'':' (inactive)')+'</option>').join('');
    if(state.people.some(p=>p.id===before))dropdown.value=before;
    const select=$('trAssignEmployee'),prior=select.value;
    select.innerHTML='<option value="">Choose an employee</option>'+
      state.people.filter(p=>p.active).map(p=>
       '<option value="'+esc(p.id)+'">'+esc(p.full_name)+' · '+esc(roleLabel(p.role))+'</option>').join('');
    if(state.people.some(p=>p.id===prior&&p.active))select.value=prior;
  }
  function renderCourseOptions(){
    if(!admin())return;
    const employeeId=$('trAssignEmployee').value;
    const options=$('trCourseOptions');
    const assigned=new Set(state.assignments.filter(a=>a.employee_id===employeeId)
      .map(a=>a.training_id));
    options.innerHTML=state.courses.length?state.courses.map(c=>{
      const already=assigned.has(c.id);
      return '<label class="tr-checkbox-option'+(already?' tr-already':'')+'">'+
      '<input type="checkbox" name="trCourseChoice" value="'+esc(c.id)+'"'+
      (already?' disabled':'')+'><span>'+esc(c.name)+
      (already?' <small>Already assigned</small>':'')+'</span></label>';
    }).join(''):'<p class="tr-empty-inline">Create a training type first.</p>';
  }
  function courseList(){
    if(!admin())return;
    const node=$('trCatalog');
    node.innerHTML=state.courses.length?state.courses.map(c=>
      '<div class="tr-catalog-item"><strong>'+esc(c.name)+'</strong>'+
      (c.description?'<span>'+esc(c.description)+'</span>':'')+'</div>'
    ).join(''):'<p class="tr-empty-inline">No training types yet. Add your first one above.</p>';
    $('trTypeCount').textContent=state.courses.length+' training type'+
      (state.courses.length===1?'':'s');
    renderCourseOptions();
  }
  function renderRoster(){
    const node=$('trRoster'),years=state.year,selectedEmployee=admin()?$('trFilterEmployee').value:'';
    const statusFilter=admin()?$('trFilterStatus').value:'';
    const people=admin()?
      state.people.filter(p=>!selectedEmployee||p.id===selectedEmployee):
      [{id:state.profile.id,full_name:state.profile.full_name,role:state.profile.role,active:true}];
    let attended=0,pending=0,rendered=0;
    const sections=[];
    for(const p of people){
      const assignments=state.assignments.filter(a=>a.employee_id===p.id&&applies(a,years))
        .sort((a,b)=>(courseFor(a.training_id)?.name||'').localeCompare(courseFor(b.training_id)?.name||''));
      const total=assignments.length;
      const relevant=assignments.filter(a=>{
        const isAttended=!!attendanceFor(p.id,a.training_id)?.attended;
        return !statusFilter||(statusFilter==='attended'?isAttended:!isAttended);
      });
      const entries=relevant.map(a=>{
        const course=courseFor(a.training_id);
        if(!course)return '';
        const didAttend=!!attendanceFor(p.id,a.training_id)?.attended;
        if(didAttend)attended++;else pending++;
        rendered++;
        const status='<span class="tr-pill '+(didAttend?'tr-attended':'tr-not-attended')+'">'+
          (didAttend?'✓ Attended':'○ Not Attended')+'</span>';
        const edit=admin()?'<button type="button" class="tr-status-toggle tl-secondary-button" '+
          'data-tr-employee="'+esc(p.id)+'" data-tr-course="'+esc(course.id)+'" '+
          'data-tr-next="'+String(!didAttend)+'">'+
          (didAttend?'Mark not attended':'Mark attended')+'</button>':'';
        return '<tr><td><strong>'+esc(course.name)+'</strong>'+
          (course.description?'<small class="tr-description">'+esc(course.description)+'</small>':'')+
          '</td><td class="tr-year-cell">'+years+'</td><td>'+status+'</td>'+
          (admin()?'<td>'+edit+'</td>':'')+'</tr>';
      }).filter(Boolean).join('');
      let body=entries;
      if(!body){
        const reason=total===0?'No trainings assigned for '+years+'.':
          'No trainings match this attendance filter.';
        body='<tr><td colspan="'+(admin()?4:3)+'" class="tr-empty-cell">'+reason+'</td></tr>';
      }
      const heading=admin()?'<div class="tr-person-heading"><strong>'+esc(p.full_name)+
        '</strong><span>'+esc(roleLabel(p.role))+(p.active?'':' · Inactive')+'</span></div>':'';
      sections.push('<section class="tr-person-card">'+heading+'<div class="tr-table-scroll"><table class="tr-table"><thead><tr>'+
        '<th>Training name</th><th>Year</th><th>Attendance</th>'+(admin()?'<th>Action</th>':'')+
        '</tr></thead><tbody>'+body+'</tbody></table></div></section>');
    }
    node.innerHTML=sections.length?sections.join(''):
      '<div class="tr-empty-state">No employees match your selection.</div>';
    $('trTotal').textContent=String(rendered);
    $('trAttended').textContent=String(attended);
    $('trPending').textContent=String(pending);
    $('trRosterCount').textContent=admin()?
      'Showing '+people.length+' employee'+(people.length===1?'':'s')+' · '+years:
      'Your annual training records · '+years;
  }

  async function loadData(){
    if(!state.db||!state.profile)return;
    const id=++state.loadId,year=state.year;
    notice('Loading annual training records…');
    try{
      const queries=[
        state.db.from('training_courses').select('id,name,description,created_at').order('name'),
        state.db.from('employee_training_assignments')
          .select('id,employee_id,training_id,start_year,created_at'),
        state.db.from('employee_training_attendance')
          .select('employee_id,training_id,training_year,attended,recorded_at')
          .eq('training_year',year)
      ];
      if(admin())queries.push(state.db.from('profiles')
        .select('id,full_name,role,active').order('full_name'));
      const results=await Promise.all(queries);
      if(id!==state.loadId)return;
      const failure=results.find(x=>x.error);
      if(failure)throw failure.error;
      [state.courses,state.assignments,state.attendance]=results.slice(0,3)
        .map(x=>x.data||[]);
      if(admin())state.people=results[3].data||[];
      renderYears();renderEmployeeFilter();courseList();renderRoster();
      notice('Annual training history is saved separately for each year.');
    }catch(e){
      if(id===state.loadId)notice('Could not load trainings: '+(e.message||'Please retry.'),true);
    }
  }

  async function addCourse(event){
    event.preventDefault();
    if(!admin())return;
    const name=$('trCourseName').value.trim(),description=$('trCourseDescription').value.trim();
    if(name.length<2||name.length>120||description.length>800){
      notice('Enter a training name between 2 and 120 characters.',true);return;
    }
    const button=$('trCreateCourse');button.disabled=true;
    try{
      const {error}=await state.db.from('training_courses')
        .insert({name,description,created_by:state.profile.id});
      if(error)throw error;
      $('trCourseForm').reset();
      await loadData();
      state.toast?.('Training type created successfully.');
    }catch(e){notice('Could not add training: '+(e.message||'Please retry.'),true)}
    finally{button.disabled=false}
  }
  async function assignCourses(event){
    event.preventDefault();
    if(!admin())return;
    const employeeId=$('trAssignEmployee').value;
    const year=Number($('trStartYear').value);
    const ids=[...document.querySelectorAll('input[name="trCourseChoice"]:checked')]
      .map(c=>c.value);
    if(!employeeId||!state.people.some(p=>p.id===employeeId&&p.active)){
      notice('Choose an active employee.',true);return;
    }
    if(!Number.isInteger(year)||year<2020||year>2100){
      notice('Choose a valid starting year.',true);return;
    }
    if(!ids.length){notice('Choose at least one training type.',true);return}
    const assigned=new Set(state.assignments.filter(a=>a.employee_id===employeeId)
      .map(a=>a.training_id));
    if(ids.some(id=>assigned.has(id)||!state.courses.some(c=>c.id===id))){
      notice('One or more trainings are already assigned. Refresh and try again.',true);return;
    }
    const button=$('trAssignButton');button.disabled=true;
    try{
      const {error}=await state.db.from('employee_training_assignments').insert(
        ids.map(training_id=>({employee_id:employeeId,training_id,start_year:year,
          assigned_by:state.profile.id})));
      if(error)throw error;
      await loadData();
      state.toast?.(ids.length+' training'+(ids.length===1?'':'s')+
        ' assigned. Attendance will be tracked automatically every year from '+year+'.');
    }catch(e){notice('Could not assign trainings: '+(e.message||'Please retry.'),true)}
    finally{button.disabled=false}
  }
  async function changeAttendance(button){
    if(!admin())return;
    const employee_id=button.dataset.trEmployee,training_id=button.dataset.trCourse;
    const attended=button.dataset.trNext==='true';
    const assignment=state.assignments.find(a=>a.employee_id===employee_id&&a.training_id===training_id);
    if(!assignment||!applies(assignment,state.year)){
      notice('The training is not assigned to this employee for the selected year.',true);return;
    }
    button.disabled=true;
    try{
      const {error}=await state.db.from('employee_training_attendance').upsert({
        employee_id,training_id,training_year:state.year,attended,
        recorded_by:state.profile.id,recorded_at:new Date().toISOString()
      },{onConflict:'employee_id,training_id,training_year'});
      if(error)throw error;
      await loadData();
      state.toast?.(attended?'Marked Attended':'Marked Not Attended')+' for '+state.year+'.');
    }catch(e){notice('Could not update training attendance: '+(e.message||'Please retry.'),true)}
    finally{button.disabled=false}
  }
  function wire(){
    if(state.wired)return;
    state.wired=true;
    $('trYear').addEventListener('change',()=>{
      state.year=Number($('trYear').value);loadData();
    });
    $('trRefresh').addEventListener('click',loadData);
    $('trFilterEmployee').addEventListener('change',renderRoster);
    $('trFilterStatus').addEventListener('change',renderRoster);
    $('trAssignEmployee').addEventListener('change',renderCourseOptions);
    $('trCourseForm').addEventListener('submit',addCourse);
    $('trAssignForm').addEventListener('submit',assignCourses);
    $('trRoster').addEventListener('click',event=>{
      const button=event.target.closest('button[data-tr-employee][data-tr-course]');
      if(button)changeAttendance(button);
    });
  }
  function init({db,profile,toast}){
    state.db=db;state.profile=profile;state.toast=toast;state.year=myYear();
    state.people=[];state.courses=[];state.assignments=[];state.attendance=[];
    $('trManagement').classList.toggle('hidden',!admin());
    $('trFilters').classList.toggle('hidden',!admin());
    $('trStartYear').value=String(state.year);
    $('trYear').value=String(state.year);
    wire();
  }
  function open(){loadData()}
  window.TrainingLedger=Object.freeze({init,open});
})();
