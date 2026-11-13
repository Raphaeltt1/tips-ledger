window.LaborControl = (() => {
  let db, profile, management, generation = 0, dirty = false;
  const get = id => document.getElementById(id);
  const status = text => { get('laborStatus').textContent = text; };
  const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  function el(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(text, click) {
    const b = el('button',text); b.type='button'; b.onclick=click; return b;
  }
  function input(type,value,label,max) {
    const node = el('input'); node.type=type; node.value=value ?? '';
    node.required=true; node.setAttribute('aria-label',label);
    if (type==='number') { node.min='0'; node.max=String(max); node.step='any'; }
    if (type==='text') node.maxLength=max;
    return node;
  }
  function grid(headers) {
    const wrap=el('div'); wrap.className='scroll';
    const table=el('table'), head=table.createTHead().insertRow();
    for (const label of headers) head.append(el('th',label));
    const body=table.createTBody(); wrap.append(table); return {wrap,body};
  }
  function render(sheet) {
    const content=get('laborContent'); content.replaceChildren();
    if (!management) {
      status(sheet.through ? 'Hours worked through '+sheet.through : 'Hours have not been published yet.');
      if (sheet.through) {
        const {wrap,body}=grid(['Staff ID','Name','Hours worked']);
        wrap.firstChild.style.minWidth='0';
        for (const row of sheet.rows) {
          const tr=body.insertRow();
          for (const value of [row.id,row.name,row.hours]) tr.insertCell().textContent=value;
        }
        content.append(wrap);
      }
      content.append(action('Refresh',()=>open())); return;
    }
    status(sheet.through ? 'Last saved through '+sheet.through : 'Enter the cumulative hours and sales for the same period.');
    const form=el('form'), fields=el('div'); fields.className='row';
    const through=input('date',sheet.through,'Hours through');
    const sales=input('number',sheet.sales,'Total sales (USD)',999999999999.99);
    const target=input('number',sheet.target,'Labor target (%)',100);
    for (const control of [through,sales,target]) {
      const label=el('label',control.getAttribute('aria-label')); label.className='field'; label.append(control); fields.append(label);
    }
    const {wrap,body}=grid(['Staff ID','Name','Rate (USD/hour)','Hours worked','Labor cost (USD)','']);
    const entries=[], result=el('p'); result.setAttribute('role','status');
    function totals() {
      let total=0;
      for (const e of entries) {
        const cost=Number(e.rate.value)*Number(e.hours.value);
        total+=cost; e.cost.textContent=money.format(cost);
      }
      let summary='Total labor cost '+money.format(total);
      if (Number(sales.value)>0 && target.value!=='') {
        const actual=total*100/Number(sales.value);
        summary+=' · Actual '+actual.toFixed(2)+'% · '+(actual<=Number(target.value)+1e-10?'Within target':'Over target');
      } else summary+=' · Enter positive sales and a target to compare.';
      result.textContent=summary;
    }
    function row(record) {
      const tr=body.insertRow();
      const e={id:input('text',record.id,'Staff ID',80),name:input('text',record.name,'Employee name',160),
        rate:input('number',record.rate,'Hourly rate in USD',9999999),hours:input('number',record.hours,'Hours worked',999999)};
      for (const field of [e.id,e.name,e.rate,e.hours]) tr.insertCell().append(field);
      e.cost=tr.insertCell(); entries.push(e);
      tr.insertCell().append(action('Remove',()=>{entries.splice(entries.indexOf(e),1); tr.remove(); dirty=true; totals();}));
      return e;
    }
    sheet.rows.forEach(row);
    const add=action('Add employee',()=>{const entry=row({hours:0}); dirty=true; totals(); entry.id.focus();});
    const save=el('button','Save and publish hours'); save.type='submit';
    const refresh=action('Reload saved sheet',()=>{if (!dirty || window.confirm('Discard your unsaved changes?')) { dirty=false; open(); }});
    form.oninput=()=>{dirty=true; totals();};
    const controls=el('div'); controls.className='row'; controls.append(add,save,refresh);
    const group=el('fieldset'); group.style.cssText='min-width:0;border:0;margin:0;padding:0';
    group.append(fields,wrap,result,controls); form.append(group); content.append(form); totals();
    form.onsubmit=async event=>{
      event.preventDefault();
      if (!form.reportValidity() || group.disabled) return;
      const rows=entries.map(e=>({id:e.id.value.trim(),name:e.name.value.trim(),rate:Number(e.rate.value),hours:Number(e.hours.value)}));
      const token=generation;
      group.disabled=true;
      try {
        const {error,data}=await db.rpc('save_labor_control',{p_revision:sheet.revision,p_through:through.value,p_sales:Number(sales.value),p_target:Number(target.value),p_rows:rows});
        if (token!==generation) return;
        if (error) throw error;
        dirty=false; render(data); status('Saved. Employee hours are published through '+data.through+'.');
      } catch(err) {
        if (token===generation) {status(err.message || 'Save failed. Please retry.');group.disabled=false;}
      }
    };
  }
  async function open() {
    if (dirty || !profile) return;
    const token=++generation;
    get('laborContent').replaceChildren(); status('Loading…');
    try {
      const {data,error}=await db.rpc('read_labor_control');
      if (token!==generation) return;
      if (error) throw error;
      render(data);
    } catch(err) {
      if (token===generation) {status(err.message || 'Unable to load.');get('laborContent').append(action('Retry',()=>open()));}
    }
  }
  function init(context) {
    if (profile?.id===context.profile.id && profile?.role===context.profile.role && dirty) return;
    ++generation; dirty=false; ({db,profile}=context);
    management=['manager','admin','superuser'].includes(profile.role);
    get('laborLabel').textContent=get('laborTitle').textContent=management?'Labor Control':'Total Hours';
    get('laborContent').replaceChildren(); status('');
  }
  return {init,open};
})();
