import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';
import { loadDashboardData } from './load-monthly-data.mjs';

const root = process.cwd();
const outDir = path.join(root, 'outputs', 'blf-monthly-disclosure');
const { assetRows: dataRows, latestDate, latestPeriod, fx } = await loadDashboardData(root);
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(/,/g, ''));
const latestMonth = latestDate.getMonth() + 1;
const dashboardRangeText = `115 年 1–${latestMonth} 月；勞保、國保為 115 年 ${latestMonth} 月`;

function sectionRows(text, start, end, scope) {
  const block = text.slice(text.indexOf(start), text.indexOf(end));
  const fundCut = block.indexOf('2. 舊制勞工退休基金');
  const parts = [[ '新制', block.slice(0, fundCut) ], [ '舊制', block.slice(fundCut) ]];
  const rows = [];
  for (const [fund, part] of parts) {
    const titleRe = scope === '國內'
      ? /(?:^|\n)(?:國內\s*)?(\d+\s*年[^\n]*委託經營[^\n]*)\s+單位：([^\n]+)/g
      : /(?:^|\n)(\d+(?:-\d+)?\s+[^\n]*?型[^\n]*)\s+單位：([^\n]+)/g;
    const matches = [...part.matchAll(titleRe)];
    for (let i=0; i<matches.length; i++) {
      const heading = clean(matches[i][1]);
      const unit = clean(matches[i][2]);
      const seg = part.slice(matches[i].index + matches[i][0].length, i+1<matches.length ? matches[i+1].index : part.length);
      const merged = clean(seg.replace(/\n/g, ' '));
      const rowRe = /([^\d%－\-]+?)\s+([\d,]+)\s+([\d,]+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(?:－|\d+)\s+(-?\d+\.\d+)/g;
      for (const r of merged.matchAll(rowRe)) {
        const manager = clean(r[1]);
        if (!manager || manager.includes('合計') || manager.includes('註') || manager.length > 30) continue;
        rows.push([new Date(2026,5,1),'115年6月',fund,scope,heading,manager,num(r[2]),num(r[3]),Number(r[5])/100,Number(r[6])/100,unit,'勞工退休基金-115年6月.pdf']);
      }
    }
  }
  return rows;
}
const delegated = JSON.parse(await fs.readFile(path.join(root, 'work', 'delegated-coords.json'), 'utf8'));
const addedDelegated = [
  ...JSON.parse(await fs.readFile(path.join(root, 'work', 'labor-insurance.json'), 'utf8')),
  ...JSON.parse(await fs.readFile(path.join(root, 'work', 'national-pension.json'), 'utf8')),
];
const canonicalManager = (manager, section) => {
  const key = manager.replace(/\s/g, '');
  if (key === 'NinetyOne') return 'Ninety One';
  if (key === 'AmericanCentury' || key === 'American') return 'American Century';
  if (key === 'T.RowePrice') return 'T. Rowe Price';
  if (key === 'Clearbridge') return 'ClearBridge';
  if (key === 'Allianz' || key === '安聯') return section === '國內' ? '安聯' : 'Allianz';
  if (key === 'Nomura' || key === '野村') return section === '國內' ? '野村' : 'Nomura';
  if (key === 'UBS' || key === '瑞銀') return section === '國內' ? '瑞銀' : 'UBS';
  if (key === '信安環球') return '信安';
  if (manager === '富蘭克林' || manager === '富蘭克林坦伯頓') return '富蘭克林坦伯頓';
  if (manager === '摩根' || manager === 'JPMorgan') return section === '國內' ? 'JPMorgan（國內）' : 'JPMorgan（國外）';
  if (manager === 'Center') return 'Center Square';
  return manager;
};
const compactKey = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[()（）]/g, '');
const delegatedKey = (row) => [row.fund, row.section, compactKey(row.batch), compactKey(canonicalManager(row.manager, row.section)), compactKey(row.unit)].join('|');
async function loadPreviousDelegatedMap(root, currentKey) {
  const snapshotDir = path.join(root, 'snapshots');
  const entries = await fs.readdir(snapshotDir, { withFileTypes: true }).catch(() => []);
  const previous = entries
    .filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name) && entry.name.slice(0, 6) < currentKey)
    .map((entry) => entry.name)
    .sort();
  const latest = previous.at(-1);
  if (!latest) return new Map();
  const snapshot = JSON.parse(await fs.readFile(path.join(snapshotDir, latest), 'utf8'));
  const map = new Map();
  for (const row of snapshot.delegated || []) {
    const key = delegatedKey(row);
    map.set(key, (map.get(key) || 0) + Number(row.nav || 0));
  }
  return map;
}
async function loadPreviousDelegatedRows(root, currentKey) {
  const snapshotDir = path.join(root, 'snapshots');
  const entries = await fs.readdir(snapshotDir, { withFileTypes: true }).catch(() => []);
  const previous = entries.filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name) && entry.name.slice(0, 6) < currentKey).map((entry) => entry.name).sort().at(-1);
  if (!previous) return [];
  const snapshot = JSON.parse(await fs.readFile(path.join(snapshotDir, previous), 'utf8'));
  return snapshot.delegated || [];
}
const currentSnapshotKey = `${latestDate.getFullYear()}${String(latestDate.getMonth() + 1).padStart(2, '0')}`;
const previousDelegatedMap = await loadPreviousDelegatedMap(root, currentSnapshotKey);
const previousDelegatedRows = await loadPreviousDelegatedRows(root, currentSnapshotKey);
const rocYear = latestDate.getFullYear() - 1911;
const mappedDelegated = [...delegated.map((r) => ({...r,filename:`勞工退休基金-${rocYear}年${latestDate.getMonth()+1}月.pdf`})),...addedDelegated.map((r) => ({...r,filename:r.fund==='勞工保險'?`勞工保險基金-${rocYear}年${latestDate.getMonth()+1}月.pdf`:`國民年金保險基金-${rocYear}年${latestDate.getMonth()+1}月.pdf`}))].map((r) => [latestDate, latestPeriod, r.fund, r.section, r.batch, r.manager, r.amount, r.nav, r.sinceRet / 100, r.target === null ? null : r.target / 100, r.unit, r.filename]);
// 109 年第二次委託經營（相對報酬）為國內委託批次；以此規則避免來源表格標題解析造成誤分類。
for (const row of mappedDelegated) {
  if (row[4].replace(/\s/g, '').includes('109年第二次委託經營(相對報酬)')) row[3] = '國內';
  row[5] = canonicalManager(row[5], row[3]);
  const prevNav = previousDelegatedMap.get([row[2], row[3], compactKey(row[4]), compactKey(row[5]), compactKey(row[10])].join('|'));
  row.push(prevNav === undefined ? row[7] : row[7] - prevNav, prevNav === undefined ? '新增' : '持續');
}
const currentKeys = new Set(mappedDelegated.map((row) => [row[2], row[3], compactKey(row[4]), compactKey(row[5]), compactKey(row[10])].join('|')));
for (const previous of previousDelegatedRows) {
  const manager = canonicalManager(previous.manager, previous.section);
  const key = [previous.fund, previous.section, compactKey(previous.batch), compactKey(manager), compactKey(previous.unit)].join('|');
  if (currentKeys.has(key)) continue;
  mappedDelegated.push([latestDate, latestPeriod, previous.fund, previous.section, previous.batch, manager, 0, 0, null, null, previous.unit, previous.sourceFile || '', -Number(previous.nav || 0), '解約']);
}
const domestic = mappedDelegated.filter((r) => r[3] === '國內');
const overseas = mappedDelegated.filter((r) => r[3] === '國外');
if (domestic.length < 80 || overseas.length < 100) throw new Error(`委外明細擷取數量不足：國內 ${domestic.length}、國外 ${overseas.length}`);

