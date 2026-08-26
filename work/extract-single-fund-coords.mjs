import fs from 'node:fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
const [file, fixedFund, output] = process.argv.slice(2);
if (!file || !fixedFund || !output) throw new Error('usage: pdf fund output');
const doc=await pdfjsLib.getDocument({data:new Uint8Array(await fs.readFile(file)),disableWorker:true}).promise;
let section=null, fund=fixedFund, batch=null, unit=null; const rows=[];
const compact=(a)=>a.sort((x,y)=>x.x-y.x).map(x=>x.s).join('').replace(/\s+/g,' ').trim();
const scalar=(g,min,max)=>compact(g.filter(x=>x.x>=min&&x.x<max));
const numeric=(s)=>/^[-−]?\d[\d,]*(?:\.\d+)?$/.test(s)?Number(s.replace(/[−,]/g,m=>m==='−'?'-':'')):null;
for(let p=1;p<=doc.numPages;p++){
 const pg=await doc.getPage(p), ct=await pg.getTextContent(), m=new Map();
 for(const i of ct.items){if(!i.str)continue;const y=Math.round(i.transform[5]);if(!m.has(y))m.set(y,[]);m.get(y).push({x:i.transform[4],s:i.str});}
 const lines=[...m.entries()].sort((a,b)=>b[0]-a[0]).map(([y,a])=>({y,a,t:compact(a)})); const all=lines.map(x=>x.t).join(' ');
 if(all.includes('四、基')&&all.includes('國內委外'))section='國內'; if(all.includes('五、基')&&all.includes('國外委外'))section='國外'; if(all.includes('六、基')&&all.includes('自營投資'))section=null;
 for(let ix=0;ix<lines.length;ix++){const line=lines[ix], norm=line.t.replace(/\s/g,'');
  const nextNorm=(lines[ix+1]?.t||'').replace(/\s/g,'');
  const titleWithNextUnit=section&&nextNorm.startsWith('單位')&&(norm.includes('委託經營')||(section==='國外'&&norm.includes('型')));
  if(section && ((/單位[:：]/.test(norm) && (norm.includes('委託經營') || (section==='國外'&&norm.includes('型'))) ) || titleWithNextUnit)){const heading=titleWithNextUnit?`${norm}${nextNorm}`:norm;batch=heading.replace(/單位[:：].*$/,'');unit=(heading.match(/單位[:：](.+)$/)||[])[1]||'';continue;}
  if(!section||!batch||line.t.startsWith('合計')||line.t.startsWith('註'))continue;
  const domestic=section==='國內', managerLimit=95;
  let manager=scalar(line.a,0,managerLimit); const amount=numeric(scalar(line.a,95,181)); const nav=numeric(scalar(line.a,181,270)); const monthRet=numeric(scalar(line.a,270,370)); const sinceRet=numeric(scalar(line.a,370,430)); let target=numeric(scalar(line.a,480,540));
  if(!manager&&amount!==null&&nav!==null){const nearby=lines.filter(n=>Math.abs(n.y-line.y)<=20&&n!==line).map(n=>({y:n.y,name:scalar(n.a,0,managerLimit),hasNum:n.a.some(x=>x.x>=95)})).filter(n=>n.name&&!n.hasNum).sort((a,b)=>Math.abs(a.y-line.y)-Math.abs(b.y-line.y));manager=nearby[0]?.name||'';}
  if(manager&&amount!==null&&nav!==null&&monthRet!==null&&sinceRet!==null&&!/^(投信|受託|名稱|機構|委託|目前|累積|投資|排名|\d+)/.test(manager)){const next=lines[ix+1];if(target===null&&next&&Math.abs(line.y-next.y)<30&&next.a.some(x=>x.x>=480))target=numeric(scalar(next.a,480,540));rows.push({fund,section,batch,manager,amount,nav,monthRet,sinceRet,target,unit});}
 }
}
const cleanRows=rows.filter(r=>!r.manager.startsWith('註：')&&!r.manager.includes('合計'));
for (const r of cleanRows) {
  if (r.manager === 'American') r.manager = 'American Century';
  if (r.manager === 'T. Rowe') r.manager = 'T. Rowe Price';
  if (r.fund === '國民年金' && r.section === '國外' && r.batch.startsWith('110-1全球多元資產型') && r.amount === 60000000 && r.nav === 73420942) r.manager = 'Ninety One';
}
for(const key of new Set(cleanRows.map(r=>`${r.section}|${r.batch}`))){const g=cleanRows.filter(r=>`${r.section}|${r.batch}`===key),t=g.find(r=>r.target!==null)?.target;if(t!==undefined)for(const r of g)if(r.target===null)r.target=t;}
await fs.writeFile(output,JSON.stringify(cleanRows,null,2)); console.log(JSON.stringify({fund,rows:cleanRows.length,domestic:cleanRows.filter(r=>r.section==='國內').length,overseas:cleanRows.filter(r=>r.section==='國外').length},null,2));
