'use strict';
/* Audit Log export regression tests: real XLSX output + full-query pagination.
 * Executes shipped modules against offline data; never changes production records.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ExcelJS = require('/tmp/tl-exceljs.min.js');

const moduleSource = fs.readFileSync('excel-export.js', 'utf8');
const appSource = fs.readFileSync('index.html', 'utf8');

function auditExample(i, action='payment.published', overrides={}) {
  return {
    id: i + 1,
    occurred_at: new Date(Date.UTC(2026, 9, 31, 18, 0) - i * 60000).toISOString(),
    actor_id: 'admin-' + (i % 3),
    actor_name: i % 2 ? 'Manager Sample' : 'Admin Sample',
    actor_role: i % 2 ? 'manager' : 'superuser',
    action, entity_type:'weekly_tips',entity_id:'entry-'+i,
    target_user_id:'employee-'+(i % 4),
    target_name:'Employee '+(i % 4),
    details:{after:{tips_amount:1000 + i, advances:25}},
    display_role:i % 2 ? 'Manager' : 'Superuser',
    display_action:'Payment Published',
    display_details:'Tips LBP '+(1000+i)+' · Advance LBP 25',
    ...overrides
  };
}
function exporter() {
  const state = { links:[], blobs:[], removed:[], timeouts:[] };
  const window = { ExcelJS };
  const document = {
    createElement(tag) {
      assert.equal(tag,'a');
      return { style:{}, download:'', href:'', click(){state.links.push(this);},remove(){state.removed.push(this);} };
    },
    body:{appendChild(){}}
  };
  const url = {
    createObjectURL(blob){state.blobs.push(blob);return 'blob:audit-mock';},
    revokeObjectURL(){}
  };
  vm.runInNewContext(moduleSource,{
    window,document,URL:url,Blob,Date,Intl,Number,String,Set,Object,Error,Promise,
    setTimeout(fn,delay){state.timeouts.push({fn,delay});return state.timeouts.length;},
    clearTimeout(){}
  },{filename:'excel-export.js',timeout:3000});
  return {api:window.TipsLedgerExcel,state};
}
async function workbookFor(records,filterSummary='All activity (no filters applied)') {
  const {api,state}=exporter();
  const result=await api.exportAuditLog({records,filterSummary});
  assert.equal(result.count,records.length);
  assert.equal(state.links.length,1);
  assert.match(state.links[0].download,/^tips-ledger-audit-\d{4}-\d\d-\d\d\.xlsx$/);
  assert.equal(state.removed.length,1);
  assert.equal(state.blobs[0].type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await state.blobs[0].arrayBuffer()));
  return {book,log:book.getWorksheet('Audit Log'),raw:book.getWorksheet('Raw Records'),result};
}

test('real audit XLSX has polished navy style, summary, dates and complete raw records',async()=>{
  const original=[auditExample(0),auditExample(1,'employee.created')];
  const {book,log,raw,result}=await workbookFor(original);
  assert.equal(book.creator,'Tips Ledger');
  assert.equal(result.count,2);
  assert.equal(log.getCell('A1').value,'TIPS.LEDGER  /  AUDIT RECORDS');
  assert.equal(log.getCell('A1').fill.fgColor.argb,'FF13223C');
  assert.equal(log.getCell('A1').font.color.argb,'FFFFFFFF');
  assert.equal(log.getCell('A9').fill.fgColor.argb,'FF23446D');
  assert.equal(log.getCell('A8').value,2);
  assert.equal(log.getCell('B11').value,'Admin Sample');
  assert.equal(log.getCell('D11').value,'Payment Published');
  assert.equal(log.getCell('E11').value,'Employee 0');
  assert.equal(log.getCell('F11').value,'Tips LBP 1000 · Advance LBP 25');
  assert.equal(log.getCell('A11').numFmt,'dd mmm yyyy hh:mm');
  assert.ok(log.getCell('A11').value instanceof Date);
  assert.equal(log.getCell('A11').value.toISOString(),'2026-10-31T20:00:00.000Z','Beirut +02 local clock is displayed');
  assert.equal(log.views[0].ySplit,10);
  assert.ok(raw,'Complete raw records sheet must exist');
  assert.equal(raw.getCell('A5').value,'1');
  assert.equal(raw.getCell('E5').value,'superuser','Raw role is not a formatted label');
  assert.equal(raw.getCell('F6').value,'employee.created');
  assert.equal(raw.getCell('I5').value,'employee-0');
  assert.equal(raw.getCell('K5').value,JSON.stringify(original[0].details));
  assert.equal(raw.views[0].ySplit,4);
});

test('audit export only includes matching rows and carries selected filters',async()=>{
  const {log,raw}=await workbookFor([auditExample(4)],'Action: Payment published | Employee: Employee 0');
  assert.match(log.getCell('A5').value,/Payment published/);
  assert.equal(log.getCell('A8').value,1);
  assert.equal(log.getCell('E11').value,'Employee 0');
  assert.equal(log.getCell('B12').value,null);
  assert.equal(raw.getCell('A6').value,null);
});

test('no matching rows produces an actual empty, valid XLSX',async()=>{
  const {log,raw}=await workbookFor([],'Action: Payment deleted');
  assert.equal(log.getCell('A8').value,0);
  assert.equal(log.getCell('D8').value,'No matching events');
  assert.equal(raw.getCell('A5').value,null);
});

test('raw data is preserved and Excel formula-like user text is stored as text',async()=>{
  const record=auditExample(3,'employee.update',{
    actor_name:'=HYPERLINK("https://invalid.example","click")',
    display_action:'Employee Activated',
    details:{before:{active:false},after:{active:true},note:'some preserved string'}
  });
  const {log,raw}=await workbookFor([record]);
  assert.equal(log.getCell('D11').value,'Employee Activated');
  assert.equal(raw.getCell('D5').value,record.actor_name);
  assert.equal(typeof raw.getCell('D5').value,'string');
  assert.equal(raw.getCell('K5').value,JSON.stringify(record.details));
});

test('broken audit timestamp and oversized JSON fail before initiating download',async()=>{
  const {api,state}=exporter();
  await assert.rejects(api.exportAuditLog({records:[auditExample(1,undefined,{occurred_at:'not a date'})]}),/invalid.*timestamp/i);
  await assert.rejects(api.exportAuditLog({records:[auditExample(1,undefined,{details:{long:'x'.repeat(33000)}})]}),/cell length limit/i);
  assert.equal(state.links.length,0);
});

function queryEngine(rows) {
  const calls=[];
  const db={from(name){
    assert.equal(name,'audit_log');
    const q={rangeStart:0,rangeEnd:0,eqFilters:[],inFilters:[],gteTime:null,ltTime:null};
    return {
      select(columns){calls.push({type:'select',columns});return this;},
      order(){return this;},
      range(start,end){q.rangeStart=start;q.rangeEnd=end;calls.push({type:'range',start,end});return this;},
      in(key,values){q.inFilters.push([key,values]);return this;},
      eq(key,value){q.eqFilters.push([key,value]);return this;},
      gte(key,value){assert.equal(key,'occurred_at');q.gteTime=value;return this;},
      lt(key,value){assert.equal(key,'occurred_at');q.ltTime=value;return this;},
      then(resolve,reject){
        try{
          let filtered=rows;
          for(const [key,value] of q.eqFilters)filtered=filtered.filter(r=>r[key]===value);
          for(const [key,values] of q.inFilters)filtered=filtered.filter(r=>values.includes(r[key]));
          if(q.gteTime)filtered=filtered.filter(r=>r.occurred_at>=q.gteTime);
          if(q.ltTime)filtered=filtered.filter(r=>r.occurred_at<q.ltTime);
          filtered=filtered.slice().sort((a,b)=>
            b.occurred_at.localeCompare(a.occurred_at)||b.id-a.id);
          resolve({data:filtered.slice(q.rangeStart,q.rangeEnd+1),error:null});
        }catch(error){reject(error)}
      }
    }
  }};
  return {db,calls};
}
function auditHarness(rows) {
  const a=appSource.indexOf('function auditMatchesLegacy(');
  const b=appSource.indexOf('function auditDisplayAction(',a);
  const start=appSource.indexOf('const auditBeirutCalendar=');
  const end=appSource.indexOf('function renderAuditRecords()',start);
  assert.ok(a>0&&b>a&&start>b&&end>start,'Required production query/legacy helper found');
  const legacy=appSource.slice(a,b);
  const queried=appSource.slice(start,end);
  const engine=queryEngine(rows);
  const context={db:engine.db,Date,Intl,Number,Error,Set,Promise};
  vm.runInNewContext(legacy+'\n'+queried+
    '\nglobalThis.auditApi={allAuditExportRows,auditQuery,auditBeirutDayStartUtc}',context,{timeout:3000});
  return {...context.auditApi,calls:engine.calls};
}
const emptyFilters=()=>({action:'',actor:'',employee:'',from:'',to:''});

test('unfiltered export fetches all audit data beyond visible 10 and over 1000 rows',async()=>{
  const all=Array.from({length:1205},(_,i)=>auditExample(i));
  const api=auditHarness(all),progress=[];
  const result=await api.allAuditExportRows(emptyFilters(),n=>progress.push(n));
  assert.equal(result.length,1205);
  assert.deepEqual(progress,[500,1000,1205]);
  assert.deepEqual(api.calls.filter(x=>x.type==='range').map(x=>[x.start,x.end]),
    [[0,499],[500,999],[1000,1499]]);
  assert.equal(new Set(result.map(x=>x.id)).size,1205,'No missing or duplicate event records');
  assert.match(api.calls.find(x=>x.type==='select').columns,/actor_id,target_user_id|actor_id.*target_user_id/,
    'Complete raw fields fetched');
});

test('filters apply across all pages, including actor, employee, action and Beirut date window',async()=>{
  const rows=Array.from({length:1200},(_,i)=>auditExample(i,
    i%2===0?'payment.published':'employee.created',{
      actor_id:i%3===0?'admin-target':'other',
      target_user_id:i%4===0?'employee-target':'other'
    }));
  const api=auditHarness(rows);
  const f={action:'payment.published',actor:'admin-target',
    employee:'employee-target',from:'2026-10-31',to:'2026-10-31'};
  const result=await api.allAuditExportRows(f);
  assert.ok(result.length>0);
  assert.ok(result.every(r=>r.action==='payment.published'&&
    r.actor_id==='admin-target'&&r.target_user_id==='employee-target'));
  assert.ok(result.every(r=>r.occurred_at>='2026-10-30T22:00:00Z'&&r.occurred_at<'2026-10-31T22:00:00Z'));
});

test('legacy employee activations are filtered with exactly the same logic as the on-screen log',async()=>{
  const rows=[
    auditExample(0,'employee.update',{details:{before:{active:false},after:{active:true}}}),
    auditExample(1,'employee.update',{details:{before:{active:true},after:{active:false}}}),
    auditExample(2,'employee.update',{details:{before:{full_name:'Old'},after:{full_name:'New'}}}),
    auditExample(3,'employee.activated')
  ];
  const api=auditHarness(rows);
  const result=await api.allAuditExportRows({...emptyFilters(),action:'employee.activated'});
  assert.deepEqual([...result.map(r=>r.id)].sort((a,b)=>a-b),[1,4]);
});

test('Audit export button and explicit role guard are present; source is not UI pagination',()=>{
  assert.match(appSource,/id="exportAuditExcel"/);
  assert.match(appSource,/show\('exportAuditExcel',\['admin','superuser'\]\.includes\(profile\.role\)\)/);
  assert.match(appSource,/\$\('exportAuditExcel'\)\.onclick=async/);
  assert.match(appSource,/if\(!\['admin','superuser'\]\.includes\(profile\?\.role\)\)/);
  assert.match(appSource,/allAuditExportRows\(filters,/);
  assert.match(appSource,/records:log\.map/);
  assert.doesNotMatch(appSource,/\$\('exportAuditExcel'\)\.onclick=[\s\S]{0,600}auditPaging\.records\.slice/);
});
