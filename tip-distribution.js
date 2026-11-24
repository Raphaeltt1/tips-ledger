(() => {
  const el = id => document.getElementById('td'+id);
  const options = (node, rows) => node.replaceChildren(...rows.map(([text,value]) => new Option(text,value)));
  let db, push, refreshPayments, people, weeks, week, busy=false;
  const fmt = n => n.toLocaleString('en-US');
  let department='FOH';
  const roles={runner:'Runner',expo:'Expo',host_hostess:'Host / Hostess',counter:'Counter',waiter_waitress:'Waiter / Waitress',driver:'Driver',kitchen_crew:'Kitchen Crew'};
  const positions=()=>department==='BOH'?['kitchen_crew']:Object.keys(roles).filter(r=>r!=='kitchen_crew');
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
    options(el('History'),[['Choose week',''],...Array.from(new Set(weeks.map(w=>w.week_start)),date=>[date,date])]);
  }
  function load(w) {
    week=structuredClone(w);
    el('Date').value=w.week_start;
    el('History').value=w.week_start;
    el('PoolLabel').textContent=department+' total tips (LBP)';
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
      tr.cells[5].textContent=fmt(shares[i]);
      tr.cells[7].textContent=fmt(shares[i]-week.members[i].advance);
    });
  }
  function draw(){
    const frozen=locked();
    el('Pool').disabled=frozen;
    el('Save').disabled=frozen;
    el('Add').disabled=frozen;
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
      input('name','text');
      const position=document.createElement('select');
      options(position,positions().map(r=>[roles[r],r]));
      position.value=m.position;position.disabled=frozen;
      position.onchange=()=>{m.position=position.value;m.account=null;draw();};
      row.insertCell().append(position);
      input('hours','number','0.01');
      input('rate','number','0.01');
      row.insertCell();input('advance','number','1');row.insertCell();
      const actions=row.insertCell();
      function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;actions.append(b);}
      if(week.payments[m.id]) actions.textContent='Published';
      else {
        const accounts=document.createElement('select');
        options(accounts,[['Select payment account',''],...people.filter(p=>p.active&&p.role===m.position).map(p=>[p.full_name,p.id])]);
        accounts.value=m.account||'';
        actions.append(accounts);
        button('Publish',()=>run(async()=>{
          if(!accounts.value)throw Error('Select the employee account to publish this payment.');
          await save(m.id,accounts.value);
        }));
      }
      if(!frozen)button('Remove',()=>{week.members=week.members.filter(x=>x!==m);draw();});
      [...row.cells].forEach((cell,i)=>cell.dataset.label=row.closest('table').tHead.rows[0].cells[i].textContent);
    }
    updateAmounts();
  }
  function newSheet(date){
    const previous=weeks.find(w=>w.position===department&&w.week_start<date);
    return {week_start:date,position:department,revision:0,pool:0,payments:{},
      members:(previous?.members||[]).map(m=>({...m,hours:0,advance:0}))};
  }
  function choose(date){
    load(weeks.find(w=>w.position===department&&w.week_start===date)||newSheet(date));
  }
  async function save(id=null,account=null){
    if([...el('Editor').querySelectorAll('input')].some(field=>!field.reportValidity()))return;
    const result=await query(db.rpc('department_distribution_action',{w:week.week_start,pos:week.position,rev:week.revision,total:week.pool,roster:week.members,recipient:id,account}));
    weeks=[result.week,...weeks.filter(w=>w.week_start!==week.week_start||w.position!==week.position)].sort((a,b)=>b.week_start.localeCompare(a.week_start));
    selectPosition();load(result.week);
    el('Status').textContent=id?'Payment published.':'Draft saved.';
    if(result.published){await push('published',result.published);await refreshPayments();}
    return true;
  }
  async function open(client,sendPush,refresh){
    db=client;push=sendPush;refreshPayments=refresh;
    await run(async()=>{
      el('Editor').hidden=true;
      [people,weeks]=await Promise.all([
        query(db.from('profiles').select('id,full_name,role,active').order('full_name')),
        query(db.from('tip_distributions').select('*').order('week_start',{ascending:false}))]);
      selectPosition();
      el('Date').onchange=()=>{el('Editor').hidden=true;el('History').value='';};
      for(const dept of ['FOH','BOH']){
        el(dept).setAttribute('aria-pressed',String(dept===department));
        el(dept).onclick=()=>run(async()=>{
          if(department===dept)return;
          const date=el('Editor').hidden?'':week?.week_start;
          if(date && !locked()){
            if(week.members.some(m=>!m.name.trim()))throw Error('Enter the employee name or remove the empty row first.');
            if(!(await save()))return;
          }
          department=dept;
          for(const key of ['FOH','BOH'])el(key).setAttribute('aria-pressed',String(key===dept));
          if(date)choose(date);
        });
      }
      el('History').onchange=()=>{if(el('History').value)choose(el('History').value);else selectPosition();};
      el('New').onclick=()=>run(async()=>{
        const date=el('Date').value;
        if(!date)throw Error('Choose a week date.');
        choose(date);
        if(!week.revision)await save();
      });
      el('Pool').oninput=()=>{week.pool=Math.max(0,Math.trunc(Number(el('Pool').value)||0));updateAmounts();};
      el('Add').onclick=()=>{week.members.push({id:crypto.randomUUID(),code:'',name:'',position:positions()[0],hours:0,rate:0,advance:0});draw();};
      el('Save').onclick=()=>run(()=>save());
    });
  }
  window.TipDistribution={open};
})();
