import assert from 'node:assert/strict';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createTerminalTitle, TITLE_SPINNER_FRAMES } from '../lib/terminal-title.js';

const helperUrl = new URL('../lib/terminal-title.js', import.meta.url).href;
const baseline = 'nhs-snomed';

function capture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'terminal-title-'));
  const path = join(directory, 'titles');
  const fd = openSync(path, 'w');
  t.after(() => {
    closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    fd,
    path,
    titles: () => [...readFileSync(path, 'utf8').matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map((match) => match[1]),
  };
}

test('animates while the main thread blocks and stops after close', async (t) => {
  const output = capture(t);
  const title = createTerminalTitle({ output: { isTTY: true, fd: output.fd }, term: 'xterm' });
  t.after(() => title.close());
  title.running('Process SNOMED');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  title.close();
  const titles = output.titles();
  assert.ok(titles.length >= 12, `Expected a full spinner cycle, got ${titles.length} titles`);
  titles.slice(0, -1).forEach((value, index) => {
    assert.equal(value, `${TITLE_SPINNER_FRAMES[index % 10]} - Process SNOMED (nhs-snomed)`);
  });
  assert.equal(titles.at(-1), baseline);
  await delay(250);
  title.close();
  assert.deepEqual(output.titles(), titles);
});

test('suppresses escapes for redirected output and dumb terminals', (t) => {
  const output = capture(t);
  for (const [isTTY, term] of [[false, 'xterm'], [true, 'dumb']]) {
    const title = createTerminalTitle({ output: { isTTY, fd: output.fd }, term });
    title.running('Task');
    title.close();
  }
  assert.equal(readFileSync(output.path, 'utf8'), '');
});

test('terminal write failures are nonfatal', () => {
  const title = createTerminalTitle({ output: { isTTY: true, fd: -1 }, term: 'xterm' });
  assert.doesNotThrow(() => {
    title.running('Task');
    title.close();
  });
});

test('exit cleanup runs for direct process.exit and action failure', (t) => {
  for (const ending of ['process.exit(0)', 'throw new Error("action failed")']) {
    const output = capture(t);
    const source = `(async () => {
      const { openSync } = await import('node:fs');
      const { createTerminalTitle } = await import(${JSON.stringify(helperUrl)});
      const title = createTerminalTitle({ output: { isTTY: true, fd: openSync(${JSON.stringify(output.path)}, 'w') }, term: 'xterm' });
      title.running('Task');
      ${ending};
    })()`;
    const result = spawnSync(process.execPath, ['--eval', source], { encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, ending.startsWith('throw') ? 1 : 0);
    assert.equal(output.titles().at(-1), baseline);
  }
});
