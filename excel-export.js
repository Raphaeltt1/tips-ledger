/* Employee Ledger — styled, read-only payment history export.
   Source data comes exclusively from the existing filtered payment list.
   ExcelJS is loaded on demand to avoid impacting app startup. */
(() => {
  'use strict';
  const EXCEL_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const C = Object.freeze({
    navy: '13223C', navyLight: '23446D', blue: '285A99',
    ink: '1D2B42', muted: '687C98', white: 'FFFFFF',
    pale: 'F1F5FB', paleBlue: 'E8F1FD', border: 'DDE6F2',
    green: '176B4D', paleGreen: 'E1F3E8',
    amber: '8B5A19', paleAmber: 'FFF1D6',
    slate: '465E80', paleSlate: 'E8EEF7'
  });
  let loading = null;
  function loadExcel() {
    if (window.ExcelJS && typeof window.ExcelJS.Workbook === 'function') return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('Excel generator timed out. Check your internet connection.')), 15000);
      script.async = true;
      script.src = EXCEL_URL;
      script.onload = () => window.ExcelJS && typeof window.ExcelJS.Workbook === 'function'
        ? finish() : finish(new Error('Excel generator could not initialize.'));
      script.onerror = () => finish(new Error('Excel generator could not load. Check your internet connection.'));
      document.head.appendChild(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  const fill = color => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } });
  const font = (color, size, bold = false) => ({
    name: 'Aptos', family: 2, size, bold, color: { argb: 'FF' + color }
  });
  const borderBottom = { bottom: { style: 'hair', color: { argb: 'FF' + C.border } } };
  const safeNumber = value => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid payment amount in export.');
    return n;
  };
  function safeDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Invalid week date in export.');
    const d = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
      throw new Error('Invalid week date in export.');
    return d;
  }
  function statusOf(record, received) {
    return received.has(record.id) ? 'Received' : record.published ? 'Published' : 'Draft';
  }
  function mergeText(ws, address, value, fillColor, fontColor, size, bold = false, align = 'left') {
    ws.mergeCells(address);
    const cell = ws.getCell(address.split(':')[0]);
    cell.value = value;
    cell.fill = fill(fillColor);
    cell.font = font(fontColor, size, bold);
    cell.alignment = { vertical: 'middle', horizontal: align, indent: align === 'left' ? 1 : 0 };
    return cell;
  }
  function summaryBox(ws, labelRange, valueRange, label, value, result) {
    mergeText(ws, labelRange, label, C.paleBlue, C.muted, 9, true);
    const cell = mergeText(ws, valueRange,
      value === null ? result : { formula: value, result },
      C.paleBlue, C.navy, 17, true);
    cell.numFmt = '#,##0.00';
  }
  function downloadBlob(buffer, filename) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none';
    document.body.appendChild(link);
    try { link.click(); }
    finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
  async function exportPayments(input) {
    const records = (input && input.records) || [];
    if (!Array.isArray(records)) throw new Error('Invalid payment export records.');
    const names = input.names;
    const confirmed = new Set(input.confirmed || []);
    if (!names || typeof names.get !== 'function') throw new Error('Employee names not available.');
    // Check before making a file; no data is written to Supabase.
    const entries = records.map(x => ({
      id: x.id,
      week: safeDate(x.week_start),
      name: String(names.get(x.runner_id) || x.runner_id || 'Team Member'),
      hours: safeNumber(x.hours_worked),
      tips: safeNumber(x.tips_amount),
      advances: safeNumber(x.advances),
      net: safeNumber(x.net_payout),
      status: statusOf(x, confirmed)
    }));
    const totals = entries.reduce((a, x) => ({
      hours: a.hours + x.hours, tips: a.tips + x.tips,
      advances: a.advances + x.advances, net: a.net + x.net
    }), { hours: 0, tips: 0, advances: 0, net: 0 });
    await loadExcel();
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'Employee Ledger';
    wb.lastModifiedBy = 'Employee Ledger';
    wb.created = new Date();
    wb.modified = new Date();
    const ws = wb.addWorksheet('Payments', {
      views: [{ state: 'frozen', ySplit: 11, activeCell: 'B12' }],
      pageSetup: {
        paperSize: 9, orientation: 'landscape',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
      },
      properties: { defaultRowHeight: 23 }
    });
    ws.columns = [
      { header: '', key: 'week', width: 19 },
      { header: '', key: 'employee', width: 30 },
      { header: '', key: 'hours', width: 17 },
      { header: '', key: 'tips', width: 21 },
      { header: '', key: 'advances', width: 21 },
      { header: '', key: 'net', width: 23 },
      { header: '', key: 'status', width: 17 }
    ];
    ws.getRow(1).height = 26; ws.getRow(2).height = 26;
    ws.getRow(3).height = 28; ws.getRow(4).height = 27;
    ws.getRow(5).height = 12;
    ws.getRow(6).height = 23; ws.getRow(7).height = 30;
    ws.getRow(8).height = 22; ws.getRow(9).height = 16;
    ws.getRow(10).height = 30; ws.getRow(11).height = 32;

    mergeText(ws, 'A1:G2', 'EMPLOYEE.LEDGER  /  PAYMENT RECORD', C.navy, C.white, 18, true);
    mergeText(ws, 'A3:G3', 'WEEKLY PAYMENT HISTORY  |  ALL AMOUNTS IN LBP', C.navy, 'C3D5EF', 10, true);
    const day = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Beirut', day: '2-digit', month: 'long', year: 'numeric'
    }).format(new Date());
    mergeText(ws, 'A4:G4',
      'Generated ' + day + '  |  ' + entries.length + ' payment record' + (entries.length === 1 ? '' : 's') +
      '  |  Reflects currently applied filters', C.pale, C.muted, 10);

    const firstDataRow = 12;
    const totalRow = firstDataRow + entries.length;
    summaryBox(ws, 'A6:B6', 'A7:B8', 'TOTAL TIPS / LBP',
      entries.length ? 'D' + totalRow : null, totals.tips);
    summaryBox(ws, 'C6:D6', 'C7:D8', 'ADVANCES / LBP',
      entries.length ? 'E' + totalRow : null, totals.advances);
    summaryBox(ws, 'E6:G6', 'E7:G8', 'NET PAYOUT / LBP',
      entries.length ? 'F' + totalRow : null, totals.net);
    mergeText(ws, 'A10:G10', 'PAYMENT DETAILS', C.navyLight, C.white, 11, true);

    const headers = ['Week', 'Team member', 'Hours worked', 'Tips (LBP)', 'Advances (LBP)', 'Remaining tips (LBP)', 'Status'];
    const header = ws.getRow(11);
    headers.forEach((name, index) => {
      const cell = header.getCell(index + 1);
      cell.value = name;
      cell.fill = fill(C.navyLight);
      cell.font = font(C.white, 10, true);
      cell.alignment = { vertical: 'middle', horizontal: index >= 2 && index <= 5 ? 'right' : 'left', indent: 1 };
    });
    entries.forEach((entry, i) => {
      const row = ws.getRow(firstDataRow + i);
      row.height = 28;
      const values = [entry.week, entry.name, entry.hours, entry.tips, entry.advances, entry.net, entry.status];
      values.forEach((value, columnIndex) => {
        const cell = row.getCell(columnIndex + 1);
        cell.value = value;
        cell.fill = fill(i % 2 === 0 ? C.white : C.pale);
        cell.font = font(C.ink, 10, columnIndex === 5);
        cell.alignment = { vertical: 'middle', horizontal: columnIndex >= 2 && columnIndex <= 5 ? 'right' : 'left', indent: 1 };
        cell.border = borderBottom;
        if (columnIndex === 0) cell.numFmt = 'dd mmm yyyy';
        if (columnIndex === 2) cell.numFmt = '0.##';
        if (columnIndex >= 3 && columnIndex <= 5) cell.numFmt = '#,##0.00';
        if (columnIndex === 6) {
          const palette = entry.status === 'Received' ? [C.paleGreen, C.green]
            : entry.status === 'Published' ? [C.paleBlue, C.blue] : [C.paleAmber, C.amber];
          cell.fill = fill(palette[0]);
          cell.font = font(palette[1], 10, true);
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      });
    });

    const lastDetail = totalRow - 1;
    ws.getRow(totalRow).height = 33;
    const totalCells = ws.getRow(totalRow);
    const formulas = entries.length
      ? [null, null, 'SUM(C' + firstDataRow + ':C' + lastDetail + ')',
        'SUM(D' + firstDataRow + ':D' + lastDetail + ')',
        'SUM(E' + firstDataRow + ':E' + lastDetail + ')',
        'SUM(F' + firstDataRow + ':F' + lastDetail + ')']
      : [null, null, null, null, null, null];
    const results = [null, null, totals.hours, totals.tips, totals.advances, totals.net];
    for (let col = 1; col <= 7; col++) {
      const cell = totalCells.getCell(col);
      cell.value = col === 1 ? 'TOTAL' : col >= 3 && col <= 6
        ? formulas[col - 1] ? { formula: formulas[col - 1], result: results[col - 1] } : 0
        : null;
      cell.fill = fill(col === 6 ? C.blue : C.navy);
      cell.font = font(C.white, col === 6 ? 12 : 10, true);
      cell.alignment = { vertical: 'middle', horizontal: col >= 3 && col <= 6 ? 'right' : 'left', indent: 1 };
      if (col === 3) cell.numFmt = '0.##';
      if (col >= 4 && col <= 6) cell.numFmt = '#,##0.00';
    }

    const footer = totalRow + 2;
    ws.getRow(footer).height = 25;
    mergeText(ws, 'A' + footer + ':G' + footer,
      'INTERNAL FINANCIAL EXPORT  /  Net payout = tips minus advances. Statuses are based on recorded employee confirmations.',
      C.pale, C.muted, 9);
    ws.autoFilter = { from: 'A11', to: 'G' + Math.max(lastDetail, 11) };
    ws.printTitlesRow = '10:11';
    ws.headerFooter.oddFooter = '&L EMPLOYEE.LEDGER  |  INTERNAL USE ONLY&RPage &P of &N';
    const bytes = await wb.xlsx.writeBuffer();
    const filename = 'employee-ledger-payments-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    downloadBlob(bytes, filename);
    return { filename, count: entries.length, totals };
  }

  // Audit workbook: polished readable history + an unabridged raw-records sheet.
  // The caller has already fetched all pages using the server's protected RLS query.
  async function exportAuditLog(input) {
    if (!input || !Array.isArray(input.records)) throw new Error('Invalid Audit Log export records.');
    const records = input.records;
    const summary = String(input.filterSummary || 'All activity (no filters applied)');
    const localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const makeLocalDate = date => {
      const instant = new Date(date);
      if (!Number.isFinite(instant.getTime())) throw new Error('Invalid Audit Log timestamp.');
      const parts = localTime.formatToParts(instant);
      const get = type => Number(parts.find(p => p.type === type).value);
      return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')));
    };
    const clean = value => value == null ? '' : String(value);
    const data = records.map(x => {
      if (x.id == null || !x.occurred_at) throw new Error('Incomplete Audit Log record.');
      const details = JSON.stringify(x.details ?? {});
      if (details.length > 32767) throw new Error('An Audit Log entry exceeds the Excel cell length limit.');
      return {
        when: makeLocalDate(x.occurred_at),
        actor: clean(x.actor_name || 'System / unavailable'),
        role: clean(x.display_role || x.actor_role || '—'),
        rawRole: clean(x.actor_role),
        action: clean(x.display_action || x.action),
        employee: clean(x.target_name || '—'),
        details: clean(x.display_details),
        id: clean(x.id),
        timestamp: clean(x.occurred_at),
        actorId: clean(x.actor_id),
        actionCode: clean(x.action),
        entityType: clean(x.entity_type),
        entityId: clean(x.entity_id),
        employeeId: clean(x.target_user_id),
        json: details
      };
    });
    await loadExcel();
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'Employee Ledger';
    workbook.lastModifiedBy = 'Employee Ledger';
    workbook.created = new Date();
    workbook.modified = new Date();
    const pageOptions = {
      paperSize: 9, orientation: 'landscape', fitToPage: true,
      fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
    };
    const ws = workbook.addWorksheet('Audit Log', {
      views: [{ state: 'frozen', ySplit: 10, activeCell: 'B11' }],
      pageSetup: pageOptions, properties: { defaultRowHeight: 24 }
    });
    ws.columns = [
      { key: 'when', width: 23 }, { key: 'actor', width: 30 },
      { key: 'role', width: 17 }, { key: 'action', width: 30 },
      { key: 'employee', width: 31 }, { key: 'details', width: 65 }
    ];
    for (const [index, height] of [[1,28],[2,29],[3,28],[4,34],[5,27],[6,11],[7,25],[8,35],[9,28],[10,32]]) {
      ws.getRow(index).height = height;
    }
    mergeText(ws, 'A1:F2', 'EMPLOYEE.LEDGER  /  AUDIT RECORDS', C.navy, C.white, 18, true);
    mergeText(ws, 'A3:F3', 'ACTIVITY & ACCOUNTABILITY  |  INTERNAL ACCESS ONLY', C.navy, 'C3D5EF', 10, true);
    const now = new Date();
    const dateLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Beirut', dateStyle: 'medium', timeStyle: 'short'
    }).format(now);
    mergeText(ws, 'A4:F4', 'Exported ' + dateLabel + ' (Beirut time)  |  ' +
      data.length + ' matching event' + (data.length === 1 ? '' : 's'), C.pale, C.muted, 10);
    mergeText(ws, 'A5:F5', 'FILTERS: ' + summary.slice(0, 255), C.pale, C.ink, 10);
    mergeText(ws, 'A7:C7', 'EXPORTED EVENTS', C.paleBlue, C.muted, 9, true);
    mergeText(ws, 'D7:F7', 'AUDIT PERIOD  /  BEIRUT TIME', C.paleBlue, C.muted, 9, true);
    mergeText(ws, 'A8:C8', data.length, C.paleBlue, C.navy, 18, true);
    const first = data.at(-1)?.when, last = data[0]?.when;
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric'
    });
    const span = data.length ? fmt.format(first) + '  —  ' + fmt.format(last) : 'No matching events';
    mergeText(ws, 'D8:F8', span, C.paleBlue, C.navy, 12, true);
    mergeText(ws, 'A9:F9', 'AUDIT EVENT HISTORY', C.navyLight, C.white, 11, true);
    const columns = ['When (Beirut)', 'Performed by', 'Role', 'Action', 'Employee', 'Details'];
    columns.forEach((label, i) => {
      const cell = ws.getRow(10).getCell(i + 1);
      cell.value = label;
      cell.fill = fill(C.navyLight);
      cell.font = font(C.white, 10, true);
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    });
    data.forEach((entry, i) => {
      const row = ws.getRow(11 + i);
      row.height = 30;
      [entry.when, entry.actor, entry.role, entry.action, entry.employee, entry.details].forEach((value, j) => {
        const cell = row.getCell(j + 1);
        cell.value = value;
        cell.fill = fill(i % 2 ? C.pale : C.white);
        cell.font = font(j === 3 ? C.blue : C.ink, 10, j === 3);
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: j === 5 };
        cell.border = borderBottom;
        if (j === 0) cell.numFmt = 'dd mmm yyyy hh:mm';
      });
    });
    const endRow = 10 + data.length;
    const footer = endRow + 2;
    ws.getRow(footer).height = 28;
    mergeText(ws, 'A' + footer + ':F' + footer,
      'INTERNAL AUDIT EXPORT   •   All matching records, including those beyond the on-screen pages. Raw event data is available on the second sheet.',
      C.pale, C.muted, 9);
    if (data.length) ws.autoFilter = { from: 'A10', to: 'F' + endRow };
    ws.printTitlesRow = '9:10';
    ws.headerFooter.oddFooter = '&L EMPLOYEE.LEDGER  |  CONFIDENTIAL AUDIT&RPage &P of &N';

    const raw = workbook.addWorksheet('Raw Records', {
      views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5' }],
      pageSetup: pageOptions
    });
    raw.columns = [
      {width:20},{width:27},{width:40},{width:30},{width:16},{width:30},
      {width:22},{width:40},{width:40},{width:30},{width:72}
    ];
    raw.getRow(1).height = 35;
    mergeText(raw, 'A1:K1', 'EMPLOYEE.LEDGER  /  ORIGINAL AUDIT DATA', C.navy, C.white, 16, true);
    mergeText(raw, 'A2:K2', 'UNALTERED EVENT FIELDS   |   UTC TIMESTAMPS   |   INTERNAL USE ONLY',
      C.navyLight, C.white, 10, true);
    mergeText(raw, 'A3:K3', 'Includes record identifiers, original action codes and complete JSON details.',
      C.pale, C.muted, 10);
    const rawHeaders = ['Event ID','Timestamp (UTC)','Actor ID','Actor name','Actor role',
      'Action code','Entity type','Entity ID','Employee ID','Employee name','Details JSON'];
    rawHeaders.forEach((label,i) => {
      const cell = raw.getRow(4).getCell(i+1);
      cell.value = label; cell.font = font(C.white,10,true);cell.fill = fill(C.navyLight);
      cell.alignment = { vertical: 'middle', indent: 1 };
    });
    raw.getRow(4).height = 31;
    data.forEach((x,i) => {
      const row = raw.getRow(i+5);row.height = 26;
      [x.id,x.timestamp,x.actorId,x.actor,x.rawRole,x.actionCode,x.entityType,
        x.entityId,x.employeeId,x.employee,x.json].forEach((value,j) => {
        const cell = row.getCell(j+1);
        cell.value = value;cell.font = font(C.ink,9);
        cell.fill = fill(i%2 ? C.pale : C.white);
        cell.border = borderBottom;
        cell.alignment = { vertical: 'middle', indent: 1 };
      });
    });
    if(data.length)raw.autoFilter={from:'A4',to:'K'+(data.length+4)};
    raw.printTitlesRow='4:4';
    raw.headerFooter.oddFooter = '&L EMPLOYEE.LEDGER  |  CONFIDENTIAL RAW AUDIT&RPage &P of &N';

    const bytes = await workbook.xlsx.writeBuffer();
    const filename = 'employee-ledger-audit-' + now.toISOString().slice(0,10) + '.xlsx';
    downloadBlob(bytes, filename);
    return { filename, count: data.length };
  }

  async function exportRequests(week,records,days){
    await loadExcel();
    const book=new window.ExcelJS.Workbook();
    const sheet=book.addWorksheet('Weekly requests',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
    sheet.addRow(['Schedule requests · Week of '+week]);sheet.mergeCells('A1:H1');
    sheet.addRow(['Employee',...days]);
    for(const r of records)sheet.addRow([r.employee_name,...days.map(day=>r.days[day]||'')]);
    sheet.getColumn(1).width=Math.max(25,...records.map(r=>Math.min(45,r.employee_name.length+3)));
    for(let i=2;i<=8;i++)sheet.getColumn(i).width=13;
    for(const i of [1,2]){const row=sheet.getRow(i);row.font=font(C.white,12,true);row.fill=fill(C.navy);row.height=23;}
    sheet.pageSetup.printTitlesRow='1:2';sheet.views=[{state:'frozen',ySplit:2,xSplit:1}];
    sheet.headerFooter.oddFooter='&RPage &P of &N';
    downloadBlob(await book.xlsx.writeBuffer(),'schedule-requests-'+week+'.xlsx');
  }
  window.TipsLedgerExcel = Object.freeze({ exportPayments, exportAuditLog, exportRequests });
})();