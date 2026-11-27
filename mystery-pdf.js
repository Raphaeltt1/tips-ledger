/* Roadster Diner CS-MSR-41-V1 text PDF parser. No report bytes are uploaded. */
(() => {
  'use strict';
  const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/';
  const groups={V:['Valet Parking',3],CL:['Cleanliness & Atmosphere',9],W:['Waiters Performance',20],FS:['Food & Speed of Service',12],BS:['Bill Service',7],SM:['Service Management',4],WOW:['WOW Performance',4]};
  const ids=Object.entries(groups).flatMap(([k,v])=>Array.from({length:v[1]},(_,i)=>k+(i+1)));
  const tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
  const fail=()=>{throw Error('This PDF does not match the supported Roadster DineIN report or contains unclear answers. Nothing was published. Please use the original exported PDF.');};
  const idRe=/^(WOW|CL|FS|BS|SM|W|V)(\d+)(?:\s|$)/;
  const scale=3;
  function classify(read,base){
    const y=base-2.4;
    const cols=[420.4,446.2,470.8];
    const values=cols.map(x=>{
      let sum=0;for(const dx of [-.5,0,.5])for(const dy of [-.5,0,.5])sum+=read(x+dx,y+dy);
      return sum/9;
    });
    if(values.filter(v=>v<80).length!==1||values.filter(v=>v>170).length!==2)fail();
    // Require the three circular outlines; a random dark pixel is not an answer.
    for(const x of cols){
      let left=255,right=255;
      for(let dy=-1.5;dy<=1.5;dy+=.5)for(let dx=3;dx<=4.2;dx+=.3){
        left=Math.min(left,read(x-dx,y+dy));right=Math.min(right,read(x+dx,y+dy));
      }
      if(left>165||right>165)fail();
    }
    return values.indexOf(Math.min(...values));
  }
  function rowText(items,read,row,previous){
    const y=row.y-2.4;
    const bg=z=>[398,402,406].map(x=>read(x,z)).sort((a,b)=>a-b)[1];
    const color=bg(y);let lo=y,hi=y;
    while(lo>65&&Math.abs(bg(lo)-color)<5)lo-=.5;
    while(hi<780&&Math.abs(bg(hi)-color)<5)hi+=.5;
    if(hi-lo>200||hi-lo<8)fail();
    let lines=items.filter(t=>t.y>=lo-1&&t.y<=hi+1&&t.x>=129&&t.x<409)
      .map(t=>({...t}));
    if(row.remainder)lines.push({x:131,y:row.y,str:row.remainder});
    lines.sort((a,b)=>Math.abs(a.y-b.y)<1?a.x-b.x:a.y-b.y);
    const stop=lines.findIndex(t=>/^(General Comments|Comments\.\.)/i.test(t.str));
    if(stop!==-1)lines=lines.slice(0,stop);
    // Do not read adjacent rows even if the two rows share a background.
    if(items.some(t=>t!==row.item&&t.x>107&&t.x<128&&idRe.test(t.str)&&t.y>=lo&&t.y<=hi))fail();
    let wording=tidy(lines.map(t=>t.str).join(' '));
    // The Bill Service question can straddle a page break (ID on next page).
    if(row.id==='BS1'&&lo<77&&previous.length){
      const all=tidy(previous.filter(t=>t.x>=129&&t.x<409&&t.y>650).map(t=>t.str).join(' '));
      const criterion=all.match(/The whole payment process \(bill presentation and transaction\) is completed within 5 minutes\./i)?.[0];
      if(criterion&&!wording.startsWith(criterion))wording=tidy(criterion+' '+wording);
    }
    if(!wording||wording.length<12||wording.length>4000)fail();
    return wording;
  }
  async function parse(file){
    const pdfjs=await import(PDFJS+'pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.mjs';
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:false});
    let pdf;
    try{
      pdf=await task.promise;
      if(pdf.numPages<2||pdf.numPages>100)fail();
      let grade=null, date=null, previous=[], found=new Map(), noPoints=[];
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n),v=page.getViewport({scale:1});
        if(Math.abs(v.width-596)>2||Math.abs(v.height-842)>2||v.rotation!==0)fail();
        const content=await page.getTextContent();
        const items=content.items.filter(t=>typeof t.str==='string'&&tidy(t.str)).map(t=>{
          const xy=pdfjs.Util.applyTransform([t.transform[4],t.transform[5]],v.transform);
          return {str:tidy(t.str),x:xy[0],y:xy[1]};
        });
        if(n===1){
          const first=tidy(items.map(t=>t.str).join(' '));
          const g=first.match(/\bAverage\s*\(\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*\)/i);
          const d=first.match(/\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\b/);
          if(!/Roadster Diner DineIN/i.test(first)||!g||!d)fail();
          grade=Number(g[1].replace(',','.'));
          const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(d[2].toLowerCase())+1;
          date=d[3]+'-'+String(month).padStart(2,'0')+'-'+d[1].padStart(2,'0');
          if(!Number.isFinite(grade)||grade<0||grade>100||!month||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail();
        }
        const rows=items.flatMap(t=>{
          const m=t.x>107&&t.x<128&&t.str.match(idRe);
          return m?[{id:m[1]+m[2],group:m[1],y:t.y,item:t,remainder:t.str.slice(m[0].length).trim()}]:[];
        });
        if(rows.length){
          const canvas=document.createElement('canvas');const vp=page.getViewport({scale});
          canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
          try{
            const ctx=canvas.getContext('2d',{willReadFrequently:true});
            await page.render({canvasContext:ctx,viewport:vp,annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;
            const image=ctx.getImageData(0,0,canvas.width,canvas.height),w=canvas.width;
            const read=(x,y)=>{const i=(Math.round(y*scale)*w+Math.round(x*scale))*4;return (image.data[i]+image.data[i+1]+image.data[i+2])/3};
            for(const r of rows){
              if(!ids.includes(r.id)||found.has(r.id))fail();
              const answer=classify(read,r.y);found.set(r.id,answer);
              if(answer===1)noPoints.push({code:r.id,section:groups[r.group][0],text:rowText(items,read,r,previous)});
            }
          }finally{canvas.width=0;canvas.height=0}
        }
        previous=items;page.cleanup();
      }
      if(found.size!==ids.length||ids.some(id=>!found.has(id))||grade===null||!date)fail();
      noPoints.sort((a,b)=>ids.indexOf(a.code)-ids.indexOf(b.code));
      return {date,grade,noPoints};
    }finally{if(pdf)await pdf.destroy();else await task.destroy();}
  }
  window.MysteryPDF=Object.freeze({parse,classify,rowText,ids});
})();