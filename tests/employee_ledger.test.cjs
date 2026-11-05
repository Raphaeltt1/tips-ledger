/* Non-production integration checks for Employee Ledger. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ExcelJS=require('/tmp/tl-exceljs.min.js');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'employee-ledger.js'),'utf8');
const app=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261105_health_card_schedule_notifications.sql'),'utf8');
function internals(){
  const window={ExcelJS};
  const modified=source.replace(
    'window.EmployeeLedger=Object.freeze({init,onRefresh,openSchedule:loadScheduleIndex});',
    'window.__test={parseExcel,tableMarkup,mondayISO,dayDelta,getHealthGroup};'
  );
  assert.notEqual(modified,source,'test hook failed');
  vm.runInNewContext(modified,{window,document:{getElementById:()=>null},Date,Intl,console,setTimeout,clearTimeout},{timeout:3000});
  return window.__test;
}
const m=internals();
const mkfile=async(sheetNames)=>{
  const book=new ExcelJS.Workbook();
  for(const name of sheetNames){
    const ws=book.addWorksheet(name);
    ws.addRow(['Employee','Role','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
    ws.addRow(['Alex <script>','Waiter','12-6','OFF','12-6','6-11','12-6','OFF','6-11']);
    ws.addRow(['Sam','Runner','OFF','6-11','6-11','OFF','12-6','6-12','6-12']);
  }
  const bytes=Buffer.from(await book.xlsx.writeBuffer());
  return {name:'Schedule.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
};

test('visible Employee Ledger brand and both schedule selectors',()=>{
  assert.match(app,/<title>Employee Ledger<\/title>/);
  assert.match(app,/<div class="tl-brand-title">Employee Ledger<\/div>/);
  assert.match(app,/id="elScheduleFoh"/);
  assert.match(app,/id="elScheduleBoh"/);
  assert.match(app,/data-tab="schedule"/);
  assert.match(app,/data-pane="schedule"/);
  assert.match(app,/src="\.\/employee-ledger\.js/);
});
test('health cards stay management-only and callbacks do not expose write to staff',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.employee_health_cards/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/management_views_health_card_expiry/);
  assert.match(sql,/public\.is_admin\(\)/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.set_employee_health_card_expiry/);
  assert.match(sql,/current_user_role\(\)\) NOT IN \('admin','superuser'\)/);
  assert.match(source,/if\(!admin\(\)\)return;/);
});
test('Excel import selects FOH/BOH sheets independently with actual XLSX data',async()=>{
  const f=await mkfile(['BOH','FOH']);
  const foh=await m.parseExcel(f,'FOH');
  const boh=await m.parseExcel(f,'BOH');
  assert.equal(foh.sheet,'FOH');
  assert.equal(boh.sheet,'BOH');
  assert.equal(foh.rows[0][2],'Monday');
  assert.equal(foh.rows[1][0],'Alex <script>');
  assert.equal(foh.rows[1][3],'OFF');
});
test('schedule renderer HTML-escapes employee names and retains OFF emphasis',async()=>{
  const f=await mkfile(['FOH']);
  const parsed=await m.parseExcel(f,'FOH');
  const html=m.tableMarkup(parsed.rows);
  assert.match(html,/Monday/);
  assert.match(html,/el-day-off/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/Alex &lt;script&gt;/);
});
test('rejects legacy or oversized schedule files',async()=>{
  await assert.rejects(m.parseExcel({name:'old.xls',size:10},'FOH'),/\.xlsx/);
  await assert.rejects(m.parseExcel({name:'huge.xlsx',size:7000000},'BOH'),/6 MB/);
});
test('week-of dates snap to Mondays without client timezone drift',()=>{
  assert.equal(m.mondayISO('2026-11-05'),'2026-11-02');
  assert.equal(m.mondayISO('2026-11-08'),'2026-11-02');
  assert.equal(m.mondayISO('2026-11-09'),'2026-11-09');
});
test('draft imports do not notify; only successful publish changes status and broadcasts',()=>{
  assert.match(sql,/FOR INSERT TO authenticated WITH CHECK/);
  assert.match(sql,/status='draft' AND published_by IS NULL/);
  assert.match(sql,/WHERE id=p_publication_id AND status='draft'/);
  assert.match(sql,/AFTER UPDATE OF status ON public\.schedule_publications/);
  assert.match(sql,/Your weekly schedule has been published/);
  assert.match(source,/await state\.db\.rpc\('publish_employee_schedule'/);
  assert.match(source,/event_type:'schedule_published'/);
  assert.doesNotMatch(source,/function importSchedule[\s\S]*?function publishSchedule[\s\S]*?DELETE FROM/);
});
