'use strict';
/* Real XLSX round-trip and styling regressions for Employee Ledger.
 * Uses the same ExcelJS browser bundle loaded by the app.
 * No live payment records or databases are touched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('excel-export.js', 'utf8');
const app = fs.readFileSync('index.html', 'utf8');
const ExcelJS = require(process.env.EXCELJS_BROWSER_BUNDLE || '/tmp/tl-exceljs.min.js');
assert.equal(typeof ExcelJS.Workbook, 'function', 'Browser ExcelJS bundle must expose Workbook');

function harness() {
  const state = { urls: [], clicked: [], removed: [], objects: [], timeouts: [] };
  const window = { ExcelJS };
  const document = {
    createElement(name) {
      assert.equal(name, 'a');
      const link = { style: {}, clicked: false, download: '', href: '',
        click() { this.clicked = true; state.clicked.push(this); },
        remove() { state.removed.push(this); }
      };
      return link;
    },
    body: { appendChild(link) { state.objects.push(link); } }
  };
  const url = {
    createObjectURL(blob) { state.urls.push(blob); return 'blob:tips-ledger-test'; },
    revokeObjectURL(path) { state.removed.push(path); }
  };
  vm.runInNewContext(source, {
    window, document, URL: url, Blob, Date, Number, String,
    Set, Error, Intl, Promise, Object,
    setTimeout(fn, ms) { state.timeouts.push({ fn, ms }); return state.timeouts.length; },
    clearTimeout() {}
  }, { filename: 'excel-export.js', timeout: 2000 });
  return { api: window.TipsLedgerExcel, state };
}
const records = [
  { id:'draft', week_start:'2026-10-05', runner_id:'a', hours_worked:3, tips_amount:1200, advances:100, net_payout:1100, published:false },
  { id:'published', week_start:'2026-10-12', runner_id:'b', hours_worked:4, tips_amount:2000, advances:200, net_payout:1800, published:true },
  { id:'received', week_start:'2026-10-19', runner_id:'c', hours_worked:5, tips_amount:3000, advances:300, net_payout:2700, published:true }
];
const names = new Map([['a','Alpha'],['b','Beta'],['c','Gamma']]);
async function inspect(input={}) {
  const { api, state } = harness();
  const result = await api.exportPayments({
    records, names, confirmed:['received'], ...input
  });
  assert.equal(state.clicked.length, 1, 'File download should be triggered once');
  assert.equal(state.urls.length, 1, 'File URL should be created once');
  assert.equal(state.removed.length, 1, 'Temporary download anchor must be removed');
  assert.equal(state.clicked[0].href, 'blob:tips-ledger-test');
  assert.match(state.clicked[0].download, /^employee-ledger-payments-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(state.urls[0].type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await state.urls[0].arrayBuffer()));
  return { result, state, wb, ws:wb.getWorksheet('Payments') };
}

test('real export opens as valid .xlsx with navy/blue professional styling', async () => {
  const { ws, result, wb } = await inspect();
  assert.ok(ws);
  assert.equal(wb.creator, 'Employee Ledger');
  assert.equal(ws.getCell('A1').value, 'EMPLOYEE.LEDGER  /  PAYMENT RECORD');
  assert.equal(ws.getCell('A1').fill.fgColor.argb, 'FF13223C');
  assert.equal(ws.getCell('A1').font.bold, true);
  assert.equal(ws.getCell('A1').font.color.argb, 'FFFFFFFF');
  assert.equal(ws.getCell('A10').value, 'PAYMENT DETAILS');
  assert.equal(ws.getCell('A11').fill.fgColor.argb, 'FF23446D');
  assert.equal(ws.getCell('F15').fill.fgColor.argb, 'FF285A99');
  assert.equal(ws.getCell('F15').font.color.argb, 'FFFFFFFF');
  assert.ok(ws._merges.A1, 'Header should be merged for clean appearance');
  assert.deepEqual([result.totals.hours, result.totals.tips, result.totals.advances, result.totals.net], [12, 6200, 600, 5600]);
});

test('preserves rows, status, employee names, numeric values, totals and formulas', async () => {
  const { ws } = await inspect();
  assert.equal(ws.getCell('A11').value, 'Week');
  assert.equal(ws.getCell('B11').value, 'Team member');
  assert.equal(ws.getCell('G11').value, 'Status');
  assert.deepEqual([ws.getCell('B12').value, ws.getCell('B13').value, ws.getCell('B14').value], ['Alpha','Beta','Gamma']);
  assert.deepEqual([ws.getCell('G12').value, ws.getCell('G13').value, ws.getCell('G14').value], ['Draft','Published','Received']);
  assert.equal(ws.getCell('G12').fill.fgColor.argb, 'FFFFF1D6');
  assert.equal(ws.getCell('G13').fill.fgColor.argb, 'FFE8F1FD');
  assert.equal(ws.getCell('G14').fill.fgColor.argb, 'FFE1F3E8');
  assert.deepEqual([ws.getCell('C12').value,ws.getCell('D12').value,ws.getCell('E12').value,ws.getCell('F12').value], [3,1200,100,1100]);
  assert.equal(ws.getCell('D15').value.formula, 'SUM(D12:D14)');
  assert.equal(ws.getCell('D15').value.result, 6200);
  assert.equal(ws.getCell('F15').value.result, 5600);
  assert.equal(ws.getCell('A7').value.formula, 'D15');
  assert.equal(ws.getCell('E7').value.formula, 'F15');
  assert.equal(ws.getCell('E7').value.result, 5600);
  assert.ok(ws.getCell('A12').value instanceof Date, 'Dates must be real spreadsheet dates');
  assert.equal(ws.getCell('A12').numFmt, 'dd mmm yyyy');
  assert.equal(ws.getCell('D12').numFmt, '#,##0.00');
  assert.equal(ws.views[0].state, 'frozen');
  assert.equal(ws.views[0].ySplit, 11);
});

test('export respects filtered records and includes only filtered totals', async () => {
  const { ws, result } = await inspect({ records:[records[2]] });
  assert.equal(result.count, 1);
  assert.equal(ws.getCell('B12').value, 'Gamma');
  assert.equal(ws.getCell('G12').value, 'Received');
  assert.equal(ws.getCell('D13').value.result, 3000);
  assert.equal(ws.getCell('F13').value.result, 2700);
  assert.equal(ws.getCell('B13').value, null);
});

test('empty filtered result still exports valid report with zero totals', async () => {
  const { ws, result } = await inspect({ records:[] });
  assert.equal(result.count, 0);
  assert.equal(result.totals.net, 0);
  assert.equal(ws.getCell('D12').value, 0);
  assert.equal(ws.getCell('F12').value, 0);
  assert.equal(ws.getCell('A7').value, 0);
});

test('invalid finance and date data fails before writing or downloading a file', async () => {
  const { api, state } = harness();
  for(const broken of [
    { ...records[0], tips_amount:-2 },
    { ...records[0], week_start:'2026-02-30' },
    { ...records[0], advances:NaN },
    { ...records[0], net_payout:Infinity }
  ]) await assert.rejects(api.exportPayments({records:[broken],names,confirmed:[]}),/invalid/i);
  assert.equal(state.clicked.length, 0);
});

test('UI still restricts exporting to management and passes the filtered data', () => {
  const start = app.indexOf("$('exportExcel').onclick=async()=>");
  const stop = app.indexOf("\n$('passwordForm').onsubmit",start);
  assert.ok(start>0&&stop>start,'Excel handler found');
  const code = app.slice(start,stop);
  assert.match(code, /manager','admin','superuser/);
  assert.match(code, /currentFilteredRows\.slice\(\)/);
  assert.match(code, /currentRunnerNames/);
  assert.match(code, /currentPaymentConfirmations\.slice\(\)/);
  assert.match(code, /b\.disabled=true/);
  assert.match(code, /finally\{b\.disabled=false\}/);
  assert.match(app, /excel-export\.js\?v=styled-20261101/);
  assert.doesNotMatch(source,/document\.body\.appendChild\(page\)|html2canvas|html2pdf/);
});
