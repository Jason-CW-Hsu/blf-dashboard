import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = process.cwd();
const incoming = path.join(root, 'incoming');
const snapshotsDir = path.join(root, 'snapshots');
const siteDir = path.join(root, 'site');
const downloadDir = path.join(root, 'downloads');
const required = [
  ['勞工退休基金', '新制／舊制勞退'],
  ['勞工保險基金', '勞工保險'],
  ['國民年金保險基金', '國民年金']
];
const assetLabels = ['自行運用','轉存金融機構','政策性貸款','短期票券','公債、公司債、金融債券及特別股','公債、金融債券、公司債及證券化商品','房屋及土地','政府或公營事業貸款','被保險人貸款','股票及受益憑證投資（含期貨）','國外投資','固定收益','權益證券','另類投資','委託經營','國內委託經營','國外委託經營','合計'];
const clean = s => s.replace(/\s+/g, ' ').trim();
const toNum = s => Number(s.replace(/,/g, ''));
const run = promisify(execFile);

async function linesFromPdf(file) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await fs.readFile(file)), disableWorker: true }).promise;
  const pages = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: item.transform[4], text: item.str });
    }
    pages.push([...byY.entries()].sort((a,b) => b[0]-a[0]).map(([y, items]) => ({ y, items: items.sort((a,b)=>a.x-b.x), text: clean(items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')) })));
  }
  return pages;
}

async function maybeSendEmail(period) {
  if (!['1', 'true', 'yes', 'on'].includes((process.env.SEND_UPDATE_EMAIL || '').trim().toLowerCase())) return;
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const emailTo = (process.env.EMAIL_TO || '').trim();
  if (!smtpHost || !smtpUser || !smtpPass || !emailTo) return;
  await run('python3', [path.join(root, 'scripts', 'send-update-email.py')], {
    env: {
      ...process.env,
      UPDATE_PERIOD: period,
      DASHBOARD_URL: 'https://jason-cw-hsu.github.io/blf-dashboard/',
    },
  });
}

const compactKey = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[()（）]/g, '');
const delegatedKey = (row) => [row.fund, row.section, compactKey(row.batch), compactKey(canonical(row.manager, row.section)), compactKey(row.unit)].join('|');

async function loadPreviousDelegatedMap(currentPeriod) {
  const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  const previous = entries
    .filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name) && entry.name.slice(0, 6) < currentPeriod)
    .map((entry) => entry.name)
    .sort();
  const latest = previous.at(-1);
  if (!latest) return new Map();
  const snapshot = JSON.parse(await fs.readFile(path.join(snapshotsDir, latest), 'utf8'));
  const map = new Map();
  for (const row of snapshot.delegated || []) {
    const key = delegatedKey(row);
    map.set(key, (map.get(key) || 0) + Number(row.nav || 0));
  }
  return map;
}

function parseAssets(pages, fund) {
  const out = []; let inAssets = false; let parent = '';
  for (const page of pages) for (let i=0; i<page.length; i++) {
    const line = page[i];
    if (line.text.includes('資產配置')) inAssets = true;
    if (inAssets && (/四、基\s*金\s*國內委外/.test(line.text) || line.text.includes('國內委外投資概況表'))) inAssets = false;
    if (!inAssets) continue;
    const compactLine = line.text.replace(/\s/g, '');
    const label = assetLabels.find(x => compactLine.startsWith(x));
    if (!label) continue;
    const match = line.text.match(/([\d,]+)\s+(\d+(?:\.\d+)?)\s*$/) || page[i-1]?.text.match(/([\d,]+)\s+(\d+(?:\.\d+)?)\s*$/);
    if (!match) continue;
    if (label === '自行運用' || label === '委託經營') parent = label;
    let item = label;
    if (['固定收益','權益證券','另類投資'].includes(label)) item = `${parent}-${label}`;
    out.push({ fund, item, amount: toNum(match[1]), ratio: Number(match[2]) / 100 });
  }
  if (!out.some(x => x.item === '合計')) throw new Error(`${fund}：找不到完整的「資產配置」表`);
  return out;
}

