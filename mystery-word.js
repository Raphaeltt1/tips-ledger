/* Minimal, standards-compliant Office Open XML report; no remote document service. */
(() => {
 'use strict';
 const enc=new TextEncoder();
 const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
 function zip(files){
  const chunks=[],central=[];let offset=0,size=0;
  const header=(n)=>{const a=new Uint8Array(n);return [a,new DataView(a.buffer)]};
  for(const [name,text] of Object.entries(files)){
   const n=enc.encode(name),data=enc.encode(text),c=crc(data),[l,v]=header(30),[h,d]=header(46);
   v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,c,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);
   d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,c,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);
   chunks.push(l,n,data);central.push(h,n);offset+=l.length+n.length+data.length;size+=h.length+n.length;
  }
  const [end,e]=header(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,Object.keys(files).length,true);e.setUint16(10,Object.keys(files).length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
 }
 const p=(t,sz=22,bold=false,color='172B49')=>'<w:p><w:pPr><w:spacing w:after="180"/></w:pPr><w:r><w:rPr>'+(bold?'<w:b/>':'')+'<w:color w:val="'+color+'"/><w:sz w:val="'+sz+'"/></w:rPr><w:t xml:space="preserve">'+xml(t)+'</w:t></w:r></w:p>';
 function create(report,name){
  const body=p('ROADSTER DINER',24,true,'67768A')+p('Mystery Shopper Evaluation',38,true)+p(name+'  |  '+report.report_date,22)+p('Total grade: '+Number(report.total_grade).toFixed(2)+'%',42,true)+p('Points requiring improvement',26,true)+((report.no_points||[]).length?report.no_points.map(q=>p(q.code+' · '+q.section+' · NO',22,true,'B42338')+p(q.text)).join(''):p('No points marked NO.'));
  return zip({'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
   '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
   'word/document.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>'});
 }
 window.MysteryWord=Object.freeze({create});
})();