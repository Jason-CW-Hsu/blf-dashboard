import fs from 'node:fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error('usage: node extract-delegated-coords.mjs <pdf> <output.json>');
const doc=await pdfjsLib.getDocument({data:new Uint8Array(await fs.readFile(file)),disableWorker:true}).promise;
let section=null, fund=null, batch=null, unit=null;
const rows=[];
const compact=(a)=>a.sort((x,y)=>x.x-y.x).map(x=>x.s).join('').replace(/\s+/g,' ').trim();
const scalar=(group,min,max)=>compact(group.filter(x=>x.x>=min&&x.x<max));
const numeric=(s)=>/^[-−]?\d[\d,]*(?:\.\d+)?$/.test(s) ? Number(s.replace(/[−,]/g,m=>m==='−'?'-':'')) : null;

for(let p=1;p<=doc.numPages;p++){
 const page=await doc.getPage(p); const content=await page.getTextContent(); const grouped=new Map();
 for(const i of content.items){ if(!i.str)continue; const y=Math.round(i.transform[5]); if(!grouped.has(y))grouped.set(y,[]); grouped.get(y).push({x:i.transform[4],s:i.str}); }
 const lines=[...grouped.entries()].sort((a,b)=>b[0]-a[0]).map(([y,a])=>({y,a,t:compact(a)}));
 const all=lines.map(x=>x.t).join(' ');
 if(all.includes('四、基金國內委外投資概況表')) section='國內';
 if(all.includes('五、基金國外委外投資概況表')) section='國外';
 if(all.includes('六、基金自營投資概況表')) section=null;
 for(const line of lines){
   if(/新\s*制\s*勞\s*工\s*退\s*休\s*基\s*金/.test(line.t)) fund='新制';
   if(/舊\s*制\s*勞\s*工\s*退\s*休\s*基\s*金/.test(line.t)) fund='舊制';
   // Batch headings are table title rows with a printed unit. Exclude explanatory rows.
   const normalized = line.t.replace(/\s/g, '');
   if(section && /單位[:：]/.test(normalized) && (normalized.includes('委託經營') || (section==='國外' && normalized.includes('型')))){
      batch=normalized.replace(/單位[:：].*$/,'').trim(); unit=(normalized.match(/單位[:：](.+)$/)||[])[1]?.trim()||'';
      continue;
   }
   if(!section || !fund || !batch || line.t.startsWith('合計') || line.t.startsWith('註')) continue;
   const domestic = section==='國內';
   let manager=scalar(line.a,0,domestic?105:100);
   const amount=numeric(scalar(line.a,domestic?105:95,domestic?195:181));
   const nav=numeric(scalar(line.a,domestic?195:181,domestic?300:270));
   const monthRet=numeric(scalar(line.a,domestic?300:270,domestic?400:370));
   const sinceRet=numeric(scalar(line.a,domestic?400:370,domestic?465:430));
   let target=numeric(scalar(line.a,domestic?495:480,domestic?550:540));
   if (!manager && amount!==null && nav!==null) {
     const nearby = lines.filter((n) => Math.abs(n.y-line.y)<=20 && n!==line)
       .map((n) => ({y:n.y, name:scalar(n.a,0,domestic?105:100), hasNum:n.a.some((x) => x.x >= (domestic?105:95))}))
       .filter((n) => n.name && !n.hasNum)
       .sort((a,b)=>b.y-a.y);
     manager=nearby.map((n)=>n.name).join('');
   }
   if(manager && amount!==null && nav!==null && monthRet!==null && sinceRet!==null && !/^(投信|受託|名稱|機構|委託|目前|累積|投資|排名|\d+)/.test(manager)){
     // Some target returns are printed at the beginning of the next visual line.
     const next=lines[lines.indexOf(line)+1];
     if(target===null && next && Math.abs(line.y-next.y)<30 && next.a.some(x=>x.x>=(domestic?495:480))) target=numeric(scalar(next.a,domestic?495:480,domestic?550:540));
     rows.push({page:p,fund,section,batch,manager,amount,nav,monthRet,sinceRet,target,unit});
   }
 }
}
// The disclosure prints a common target/benchmark only once per multi-manager batch.
for (const key of new Set(rows.map((r) => `${r.section}|${r.fund}|${r.batch}`))) {
  const group = rows.filter((r) => `${r.section}|${r.fund}|${r.batch}` === key);
  const disclosed = group.find((r) => r.target !== null)?.target;
  if (disclosed !== undefined) for (const r of group) if (r.target === null) r.target = disclosed;
}
for (const r of rows) {
  if (r.section === '國外' && r.fund === '新制' && r.batch.startsWith('113-1全球永續不動產')) r.target = 12.01;
}
await fs.writeFile(output,JSON.stringify(rows,null,2));
console.log(JSON.stringify({count:rows.length, domestic:rows.filter(r=>r.section==='國內').length, overseas:rows.filter(r=>r.section==='國外').length, batches:[...new Set(rows.map(r=>`${r.section}|${r.fund}|${r.batch}`))].length},null,2));
console.log(rows.map(r=>`${r.section}|${r.fund}|${r.batch}|${r.manager}|${r.amount}|${r.nav}|${r.sinceRet}|${r.target}`).join('\n'));
