import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, reminderStage, healthReminder, todayInBeirut } from '../supabase/functions/health-card-reminders/notification-rules.mjs';

const today = '2026-11-05';
const employee = (expiry) => ({
  id: 'ee0ae76d-0000-4000-bbbb-000000000001',
  full_name: 'Sample Team Member',
  active: true,
  health_card_expiry: expiry,
});

test('10-day reminder window includes days 10 through 4 and never days 11+', () => {
  assert.equal(daysUntil('2026-11-15', today), 10);
  assert.equal(reminderStage('2026-11-15', today), '10');
  assert.equal(reminderStage('2026-11-14', today), '10');
  assert.equal(reminderStage('2026-11-09', today), '10');
  assert.equal(reminderStage('2026-11-16', today), null);
});
test('3-day reminder window is separate from the first reminder', () => {
  assert.equal(reminderStage('2026-11-08', today), '3');
  assert.equal(reminderStage('2026-11-07', today), '3');
  assert.equal(reminderStage('2026-11-05', today), '3');
  assert.equal(reminderStage('2026-11-04', today), null);
});
test('renewal date produces no old reminder and an individual event key', () => {
  const before = healthReminder(employee('2026-11-08'), today);
  assert.equal(before.stage, '3');
  const after = healthReminder(employee('2027-11-08'), today);
  assert.equal(after, null);
  assert.match(before.event_key, /^health:ee0ae76d-.*:2026-11-08:3$/);
});
test('missing dates, inactive employees and invalid calendar strings do not alert', () => {
  assert.equal(healthReminder(employee(null), today), null);
  assert.equal(healthReminder({ ...employee('2026-11-08'), active: false }, today), null);
  assert.equal(reminderStage('bad-date', today), null);
});
test('Beirut date uses local calendar instead of UTC near midnight', () => {
  assert.equal(todayInBeirut(new Date('2026-11-04T23:40:00Z')), '2026-11-05');
});
test('date arithmetic is immune to daylight-saving clock switches', () => {
  assert.equal(daysUntil('2027-03-29', '2027-03-26'), 3);
  assert.equal(daysUntil('2027-10-31', '2027-10-28'), 3);
});
