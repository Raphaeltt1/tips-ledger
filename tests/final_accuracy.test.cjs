'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('index.html', 'utf8');
function excerpt(begin, end) {
  const start = source.indexOf(begin);
  assert.ok(start !== -1, 'Missing source: ' + begin);
  const stop = source.indexOf(end, start);
  assert.ok(stop > start, 'Missing end of source: ' + end);
  return source.slice(start, stop);
}

// Run the actual audit filter functions from the shipped HTML against a query
// recorder. Verify exact UTC query boundaries for local Beirut calendar days.
const auditCode = excerpt('const auditBeirutCalendar=', 'function renderAuditRecords()');
const operations = [];
const query = {};
for (const method of ['select', 'order', 'range', 'in', 'eq', 'gte', 'lt']) {
  query[method] = (...args) => { operations.push([method, ...args]); return query; };
}
const auditContext = { db: { from: name => {
  assert.equal(name, 'audit_log'); return query;
}}, Intl, Date, Error };
vm.runInNewContext(auditCode + '\n;globalThis.__audit = {auditBeirutDayStartUtc, auditQuery}', auditContext);
const { auditBeirutDayStartUtc, auditQuery } = auditContext.__audit;
const zoneFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit', day: '2-digit'
});
function localDate(instant) {
  const parts = zoneFormatter.formatToParts(new Date(instant));
  const field = name => parts.find(p => p.type === name).value;
  return field('year') + '-' + field('month') + '-' + field('day');
}
for (const day of ['2026-01-15', '2026-03-28', '2026-03-29', '2026-03-30',
                   '2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01']) {
  const start = auditBeirutDayStartUtc(day);
  assert.equal(localDate(start), day, 'Start must be inside chosen Beirut date ' + day);
  assert.ok(localDate(Date.parse(start) - 1) < day, 'Previous millisecond must be earlier than ' + day);
}
const initial = auditBeirutDayStartUtc('2026-03-29');
const after = auditBeirutDayStartUtc('2026-03-30');
assert.ok([23, 24, 25].includes((Date.parse(after) - Date.parse(initial)) / 3600000), 'DST day must have valid length');
operations.length = 0;
auditQuery({action:'', actor:'', employee:'', from:'2026-10-25', to:'2026-10-25'}, 0, 49);
assert.ok(operations.some(x => x[0] === 'gte' && x[1] === 'occurred_at' && x[2] === auditBeirutDayStartUtc('2026-10-25')));
assert.ok(operations.some(x => x[0] === 'lt' && x[1] === 'occurred_at' && x[2] === auditBeirutDayStartUtc('2026-10-26')));
assert.ok(!operations.some(x => x[0] === 'lte'), 'Use exclusive next-day upper boundary');
operations.length = 0;
auditQuery({action:'employee.activated',actor:'person',employee:'target',from:'',to:''}, 10, 19);
assert.ok(operations.some(x => x[0] === 'in' && x[1] === 'action' && x[2][0] === 'employee.activated'));
assert.ok(operations.some(x => x[0] === 'eq' && x[1] === 'actor_id' && x[2] === 'person'));
assert.ok(operations.some(x => x[0] === 'eq' && x[1] === 'target_user_id' && x[2] === 'target'));
assert.ok(!operations.some(x => ['gte','lt'].includes(x[0])), 'No date filter means no date bound');

// Verify that the export button still forwards the currently filtered rows to
// the styled workbook generator. Real XLSX totals and statuses are tested in
// tests/excel_export.test.cjs using the actual ExcelJS browser bundle.
const exportCode = excerpt(" $('exportExcel').onclick=async()=>{".trim(), "\n$('passwordForm').onsubmit");
assert.match(exportCode, /\['manager','admin','superuser'\]/);
assert.match(exportCode, /currentFilteredRows\.slice\(\)/);
assert.match(exportCode, /currentRunnerNames/);
assert.match(exportCode, /currentPaymentConfirmations\.slice\(\)/);
assert.match(exportCode, /TipsLedgerExcel\.exportPayments/);
assert.match(exportCode, /finally\{b\.disabled=false\}/);

console.log('PASS: Beirut Audit Log dates, DST boundaries and styled Excel export integration.');
