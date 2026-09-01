import fs from 'node:fs/promises';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const PENSION_NEW_LABELS = ['自行運用', '轉存金融機構', '短期票券', '公債、公司債、金融債券及特別股', '股票及受益憑證投資（含期貨）', '國外投資', '固定收益', '權益證券', '另類投資', '委託經營', '國內委託經營', '國外委託經營', '固定收益', '權益證券', '另類投資', '合計'];
const PENSION_OLD_LABELS = ['自行運用', '轉存金融機構', '短期票券', '公債、金融債券、公司債及證券化商品', '股票及受益憑證投資（含期貨）', '國外投資', '固定收益', '權益證券', '另類投資', '委託經營', '國內委託經營', '國外委託經營', '固定收益', '權益證券', '另類投資', '合計'];
const LABOR_LABELS = ['自行運用', '轉存金融機構', '短期票券', '公債、公司債、金融債券及特別股', '房屋及土地', '政府或公營事業貸款', '被保險人貸款', '股票及受益憑證投資（含期貨）', '國外投資', '固定收益', '權益證券', '另類投資', '委託經營', '國內委託經營', '國外委託經營', '固定收益', '權益證券', '另類投資', '合計'];
const NATIONAL_LABELS = ['自行運用', '轉存金融機構', '政策性貸款', '短期票券', '公債、公司債、金融債券及特別股', '股票及受益憑證投資（含期貨）', '國外投資', '固定收益', '權益證券', '另類投資', '委託經營', '國內委託經營', '國外委託經營', '固定收益', '權益證券', '另類投資', '合計'];

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(/,/g, ''));
const monthFromFile = (name) => {
  const m = name.match(/115年(\d+)月/);
  return m ? Number(m[1]) : null;
};
const dateFromMonth = (month) => new Date(2026, month - 1, 1);
const periodFromMonth = (month) => `115年${month}月`;

async function walk(dir, result = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'outputs' || entry.name === '.codex' || entry.name === '.agents') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, result);
    } else if (entry.isFile() && entry.name.endsWith('.pdf')) {
      result.push(full);
    }
  }
  return result;
}

function extractPageBlock(text, pageNo) {
  const re = new RegExp(`===== PAGE ${pageNo} =====\\n([\\s\\S]*?)(?=\\n===== PAGE \\d+ =====|$)`);
  return text.match(re)?.[1] ?? '';
}

function parseOrderedPairs(block, labels, { filename, fund, period, date, source }) {
  const pairs = [...block.matchAll(/([^\d%－\-]+?)\s+([\d,]+)\s+(\d+\.\d{2}|0(?:\.\d{2})?)/g)]
    .map((m) => [clean(m[1]), num(m[2]), Number(m[3])]);
  const rows = [];
  let parent = '';
  labels.forEach((label, index) => {
    if (label === '自行運用' || label === '委託經營') parent = label;
    const pair = pairs[index];
    if (!pair) return;
    let category = (['固定收益', '權益證券', '另類投資'].includes(label) && parent) ? `${parent}-${label}` : label;
    // 資產配置分析將國內委託經營視為委託經營中的權益證券，避免被漏列或重複計算。
    if (category === '國內委託經營') category = '委託經營-權益證券';
    rows.push([date, period, fund, category, pair[1], pair[2] / 100, filename, source]);
  });
  return rows;
}

async function extractPdfText(file) {
  const data = new Uint8Array(await fs.readFile(file));
  const doc = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x, str: item.str });
    }
    const text = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '))
      .join('\n');
    pages.push(`\n===== PAGE ${p} =====\n${text}`);
  }
  return pages.join('\n');
}

function parsePensionAssets(text, file) {
  const month = monthFromFile(path.basename(file));
  if (!month) return [];
  const date = dateFromMonth(month);
  const period = periodFromMonth(month);
  const newBlock = extractPageBlock(text, 3);
  const oldBlock = extractPageBlock(text, 4);
  return [
    ...parseOrderedPairs(newBlock, PENSION_NEW_LABELS, { filename: path.basename(file), fund: '新制', period, date, source: `資產配置（新制勞工退休基金）` }),
    ...parseOrderedPairs(oldBlock, PENSION_OLD_LABELS, { filename: path.basename(file), fund: '舊制', period, date, source: `資產配置（舊制勞工退休基金）` }),
  ];
}

function parseSingleFundAssets(text, { file, fund, labels, source }) {
  const month = monthFromFile(path.basename(file));
  if (!month) return [];
  const date = dateFromMonth(month);
  const period = periodFromMonth(month);
  const block = extractPageBlock(text, 2);
  const start = block.indexOf('( 二 ) 資產配置');
  const end = block.indexOf('( 三 )', start >= 0 ? start : 0);
  const section = start >= 0 ? block.slice(start, end > start ? end : undefined) : block;
  return parseOrderedPairs(section, labels, { filename: path.basename(file), fund, period, date, source });
}

export async function loadDashboardData(root = process.cwd()) {
  const files = (await walk(root)).filter((file) => /115年\d+月.*\.pdf$/.test(path.basename(file)));
  const byBase = new Map();
  for (const file of files) byBase.set(path.basename(file), file);
  const pensionFiles = [...byBase.keys()].filter((name) => name.startsWith('勞工退休基金-115年')).sort((a, b) => monthFromFile(a) - monthFromFile(b));
  const laborFile = [...byBase.keys()].filter((name) => name.startsWith('勞工保險基金-115年')).sort((a, b) => monthFromFile(a) - monthFromFile(b)).at(-1);
  const nationalFile = [...byBase.keys()].filter((name) => name.startsWith('國民年金保險基金-115年')).sort((a, b) => monthFromFile(a) - monthFromFile(b)).at(-1);

  const assetRows = [];
  for (const name of pensionFiles) {
    const file = byBase.get(name);
    const text = await extractPdfText(file);
    assetRows.push(...parsePensionAssets(text, file));
  }
  if (laborFile) {
    const file = byBase.get(laborFile);
    const text = await extractPdfText(file);
    assetRows.push(...parseSingleFundAssets(text, { file, fund: '勞工保險', labels: LABOR_LABELS, source: '資產配置（勞工保險基金）' }));
  }
  if (nationalFile) {
    const file = byBase.get(nationalFile);
    const text = await extractPdfText(file);
    assetRows.push(...parseSingleFundAssets(text, { file, fund: '國民年金', labels: NATIONAL_LABELS, source: '資產配置（國民年金保險基金）' }));
  }

  const latestMonth = Math.max(...assetRows.map((row) => row[0].getMonth() + 1));
  const latestDate = dateFromMonth(latestMonth);
  return {
    assetRows,
    latestDate,
    latestPeriod: periodFromMonth(latestMonth),
    fx: {
      rate: 31.945,
      quotedAt: '2026-08-26 04:40',
      source: 'https://rate.bot.com.tw/xrt?Lang=en-US',
    },
  };
}
