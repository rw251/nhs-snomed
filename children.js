// Get all descendants of a code

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('> Loading definitions...');
const SNOMED_DEFINITIONS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'files', 'processed', 'latest', 'defs-single.json'),
    'utf8'
  )
);
console.log('> Loading relationships...');
const rels = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      'files',
      'processed',
      'latest',
      'relationships-readable.json'
    ),
    'utf8'
  )
);

function getChildren(code) {
  if (!rels[code]) return [];
  return Object.keys(rels[code]);
}

function getBestDefinition(conceptId) {
  // if we have any that are active AND main then pick most recent
  const activeAndMainDef = Object.values(SNOMED_DEFINITIONS[conceptId])
    .filter((data) => data.a && data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (activeAndMainDef.length > 0) {
    return activeAndMainDef[0].t;
  }

  // if no mains, but some actives, pick most recent
  const activeAndSynDef = Object.values(SNOMED_DEFINITIONS[conceptId])
    .filter((data) => data.a && !data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (activeAndSynDef.length > 0) {
    return activeAndSynDef[0].t;
  }

  // if main but no actives, pick most recent
  const inactiveAndMainDef = Object.values(SNOMED_DEFINITIONS[conceptId])
    .filter((data) => !data.a && data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (inactiveAndMainDef.length > 0) {
    return inactiveAndMainDef[0].t;
  }

  // no main and no active - investigate
  const inactiveAndMSynDef = Object.values(SNOMED_DEFINITIONS[conceptId])
    .filter((data) => !data.a && !data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (inactiveAndMSynDef.length > 0) {
    return inactiveAndMSynDef[0].t;
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const prompt = (isFirst) =>
  new Promise((resolve) =>
    rl.question(
      isFirst
        ? 'Enter the SNOMED code to get all its descendants:'
        : "Enter 'n' to copy the codes without the hierarchy indenting, or enter another SNOMED code to go again:",
      resolve
    )
  );

let outputNoIndenting;
function displayDescendants(snomedId) {
  let ans = [];
  let queue = [{ code: snomedId, level: 0 }];

  while (queue.length > 0) {
    const next = queue.pop();
    ans.push(next);
    const children = getChildren(next.code);
    queue = queue.concat(
      children.map((x) => {
        return { code: x, level: next.level + 1 };
      })
    );
  }

  outputNoIndenting = ans
    .map((x) => `${x.code}\t${SNOMED_DEFINITIONS[x.code]}`)
    .join('\n');
  const output = ans
    .map(
      (x) =>
        `${new Array(x.level).fill('>').join('')}${x.code}\t${
          SNOMED_DEFINITIONS[x.code]
        }`
    )
    .join('\n');
  console.log(`${output}\n\n Also copied to clipboard.\n`);
  spawn('clip').stdin.end(output);
}

async function go() {
  let isFirst = true;
  while (true) {
    const snomedId = await prompt(isFirst);
    isFirst = false;
    if (snomedId === 'n') {
      spawn('clip').stdin.end(outputNoIndenting);
    } else {
      if (SNOMED_DEFINITIONS[snomedId]) displayDescendants(snomedId);
    }
  }
}

rl.on('close', function () {
  console.log('\nBYE BYE !!!');
  process.exit(0);
});

go();
//displayDescendants('14304000');
