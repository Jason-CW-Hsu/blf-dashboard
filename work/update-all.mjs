import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const stateDir = path.join(root, 'snapshots', 'auto-update');
const completionJson = path.join(stateDir, 'last-run.json');
const completionTxt = path.join(stateDir, 'last-run.txt');
const args = new Set(process.argv.slice(2));
const shouldPush = args.has('--push');

const walk = async (dir, result = []) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'outputs' || entry.name === 'site' || entry.name === 'work') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, result);
    else if (entry.isFile() && entry.name.endsWith('.pdf')) result.push(full);
  }
  return result;
};

const monthFromName = (name) => {
  const match = name.match(/115年(\d+)月/);
  return match ? Number(match[1]) : -1;
};

const pickLatest = (prefix, files) => {
  const matches = files.filter((file) => path.basename(file).startsWith(prefix)).sort((a, b) => {
    const diff = monthFromName(path.basename(a)) - monthFromName(path.basename(b));
    if (diff !== 0) return diff;
    return a.localeCompare(b, 'zh-Hant');
  });
  return matches.at(-1);
};

const exec = (cmd, cmdArgs, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...options.env } });
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${cmd} ${cmdArgs.join(' ')} failed with exit code ${code}`));
  });
});

const node = process.execPath;
const notify = (title, body) => new Promise((resolve) => {
  const child = spawn('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { stdio: 'ignore' });
  child.on('exit', () => resolve());
  child.on('error', () => resolve());
});

const writeCompletion = async (record) => {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(completionJson, `${JSON.stringify(record, null, 2)}\n`);
  await fs.writeFile(completionTxt, [
    `status: ${record.status}`,
    `finishedAt: ${record.finishedAt}`,
    `period: ${record.period}`,
    `pensionPdf: ${record.pensionPdf}`,
    `laborPdf: ${record.laborPdf}`,
    `nationalPdf: ${record.nationalPdf}`,
    `pushed: ${record.pushed}`,
    `output: ${record.output}`,
  ].join('\n') + '\n');
};

const maybeSendEmail = async (period) => {
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const emailTo = (process.env.EMAIL_TO || '').trim();
  if (!smtpHost || !smtpUser || !smtpPass || !emailTo) return;
  await exec('python3', ['scripts/send-update-email.py'], {
    env: {
      UPDATE_PERIOD: period,
      UPDATE_EXCEL_PATH: path.join(root, 'outputs', 'blf-monthly-disclosure', '勞動基金月度揭露_可持續更新.xlsx'),
      DASHBOARD_URL: 'https://jason-cw-hsu.github.io/blf-dashboard/',
    },
  });
};

let record;
try {
  const pdfs = await walk(root);
  const pensionPdf = pickLatest('勞工退休基金-115年', pdfs);
  const laborPdf = pickLatest('勞工保險基金-115年', pdfs);
  const nationalPdf = pickLatest('國民年金保險基金-115年', pdfs);
  if (!pensionPdf || !laborPdf || !nationalPdf) {
    throw new Error(`找不到完整 PDF：勞退=${pensionPdf ?? '缺少'}，勞保=${laborPdf ?? '缺少'}，國保=${nationalPdf ?? '缺少'}`);
  }

  await exec(node, ['work/extract-delegated-coords.mjs', pensionPdf, 'work/delegated-coords.json']);
  await exec(node, ['work/extract-single-fund-coords.mjs', laborPdf, '勞工保險', 'work/labor-insurance.json']);
  await exec(node, ['work/extract-single-fund-coords.mjs', nationalPdf, '國民年金', 'work/national-pension.json']);
  await exec(node, ['work/build-workbook.mjs']);
  await exec(node, ['work/render-site.mjs']);
  await exec(node, ['work/verify-workbook.mjs']);

  let pushed = false;
  if (shouldPush) {
    await exec('git', ['add', 'index.html', 'site/index.html', 'work/delegated-coords.json', 'work/labor-insurance.json', 'work/national-pension.json', 'outputs/blf-monthly-disclosure/勞工退休基金月度揭露_可持續更新.xlsx']);
    let hasChanges = true;
    try {
      await exec('git', ['diff', '--cached', '--quiet']);
      hasChanges = false;
    } catch {
      hasChanges = true;
    }
    if (hasChanges) {
      await exec('git', ['commit', '-m', 'Update monthly disclosure']);
      await exec('git', ['push', 'origin', 'HEAD:main']);
      pushed = true;
    }
  }

  record = {
    status: 'success',
    finishedAt: new Date().toISOString(),
    period: path.basename(path.dirname(pensionPdf)),
    pensionPdf,
    laborPdf,
    nationalPdf,
    pushed,
    output: path.join(root, 'outputs', 'blf-monthly-disclosure', '勞工退休基金月度揭露_可持續更新.xlsx'),
  };
  await writeCompletion(record);
  await notify('勞動基金月報更新完成', `${record.period} 已完成更新${record.pushed ? '並推送至 GitHub' : ''}`);
  await maybeSendEmail(record.period);
} catch (error) {
  record = {
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  await writeCompletion(record);
  await notify('勞動基金月報更新失敗', record.error);
  throw error;
}

console.log(JSON.stringify(record, null, 2));
