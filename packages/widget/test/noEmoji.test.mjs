import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[←-⇿⌀-⏿■-◿☀-➿⬀-⯿️‍]/gu;
const ESCAPED =
  /\\u\{?(?:21[9a-f][0-9a-f]|23[0-9a-f]{2}|25[a-f][0-9a-f]|2[6-7][0-9a-f]{2}|2b[0-9a-f]{2}|fe0f|1f[0-9a-f]{3})\}?/gi;
const EXTENSIONS = /\.(tsx?|css|html|js|mjs)$/;

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return EXTENSIONS.test(name) ? [path] : [];
  });
}

function offenders(paths) {
  const found = [];
  for (const path of paths) {
    const text = readFileSync(path, 'utf8');
    const hits = [...(text.match(EMOJI) ?? []), ...(text.match(ESCAPED) ?? [])];
    if (hits.length > 0)
      found.push(`${path.slice(root.length + 1)}: ${[...new Set(hits)].join(' ')}`);
  }
  return found;
}

test('widget source contains no emoji or pictographic symbols', () => {
  assert.deepEqual(offenders(files(join(root, 'src'))), []);
  assert.deepEqual(offenders([join(root, 'index.html')].filter(existsSync)), []);
});

test('widget build output contains no emoji or pictographic symbols', (t) => {
  const built = files(join(root, 'dist')).filter((p) => !p.endsWith('.map'));
  if (built.length === 0) {
    t.skip('dist is missing, run the build first');
    return;
  }
  assert.deepEqual(offenders(built), []);
});