const wb = Workbook.create();
// 圓餅圖依序採用主題 Accent 1–6：前三個為自行運用的藍色深淺，後三個為委託經營的橘色深淺。
wb.setColorScheme({name:'Labor Funds Dashboard',themeColors:{accent1:'#9DC3E6',accent2:'#5B9BD5',accent3:'#2F75B5',accent4:'#1F4E79',accent5:'#F4B183',accent6:'#C55A11',dk1:'#17365D',lt1:'#FFFFFF',lt2:'#F4F7FA',hlink:'#0563C1',folHlink:'#954F72'}});
const sheets = {};
for (const n of ['儀表板','儀表板(美元)','月度資產配置','國內委外明細','國外委外明細','批次彙總','業者彙總','更新說明','資料品質檢核']) sheets[n] = wb.worksheets.add(n);
const navy='#17365D', blue='#D9EAF7', light='#F4F7FA', green='#E2F0D9', orange='#FCE4D6';
function title(sheet, text, endCol) { sheet.getRange(`A1:${endCol}1`).merge(); sheet.getRange('A1').values=[[text]]; sheet.getRange(`A1:${endCol}1`).format={fill:navy,font:{bold:true,color:'#FFFFFF',size:16},horizontalAlignment:'left',verticalAlignment:'center'}; sheet.getRange('A1').format.rowHeight=30; sheet.showGridLines=false; }
function header(sheet, range) { sheet.getRange(range).format={fill:navy,font:{bold:true,color:'#FFFFFF'},horizontalAlignment:'center',verticalAlignment:'center',wrapText:true,borders:{preset:'outside',style:'thin',color:'#9EADBA'}}; }
function body(sheet, range) { sheet.getRange(range).format={borders:{preset:'inside',style:'thin',color:'#D9E2F3'},verticalAlignment:'center'}; }
function asTable(sheet, range, name) { sheet.tables.add(range, true, name); }

