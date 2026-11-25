import { writeSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

export const TITLE_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const TITLE_SPINNER_INTERVAL = 100;
const PROJECT = 'nhs-snomed';

// Both threads use the same lock so cleanup is always the last title written.
export function writeTerminalTitle(fd, title, state, onlyWhenRunning = false) {
  while (Atomics.compareExchange(state, 1, 0, 1) !== 0) {
    Atomics.wait(state, 1, 1);
  }
  try {
    if (onlyWhenRunning && !Atomics.load(state, 0)) return false;
    const safeTitle = title.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    writeSync(fd, `\x1b]0;${safeTitle}\x07`);
    return true;
  } catch {
    return false;
  } finally {
    Atomics.store(state, 1, 0);
    Atomics.notify(state, 1);
  }
}

export function createTerminalTitle({ output = process.stdout, term = process.env.TERM } = {}) {
  if (!output.isTTY || term === 'dumb' || !Number.isInteger(output.fd)) {
    return { running() {}, close() {} };
  }

  let closed = false;
  let state = new Int32Array(new SharedArrayBuffer(8));

  function stop() {
    Atomics.store(state, 0, 0);
    // Drain any frame already being written before another worker can start.
    while (Atomics.compareExchange(state, 1, 0, 1) !== 0) {
      Atomics.wait(state, 1, 1);
    }
    Atomics.store(state, 1, 0);
    Atomics.notify(state, 1);
    // The worker observes this flag on its next tick and exits naturally.
    // Do not terminate it while it might hold the write lock.
  }

  function running(label) {
    if (closed) return;
    stop();
    // Use a fresh flag for each worker: a previous worker must never resume.
    const runningState = new Int32Array(new SharedArrayBuffer(8));
    Atomics.store(runningState, 0, 1);
    writeTerminalTitle(output.fd, `${TITLE_SPINNER_FRAMES[0]} - ${label} (${PROJECT})`, runningState);
    try {
      const worker = new Worker(new URL('./terminal-title-worker.js', import.meta.url), {
        workerData: { fd: output.fd, label, state: runningState.buffer },
      });
      worker.on('error', () => {});
      worker.unref();
    } catch {
      // Title animation is optional; processing should still run.
    }
    // All subsequent writes and cleanup must share this worker's lock.
    state = runningState;
  }

  function close() {
    if (closed) return;
    closed = true;
    stop();
    writeTerminalTitle(output.fd, PROJECT, state);
    process.off('exit', close);
  }

  process.once('exit', close);
  return { running, close };
}
