/* Tips Ledger: lightweight vector PDF receipts, with native iPhone file sharing.
   Only call prepare() with the row returned by get_confirmed_payment_receipt RPC. */
(() => {
  'use strict';
  const PDF_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js';
  let libraryLoading = null;

  function loadLibrary() {
    if (window.jspdf && typeof window.jspdf.jsPDF === 'function') return Promise.resolve();
    if (libraryLoading) return libraryLoading;
    libraryLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('PDF generator timed out. Check the internet connection and retry.')), 12000);
      script.async = true;
      script.src = PDF_SCRIPT;
      script.onload = () => window.jspdf && typeof window.jspdf.jsPDF === 'function'
        ? finish() : finish(new Error('PDF generator could not initialize.'));
      script.onerror = () => finish(new Error('PDF generator could not load. Check the internet connection.'));
      document.head.appendChild(script);
    }).catch(error => { libraryLoading = null; throw error; });
    return libraryLoading;
  }

  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid payment amount.');
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function weekLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Invalid week start date.');
    return new Date(String(value) + 'T00:00:00Z').toLocaleDateString('en-GB',
      { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' });
  }
  function timestampLabel(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid confirmation timestamp.');
    return new Intl.DateTimeFormat('en-GB',
      { timeZone: 'Asia/Beirut', dateStyle: 'long', timeStyle: 'short' }).format(date) + ' (Beirut time)';
  }

  async function prepare(receipt) {
    if (!receipt || !/^TL-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(receipt.receipt_reference))) {
      throw new Error('This is not a verified payment receipt.');
    }
    if (!String(receipt.employee_name || '').trim()) throw new Error('Receipt employee name missing.');
    const reference = String(receipt.receipt_reference).toUpperCase();
    const week = weekLabel(receipt.week_start);
    const hours = money(receipt.hours_worked);
    const tips = money(receipt.tips_amount);
    const advances = money(receipt.advances);
    const net = money(receipt.net_payout);
    const confirmed = timestampLabel(receipt.confirmed_at);
    await loadLibrary();

    // Draw PDF directly: no full-page HTML canvas, overlay or navigation changes.
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: 'Tips Ledger - Confirmed Payment Receipt', subject: 'Internal confirmed weekly payout' });
    const color = (r, g, b) => pdf.setTextColor(r, g, b);
    const text = (value, x, y, size = 11, bold = false, options) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(size);
      pdf.text(String(value), x, y, options);
    };
    const line = y => { pdf.setDrawColor(222, 230, 243); pdf.line(20, y, 190, y); };

    // Brand header
    pdf.setFillColor(19, 34, 60);
    pdf.rect(0, 0, 210, 54, 'F');
    color(255, 255, 255);
    text('TIPS.LEDGER', 20, 25, 19, true);
    color(170, 194, 226);
    text('PAYMENT RECORD  /  COMMAND SUITE', 20, 33, 8, true);
    pdf.setFillColor(213, 244, 230);
    pdf.roundedRect(158, 19, 32, 13, 5, 5, 'F');
    color(18, 105, 71);
    text('RECEIVED', 174, 27.2, 10, true, { align: 'center' });

    color(113, 130, 154);
    text('EMPLOYEE-CONFIRMED', 20, 71, 9, true);
    color(20, 40, 70);
    text('Digital Payment Receipt', 20, 83, 21, true);
    color(91, 107, 130);
    text('Receipt reference', 20, 94, 9);
    color(38, 69, 108);
    text(reference, 20, 101, 9, true);

    pdf.setFillColor(243, 246, 253);
    pdf.roundedRect(20, 111, 170, 56, 4, 4, 'F');
    color(103, 121, 148);
    text('EMPLOYEE', 28, 121, 8, true);
    color(21, 40, 66);
    const names = pdf.splitTextToSize(String(receipt.employee_name), 148).slice(0, 2);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text(names, 28, 131);
    color(102, 121, 147);
    text('WEEK STARTING', 28, 153, 8, true);
    text('HOURS WORKED', 116, 153, 8, true);
    color(21, 40, 66);
    text(week, 28, 161, 10, true);
    text(hours, 116, 161, 10, true);

    color(20, 40, 70);
    text('Payment breakdown', 20, 186, 14, true);
    color(105, 120, 141);
    text('All values in Lebanese pounds (LBP)', 20, 194, 9);
    line(202);
    color(58, 76, 104);
    text('Tips', 20, 211, 11);
    text(tips + ' LBP', 190, 211, 11, true, { align: 'right' });
    line(218);
    text('Advances', 20, 227, 11);
    text('- ' + advances + ' LBP', 190, 227, 11, true, { align: 'right' });
    line(234);

    pdf.setFillColor(231, 239, 255);
    pdf.roundedRect(20, 242, 170, 20, 4, 4, 'F');
    color(25, 62, 113);
    text('NET PAYOUT', 28, 254.6, 12, true);
    text(net + ' LBP', 182, 254.6, 14, true, { align: 'right' });

    color(80, 98, 120);
    text('Receipt confirmed by employee on:', 20, 275, 9);
    color(28, 101, 77);
    text(confirmed, 20, 282, 10, true);

    pdf.setDrawColor(222, 230, 243);
    pdf.line(20, 288, 190, 288);
    color(112, 129, 150);
    text('Internal acknowledgment only - not proof of bank transfer.', 20, 293, 7.7);

    const filename = 'tips-ledger-receipt-' + receipt.week_start + '-' + reference.slice(-12) + '.pdf';
    const blob = pdf.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    return { filename, blob, file };
  }

  function canShareFile(prepared) {
    return !!(prepared && typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' && navigator.canShare({ files: [prepared.file] }));
  }

  // Call directly from the user's SECOND click, to preserve iOS user activation.
  function share(prepared) {
    if (!canShareFile(prepared)) throw new Error('File sharing is not available on this device.');
    return navigator.share({ files: [prepared.file], title: 'Tips Ledger - Payment Receipt' });
  }

  function download(prepared) {
    if (!prepared || !prepared.blob) throw new Error('Generate a receipt before saving.');
    const url = URL.createObjectURL(prepared.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = prepared.filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    try { link.click(); }
    finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  window.TipsLedgerReceipt = Object.freeze({ prepare, canShareFile, share, download });
})();