function parsePensionAssets(pages) {
  const labels = ['自行運用','轉存金融機構','短期票券','公債、公司債、金融債券及特別股','股票及受益憑證投資（含期貨）','國外投資','固定收益','權益證券','另類投資','委託經營','國內委託經營','國外委託經營','固定收益','權益證券','另類投資','合計'];
  const results = [];
  for (const [fund, pageIndex] of [['新制',2],['舊制',3]]) {
    const text = (pages[pageIndex] || []).map(x => x.text).join(' ');
    const pairs = [...text.matchAll(/([\d,]+)\s+(\d+\.\d{2})/g)].map(x => [toNum(x[1]),Number(x[2])/100]);
    if (pairs.length < 16) throw new Error(`${fund}：資產配置擷取不完整（${pairs.length}/16）`);
    let parent = '';
    labels.forEach((label,i) => { if(label==='自行運用'||label==='委託經營') parent=label; const item=['固定收益','權益證券','另類投資'].includes(label)?`${parent}-${label}`:label; results.push({fund,item,amount:pairs[i][0],ratio:pairs[i][1]}); });
  }
  return results;
}

function parseDelegated(pages, fund) {
  const rows = []; let section = null; let batch = ''; let unit = '';
  for (const page of pages) for (let i=0; i<page.length; i++) {
    const line = page[i]; const n = line.text.replace(/\s/g, '');
    if (n.includes('四、基金國內委外投資概況表')) section = '國內';
    if (n.includes('五、基金國外委外投資概況表')) section = '國外';
    if (n.includes('六、基金自營投資概況表')) section = null;
    if (!section) continue;
    if (n.includes('單位') && (n.includes('委託經營') || (section === '國外' && n.includes('型')))) {
      batch = n.replace(/單位[:：].*$/, ''); unit = (n.match(/單位[:：](.*)$/)||[])[1] || ''; continue;
    }
    if (!batch || /^(合計|註|投信|受託|名稱|機構|委託|目前|累積|投資|排名)/.test(line.text)) continue;
    const numeric = [...line.text.matchAll(/[-−]?\d[\d,]*(?:\.\d+)?/g)].map(x => Number(x[0].replace(/[−,]/g, c => c === '−' ? '-' : '')));
    if (numeric.length < 5) continue;
    const manager = clean(line.items.filter(x => x.x < 100).map(x => x.text).join(' '));
    if (!manager || /^\d/.test(manager) || manager.includes('單位')) continue;
    const [amount, nav, monthReturn, sinceReturn] = numeric;
    if (amount < 1e6 || nav < 1e6) continue;
    const target = numeric.at(-1);
    rows.push({ fund, section, batch, manager, amount, nav, monthReturn, sinceReturn, target, unit });
  }
  if (rows.length < 10) throw new Error(`${fund}：委外明細僅擷取 ${rows.length} 筆，疑似 PDF 格式變更`);
  return rows;
}

function canonical(manager, section) {
  const key = manager.replace(/\s/g, '');
  if (key === 'NinetyOne') return 'Ninety One';
  if (key === 'AmericanCentury' || key === 'American') return 'American Century';
  if (key === 'T.RowePrice') return 'T. Rowe Price';
  if (manager === '富蘭克林' || manager === '富蘭克林坦伯頓') return '富蘭克林坦伯頓';
  if (manager === '摩根' || manager === 'JPMorgan') return section === '國內' ? 'JPMorgan（國內）' : 'JPMorgan（國外）';
  if (manager === 'Center') return 'Center Square';
  return manager;
}

function managerTotals(rows, section) {
  const items = new Map();
  for (const row of rows.filter(x => x.section === section)) {
    const name = canonical(row.manager, section);
    const current = items.get(name) || { nav: 0, change: 0 };
    current.nav += row.nav;
    current.change += Number(row.change || 0);
    items.set(name, current);
  }
  const total = [...items.values()].reduce((a,b)=>a+b.nav,0);
  return [...items].map(([name,stats]) => ({ name, nav: stats.nav, change: stats.change, share: stats.nav / total })).sort((a,b)=>b.nav-a.nav);
}

