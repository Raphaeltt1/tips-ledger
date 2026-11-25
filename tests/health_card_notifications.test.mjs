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

test('10-day reminder is due only on day 10', () => {
  assert.equal(daysUntil('2026-11-15', today), 10);
  assert.equal(reminderStage('2026-11-15', today), '10');
  assert.equal(reminderStage('2026-11-14', today), null);
  assert.equal(reminderStage('2026-11-09', today), null);
  assert.equal(reminderStage('2026-11-16', today), null);
});
test('3-day reminder window is separate from the first reminder', () => {
  assert.equal(reminderStage('2026-11-08', today), '3');
  assert.equal(reminderStage('2026-11-07', today), null);
  assert.equal(reminderStage('2026-11-05', today), null);
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

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('both schedule publishers report bell rows separately from accepted and failed device pushes', () => {
  const window = {};
  runInNewContext(readFileSync('schedule-editor.js', 'utf8'), { window });
  const summary = window.ScheduleEditor.scheduleNotificationSummary;
  for (const [sent, failed, withoutDevice] of [[0,0,5], [2,1,3]]) {
    const message = summary({data:{bellCount:5, sent, failed, withoutDevice}});
    assert.ok(message.includes('In-app alerts: 5'));
    assert.ok(message.includes('Device pushes accepted: '+sent));
    assert.ok(message.includes('Failed: '+failed));
    assert.ok(message.includes('Accounts without a registered device: '+withoutDevice));
  }
  assert.match(summary({error:new Error('offline')}), /could not be verified/);
  assert.match(readFileSync('employee-ledger.js','utf8'), /ScheduleEditor\.scheduleNotificationSummary\(push\)/);
});

test('permission alone cannot enable push for the wrong account', async () => {
  const html=readFileSync('index.html','utf8');
  const source=html.slice(html.indexOf('async function refreshPushStatus'),html.indexOf('async function enablePush'));
  for(const registered of [false,true]){
    const shown={}, status={classList:{toggle(){},remove(){}}};
    const filters={};
    const query={select(){return this},eq(key,value){filters[key]=value;return this},
      async maybeSingle(){return {data:registered?{id:'registration'}:null}}};
    await runInNewContext(source+';refreshPushStatus()',{
      $:()=>status,show:(id,value)=>{shown[id]=value},profile:{id:'test-account'},
      pushSupported:()=>true,Notification:{permission:'granted'},db:{from:()=>query},
      navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({endpoint:'test-device'})}})}}
    });
    assert.deepEqual(filters,{endpoint:'test-device',user_id:'test-account'});
    assert.equal(shown.testPush,registered);
    assert.equal(shown.enablePush,!registered);
  }
});
