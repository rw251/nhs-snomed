import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  createWriteStream,
  createReadStream,
  copyFileSync,
} from 'fs';
import { JsonStreamStringify } from 'json-stream-stringify';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import unzip from 'unzip-stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defsFrom3700 = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      'files',
      'processed',
      'latest-starting_37-02',
      'defs.json'
    )
  )
);
const defsFrom3604 = JSON.parse(
  readFileSync(
    path.join(__dirname, 'files', 'processed', 'latest', 'defs.json')
  )
);

Object.keys(defsFrom3700).forEach((conceptId) => {
  if (!defsFrom3604[conceptId]) console.log(`${conceptId} in 3700 not in 3604`);
});

Object.keys(defsFrom3604).forEach((conceptId) => {
  if (!defsFrom3700[conceptId]) console.log(`${conceptId} in 3604 not in 3700`);
});