// Assets
{ const s=sheets['月度資產配置']; title(s,'月度資產配置｜每月只需在此表追加 PDF 擷取資料','H');
  s.getRange('A3:H3').values=[['日期','期間','基金','資產配置項目','金額（元）','占基金運用比率','來源檔案','來源表格']]; header(s,'A3:H3');
  s.getRange(`A4:H${3+dataRows.length}`).values=dataRows; body(s,`A4:H${3+dataRows.length}`); asTable(s,`A3:H${3+dataRows.length}`,'tblAssets');
  s.getRange(`A4:A${3+dataRows.length}`).format.numberFormat='yyyy-mm-dd'; s.getRange(`E4:E${3+dataRows.length}`).format.numberFormat='#,##0'; s.getRange(`F4:F${3+dataRows.length}`).format.numberFormat='0.00%'; s.getRange('A:H').format.autofitColumns(); s.getRange('D:D').format.columnWidth=28; s.getRange('G:H').format.columnWidth=30; s.freezePanes.freezeRows(3);
}
function detailSheet(name, rows, tableName) { const s=sheets[name]; title(s,`${name}｜最新月度受託機構明細`, 'N'); const heads=['日期','期間','基金','區域','批次／策略類型','業者','委託金額','目前淨資產','委外帳戶當期加/減','帳戶狀態','單位','委任至今投資報酬率','委任至今目標／指標報酬率','來源檔案']; s.getRange('A3:N3').values=[heads]; header(s,'A3:N3'); const values=rows.map((r)=>[r[0],r[1],r[2],r[3],r[4],canonicalManager(r[5],r[3]),r[6],r[7],r[12] ?? 0,r[13] || '持續',r[10],r[8],r[9],r[11]]); s.getRange(`A4:N${3+rows.length}`).values=values; body(s,`A4:N${3+rows.length}`); asTable(s,`A3:N${3+rows.length}`,tableName); s.getRange(`A4:A${3+rows.length}`).format.numberFormat='yyyy-mm-dd'; s.getRange(`G4:I${3+rows.length}`).format.numberFormat='#,##0'; s.getRange(`L4:M${3+rows.length}`).format.numberFormat='0.00%'; s.getRange('A:N').format.autofitColumns(); s.getRange('E:E').format.columnWidth=38; s.getRange('N:N').format.columnWidth=28; s.freezePanes.freezeRows(3); }
detailSheet('國內委外明細', domestic, 'tblDomestic'); detailSheet('國外委外明細', overseas, 'tblOverseas');

{ const s=sheets['批次彙總']; title(s,'委外批次彙總｜歷年批次、策略、金額與委任至今績效','K'); const heads=['日期','期間','基金','區域','批次／策略類型','委託金額','目前淨資產','委任至今投資報酬率*','委任至今目標／指標報酬率','單位','來源']; s.getRange('A3:K3').values=[heads]; header(s,'A3:K3'); const keys=[]; for(const r of [...domestic,...overseas]) { const k=[r[0].toISOString(),r[2],r[3],r[4],r[10]].join('|'); if(!keys.some(x=>x.k===k)) keys.push({k,r}); } const rows=keys.map(({r})=>[r[0],r[1],r[2],r[3],r[4],null,null,null,null,r[10],r[11]]); s.getRange(`A4:K${3+rows.length}`).values=rows; for(let i=4;i<4+rows.length;i++){ const sourceSheet = rows[i-4][3]==='國內'?'國內委外明細':'國外委外明細'; const n=rows[i-4][3]==='國內'?domestic.length:overseas.length; s.getRange(`F${i}`).formulas=[[`=SUMIFS('${sourceSheet}'!$G$4:$G$${3+n},'${sourceSheet}'!$A$4:$A$${3+n},A${i},'${sourceSheet}'!$C$4:$C$${3+n},C${i},'${sourceSheet}'!$E$4:$E$${3+n},E${i})`]]; s.getRange(`G${i}`).formulas=[[`=SUMIFS('${sourceSheet}'!$H$4:$H$${3+n},'${sourceSheet}'!$A$4:$A$${3+n},A${i},'${sourceSheet}'!$C$4:$C$${3+n},C${i},'${sourceSheet}'!$E$4:$E$${3+n},E${i})`]]; s.getRange(`H${i}`).formulas=[[`=IFERROR(G${i}/F${i}-1,0)`]]; s.getRange(`I${i}`).formulas=[[`=IFERROR(SUMIFS('${sourceSheet}'!$J$4:$J$${3+n},'${sourceSheet}'!$A$4:$A$${3+n},A${i},'${sourceSheet}'!$C$4:$C$${3+n},C${i},'${sourceSheet}'!$E$4:$E$${3+n},E${i})/COUNTIFS('${sourceSheet}'!$A$4:$A$${3+n},A${i},'${sourceSheet}'!$C$4:$C$${3+n},C${i},'${sourceSheet}'!$E$4:$E$${3+n},E${i},'${sourceSheet}'!$J$4:$J$${3+n},"<>"),0)`]]; } body(s,`A4:K${3+rows.length}`); asTable(s,`A3:K${3+rows.length}`,'tblBatches'); s.getRange(`A4:A${3+rows.length}`).format.numberFormat='yyyy-mm-dd'; s.getRange(`F4:G${3+rows.length}`).format.numberFormat='#,##0'; s.getRange(`H4:I${3+rows.length}`).format.numberFormat='0.00%'; s.getRange('A:K').format.autofitColumns(); s.getRange('E:E').format.columnWidth=42; s.getRange('K:K').format.columnWidth=28; s.freezePanes.freezeRows(3); s.getRange(`A${5+rows.length}:K${5+rows.length}`).merge(); s.getRange(`A${5+rows.length}`).values=[['* 投資報酬率採「目前淨資產 ÷ 委託金額 − 1」計算；目標／指標報酬率採同批次受託機構之平均，便於跨批次比較。']]; s.getRange(`A${5+rows.length}:K${5+rows.length}`).format={fill:orange,wrapText:true}; }