function html(snapshot) {
  const fx = 31.945; const funds = ['新制','舊制','勞工保險','國民年金'];
  const totals = funds.map(f => { const a=snapshot.assets.filter(x=>x.fund===f); return [f, a.find(x=>x.item==='合計')?.amount || 0]; });
  totals.push(['四大基金合計', totals.reduce((s,x)=>s+x[1],0)]);
  const configs = funds.concat('四大基金合計').map(f => { const a=f==='四大基金合計'? snapshot.assets : snapshot.assets.filter(x=>x.fund===f); const find=item=>a.filter(x=>x.item===item).reduce((s,x)=>s+x.amount,0); return [f, find('合計'), ['自行運用-固定收益','自行運用-權益證券','自行運用-另類投資','委託經營-固定收益','委託經營-權益證券','委託經營-另類投資'].map(find)]; });
  const d=managerTotals(snapshot.delegated,'國內'), o=managerTotals(snapshot.delegated,'國外');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>勞動基金運用局｜基金儀表板</title><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;background:#f4f7fa;color:#17365d}header{background:#17365d;color:#fff;padding:24px max(20px,calc((100vw - 1200px)/2))}h1{margin:0;font-size:24px}.sub{font-size:14px;opacity:.8;margin-top:8px}main{max-width:1200px;margin:24px auto;padding:0 20px}.cards,.charts{display:grid;gap:16px}.cards{grid-template-columns:repeat(5,1fr)}.charts{grid-template-columns:repeat(3,1fr);margin:20px 0}.wide{grid-template-columns:1fr 1fr}.card,.panel{background:#fff;border:1px solid #d9e2f3;border-radius:10px;padding:14px}.card b{display:block;font-size:22px;margin-top:8px}.panel h2{font-size:16px;margin:0 0 8px}.panel canvas{max-height:300px}.fx{background:#eaf3fb;border-left:4px solid #5b9bd5;padding:10px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}th,td{padding:8px;border-bottom:1px solid #d9e2f3;text-align:right}th:first-child,td:first-child{text-align:left}tr.total td{font-weight:700;background:#eaf3fb;border-top:2px solid #5b9bd5}@media(max-width:850px){.cards,.charts,.wide{grid-template-columns:1fr}}</style></head><body><header><h1>勞動基金運用局｜四大基金儀表板</h1><div class="sub">資料期間：${snapshot.period}｜所有金額均為美元十億（USD $B）</div></header><main><section class="cards" id="totals"></section><p class="fx">美元換算：臺銀 USD/TWD 即期賣出 <b id="fx"></b>｜報價時間：更新時匯率未自動擷取；請以公開報價覆核｜<a href="https://rate.bot.com.tw/xrt?Lang=en-US">公開匯率來源</a><br>委外帳戶當期加/減為相較前一月同帳戶目前淨資產的差額；若為新出現的帳戶，則以當月目前淨資產作為加額。</p><section class="charts" id="funds"></section><section class="charts wide"><div class="panel"><h2>國內委外｜前十大目前淨資產與市占率</h2><canvas id="domestic"></canvas></div><div class="panel"><h2>國外委外｜前十大目前淨資產與市占率</h2><canvas id="overseas"></canvas></div></section><section class="charts wide"><div class="panel"><h2>國內委外｜前十大業者明細</h2><table><thead><tr><th>業者</th><th>目前淨資產（USD $B）</th><th>當期加/減（USD $B）</th><th>市占率</th></tr></thead><tbody id="domRows"></tbody></table></div><div class="panel"><h2>國外委外｜前十大業者明細</h2><table><thead><tr><th>業者</th><th>目前淨資產（USD $B）</th><th>當期加/減（USD $B）</th><th>市占率</th></tr></thead><tbody id="ovrRows"></tbody></table></div></section></main><script>const d=${JSON.stringify({fx,configs,dom:d,ovr:o})};const labs=['自行-固定收益','自行-權益','自行-另類','委託-固定收益','委託-權益','委託-另類'],c=['#9dc3e6','#5b9bd5','#2f75b5','#f4b183','#ed7d31','#c55a11'],money=v=>'$'+v.toFixed(2)+'B',moneySigned=v=>(v<0?'-':'+')+'$'+Math.abs(v).toFixed(2)+'B',usd=v=>v/d.fx/1e9;fx.textContent=d.fx.toFixed(3);totals.innerHTML=d.configs.map(x=>'<div class="card">'+x[0]+'<b>'+money(usd(x[1]))+'</b></div>').join('');const slice={id:'slice',afterDatasetsDraw(ch){const t=ch.data.datasets[0].data.reduce((a,b)=>a+b,0),ctx=ch.ctx;ctx.save();ctx.font='bold 11px sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ch.getDatasetMeta(0).data.forEach((a,i)=>{const p=a.getProps(['x','y','startAngle','endAngle','innerRadius','outerRadius'],true),q=ch.data.datasets[0].data[i]/t;if(q>.035){const r=(p.innerRadius+p.outerRadius)/2,z=(p.startAngle+p.endAngle)/2;ctx.fillText((q*100).toFixed(1)+'%',p.x+Math.cos(z)*r,p.y+Math.sin(z)*r)}});ctx.restore()}};d.configs.forEach((x,i)=>{funds.insertAdjacentHTML('beforeend','<div class="panel"><h2>'+x[0]+'｜'+money(usd(x[1]))+'</h2><canvas id="f'+i+'"></canvas></div>');new Chart(document.querySelector('#f'+i),{type:'doughnut',data:{labels:labs,datasets:[{data:x[2],backgroundColor:c}]},plugins:[slice],options:{plugins:{legend:{position:'bottom'}}}})});function bar(id,a,domestic){new Chart(document.querySelector(id),{data:{labels:a.slice(0,10).map(x=>x.name),datasets:[{type:'bar',label:'目前淨資產（USD $B）',data:a.slice(0,10).map(x=>domestic?usd(x.nav):x.nav/1e9),backgroundColor:'#5b9bd5',yAxisID:'y'},{type:'line',label:'市占率',data:a.slice(0,10).map(x=>x.share*100),borderColor:'#ed7d31',pointRadius:4,yAxisID:'y1'}]},options:{scales:{y:{ticks:{callback:v=>'$'+v.toFixed(1)+'B'}},y1:{position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>v+'%'}}}}})}function rows(id,a,domestic){const total=a.reduce((s,x)=>s+x.nav,0);document.querySelector(id).innerHTML=a.slice(0,10).map(x=>'<tr><td>'+x.name+'</td><td>'+money(domestic?usd(x.nav):x.nav/1e9)+'</td><td>'+moneySigned(domestic?usd(x.change):x.change/1e9)+'</td><td>'+(x.share*100).toFixed(1)+'%</td></tr>').join('')+'<tr class="total"><td>全數業者合計</td><td>'+money(domestic?usd(total):total/1e9)+'</td><td>'+moneySigned(domestic?usd(a.reduce((s,x)=>s+x.change,0)):a.reduce((s,x)=>s+x.change,0)/1e9)+'</td><td>100.0%</td></tr>'}bar('#domestic',d.dom,true);bar('#overseas',d.ovr,false);rows('#domRows',d.dom,true);rows('#ovrRows',d.ovr,false);</script></body></html>`;
}

