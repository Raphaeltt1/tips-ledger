'use strict';

/*
 * PDF receipt regression coverage.
 * Offline only: executes the shipped PDF module inside a fake browser and
 * checks permission-related UI wiring. No employee or payment data is changed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const moduleSource = fs.readFileSync('receipt-pdf.js', 'utf8');
const appSource = fs.readFileSync('index.html', 'utf8');

const example = Object.freeze({
  receipt_reference: 'TL-01234567-89ab-cdef-0123-456789abcdef',
  employee_name: 'Test Employee',
  week_start: '2026-10-26',
  hours_worked: 42.5,
  tips_amount: 1500000,
  advances: 250000,
  net_payout: 1250000,
  confirmed_at: '2026-10-31T18:10:00Z'
});

function harness({ libraryAlreadyLoaded = true, sharing = true, failLibrary = false } = {}) {
  const state = {
    pdfCreated: 0, text: [], shapes: [], pdfOptions: [], properties: [],
    libraryRequests: 0, failLibrary, links: [], attached: [],
    shares: [], revoked: [], timeouts: [], clearedTimeouts: [], blobs: []
  };
  class FakePDF {
    constructor(options) { state.pdfCreated++; state.pdfOptions.push(options); }
    setProperties(x) { state.properties.push(x); }
    setTextColor() {}
    setFillColor() {}
    setDrawColor() {}
    setFont() {}
    setFontSize() {}
    rect(...args) { state.shapes.push(['rect', args]); }
    roundedRect(...args) { state.shapes.push(['roundedRect', args]); }
    line(...args) { state.shapes.push(['line', args]); }
    text(value, ...args) { state.text.push({ value: String(value), args }); }
    splitTextToSize(value) { return [String(value)]; }
    output(format) {
      assert.equal(format, 'blob');
      const blob = { type: 'application/pdf', bytes: 'mock-PDF-only' };
      state.blobs.push(blob);
      return blob;
    }
  }
  class FakeFile {
    constructor(parts, name, metadata) {
      this.parts = parts;
      this.name = name;
      this.type = metadata.type;
    }
  }
  const window = {};
  if (libraryAlreadyLoaded) window.jspdf = { jsPDF: FakePDF };
  const document = {
    head: {
      appendChild(script) {
        state.libraryRequests++;
        queueMicrotask(() => {
          if (state.failLibrary) {
            script.onerror();
          } else {
            window.jspdf = { jsPDF: FakePDF };
            script.onload();
          }
        });
      }
    },
    body: {
      appendChild(element) { state.attached.push(element); }
    },
    createElement(tag) {
      const element = {
        tag, style: {}, removed: false, clicked: false,
        remove() { element.removed = true; },
        click() { element.clicked = true; state.links.push(element); }
      };
      return element;
    }
  };
  const navigator = sharing ? {
    canShare: input => !!input.files?.length,
    share: async input => { state.shares.push(input); }
  } : {};
  const urls = {
    createObjectURL: value => { assert.equal(value, state.blobs.at(-1)); return 'blob:mock-receipt'; },
    revokeObjectURL: url => { state.revoked.push(url); }
  };
  const timers = {
    setTimeout(callback, delay) {
      const token = state.timeouts.length + 1;
      state.timeouts.push({ token, callback, delay });
      return token;
    },
    clearTimeout(token) { state.clearedTimeouts.push(token); }
  };
  vm.runInNewContext(moduleSource, {
    window, document, navigator, File: FakeFile, URL: urls,
    Date, Intl, Promise, Number, String, Error, queueMicrotask, ...timers
  }, { filename: 'receipt-pdf.js', timeout: 2000 });
  return { api: window.TipsLedgerReceipt, state };
}

test('receipt module exposes only preparation and controlled save/share APIs', () => {
  const { api } = harness();
  assert.deepEqual(Object.keys(api).sort(), ['canShareFile', 'download', 'prepare', 'share']);
  assert.ok(Object.isFrozen(api));
});

test('valid receipt produces vector A4 PDF with correct LBP amounts and reference', async () => {
  const { api, state } = harness();
  const file = await api.prepare(example);
  assert.equal(file.filename, 'tips-ledger-receipt-2026-10-26-456789ABCDEF.pdf');
  assert.equal(file.file.name, file.filename);
  assert.equal(file.file.type, 'application/pdf');
  assert.deepEqual(state.pdfOptions.map(o => [o.format, o.orientation, o.unit]), [['a4', 'portrait', 'mm']]);
  const allText = state.text.map(x => x.value).join(' | ');
  for (const expected of [
    'Digital Payment Receipt', 'Test Employee',
    'TL-01234567-89AB-CDEF-0123-456789ABCDEF',
    '26 October 2026', '42.5', '1,500,000 LBP', '- 250,000 LBP',
    '1,250,000 LBP', 'Beirut time', 'Internal acknowledgment'
  ]) {
    assert.ok(allText.includes(expected), 'PDF must contain ' + expected);
  }
  assert.equal(state.pdfCreated, 1);
  assert.ok(state.shapes.some(x => x[0] === 'roundedRect'), 'Vector shapes are used');
  assert.equal(state.attached.length, 0, 'Preparation must not overlay the app UI');
});

test('zero and fractional values are formatted consistently', async () => {
  const { api, state } = harness();
  await api.prepare({ ...example, hours_worked: 0, tips_amount: 100.25, advances: 0, net_payout: 100.25 });
  const values = state.text.map(x => x.value);
  assert.ok(values.includes('0'));
  assert.ok(values.includes('100.25 LBP'));
  assert.ok(values.includes('- 0 LBP'));
});

test('invalid references, employee names and financial/date inputs fail before generating a PDF', async () => {
  const { api, state } = harness();
  const invalid = [
    null,
    { ...example, receipt_reference: 'TL-invented' },
    { ...example, employee_name: '  ' },
    { ...example, week_start: 'not-a-date' },
    { ...example, tips_amount: -1 },
    { ...example, net_payout: Number.NaN },
    { ...example, hours_worked: -2 },
    { ...example, confirmed_at: 'invalid timestamp' }
  ];
  for (const receipt of invalid) {
    await assert.rejects(api.prepare(receipt), /receipt|employee|date|amount|timestamp|week|value/i);
  }
  assert.equal(state.pdfCreated, 0, 'Do not write PDFs from malformed receipt data');
});

test('PDF generation never uses the old HTML/canvas renderer', () => {
  assert.doesNotMatch(moduleSource, /html2pdf|html2canvas|\.innerHTML\s*=|document\.body\.appendChild\(page\)/);
  assert.match(moduleSource, /new window\.jspdf\.jsPDF/);
});

test('iOS share sheet passes the prepared PDF on the direct user action', async () => {
  const { api, state } = harness();
  const file = await api.prepare(example);
  assert.equal(api.canShareFile(file), true);
  await api.share(file);
  assert.equal(state.shares.length, 1);
  assert.equal(state.shares[0].files[0], file.file);
  assert.match(state.shares[0].title, /Payment Receipt/);
});

test('sharing unavailable leaves the download fallback ready', async () => {
  const { api, state } = harness({ sharing: false });
  const file = await api.prepare(example);
  assert.equal(api.canShareFile(file), false);
  assert.throws(() => api.share(file), /not available/i);
  api.download(file);
  assert.equal(state.links.length, 1);
  assert.equal(state.links[0].download, file.filename);
  assert.equal(state.links[0].href, 'blob:mock-receipt');
  assert.equal(state.attached.length, 1);
  assert.equal(state.links[0].removed, true);
  const revoke = state.timeouts.find(x => x.delay === 60000);
  assert.ok(revoke, 'Object URL cleanup must be scheduled');
  revoke.callback();
  assert.deepEqual(state.revoked, ['blob:mock-receipt']);
});

test('download refuses missing prepared content', () => {
  const { api } = harness();
  assert.throws(() => api.download(null), /Generate a receipt/i);
});

test('dynamic PDF library loads once when missing, without blocking the document body', async () => {
  const { api, state } = harness({ libraryAlreadyLoaded: false });
  await api.prepare(example);
  await api.prepare(example);
  assert.equal(state.libraryRequests, 1);
  assert.equal(state.pdfCreated, 2);
  assert.equal(state.attached.length, 0);
});

test('network failure is reported and a subsequent PDF attempt can retry', async () => {
  const { api, state } = harness({ libraryAlreadyLoaded: false, failLibrary: true });
  await assert.rejects(api.prepare(example), /could not load/i);
  assert.equal(state.pdfCreated, 0);
  state.failLibrary = false;
  await api.prepare(example);
  assert.equal(state.libraryRequests, 2, 'Failed dynamic library load must be retryable');
  assert.equal(state.pdfCreated, 1);
});

function statusAction(role, { received = true, published = true } = {}) {
  const from = appSource.indexOf('const receiptAction=x=>');
  const until = appSource.indexOf('\n if(isTeamMemberRole(profile.role))', from);
  assert.ok(from >= 0 && until > from, 'Missing receipt action render code');
  const code = appSource.slice(from, until);
  return vm.runInNewContext(code + '\n actions({id:"payment-id",published:' + published + '})', {
    profile: { role },
    confirmed: received ? ['payment-id'] : [],
    isTeamMemberRole: value => ['runner', 'host_hostess', 'counter', 'expo', 'kitchen_crew'].includes(value),
    esc: value => String(value)
  });
}

test('PDF button is shown only for confirmed payments to Admin and Superuser', () => {
  for (const role of ['admin', 'superuser']) {
    assert.match(statusAction(role), /data-receipt="payment-id"/, role + ' should see confirmed receipt');
    assert.doesNotMatch(statusAction(role, { received: false }), /data-receipt/, role + ' must not export pending payout');
    assert.doesNotMatch(statusAction(role, { published: false }), /data-receipt/, role + ' must not export draft');
  }
  for (const role of ['manager', 'runner', 'host_hostess', 'counter', 'expo', 'kitchen_crew']) {
    assert.doesNotMatch(statusAction(role), /data-receipt/, role + ' must not export receipts');
  }
});

test('payment UI fetches verified receipts via the restricted RPC and uses iOS two-tap share', () => {
  assert.match(appSource, /db\.rpc\('get_confirmed_payment_receipt',\{p_record_id:receiptId\}\)/);
  assert.match(appSource, /if\(!\['admin','superuser'\]\.includes\(profile\?\.role\)\)/);
  assert.match(appSource, /if\(!Array\.isArray\(details\)\|\|details\.length!==1\)/);
  assert.match(appSource, /TipsLedgerReceipt\.prepare\(details\[0\]\)/);
  assert.match(appSource, /'tlReceiptSave'\)\.onclick=async/);
  assert.match(appSource, /TipsLedgerReceipt\.share\(preparedReceipt\)/);
  assert.doesNotMatch(appSource, /TipsLedgerReceipt\.download\(details\[0\]\)/);
  assert.match(appSource, /src="\.\/receipt-pdf\.js\?v=[^"]+"/);
});
