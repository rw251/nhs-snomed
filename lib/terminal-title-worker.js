import { workerData } from 'node:worker_threads';
import { TITLE_SPINNER_FRAMES, TITLE_SPINNER_INTERVAL, writeTerminalTitle } from './terminal-title.js';

const { fd, label } = workerData;
const state = new Int32Array(workerData.state);
let frame = 1;
const timer = setInterval(() => {
  const title = `${TITLE_SPINNER_FRAMES[frame]} - ${label} (nhs-snomed)`;
  if (!writeTerminalTitle(fd, title, state, true)) clearInterval(timer);
  frame = (frame + 1) % TITLE_SPINNER_FRAMES.length;
}, TITLE_SPINNER_INTERVAL);
