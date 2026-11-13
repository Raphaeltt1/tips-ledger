const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
const app=file('index.html');
const source=file('training-ledger.js');
const migration=file('supabase/migrations/20261113_annual_training_ledger.sql');
const css=file('training-ledger.css');

function trainingModule() {
  const nodes={};
  function el(id){
    return nodes[id]||(nodes[id]={value:'',textContent:'',innerHTML:'',classList:{toggle(){}}});
  }
  const window={};
  const testable=source.replace(
    'window.TrainingLedger=Object.freeze({init,open});',
    'window.__test={state,applies,renderRoster,renderYears};');
  assert.notEqual(source,testable,'Training test hook not available');
  vm.runInNewContext(testable,{window,document:{getElementById:el},Date,Intl,console},
    {timeout:3000});
  return {model:window.__test,nodes,get:el};
}
test('Training JavaScript and existing main app parse without changing payments',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  const main=app.indexOf("<script>\n(()=>{'use strict';");
  assert.ok(main>0);
  const code=app.slice(main+'<script>'.length,app.indexOf('</script>',main));
  assert.doesNotThrow(()=>new vm.Script(code));
  assert.match(app,/const PAYMENT_ROLES=\['runner','host_hostess','counter','expo','kitchen_crew'\]/);
});
test('Training navigation works for every employee role including waiters',()=>{
  assert.match(app,/data-tab="training"/);
  assert.match(app,/data-pane="training"/);
  assert.match(app,/if\(tab==='training'\)window\.TrainingLedger\?\.open/);
  assert.match(app,/window\.TrainingLedger\?\.init/);
  assert.match(app,/\['schedule','requests','training','mystery','account'\]/);
  assert.match(app,/training-ledger\.js\?v=/);
  assert.match(app,/training-ledger\.css\?v=/);
  assert.match(css,/tr-person-card/);
});
test('Management can create, assign multiple trainings and record attendance; employee view is read only',()=>{
  for(const id of ['trManagement','trCourseForm','trAssignForm','trAssignEmployee',
    'trCourseOptions','trYear','trRoster','trFilterEmployee','trFilterStatus'])
    assert.match(app,new RegExp('id="'+id+'"'));
  assert.match(source,/if\(!admin\(\)\)return;/);
  assert.match(source,/input\[name="trCourseChoice"\]:checked/);
  assert.match(source,/\.from\('training_courses'\)/);
  assert.match(source,/\.from\('employee_training_assignments'\)/);
  assert.match(source,/\.from\('employee_training_attendance'\)/);
  assert.match(source,/\.upsert\(\{/);
  assert.match(source,/\{onConflict:'employee_id,training_id,training_year'\}/);
  assert.match(source,/state\.profile\.id/);
});
test('Training catalog persists annually and attendance status is isolated by year',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.training_courses/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.employee_training_assignments/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.employee_training_attendance/);
  assert.match(migration,/start_year integer NOT NULL/);
  assert.match(migration,/training_year integer NOT NULL/);
  assert.match(migration,/CONSTRAINT attendance_one_record_per_year UNIQUE\(employee_id,training_id,training_year\)/);
  assert.match(migration,/CONSTRAINT attendance_belongs_to_assignment FOREIGN KEY/);
  const {model,get}=trainingModule();
  assert.equal(model.applies({start_year:2026},2025),false);
  assert.equal(model.applies({start_year:2026},2026),true);
  assert.equal(model.applies({start_year:2026},2027),true);
});
test('RLS is enforced for own training records, with only Admin/Superuser writes',()=>{
  for(const table of ['training_courses','employee_training_assignments','employee_training_attendance'])
    assert.match(migration,new RegExp('ALTER TABLE public\\.'+table+' ENABLE ROW LEVEL SECURITY'));
  assert.match(migration,/employee_id=\(SELECT auth\.uid\(\)\)/);
  assert.match(migration,/\(SELECT public\.current_user_role\(\)\) IS NOT NULL/);
  assert.match(migration,/\(SELECT public\.is_admin\(\)\)/);
  assert.match(migration,/Only admins record yearly training attendance/);
  assert.match(migration,/Only admins update yearly training attendance/);
  assert.doesNotMatch(migration,/GRANT DELETE/);
  assert.doesNotMatch(migration,/GRANT UPDATE ON public\.employee_training_assignments/);
});
test('Status is new every year without losing the previous year history',()=>{
  const {model,get}=trainingModule();
  model.state.profile={id:'admin',role:'admin',full_name:'Manager'};
  model.state.people=[
    {id:'alice',full_name:'Alice',role:'waiter_waitress',active:true},
    {id:'bob',full_name:'Bob',role:'runner',active:true},
    {id:'carl',full_name:'Carl',role:'counter',active:true}
  ];
  model.state.courses=[
    {id:'safety',name:'Food Safety',description:''},
    {id:'service',name:'Customer Service',description:''}
  ];
  model.state.assignments=[
    {employee_id:'alice',training_id:'safety',start_year:2026},
    {employee_id:'alice',training_id:'service',start_year:2026},
    {employee_id:'bob',training_id:'safety',start_year:2026}
  ];
  model.state.year=2026;
  model.state.attendance=[{employee_id:'alice',training_id:'safety',training_year:2026,attended:true}];
  model.renderRoster();
  assert.equal(get('trTotal').textContent,'3');
  assert.equal(get('trAttended').textContent,'1');
  assert.equal(get('trPending').textContent,'2');
  assert.match(get('trRoster').innerHTML,/No trainings assigned/);
  model.state.year=2027;
  model.state.attendance=[];
  model.renderRoster();
  assert.equal(get('trTotal').textContent,'3');
  assert.equal(get('trAttended').textContent,'0');
  assert.equal(get('trPending').textContent,'3');
  assert.match(get('trRoster').innerHTML,/Mark attended/);
});
test('Staff view shows only their own assignments with no edit buttons',()=>{
  const {model,get}=trainingModule();
  model.state.profile={id:'alice',role:'waiter_waitress',full_name:'Alice'};
  model.state.courses=[{id:'safety',name:'Food <script>Safety</script>',description:'Mandatory'}];
  model.state.assignments=[
    {employee_id:'alice',training_id:'safety',start_year:2026},
    {employee_id:'bob',training_id:'safety',start_year:2026}
  ];
  model.state.year=2027;
  model.renderRoster();
  const html=get('trRoster').innerHTML;
  assert.match(html,/Food &lt;script&gt;Safety&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/data-tr-employee/);
  assert.doesNotMatch(html,/Bob/);
  assert.match(html,/Not Attended/);
});