// Summary tables: formula-driven from the two raw tables
{ const s=sheets['業者彙總']; title(s,'受託業者彙總｜依最新月份、基金與區域篩選後排序', 'AB');
  s.getRange('A3:C5').values=[['控制項','值','說明'],['最新月份',latestDate,'可改為其他資料月份'],['基金','全部','輸入：全部／新制／舊制']]; header(s,'A3:C3'); body(s,'A4:C5'); s.getRange('B4').format.numberFormat='yyyy-mm-dd'; s.getRange('B4:B5').format.font={color:'#0000FF'};
  s.getRange('A8:F8').values=[['國內委外｜業者','委託金額','目前淨資產','市占率（目前淨資產）','排名','帳戶數']]; header(s,'A8:F8');
  const dm=domestic.filter(r=>r[1]===latestPeriod); const dNames=[...new Set(dm.map(r=>r[5]))].sort((a,b)=>dm.filter(r=>r[5]===b).reduce((t,r)=>t+r[7],0)-dm.filter(r=>r[5]===a).reduce((t,r)=>t+r[7],0));
  s.getRange(`A9:A${8+dNames.length}`).values=dNames.map(x=>[x]);
  for(let r=9;r<9+dNames.length;r++){ s.getRange(`B${r}`).formulas=[[`=SUMIFS('國內委外明細'!$G$4:$G$${3+domestic.length},'國內委外明細'!$F$4:$F$${3+domestic.length},A${r},'國內委外明細'!$A$4:$A$${3+domestic.length},$B$4)`]]; s.getRange(`C${r}`).formulas=[[`=SUMIFS('國內委外明細'!$H$4:$H$${3+domestic.length},'國內委外明細'!$F$4:$F$${3+domestic.length},A${r},'國內委外明細'!$A$4:$A$${3+domestic.length},$B$4)`]]; s.getRange(`D${r}`).formulas=[[`=IFERROR(C${r}/SUM($C$9:$C$${8+dNames.length}),0)`]]; s.getRange(`E${r}`).formulas=[[`=RANK(C${r},$C$9:$C$${8+dNames.length},0)`]]; s.getRange(`F${r}`).formulas=[[`=COUNTIFS('國內委外明細'!$F$4:$F$${3+domestic.length},A${r},'國內委外明細'!$A$4:$A$${3+domestic.length},$B$4,'國內委外明細'!$J$4:$J$${3+domestic.length},"<>解約")`]]; }
  const os=overseas; const oNames=[...new Set(os.map(r=>r[5]))].sort((a,b)=>os.filter(r=>r[5]===b).reduce((t,r)=>t+r[7],0)-os.filter(r=>r[5]===a).reduce((t,r)=>t+r[7],0)); s.getRange('G8:L8').values=[['國外委外｜業者','委託金額','目前淨資產','市占率（目前淨資產）','排名','帳戶數']]; header(s,'G8:L8'); s.getRange(`G9:G${8+oNames.length}`).values=oNames.map(x=>[x]);
  for(let r=9;r<9+oNames.length;r++){ s.getRange(`H${r}`).formulas=[[`=SUMIFS('國外委外明細'!$G$4:$G$${3+overseas.length},'國外委外明細'!$F$4:$F$${3+overseas.length},G${r},'國外委外明細'!$A$4:$A$${3+overseas.length},$B$4)`]]; s.getRange(`I${r}`).formulas=[[`=SUMIFS('國外委外明細'!$H$4:$H$${3+overseas.length},'國外委外明細'!$F$4:$F$${3+overseas.length},G${r},'國外委外明細'!$A$4:$A$${3+overseas.length},$B$4)`]]; s.getRange(`J${r}`).formulas=[[`=IFERROR(I${r}/SUM($I$9:$I$${8+oNames.length}),0)`]]; s.getRange(`K${r}`).formulas=[[`=RANK(I${r},$I$9:$I$${8+oNames.length},0)`]]; s.getRange(`L${r}`).formulas=[[`=COUNTIFS('國外委外明細'!$F$4:$F$${3+overseas.length},G${r},'國外委外明細'!$A$4:$A$${3+overseas.length},$B$4,'國外委外明細'!$J$4:$J$${3+overseas.length},"<>解約")`]]; }
  body(s,`A9:F${8+dNames.length}`); body(s,`G9:L${8+oNames.length}`); s.getRange(`B9:C${8+dNames.length}`).format.numberFormat='#,##0'; s.getRange(`D9:D${8+dNames.length}`).format.numberFormat='0.00%'; s.getRange(`H9:I${8+oNames.length}`).format.numberFormat='#,##0'; s.getRange(`J9:J${8+oNames.length}`).format.numberFormat='0.00%'; s.getRange('A:L').format.autofitColumns(); s.getRange('A:A').format.columnWidth=20; s.getRange('G:G').format.columnWidth=22; s.freezePanes.freezeRows(8);
  // Formula-backed Top 10 helper blocks preserve the current ranking and keep share charts readable.
  s.getRange('M3:O3').values=[['國內委外｜前十名+其他','委託金額','市占率']]; header(s,'M3:O3');
  s.getRange('P3:R3').values=[['國外委外｜前十名+其他','委託金額','市占率']]; header(s,'P3:R3');
  for(let i=0;i<10;i++){s.getRange(`P${4+i}`).formulas=[[`=G${9+i}&" "&TEXT(J${9+i},"0.0%")`]];s.getRange(`Q${4+i}`).formulas=[[`=I${9+i}`]];} s.getRange('P14').values=[['其他']];s.getRange('Q14').formulas=[[`=SUM(I19:I${8+oNames.length})`]]; for(let r=4;r<=14;r++)s.getRange(`R${r}`).formulas=[[`=Q${r}/SUM($Q$4:$Q$14)`]];
  s.getRange('S3:T3').values=[['國內市占率圖表標籤','市占率']]; s.getRange('V3:W3').values=[['國外市占率圖表標籤','市占率']];
  for(let r=4;r<=14;r++){s.getRange(`S${r}`).formulas=[[`=M${r}`]];s.getRange(`T${r}`).formulas=[[`=O${r}`]];s.getRange(`V${r}`).formulas=[[`=P${r}`]];s.getRange(`W${r}`).formulas=[[`=R${r}`]];}
  s.getRange('T4:T14').format.numberFormat='0.0%'; s.getRange('W4:W14').format.numberFormat='0.0%';
  s.getRange('N4:N14').format.numberFormat='#,##0'; s.getRange('O4:O14').format.numberFormat='0.0%'; s.getRange('Q4:Q14').format.numberFormat='#,##0'; s.getRange('R4:R14').format.numberFormat='0.0%'; s.getRange('M:R').format.columnWidth=16;
  const dAmount=s.charts.add('bar',s.getRange('M3:N13')); dAmount.titleText='國內委外｜前十名目前淨資產（業者名稱後附市占率）'; for(let i=0;i<10;i++)dAmount.series.items[0].dataLabelOverrides.add(i).showValue=true; dAmount.setPosition('M16','T31');
  const dShare=s.charts.add('doughnut',s.getRange('S3:T14')); dShare.titleText='國內委外｜市占率分布'; for(let i=0;i<11;i++)dShare.series.items[0].dataLabelOverrides.add(i).showValue=true; dShare.setPosition('U16','AB31');
  const oAmount=s.charts.add('bar',s.getRange('P3:Q13')); oAmount.titleText='國外委外｜前十名目前淨資產（業者名稱後附市占率）'; for(let i=0;i<10;i++)oAmount.series.items[0].dataLabelOverrides.add(i).showValue=true; oAmount.setPosition('M33','T48');
  const oShare=s.charts.add('doughnut',s.getRange('V3:W14')); oShare.titleText='國外委外｜市占率分布'; for(let i=0;i<11;i++)oShare.series.items[0].dataLabelOverrides.add(i).showValue=true; oShare.setPosition('U33','AB48');
}

