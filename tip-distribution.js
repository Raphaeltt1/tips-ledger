(() => {
  const el = id => document.getElementById('td'+id);
  const options = (node, rows) => node.replaceChildren(...rows.map(([text,value]) => new Option(text,value)));
  let db, push, refreshPayments, people, rates, weeks, week, busy=false;
  const fmt = n => n.toLocaleString('en-US');
  const rateFor = (id,date) => Number(rates.find(r=>r.runner_id===id && r.effective_from<=date)?.hourly_rate || 0);
  const active = () => people.filter(p=>p.active && p.role===el('Position').value);
  const locked = () => Object.keys(week.payments).length>0;
  async function query(request) {
    const {data,error}=await request;
    if(error) throw new Error(error.message);
    return data;
  }
  async function run(fn) {
    if(busy)return;
    busy=true;
    const panel=el('Status').closest('section');
    panel.inert=true;
    try {el('Status').textContent=''; await fn();}
    catch(e){el('Status').textContent=e.message;}
    finally{busy=false;panel.inert=false;}
  }
  function selectPosition() {
    week=null;
    el('Editor').hidden=true;
    options(el('History'),[['Choose week',''],...weeks.filter(w=>w.position===el('Position').value).map(w=>[w.week_start,w.week_start])]);
  }
  function load(w) {
    week=structuredClone(w);
    el('Date').value=w.week_start;
    el('History').value=w.week_start;
    el('Pool').value=w.pool;
    el('Editor').hidden=false;
    draw();
  }
  function amounts() {
    const members=week.members;
    const weights=members.map(m=>BigInt(Math.round(m.hours*100))*BigInt(Math.round(m.rate*100)));
    const sum=weights.reduce((a,b)=>a+b,0n);
    if(!sum)return members.map(()=>0);
    const total=BigInt(week.pool);
    const shares=weights.map(w=>Number(total*w/sum));
    const order=weights.map((w,i)=>({i,r:total*w%sum})).sort((a,b)=>a.r===b.r?members[a.i].id.localeCompare(members[b.i].id):a.r>b.r?-1:1);
    for(const {i} of order.slice(0,week.pool-shares.reduce((a,b)=>a+b,0)))shares[i]++;
    return shares;
  }
  function updateAmounts(){
    const shares=amounts();
    [...el('Rows').rows].forEach((tr,i)=>{
      tr.cells[4].textContent=fmt(shares[i]);
      tr.cells[6].textContent=fmt(shares[i]-week.members[i].advance);
    });
  }
  function draw(){
    const frozen=locked();
    el('Pool').disabled=frozen;
    el('Save').disabled=frozen;
    const available=active().filter(p=>!week.members.some(m=>m.id===p.id));
    options(el('Person'),available.map(p=>[p.full_name,p.id]));
    el('Add').disabled=frozen||!available.length;
    el('Rows').replaceChildren();
    for(const m of week.members){
      const row=el('Rows').insertRow();
      function input(key,type,step) {
        const field=document.createElement('input');
        field.type=type;field.value=m[key];field.disabled=frozen;
        field.setAttribute('aria-label',m.name+' '+key);
        if(type==='number'){field.min=0;field.step=step;}
        field.oninput=()=>{m[key]=type==='number'?Math.max(0,Number(field.value)||0):field.value;updateAmounts();};
        row.insertCell().append(field);
      }
      input('code','text');
      row.insertCell().textContent=m.name;
      input('hours','number','0.01');
      row.insertCell().textContent=fmt(m.rate);
      row.insertCell();input('advance','number','1');row.insertCell();
      const actions=row.insertCell();
      function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;actions.append(b);}
      if(week.payments[m.id]) actions.textContent='Published';
      else button('Publish',()=>run(()=>save(m.id)));
      if(!frozen)button('Remove',()=>{week.members=week.members.filter(x=>x!==m);draw();});
    }
    updateAmounts();
  }
  function member(p,date,code=''){
    return {id:p.id,name:p.full_name,code,hours:0,rate:rateFor(p.id,date),advance:0};
  }
  async function save(id=null){
    if([...el('Editor').querySelectorAll('input')].some(field=>!field.reportValidity()))return;
    const result=await query(db.rpc('tip_distribution_action',{w:week.week_start,pos:week.position,rev:week.revision,total:week.pool,roster:week.members,recipient:id}));
    weeks=[result.week,...weeks.filter(w=>w.week_start!==week.week_start||w.position!==week.position)].sort((a,b)=>b.week_start.localeCompare(a.week_start));
    selectPosition();load(result.week);
    el('Status').textContent=id?'Payment published.':'Draft saved.';
    if(result.published){await push('published',result.published);await refreshPayments();}
  }
  async function open(client,sendPush,refresh){
    db=client;push=sendPush;refreshPayments=refresh;
    await run(async()=>{
      el('Editor').hidden=true;
      [people,rates,weeks]=await Promise.all([
        query(db.from('profiles').select('id,full_name,role,active').order('full_name')),
        query(db.from('runner_rates').select('runner_id,hourly_rate,effective_from').order('effective_from',{ascending:false})),
        query(db.from('tip_distributions').select('*').order('week_start',{ascending:false}))]);
      selectPosition();
      el('Date').onchange=()=>{el('Editor').hidden=true;el('History').value='';};
      el('Position').onchange=selectPosition;
      el('History').onchange=()=>{const w=weeks.find(x=>x.week_start===el('History').value && x.position===el('Position').value);if(w)load(w);else selectPosition();};
      el('New').onclick=()=>run(async()=>{
        const date=el('Date').value,pos=el('Position').value;
        if(!date)throw Error('Choose a week date.');
        const existing=weeks.find(w=>w.week_start===date&&w.position===pos);
        if(existing){load(existing);return;}
        const prior=weeks.find(w=>w.position===pos&&w.week_start<date);
        const roster=prior?prior.members.flatMap(m=>{const p=active().find(p=>p.id===m.id);return p?[member(p,date,m.code)]:[];}):active().map(p=>member(p,date));
        load({week_start:date,position:pos,members:roster,pool:0,revision:0,payments:{}});
        await save();
      });
      el('Pool').oninput=()=>{week.pool=Math.max(0,Math.trunc(Number(el('Pool').value)||0));updateAmounts();};
      el('Add').onclick=()=>{const p=active().find(x=>x.id===el('Person').value);if(p){week.members.push(member(p,week.week_start));draw();}};
      el('Save').onclick=()=>run(()=>save());
    });
  }
  window.TipDistribution={open};
})();
