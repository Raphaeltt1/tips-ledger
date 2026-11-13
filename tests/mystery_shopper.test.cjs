const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root=path.resolve(__dirname,'..');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=get('index.html'),frontend=get('mystery-shopper.js'),styles=get('mystery-shopper.css');
const migration=get('supabase/migrations/20261113_mystery_shopper_waiter_access.sql');
const create=get('supabase/functions/create-employee-/index.ts');
const del=get('supabase/functions/delete-employee/index.ts');

test('both main inline app and Mystery Shopper module parse as JavaScript',()=>{
  const first=html.indexOf("<script>\n(()=>{'use strict';");
  assert.ok(first>=0,'main app script exists');
  const src=html.slice(first+'<script>'.length,html.indexOf('</script>',first));
  assert.doesNotThrow(()=>new vm.Script(src));
  assert.doesNotThrow(()=>new vm.Script(frontend));
});
test('Mystery Shopper tab and scoped management form are present',()=>{
  assert.match(html,/data-tab="mystery"/);
  assert.match(html,/data-pane="mystery"/);
  assert.match(html,/id="msUploadForm"/);
  assert.match(html,/id="msManagement" class="ms-upload-card hidden"/);
  assert.match(html,/id="msEmployeeFilterField"/);
  assert.match(html,/mystery-shopper\.js\?v=/);
  assert.match(html,/mystery-shopper\.css\?v=/);
  assert.match(styles,/ms-reports-grid/);
});
test('Waiter / Waitress can be created, activated and deleted without payment eligibility',()=>{
  assert.match(html,/<option value="waiter_waitress">Waiter \/ Waitress<\/option>/);
  assert.match(html,/const TEAM_MEMBER_ROLES=\[\.\.\.PAYMENT_ROLES,'driver','waiter_waitress'\]/);
  assert.match(html,/runners=p\.data\.filter\(x=>isPaymentRole\(x\.role\)/);
  assert.match(html,/isWaiterRole\(profile\.role\)\?'mystery':'overview'/);
  assert.match(html,/show\('paymentsTab',!isWaiterRole\(profile\.role\)\&\&profile\.role!=='driver'\)/);
  assert.match(html,/show\('overviewTab',!isWaiterRole\(profile\.role\)\&\&profile\.role!=='driver'\)/);
  assert.match(create,/const teamRoles = \[[^\]]*"waiter_waitress"\]/);
  assert.match(del,/const teamRoles = \[[^\]]*"waiter_waitress"\]/);
  assert.match(migration,/profiles_role_check/);
  assert.match(migration,/public\.set_employee_active/);
  assert.match(migration,/public\.admin_permanently_delete_employee/);
});
test('Existing Schedule remains available to Waiter / Waitress',()=>{
  assert.match(html,/data-tab="schedule"/);
  assert.match(html,/data-pane="schedule"/);
  assert.match(html,/if\(tab==='schedule'\)window\.EmployeeLedger\?\.openSchedule/);
  assert.match(html,/const isWaiterRole=role=>role==='waiter_waitress'/);
  assert.match(html,/!\['schedule','requests','labor','training','mystery','account'\]\.includes\(tab\)/);
});
test('Database metadata read policy is exactly recipient or authorized management',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.mystery_shopper_reports/);
  assert.match(migration,/ALTER TABLE public\.mystery_shopper_reports ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/Owners see only own shopper reports; admins see all/);
  assert.match(migration,/employee_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration,/public\.current_user_role\(\)/);
  assert.match(migration,/Only admin and superuser can assign mystery reports/);
  assert.match(migration,/uploaded_by = \(SELECT auth\.uid\(\)\)/);
});
test('Private report files cannot be accessed by another employee',()=>{
  assert.match(migration,/VALUES \('mystery-shopper-reports','mystery-shopper-reports',false/);
  assert.match(migration,/Read only owned mystery reports or all for admin/);
  assert.match(migration,/r\.file_path = name/);
  assert.match(migration,/r\.employee_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration,/Admins upload mystery shopper files/);
  assert.match(migration,/Admins remove mystery shopper files/);
  assert.match(frontend,/\.storage\.from\(BUCKET\)\.download\(report\.file_path\)/);
  assert.doesNotMatch(frontend,/getPublicUrl\(/);
});
test('Upload path is randomized and accepts supported PDF and images only',()=>{
  assert.match(frontend,/crypto\.randomUUID\(\)/);
  assert.match(frontend,/employeeId\+'\/'\+id\+'\.'\+ext/);
  assert.match(frontend,/upsert:false/);
  assert.match(frontend,/file\.size>12582912/);
  assert.match(frontend,/mime_type:mime,file_size:file\.size/);
  assert.match(frontend,/upload\(path,file/);
});
test('Reports are downloadable, listed newest first and paged',()=>{
  assert.match(frontend,/\.order\('report_date',\{ascending:false\}\)/);
  assert.match(frontend,/const PAGE_SIZE = 20/);
  assert.match(frontend,/\.range\(state\.page\*PAGE_SIZE,/);
  assert.match(frontend,/original_filename/);
  assert.match(frontend,/data-ms-download/);
  assert.match(frontend,/View report/);
  assert.match(frontend,/function closePreview\(/);
  assert.match(frontend,/msPreviewBody/);
  assert.match(html,/id="msPreview"/);
  assert.match(html,/id="msSaveReport"/);
});
test('Deletion cleanup prevents orphaned private attachments on account removal',()=>{
  assert.match(del,/storage\.from\("mystery-shopper-reports"\)/);
  assert.match(del,/reportStore\.remove\(paths\)/);
  assert.match(del,/reportCleanupWarning/);
});

test('Follow-up migration fixes file extension matching in table and Storage policy',()=>{
  const correction=get('supabase/migrations/20261113_fix_mystery_report_file_path.sql');
  assert.match(correction,/DROP CONSTRAINT IF EXISTS report_path_belongs_to_employee/);
  assert.match(correction,/\[\.\]\(pdf\|jpg\|jpeg\|png\|webp\)/);
  assert.match(correction,/Admins upload mystery shopper files/);
});