function buildDashboard(sheetName, isUsd) {
  const s=sheets[sheetName], unit=isUsd?'美元($B)':'新臺幣億元', divisor=isUsd?`1000000000*'儀表板(美元)'!$C$21`:'100000000';
  const domesticManagerCount = new Set(domestic.map(r => r[5])).size, overseasManagerCount = new Set(overseas.map(r => r[5])).size;
  title(s,`勞動基金運用局｜四大基金月度運用與委外經營儀表板${isUsd?'（美元）':''}`,'T'); s.getRange('A3:T3').merge(); s.getRange('A3').values=[[isUsd?`資料範圍：${dashboardRangeText}；金額單位：美元($B)（以臺銀 USD/TWD 即期賣出匯率換算；匯率資訊位於本頁下方）`:`資料範圍：${dashboardRangeText}｜金額單位：新臺幣億元（除國外委外原始明細以美元列示）`]]; s.getRange('A3:T3').format={fill:blue,font:{italic:true,color:'#1F4E78'}};
  s.getRange('A5:F5').values=[['最新月份','新制','舊制','勞工保險','國民年金','四大基金合計']]; header(s,'A5:F5'); s.getRange('A6').formulas=[[`=MAX('月度資產配置'!$A$4:$A$${3+dataRows.length})`]];
  for(const [col,fund] of [['B','新制'],['C','舊制'],['D','勞工保險'],['E','國民年金']]) s.getRange(`${col}6`).formulas=[[`=SUMIFS('月度資產配置'!$E$4:$E$${3+dataRows.length},'月度資產配置'!$A$4:$A$${3+dataRows.length},$A$6,'月度資產配置'!$C$4:$C$${3+dataRows.length},"${fund}",'月度資產配置'!$D$4:$D$${3+dataRows.length},"合計")${isUsd?`/'儀表板(美元)'!$C$21/1000000000`:''}`]];
  s.getRange('F6').formulas=[['=SUM(B6:E6)']]; body(s,'A6:F6'); s.getRange('A6').format.numberFormat='yyyy-mm-dd'; s.getRange('B6:F6').format.numberFormat=isUsd?'$#,##0.0':'#,##0';
  s.getRange('A9:F9').values=[[`資產配置（最新月份，${unit}）`,'新制','舊制','勞保','國保','四大基金合計']]; header(s,'A9:F9'); const cats=['自行運用','委託經營','自行運用-國外-固定收益','自行運用-國外-權益證券','自行運用-國外-另類投資','委託經營-國內-權益證券','委託經營-國外-固定收益','委託經營-國外-權益證券','委託經營-國外-另類投資','轉存金融機構','政策性貸款','短期票券','公債、公司債、金融債券及特別股','公債、金融債券、公司債及證券化商品','房屋及土地','政府或公營事業貸款','被保險人貸款','股票及受益憑證投資（含期貨）','國外投資']; const catEnd=9+cats.length; s.getRange(`A10:A${catEnd}`).values=cats.map(c=>[c]);
  for(let r=10;r<=catEnd;r++){ for(const [col,fund] of [['B','新制'],['C','舊制'],['D','勞工保險'],['E','國民年金']]) s.getRange(`${col}${r}`).formulas=[[`=SUMIFS('月度資產配置'!$E$4:$E$${3+dataRows.length},'月度資產配置'!$A$4:$A$${3+dataRows.length},$A$6,'月度資產配置'!$C$4:$C$${3+dataRows.length},"${fund}",'月度資產配置'!$D$4:$D$${3+dataRows.length},$A${r})/(${divisor})`]]; s.getRange(`F${r}`).formulas=[[`=SUM(B${r}:E${r})`]]; } body(s,`A10:F${catEnd}`); s.getRange(`B10:F${catEnd}`).format.numberFormat=isUsd?'$#,##0.0':'#,##0.0';
  s.getRange('H5:K5').values=[['委外業者（最新月）','國內','國外','備註']]; header(s,'H5:K5'); s.getRange('H6:K6').values=[['業者數',domesticManagerCount,overseasManagerCount,'詳見「業者彙總」']]; body(s,'H6:K6');
  s.getRange('H9:K9').values=[['甜甜圈中心資訊','新制','舊制','四大基金']]; header(s,'H9:K9'); s.getRange('H10:K12').values=[['中心資訊','每張甜甜圈顯示該基金資產規模','金額依左表與匯率公式更新','中心數字為目前期末資產'],['配色','藍色：自行運用（深淺）','橘色：委託經營（深淺）','圓環扇形顯示配置占比'],['匯率',isUsd?'臺銀 USD/TWD 即期賣出':'不適用',isUsd?'詳見左下方匯率資訊':'不適用','來源與報價時間已註明']]; body(s,'H10:K12'); s.getRange('H:K').format.wrapText=true; s.getRange('H:K').format.columnWidth=18;
  if(isUsd){s.getRange('A20:F20').merge();s.getRange('A20').values=[['美元換算匯率｜公開報價']];s.getRange('A20:F20').format={fill:navy,font:{bold:true,color:'#FFFFFF'}};s.getRange('A21:F21').values=[['幣別','匯率類型',fx.rate,'報價時間',fx.quotedAt,'TWD／USD']];body(s,'A21:F21');s.getRange('A22:F22').merge();s.getRange('A22').values=[[`來源：${fx.source}（臺灣銀行公開即時匯率；可直接覆蓋 C21 更新換算）`]];s.getRange('A22:F22').format={fill:blue,font:{color:'#1F4E78'},wrapText:true};s.getRange('C21').format={numberFormat:'0.000',font:{color:'#0000FF'}};s.getRange('E21').format.numberFormat='yyyy-mm-dd hh:mm';}
  s.getRange('A:T').format.columnWidth=13; s.getRange('A:A').format.columnWidth=26; s.getRange('B:F').format.columnWidth=16; s.freezePanes.freezeRows(3);
  const chartSources=[['V','W','B','新制基金','H15:K29'],['X','Y','C','舊制基金','L15:O29'],['Z','AA','D','勞工保險基金','P15:T29'],['AB','AC','E','國民年金保險基金','H30:K44'],['AD','AE','F','四大基金合計','L30:O44']];
  const chartCats=['自行運用 - 其他','自行運用 - 固定收益','自行運用 - 權益證券','自行運用 - 另類投資','國內委託經營 - 權益證券','國外委託經營 - 固定收益','國外委託經營 - 權益證券','國外委託經營 - 另類投資'];
  const chartFunds={B:'新制',C:'舊制',D:'勞工保險',E:'國民年金',F:'四大基金'};
  for(const [labelCol,valueCol,sourceCol,titleText,pos] of chartSources){
    s.getRange(`${labelCol}11:${valueCol}11`).values=[['資產類別','占比']];
    const fund=chartFunds[sourceCol];
    const direct=['轉存金融機構','政策性貸款','短期票券','公債、公司債、金融債券及特別股','公債、金融債券、公司債及證券化商品','房屋及土地','政府或公營事業貸款','被保險人貸款','股票及受益憑證投資（含期貨）'];
    const itemExpr=(item)=>fund==='四大基金' ? `SUMIFS('月度資產配置'!$F$4:$F$${3+dataRows.length},'月度資產配置'!$A$4:$A$${3+dataRows.length},$A$6,'月度資產配置'!$D$4:$D$${3+dataRows.length},"${item}")` : `SUMIFS('月度資產配置'!$F$4:$F$${3+dataRows.length},'月度資產配置'!$A$4:$A$${3+dataRows.length},$A$6,'月度資產配置'!$C$4:$C$${3+dataRows.length},"${fund}",'月度資產配置'!$D$4:$D$${3+dataRows.length},"${item}")`;
    const ratioExprs=[direct,['自行運用-國外-固定收益'],['自行運用-國外-權益證券'],['自行運用-國外-另類投資'],['委託經營-國內-權益證券'],['委託經營-國外-固定收益'],['委託經營-國外-權益證券'],['委託經營-國外-另類投資']].map(items=>items.map(itemExpr).join('+'));
    const ratioDenom=`(${ratioExprs.join('+')})`;
    for(let i=0;i<chartCats.length;i++){ const r=12+i; s.getRange(`${labelCol}${r}`).values=[[chartCats[i]]]; s.getRange(`${valueCol}${r}`).formulas=[[`=IFERROR(${ratioExprs[i]}/${ratioDenom},0)`]]; }
    s.getRange(`${valueCol}12:${valueCol}${11+chartCats.length}`).format.numberFormat='0.0%';
    const chart=s.charts.add('doughnut',s.getRange(`${labelCol}12:${valueCol}${11+chartCats.length}`));
    const titleValue=(s.getRange(`${sourceCol}6`).values[0][0]||0)/(isUsd?1:100000000);
    chart.titleText=`${titleText}｜${isUsd?`$${Number(titleValue).toLocaleString(undefined,{maximumFractionDigits:1})}B`:`${Number(titleValue).toLocaleString(undefined,{maximumFractionDigits:1})} 億元`}`;
    const series=chart.series.items[0]; for(let index=0;index<chartCats.length;index++) series.dataLabelOverrides.add(index).showValue=true;
    chart.setPosition(...pos.split(':'));
  }
}
buildDashboard('儀表板',false); buildDashboard('儀表板(美元)',true);

