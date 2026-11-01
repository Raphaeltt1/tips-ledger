/* Read-only PDFs for employee-confirmed Tips Ledger payouts. Source is a role-restricted RPC. */
(() => {
  'use strict';
  let pendingLibrary = null;
  const libraryUrl = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  function pdfReady() {
    if (typeof window.html2pdf === 'function') return Promise.resolve();
    if (!pendingLibrary) pendingLibrary = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = libraryUrl; script.async = true;
      script.onload = () => typeof window.html2pdf === 'function' ? resolve() : reject(new Error('PDF generator unavailable.'));
      script.onerror = () => reject(new Error('Could not load PDF generator. Please connect to the internet and try again.'));
      document.head.appendChild(script);
    }).catch(error => { pendingLibrary = null; throw error; });
    return pendingLibrary;
  }
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
  function numeric(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid receipt value.');
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function weekLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Invalid receipt week.');
    return new Date(value + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone:'UTC', day:'2-digit', month:'long', year:'numeric' });
  }
  function confirmationLabel(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid confirmation date.');
    return new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Beirut', dateStyle:'long', timeStyle:'short' }).format(date) + ' (Beirut time)';
  }
  function detail(label, value) {
    return '<div style="display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #dfe7f1;padding:16px 0"><span>' +
      safe(label) + '</span><strong>' + safe(value) + '</strong></div>';
  }
  async function download(receipt) {
    if (!receipt || !/^TL-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(receipt.receipt_reference)))
      throw new Error('Receipt not verified.');
    const reference = String(receipt.receipt_reference).toUpperCase();
    const name = safe(receipt.employee_name);
    const week = safe(weekLabel(receipt.week_start));
    const hours = safe(numeric(receipt.hours_worked));
    const tips = numeric(receipt.tips_amount);
    const advances = numeric(receipt.advances);
    const net = numeric(receipt.net_payout);
    const confirmed = safe(confirmationLabel(receipt.confirmed_at));
    await pdfReady();
    const page = document.createElement('div');
    page.setAttribute('aria-hidden', 'true');
    page.style.cssText = 'position:fixed;left:-20000px;top:0;width:794px;height:1088px;box-sizing:border-box;background:#fff;color:#1d2b42;font:16px/1.55 Arial,Helvetica,sans-serif;padding:66px 67px;';
    page.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #204f92;padding-bottom:24px">' +
        '<div><div style="font-size:15px;font-weight:800;letter-spacing:3px;color:#204f92">◆ TIPS LEDGER</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:5px">INTERNAL PAYMENT RECORD</div></div>' +
        '<span style="border-radius:24px;padding:9px 18px;background:#e2f6eb;color:#177346;font-size:13px;font-weight:700">✓ RECEIVED</span></div>' +
      '<div style="padding-top:45px"><div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#6783a3">EMPLOYEE-CONFIRMED</div>' +
        '<h1 style="font-size:31px;margin:8px 0 9px;color:#142846;line-height:1.2">Digital Payment Receipt</h1>' +
        '<p style="font-size:13px;color:#64748b;margin:0">Confirmation reference:</p>' +
        '<div style="font-size:12px;font-family:monospace;word-break:break-all;margin-top:6px">' + safe(reference) + '</div></div>' +
      '<div style="margin-top:36px;padding:24px 26px;background:#f1f5fb;border-radius:13px">' +
        '<div style="font-size:12px;color:#627994;text-transform:uppercase;letter-spacing:1.2px">Employee</div>' +
        '<div style="font-size:23px;font-weight:bold;margin:4px 0 20px;overflow-wrap:anywhere">' + name + '</div>' +
        '<div style="display:flex;justify-content:space-between;gap:25px">' +
          '<div><div style="font-size:12px;color:#627994">Week starting</div><strong>' + week + '</strong></div>' +
          '<div><div style="font-size:12px;color:#627994">Hours worked</div><strong>' + hours + '</strong></div></div></div>' +
      '<div style="margin-top:38px"><div style="font-size:15px;font-weight:bold;margin-bottom:12px">Payment breakdown ' +
        '<span style="font-size:11px;font-weight:normal;color:#687d95">(all amounts in LBP)</span></div>' +
        detail('Tips', tips + ' LBP') + detail('Advances', '− ' + advances + ' LBP') +
        '<div style="display:flex;justify-content:space-between;padding:23px 22px;background:#eaf2fe;border-radius:11px;margin-top:16px;font-size:19px">' +
          '<strong>Net payout</strong><strong style="color:#204f92">' + safe(net) + ' LBP</strong></div></div>' +
      '<div style="margin-top:40px;border-left:4px solid #16845a;padding:4px 0 4px 17px">' +
        '<div style="font-size:12px;color:#64748b">Receipt confirmed by employee on</div>' +
        '<div style="font-size:15px;font-weight:bold;margin-top:4px">' + confirmed + '</div></div>' +
      '<div style="position:absolute;bottom:55px;left:67px;right:67px;border-top:1px solid #dfe7f1;padding-top:14px;color:#7c8ca2;font-size:11px">' +
        'Generated from the locked, employee-confirmed Tips Ledger record. This is an internal acknowledgment, not a bank transfer confirmation.</div>';
    document.body.appendChild(page);
    const filename = 'tips-ledger-receipt-' + receipt.week_start + '-' + reference.slice(-12) + '.pdf';
    try {
      await window.html2pdf().set({
        margin: 0, filename,
        image: { type:'jpeg', quality:0.98 },
        html2canvas: { scale:2, backgroundColor:'#ffffff', useCORS:false },
        jsPDF: { unit:'mm', format:'a4', orientation:'portrait' }
      }).from(page).save();
    } finally { page.remove(); }
  }
  window.TipsLedgerReceipt = Object.freeze({ download });
})();