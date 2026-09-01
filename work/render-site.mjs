import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDashboardData } from './load-monthly-data.mjs';

const root = process.cwd();

const clean = (value) => String(value).replace(/\s+/g, ' ').trim();
const canonicalManager = (manager, section) => {
  const name = clean(manager);
  const key = name.replace(/\s/g, '');
  if (key === 'NinetyOne') return 'Ninety One';
  if (key === 'AmericanCentury' || key === 'American') return 'American Century';
  if (key === 'TRowePrice' || key === 'T.RowePrice') return 'T. Rowe Price';
  if (name === '富蘭克林' || name === '富蘭克林坦伯頓') return '富蘭克林坦伯頓';
  if (name === '摩根' || name === 'JPMorgan') return section === '國內' ? 'JPMorgan（國內）' : 'JPMorgan（國外）';
  if (name === 'Center') return 'Center Square';
  return name;
};

function topManagers(rows) {
  const totals = new Map();
  for (const row of rows) {
    const manager = canonicalManager(row.manager, row.section);
    totals.set(manager, (totals.get(manager) ?? 0) + Number(row.nav));
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const totalNav = ordered.reduce((sum, [, nav]) => sum + nav, 0) || 1;
  return ordered.slice(0, 10).map(([name, nav]) => [name, nav, nav / totalNav]);
}

const { assetRows, latestDate, fx } = await loadDashboardData(root);
const latestTime = latestDate.getTime();
const latestAssets = assetRows.filter((row) => row[0].getTime() === latestTime);
const fundNames = ['新制', '舊制', '勞工保險', '國民年金'];
const categoryOrder = ['自行運用 - 其他', '自行運用 - 固定收益', '自行運用 - 權益證券', '自行運用 - 另類投資', '國內委託經營 - 權益證券', '國外委託經營 - 固定收益', '國外委託經營 - 權益證券', '國外委託經營 - 另類投資'];
const categoryGroups = [
  ['轉存金融機構','政策性貸款','短期票券','公債、公司債、金融債券及特別股','公債、金融債券、公司債及證券化商品','房屋及土地','政府或公營事業貸款','被保險人貸款','股票及受益憑證投資（含期貨）'],
  ['自行運用-國外-固定收益'], ['自行運用-國外-權益證券'], ['自行運用-國外-另類投資'],
  ['委託經營-國內-權益證券'], ['委託經營-國外-固定收益'], ['委託經營-國外-權益證券'], ['委託經營-國外-另類投資'],
];

const fundRows = fundNames.map((fund) => {
  const rows = latestAssets.filter((row) => row[2] === fund);
  const totalRow = rows.find((row) => row[3] === '合計');
  const breakdown = categoryGroups.map((group) => Number((group.reduce((sum, category) => sum + (rows.find((entry) => entry[3] === category)?.[4] || 0), 0) / 100000000).toFixed(1)));
  return [fund, Number((totalRow[4] / 100000000).toFixed(1)), breakdown];
});
fundRows.push([
  '四大基金合計',
  Number(fundRows.reduce((sum, row) => sum + row[1], 0).toFixed(1)),
  categoryGroups.map((group) => Number((fundNames.reduce((sum, fund) => sum + group.reduce((sub, category) => sub + (latestAssets.find((entry) => entry[2] === fund && entry[3] === category)?.[4] || 0), 0), 0) / 100000000).toFixed(1))),
]);

const delegated = JSON.parse(await fs.readFile(path.join(root, 'work', 'delegated-coords.json'), 'utf8'));
const laborInsurance = JSON.parse(await fs.readFile(path.join(root, 'work', 'labor-insurance.json'), 'utf8'));
const nationalPension = JSON.parse(await fs.readFile(path.join(root, 'work', 'national-pension.json'), 'utf8'));
const allDelegated = [...delegated, ...laborInsurance, ...nationalPension];
const domestic = topManagers(allDelegated.filter((row) => (row.section ?? row[3]) === '國內').map((row) => ({
  manager: row.manager ?? row[5],
  section: row.section ?? row[3],
  nav: row.nav ?? row[7],
})));
const overseas = topManagers(allDelegated.filter((row) => (row.section ?? row[3]) === '國外').map((row) => ({
  manager: row.manager ?? row[5],
  section: row.section ?? row[3],
  nav: row.nav ?? row[7],
})));

const data = {
  fx: fx.rate,
  quotedAt: fx.quotedAt,
  funds: fundRows,
  domestic,
  overseas,
};

const templatePath = path.join(root, 'index.html');
const template = await fs.readFile(templatePath, 'utf8');
const rendered = template
  .replace(/const data=\{[\s\S]*?\};/, `const data=${JSON.stringify(data)};`)
  .replace(/const labs=\[[^\]]+\],c=\[[^\]]+\]/, `const labs=${JSON.stringify(categoryOrder)},c=['#9dc3e6','#5b9bd5','#2f75b5','#1f4e79','#f4b183','#f7c9a9','#ed7d31','#c55a11']`);
await fs.writeFile(templatePath, rendered);
await fs.mkdir(path.join(root, 'site'), { recursive: true });
await fs.writeFile(path.join(root, 'site', 'index.html'), rendered);
console.log(JSON.stringify({ file: templatePath, domestic: domestic.length, overseas: overseas.length }, null, 2));
