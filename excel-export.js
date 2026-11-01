/* Tips Ledger — styled, read-only payment history export.
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
      typeof value === 'string' ? value : { formula: value, result },
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
    wb.creator = 'Tips Ledger';
    wb.lastModifiedBy = 'Tips Ledger';
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

    mergeText(ws, 'A1:G2', 'TIPS.LEDGER  /  PAYMENT RECORD', C.navy, C.white, 18, true);
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
      entries.length ? 'D' + totalRow : '0', totals.tips);
    summaryBox(ws, 'C6:D6', 'C7:D8', 'ADVANCES / LBP',
      entries.length ? 'E' + totalRow : '0', totals.advances);
    summaryBox(ws, 'E6:G6', 'E7:G8', 'NET PAYOUT / LBP',
      entries.length ? 'F' + totalRow : '0', totals.net);
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
    ws.headerFooter.oddFooter = '&L TIPS.LEDGER  |  INTERNAL USE ONLY&RPage &P of &N';
    const bytes = await wb.xlsx.writeBuffer();
    const filename = 'tips-ledger-payments-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    downloadBlob(bytes, filename);
    return { filename, count: entries.length, totals };
  }
  window.TipsLedgerExcel = Object.freeze({ exportPayments });
})();