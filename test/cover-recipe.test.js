import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const recipe = resolve('examples/cover-recipe.mjs');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'shorts-cover-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = join(root, 'short.mp4');
  await writeFile(video, 'local video fixture');
  return { root, args: ['--video', video, '--title', 'Private draft title', '--job-directory', join(root, 'job')] };
}

function run(args) {
  return spawnSync(process.execPath, [recipe, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, DELX_IMAGE_PRIVATE_KEY: 'invalid-key-must-not-be-used', YOUTUBE_DRY_RUN: 'false' },
  });
}

test('offline cover plan needs no kit, sends no title and creates no purchase state', async t => {
  const { args, root } = await fixture(t);
  const result = run([...args, '--offline']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, 'offline_plan');
  assert.equal(plan.payment_sent, false);
  assert.equal(plan.approval_required, true);
  assert.equal(plan.aspect_ratio, '1:1');
  assert.equal(plan.max_price_usdc, '0.01');
  assert.equal(result.stdout.includes('Private draft title'), false);
  await assert.rejects(access(join(root, 'job')), { code: 'ENOENT' });
});

test('quote is the default and payment approval never comes from ambiguous options or environment', async t => {
  const { args, root } = await fixture(t);
  const cases = [
    [args, /missing --kit-directory/],
    [[...args, '--pay'], /missing --kit-directory/],
    [[...args, '--title', '--pay'], /duplicate option --title/],
    [[...args.slice(0, 2), '--title', '--pay', ...args.slice(4)], /missing value for --title/],
    [[...args, '--max-price'], /missing value for --max-price/],
    [[...args, '--offline', '--pay'], /cannot approve/],
    [[...args, '--approve'], /unknown option/],
  ];
  for (const [argv, expected] of cases) {
    const result = run(argv);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, expected);
  }
  await assert.rejects(access(join(root, 'job')), { code: 'ENOENT' });
});

test('purchase state is refused inside a Git working tree even with a broken Git marker', async t => {
  const { args, root } = await fixture(t);
  const init = spawnSync('git', ['init', '-q', root]);
  assert.equal(init.status, 0);
  const result = run([...args, '--offline']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside a Git working tree/);
  await rm(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git'), 'gitdir: missing-worktree');
  const broken = run([...args, '--offline']);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /outside a Git working tree/);
  await assert.rejects(access(join(root, 'job')), { code: 'ENOENT' });
});