async function xlsx(snapshot) {
  const wb = new ExcelJS.Workbook(); wb.creator = '勞動基金月度自動更新';
  const dash = wb.addWorksheet('儀表板'); dash.columns = [{width:18},{width:18},{width:18},{width:18},{width:18},{width:18}]; dash.mergeCells('A1:F1'); dash.getCell('A1').value='勞動基金運用局｜四大基金月度儀表板'; dash.getCell('A1').font={bold:true,color:{argb:'FFFFFFFF'},size:16}; dash.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}}; dash.addRow(['資料期間',snapshot.period]); dash.addRow([]); dash.addRow(['基金','資產總額（元）']); for(const fund of ['新制','舊制','勞工保險','國民年金']) dash.addRow([fund,snapshot.assets.find(x=>x.fund===fund&&x.item==='合計')?.amount||0]); dash.addRow(['四大基金合計',{formula:`SUM(B5:B8)`}]); dash.getColumn(2).numFmt='#,##0'; dash.getRow(4).font={bold:true,color:{argb:'FFFFFFFF'}};dash.getRow(4).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};
  for(const [name, rows] of [['月度資產配置',snapshot.assets],['國內委外明細',snapshot.delegated.filter(x=>x.section==='國內')],['國外委外明細',snapshot.delegated.filter(x=>x.section==='國外')]]) { const ws=wb.addWorksheet(name); const headers=name==='月度資產配置'?['基金','資產配置項目','金額（元）','占比']:['基金','批次／策略類型','業者','委託金額','目前淨資產','委外帳戶當期加/減','單位','委任至今投資報酬率','目標／指標報酬率']; ws.addRow(headers); ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}}; for(const r of rows) ws.addRow(name==='月度資產配置'?[r.fund,r.item,r.amount,r.ratio]:[r.fund,r.batch,canonical(r.manager,r.section),r.amount,r.nav,r.change??0,r.unit,r.sinceReturn/100,r.target/100]); ws.columns.forEach(c=>c.width=22); ws.getColumn(name==='月度資產配置'?3:4).numFmt='#,##0'; if(name==='月度資產配置')ws.getColumn(4).numFmt='0.00%'; else {ws.getColumn(4).numFmt='#,##0';ws.getColumn(5).numFmt='#,##0';ws.getColumn(6).numFmt='#,##0;[Red]-#,##0';ws.getColumn(8).numFmt='0.00%';ws.getColumn(9).numFmt='0.00%';} ws.views=[{state:'frozen',ySplit:1}]; }
  await fs.mkdir(downloadDir,{recursive:true}); await wb.xlsx.writeFile(path.join(downloadDir,'勞動基金月度揭露_可持續更新.xlsx'));
}

