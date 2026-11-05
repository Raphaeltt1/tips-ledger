// Pure notification rules shared by the scheduler and its automated tests.
// Days are calendar days in Asia/Beirut, not 24-hour timezone-sensitive periods.
export function daysUntil(expiryISO, todayISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryISO || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(todayISO || '')) return NaN;
  const expiry = Date.parse(expiryISO + 'T00:00:00Z');
  const today = Date.parse(todayISO + 'T00:00:00Z');
  if (!Number.isFinite(expiry) || !Number.isFinite(today)) return NaN;
  return Math.round((expiry - today) / 86400000);
}

export function reminderStage(expiryISO, todayISO) {
  const days = daysUntil(expiryISO, todayISO);
  if (days >= 4 && days <= 10) return '10';
  if (days >= 0 && days <= 3) return '3';
  return null;
}

export function healthReminder(employee, todayISO) {
  if (!employee?.id || !employee?.health_card_expiry || employee.active === false) return null;
  const stage = reminderStage(employee.health_card_expiry, todayISO);
  if (!stage) return null;
  const days = daysUntil(employee.health_card_expiry, todayISO);
  const name = String(employee.full_name || 'Employee').trim();
  return {
    event_key: 'health:' + employee.id + ':' + employee.health_card_expiry + ':' + stage,
    title: '⚠️ Health Card Near Expiry',
    body: name + "'s health card expires " + (days === 0 ? 'today' : 'in ' + days + (days === 1 ? ' day' : ' days')) + ' (' + employee.health_card_expiry + ').',
    days, stage,
  };
}

export function todayInBeirut(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
