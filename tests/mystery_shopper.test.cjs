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
  assert.match(html,/!\['schedule','requests','labor','training','mystery','menu','account'\]\.includes\(tab\)/);
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
test('New evaluations are summary-only, not source file uploads',()=>{
  const summary=get('supabase/migrations/20261127_mystery_shopper_summary_only.sql');
  assert.match(summary,/ENABLE ROW LEVEL SECURITY/);
  assert.match(summary,/employee_id=\(SELECT auth.uid\(\)\)/);
  assert.match(summary,/No new original mystery attachments/);
  assert.match(frontend,/state.db.from\(TABLE\)/);
  assert.match(frontend,/total_grade:summary.grade,no_points:summary.noPoints/);
  assert.doesNotMatch(frontend,/storage\.from\(/);
  assert.match(frontend,/event_type:'mystery_published'/);
  assert.match(html,/accept="\.pdf,application\/pdf"/);
  assert.match(html,/Download Word/);
});
test('Answer parser rejects ambiguous selections and requires the full template',()=>{
  const ctx={window:{}};
  vm.runInNewContext(get('mystery-pdf.js'),ctx);
  const {classify,ids}=ctx.window.MysteryPDF;
  assert.equal(ids.length,59);
  const centers=[420.4,446.2,470.8];
  const read=(x,y)=>{const dist=Math.min(...centers.map(c=>Math.abs(c-x)));return (dist>=3&&dist<=4.3)||(Math.abs(x-centers[1])<2.5&&Math.abs(y-100)<2.5)?0:255};
  assert.equal(classify(read,102.4),1);
  assert.throws(()=>classify(()=>255,102.4));
  assert.throws(()=>classify(()=>0,102.4));
});
test('Word export creates a ZIP-based document without PDF content',async()=>{
  const ctx={window:{},TextEncoder,Blob,Uint8Array,DataView};
  vm.runInNewContext(get('mystery-word.js'),ctx);
  const blob=ctx.window.MysteryWord.create({report_date:'2026-11-01',total_grade:90.91,no_points:[{code:'W12',section:'Waiters Performance',text:'Test <point>'}]},'Example');
  assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const bytes=Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0),0x04034b50);
  assert.ok(bytes.includes(Buffer.from('word/document.xml')));
  assert.ok(bytes.includes(Buffer.from('Test &lt;point&gt;')));
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
