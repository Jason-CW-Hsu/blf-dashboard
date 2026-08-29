import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const incomingDir = path.join(root, 'incoming');

const sources = [
  {
    key: 'pension',
    folderLabel: '勞工退休基金',
    pageUrl: 'https://www.blf.gov.tw/49200/49255/49261/49269/49273/',
  },
  {
    key: 'labor',
    folderLabel: '勞工保險基金',
    pageUrl: 'https://www.blf.gov.tw/49200/49255/49281/49285/49289/lpsimplelist',
  },
  {
    key: 'national',
    folderLabel: '國民年金保險基金',
    pageUrl: 'https://www.blf.gov.tw/49200/49255/49323/49327/49331/lpsimplelist',
  },
];

const ensureDir = async (dir) => fs.mkdir(dir, { recursive: true });

const notify = (title, body) => new Promise((resolve) => {
  const child = spawn('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { stdio: 'ignore' });
  child.on('exit', () => resolve());
  child.on('error', () => resolve());
});

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Codex monthly disclosure updater)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`無法讀取 ${url}：HTTP ${res.status}`);
  return await res.text();
}

function extractLatestPdf(pageHtml, pageUrl) {
  const pdfLink = pageHtml.match(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([^<]*?\.pdf)<\/a>/i);
  if (!pdfLink) {
    throw new Error(`找不到最新 PDF 連結：${pageUrl}`);
  }

  const href = new URL(pdfLink[1], pageUrl).toString();
  const title = pdfLink[2].trim();
  const monthMatch = title.match(/(\d{1,2})月\.pdf$/);
  if (!monthMatch) {
    throw new Error(`無法從檔名判斷月份：${title}`);
  }
  const reportMonth = Number(monthMatch[1]);

  const tail = pageHtml.slice(Math.max(0, pdfLink.index), Math.min(pageHtml.length, pdfLink.index + 1200));
  const dateMatch = tail.match(/(?:發布日期|更新日期)[:：]\s*(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) {
    throw new Error(`無法從頁面判斷發布日期：${pageUrl}`);
  }
  const pubYear = Number(dateMatch[1]);
  const pubMonth = Number(dateMatch[2]);
  const reportYear = reportMonth > pubMonth ? pubYear - 1 : pubYear;
  const rocYear = reportYear - 1911;

  return {
    href,
    reportMonth,
    reportYear,
    rocYear,
    fileNameMonth: `${reportMonth}`.padStart(2, '0'),
  };
}

async function downloadFile(url, filePath) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Codex monthly disclosure updater)',
      accept: 'application/pdf,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`下載失敗 ${url}：HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  let shouldWrite = true;
  try {
    const existing = await fs.readFile(filePath);
    shouldWrite = !existing.equals(buffer);
  } catch {
    shouldWrite = true;
  }

  if (shouldWrite) {
    await fs.writeFile(filePath, buffer);
  }

  return { bytes: buffer.length, written: shouldWrite };
}

async function main() {
  await ensureDir(incomingDir);

  const summary = [];
  const downloaded = [];
  for (const source of sources) {
    const html = await fetchText(source.pageUrl);
    const latest = extractLatestPdf(html, source.pageUrl);
    const folder = `${latest.reportYear}${String(latest.reportMonth).padStart(2, '0')}`;
    const targetDir = path.join(incomingDir, folder);
    await ensureDir(targetDir);

    const fileName = `${source.folderLabel}-${latest.rocYear}年${latest.reportMonth}月.pdf`;
    const targetPath = path.join(targetDir, fileName);
    const result = await downloadFile(latest.href, targetPath);

    summary.push({
      source: source.folderLabel,
      pageUrl: source.pageUrl,
      pdfUrl: latest.href,
      folder,
      fileName,
      bytes: result.bytes,
      written: result.written,
    });
    if (result.written) downloaded.push(`${source.folderLabel} ${latest.rocYear}年${latest.reportMonth}月`);
  }

  if (downloaded.length) {
    await notify('勞金局新 PDF 已抓到', downloaded.join('、'));
  }
  console.log(JSON.stringify({ status: 'ok', summary }, null, 2));
}

await main();