{ const s=sheets['更新說明']; title(s,'更新說明｜每月新增 PDF 的標準作業','G'); s.getRange('A3:G3').values=[['步驟','工作表','要新增的資料','必填欄位','來源位置','圖表影響','說明']]; header(s,'A3:G3'); const rows=[['1','月度資產配置','四大基金各資產配置列','日期、基金、項目、金額、比率、來源','PDF「資產配置」','最新配置與合計圖','完整保留自行運用、轉存金融機構、短期票券、債券、貸款、股票、國外投資及委託經營；國內委託經營歸入委託經營-權益證券'],['2','國內委外明細','各批次／業者一列，含當期加/減與帳戶狀態','日期、基金、批次、業者、金額、淨資產、當期加/減、帳戶狀態、兩種報酬率','PDF「國內委外投資概況」','國內業者彙總','新增帳戶標記「新增」；既有帳戶標記「持續」；本月消失帳戶補列並標記「解約」，當期加/減以淨資產差額計算'],['3','國外委外明細','各批次／業者一列，含當期加/減與帳戶狀態','日期、基金、批次、業者、金額、淨資產、當期加/減、帳戶狀態、兩種報酬率、單位','PDF「國外委外投資概況」','國外業者彙總','新增／持續／解約判定同國內；美元及其他原始幣別不自行換匯'],['4','業者彙總','不需手動新增','調整控制項日期／基金','工作表上方 B4、B5','市占與排名、帳戶數','所有業者依目前淨資產排序；市占率以目前淨資產計算；帳戶數以每批次出現一次計數'],['5','資料品質檢核','不需手動新增','確認狀態為 OK','檢核頁','驗證來源與總額','若有缺值或合計差異，先修正明細資料']]; s.getRange(`A4:G${3+rows.length}`).values=rows; body(s,`A4:G${3+rows.length}`); s.getRange('A:G').format.autofitColumns(); s.getRange('C:C').format.columnWidth=28; s.getRange('D:D').format.columnWidth=38; s.getRange('E:E').format.columnWidth=26; s.getRange('G:G').format.columnWidth=48; s.getRange(`A4:G${3+rows.length}`).format.wrapText=true; s.freezePanes.freezeRows(3); }

