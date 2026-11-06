// npm run admin:create：交互式创建或重置 admin 密码；非 TTY 时可从 stdin 安全传入。
import readline from 'node:readline';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from './db.mjs';
import { upsertAdmin } from './admin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function hiddenQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const original = rl._writeToOutput.bind(rl);
  rl._writeToOutput = value => {
    if (value.includes('\n') || value.includes('\r')) original(value);
  };
  try { return await rl.question(prompt); }
  finally { rl.close(); process.stdout.write('\n'); }
}

async function readPassword() {
  if (process.stdin.isTTY) {
    const first = await hiddenQuestion('新 admin 密码（8–128 位，输入不回显）：');
    const second = await hiddenQuestion('再次输入：');
    if (first !== second) throw new Error('两次密码不一致');
    return first;
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.replace(/[\r\n]+$/, '');
}

const db = openDb(process.env.DB_PATH ?? join(root, 'data/novel.db'));
try {
  migrate(db, join(root, 'server/migrations'));
  const id = await upsertAdmin(db, await readPassword());
  console.log(`admin 已创建或重置（user id=${id}）。请使用受控密码登录，不要共享该账号。`);
} catch (error) {
  console.error(`admin 初始化失败：${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
