#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const KIT_FILES = {
  'examples/agentkit-image/image-workflow.mjs': 'a124dd4c0736733350ccc4c1e5183450664a9db57055097269ff203d38644c6f',
  'examples/agentkit-image/package.json': 'ae98a86fe1be368feb77797e51e75528139fd56cf57666d15711a9977059e922',
  'package.json': '099062fe94619739d43871515d013d932d79425ce70f42c9d49baa2ae0feb560',
  'package-lock.json': '4f62fab45b368d036dc475a9d23a4f80085b57098c5fae5bf525260361353bac',
};

function argumentsForRecipe(argv) {
  const result = {};
  const values = new Set(['--video', '--title', '--job-directory', '--kit-directory', '--max-price']);
  const switches = new Set(['--offline', '--pay']);
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!values.has(name) && !switches.has(name)) throw new Error(`unknown option ${name}`);
    if (Object.hasOwn(result, name)) throw new Error(`duplicate option ${name}`);
    if (switches.has(name)) {
      result[name] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${name}`);
    result[name] = value;
  }
  for (const name of ['--video', '--title', '--job-directory']) {
    if (!result[name]) throw new Error(`missing ${name}`);
  }
  if (!result['--title'].trim() || result['--title'].length > 1000) throw new Error('title must contain 1–1000 characters');
  const price = result['--max-price'] ?? '0.01';
  if (!/^\d+(\.\d{1,6})?$/.test(price) || Number(price) <= 0) throw new Error('max-price must be a positive USDC decimal with at most six places');
  if (result['--offline'] && result['--pay']) throw new Error('--offline cannot approve a payment');
  return { ...result, '--max-price': price };
}

async function privateJobDirectory(value) {
  const target = resolve(value);
  let ancestor = target;
  while (true) {
    try { await stat(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const actualAncestor = await realpath(ancestor);
  for (let current = actualAncestor; ; current = dirname(current)) {
    let marker;
    try { marker = await lstat(join(current, '.git')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (marker) throw new Error('job-directory must be outside a Git working tree');
    if (dirname(current) === current) break;
  }
  return resolve(actualAncestor, relative(ancestor, target));
}

try {
  const args = argumentsForRecipe(process.argv.slice(2));
  const video = await realpath(resolve(args['--video']));
  if (!(await stat(video)).isFile()) throw new Error('--video must name a local file');
  const directory = await privateJobDirectory(args['--job-directory']);
  const videoFromJob = relative(directory, video);
  if (!isAbsolute(videoFromJob) && videoFromJob !== '..' && !videoFromJob.startsWith(`..${sep}`)) {
    throw new Error('use a separate private directory for the cover purchase');
  }
  const prompt = `Create a square concept cover for a YouTube Short titled "${args['--title'].trim()}". Use one clear focal subject and bold, readable composition. Leave room for a human to add the final title. No logos or watermarks.`;
  if (args['--offline']) {
    console.log(JSON.stringify({ status: 'offline_plan', payment_sent: false, approval_required: true, aspect_ratio: '1:1', max_price_usdc: args['--max-price'], job_directory: directory }, null, 2));
  } else {
    if (!args['--kit-directory']) throw new Error('missing --kit-directory; install the pinned kit in examples/cover-recipe.md first');
    const kit = await realpath(resolve(args['--kit-directory']));
    for (const [name, expected] of Object.entries(KIT_FILES)) {
      const bytes = await readFile(join(kit, name));
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`pinned kit file differs: ${name}`);
    }
    if (args['--pay']) {
      let state;
      try { state = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8')); }
      catch { throw new Error('quote this cover first using the same command without --pay'); }
      if (!['quoted', 'signed', 'delivered', 'verified'].includes(state.phase)) throw new Error('quote this cover before approving payment');
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await stat(directory)).mode & 0o077) throw new Error('job-directory must be private (chmod 700)');
    const command = [join(kit, 'examples/agentkit-image/image-workflow.mjs'), '--directory', directory, '--prompt', prompt, '--max-price', args['--max-price']];
    if (args['--pay']) command.push('--pay');
    const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT };
    if (args['--pay'] && process.env.DELX_IMAGE_PRIVATE_KEY) env.DELX_IMAGE_PRIVATE_KEY = process.env.DELX_IMAGE_PRIVATE_KEY;
    const child = spawnSync(process.execPath, command, { stdio: 'inherit', env });
    if (child.error) throw new Error('could not start the image workflow');
    process.exitCode = child.status ?? 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