{ const s=sheets['資料品質檢核']; title(s,'資料品質檢核｜確認更新資料可供儀表板使用','G'); s.getRange('A3:G3').values=[['檢核項目','實際值','預期值','差異','容忍值','狀態','說明']]; header(s,'A3:G3'); const r=[['新制最新月資產配置合計',`=SUMIFS('月度資產配置'!$E$4:$E$${3+dataRows.length},'月度資產配置'!$A$4:$A$${3+dataRows.length},'儀表板'!$A$6,'月度資產配置'!$C$4:$C$${3+dataRows.length},"新制",'月度資產配置'!$D$4:$D$${3+dataRows.length},"合計")`,`='儀表板'!$B$6`,`=B4-C4`,0,`=IF(ABS(D4)<=E4,"OK","檢查")`,'應與儀表板新制總額一致'],['舊制最新月資產配置合計',`=SUMIFS('月度資產配置'!$E$4:$E$${3+dataRows.length},'月度資產配置'!$A$4:$A$${3+dataRows.length},'儀表板'!$A$6,'月度資產配置'!$C$4:$C$${3+dataRows.length},"舊制",'月度資產配置'!$D$4:$D$${3+dataRows.length},"合計")`,`='儀表板'!$C$6`,`=B5-C5`,0,`=IF(ABS(D5)<=E5,"OK","檢查")`,'應與儀表板舊制總額一致'],['國內委外明細列數',domestic.length,`>=10`,``,0,'OK','115年6月擷取的受託機構列數'],['國外委外明細列數',overseas.length,`>=10`,``,0,'OK','115年6月擷取的受託機構列數']]; s.getRange('A4:G7').values=r.map(x=>[x[0],null,null,null,x[4],null,x[6]]); s.getRange('B4:D5').formulas=r.slice(0,2).map(x=>[x[1],x[2],x[3]]); s.getRange('F4:F5').formulas=r.slice(0,2).map(x=>[x[5]]); s.getRange('B6:B7').values=[[domestic.length],[overseas.length]]; s.getRange('C6:C7').values=[['≥10'],['≥10']]; s.getRange('F6:F7').values=[['OK'],['OK']]; body(s,'A4:G7'); s.getRange('B4:E5').format.numberFormat='#,##0'; s.getRange('A:G').format.autofitColumns(); s.getRange('G:G').format.columnWidth=34; }

await fs.mkdir(outDir,{recursive:true});
const file=path.join(outDir,'勞工退休基金月度揭露_可持續更新.xlsx');
const out=await SpreadsheetFile.exportXlsx(wb); await out.save(file);
console.log(JSON.stringify({file,assetRows:dataRows.length,domesticRows:domestic.length,overseasRows:overseas.length},null,2));