const months = (await fs.readdir(incoming,{withFileTypes:true})).filter(x=>x.isDirectory()&&/^\d{6}$/.test(x.name)).map(x=>x.name).sort();
if (!months.length) throw new Error('請先建立 incoming/YYYYMM 資料夾並上傳三份 PDF');
const period = months.at(-1); const dir = path.join(incoming,period); const names = await fs.readdir(dir); const files = required.map(([needle,fund]) => { const name=names.find(x=>x.includes(needle)&&x.toLowerCase().endsWith('.pdf')); if(!name) throw new Error(`${period} 缺少「${needle}」PDF`); return [path.join(dir,name),fund]; });
const assets=[]; for(const [file,fund] of files){const pages=await linesFromPdf(file);assets.push(...(fund==='新制／舊制勞退'?parsePensionAssets(pages):parseAssets(pages,fund)));}
const tempDir = path.join(snapshotsDir,'.tmp'); await fs.mkdir(tempDir,{recursive:true});
const pensionFile = files.find(([,fund])=>fund==='新制／舊制勞退')[0]; const laborFile = files.find(([,fund])=>fund==='勞工保險')[0]; const nationalFile = files.find(([,fund])=>fund==='國民年金')[0];
const pensionOut=path.join(tempDir,`${period}-pension.json`), laborOut=path.join(tempDir,`${period}-labor.json`), nationalOut=path.join(tempDir,`${period}-national.json`);
await run(process.execPath,[path.join(root,'work','extract-delegated-coords.mjs'),pensionFile,pensionOut]);
await run(process.execPath,[path.join(root,'work','extract-single-fund-coords.mjs'),laborFile,'勞工保險',laborOut]);
await run(process.execPath,[path.join(root,'work','extract-single-fund-coords.mjs'),nationalFile,'國民年金',nationalOut]);
const delegated=[...JSON.parse(await fs.readFile(pensionOut,'utf8')),...JSON.parse(await fs.readFile(laborOut,'utf8')),...JSON.parse(await fs.readFile(nationalOut,'utf8'))];
const previousDelegated = await loadPreviousDelegatedMap(period);
for (const row of delegated) {
  const previous = previousDelegated.get(delegatedKey(row));
  row.change = previous === undefined ? row.nav : row.nav - previous;
}
const minDelegatedRows = 260;
if (delegated.length < minDelegatedRows) throw new Error(`委外明細僅擷取 ${delegated.length} 筆，低於最低品質門檻 ${minDelegatedRows} 筆；已停止發布。`);
const snapshot={period,generatedAt:new Date().toISOString(),assets,delegated}; await fs.mkdir(snapshotsDir,{recursive:true}); await fs.writeFile(path.join(snapshotsDir,`${period}.json`),JSON.stringify(snapshot,null,2)); await fs.mkdir(siteDir,{recursive:true}); await fs.writeFile(path.join(siteDir,'index.html'),html(snapshot)); await xlsx(snapshot); await maybeSendEmail(period); console.log(JSON.stringify({period,assets:assets.length,delegated:delegated.length},null,2));
