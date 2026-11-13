window.ScheduleRequests = (() => {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const shifts = ['AM','PM','Double','Off'];
  const get = id => document.getElementById(id);
  const element = (name, text) => {
    const node = document.createElement(name);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let db, profile, manager, generation = 0, timer;
  const body = () => get('requestBody');
  const status = message => { get('requestStatus').textContent = message; };
  function button(label, action) {
    const node = element('button', label);
    node.type = 'button';
    node.onclick = action;
    return node;
  }
  function menu(values, current, label) {
    const node = element('select');
    node.setAttribute('aria-label', label);
    values.forEach(value => node.add(new Option(value, value)));
    node.value = current;
    return node;
  }
  function summary(record) {
    const list = element('ul');
    for (const day of days) if (record.days[day]) list.append(element('li', day + ' · ' + record.days[day]));
    return list;
  }
  function editor(record, week, token) {
    const form = element('fieldset');
    form.style.border = '0';
    form.style.padding = '0';
    form.append(element('legend','Your requests'));
    const entries = days.filter(day => record?.days[day]).map(day => ({day, shift:record.days[day]}));
    const rows = element('div');
    const add = button('Add New', () => {
      const day = days.find(d => !entries.some(item => item.day === d));
      if (day) entries.push({day,shift:'AM'});
      draw();
    });
    const save = button('Save requests', async () => {
      form.disabled = true;
      const payload = Object.fromEntries(entries.map(item => [item.day,item.shift]));
      try {
        const table = db.from('schedule_requests');
        const query = record ? table.update({days:payload}).eq('week_start',week)
          .eq('employee_id',profile.id).eq('revision',record.revision)
          : table.insert({days:payload,week_start:week,employee_id:profile.id});
        const result = await query.select('revision').single();
        if (token !== generation) return;
        if (result.error) throw Error('Could not save. Refresh to check the deadline and the latest saved requests.');
        await open('Requests saved.');
      } catch (error) {
        if (token === generation) { status(error.message); form.disabled = false; }
      }
    });
    function draw() {
      rows.replaceChildren();
      for (const item of entries) {
        const row = element('div');
        row.className = 'row';
        const available = days.filter(day => day === item.day || !entries.some(x => x.day === day));
        const daySelect = menu(available,item.day,'Day');
        daySelect.onchange = () => { item.day = daySelect.value; draw(); };
        const shiftSelect = menu(shifts,item.shift,'Shift for ' + item.day);
        shiftSelect.onchange = () => { item.shift = shiftSelect.value; };
        for (const control of [daySelect,shiftSelect]) {
          const field = element('div'); field.className = 'field'; field.append(control); row.append(field);
        }
        row.append(button('Remove', () => { entries.splice(entries.indexOf(item),1); draw(); }));
        rows.append(row);
      }
      add.disabled = entries.length >= days.length;
      save.disabled = !record && !entries.length;
    }
    const actions = element('div'); actions.className = 'row'; actions.append(add,save);
    form.append(rows,actions); body().append(form); draw();
  }
  async function open(message) {
    const token = ++generation;
    clearTimeout(timer);
    body().replaceChildren(); status('Loading requests…');
    const picker = get('requestWeek');
    picker.disabled = true;
    try {
      const clock = await db.rpc('schedule_request_window').single();
      if (token !== generation) return;
      if (clock.error) throw clock.error;
      const {week_start:week,closes_at,is_open} = clock.data;
      picker.min = picker.max = picker.value = week;
      picker.disabled = false;
      picker.onchange = () => { picker.value = week; };
      let query = db.from('schedule_requests').select('employee_id,employee_name,days,revision').eq('week_start',week);
      if (!manager) query = query.eq('employee_id',profile.id);
      const {data,error} = await query.order('employee_name').order('employee_id').limit(manager ? 1000 : 1);
      if (token !== generation) return;
      if (error) throw error;
      if (manager) {
        let records = data;
        while (records.length && records.length % 1000 === 0) {
          const page = await db.from('schedule_requests').select('employee_id,employee_name,days,revision')
            .eq('week_start',week).order('employee_name').order('employee_id').range(records.length,records.length+999);
          if (token !== generation) return;
          if (page.error) throw page.error;
          if (!page.data.length) break;
          records = records.concat(page.data);
        }
        const submitted = records.filter(r => Object.keys(r.days).length);
        status(submitted.length ? 'Employee requests for the selected week.' : 'No requests submitted for this week.');
        for (const record of submitted) body().append(element('h3',record.employee_name),summary(record));
      } else if (is_open) {
        status(message || 'Choose only the days you want to request.');
        editor(data[0],week,token);
        const remaining = Date.parse(closes_at) - Date.now();
        if (remaining > 0) timer = setTimeout(() => open(),remaining+100);
      } else {
        status('Submissions and edits are closed for this week.');
        body().append(data[0] && Object.keys(data[0].days).length ? summary(data[0]) : element('p','You have no requests for this week.'));
      }
    } catch (error) {
      if (token === generation) { body().replaceChildren(); status(error.message || 'Unable to load requests.'); }
    }
  }
  return {
    init(context) {
      ++generation; clearTimeout(timer);
      ({db,profile} = context);
      manager = ['manager','admin','superuser'].includes(profile.role);
      body().replaceChildren();
      get('requestReload').onclick = () => open();
    }, open
  };
})();
