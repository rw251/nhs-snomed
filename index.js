/*
 * 1. Gets the latest SNOMED zip file from the TRUD website (unless already downloaded)
 *  - You need a TRUD account
 *  - Put your login detatils in the .env file
 *  - Make sure you are subscribed to "SNOMED CT UK Drug Extension, RF2: Full, Snapshot & Delta"
 * 2.
 *
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  createWriteStream,
  createReadStream,
  copyFileSync,
} from 'fs';
import { once } from 'node:events';
import readline from 'readline';

import { JsonStreamStringify } from 'json-stream-stringify';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import unzip from 'unzip-stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let Cookie;

const FILES_DIR = path.join(__dirname, 'files');
const ZIP_DIR = ensureDir(path.join(FILES_DIR, 'zip/'), true);
const RAW_DIR = ensureDir(path.join(FILES_DIR, 'raw'), true);
const PROCESSED_DIR = ensureDir(path.join(FILES_DIR, 'processed'), true);

const existingFiles = readdirSync(ZIP_DIR);

function ensureDir(filePath, isDir) {
  mkdirSync(isDir ? filePath : path.dirname(filePath), { recursive: true });
  return filePath;
}

if (!process.env.email) {
  console.log('Need email=xxx in the .env file');
  process.exit();
}
if (!process.env.password) {
  console.log('Need password=xxx in the .env file');
  process.exit();
}

async function login() {
  if (Cookie) return;
  const email = process.env.email;
  const password = process.env.password;

  console.log('> Logging in to TRUD...');
  const result = await fetch(
    'https://isd.digital.nhs.uk/trud/security/j_spring_security_check',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      body: new URLSearchParams({
        j_username: email,
        j_password: password,
        commit: 'LOG+IN',
      }),
    }
  );
  const cookies = result.headers.getSetCookie();
  const cookie = cookies.filter((x) => x.indexOf('JSESSIONID') > -1)[0];
  console.log('> Logged in, and cookie cached.');
  Cookie = cookie;
}

async function getLatestUrl() {
  await login();
  const response = await fetch(
    'https://isd.digital.nhs.uk/trud/users/authenticated/filters/0/categories/26/items/101/releases',
    { headers: { Cookie } }
  );
  const html = await response.text();
  const downloads = html
    .match(/https:\/\/isd.digital.nhs.uk\/download[^"]+(?:")/g)
    .map((url) => {
      const [, zipFileName] = url.match(/\/([^/]+.zip)/);
      return { url, zipFileName };
    });

  const drugResponse = await fetch(
    'https://isd.digital.nhs.uk/trud/users/authenticated/filters/0/categories/26/items/105/releases',
    { headers: { Cookie } }
  );
  const drugHtml = await drugResponse.text();
  const drugDownloads = drugHtml
    .match(/https:\/\/isd.digital.nhs.uk\/download[^"]+(?:")/g)
    .map((url) => {
      const [, zipFileName] = url.match(/\/([^/]+.zip)/);
      return { url, zipFileName };
    });

  return { url: downloads[0].url, drugUrl: drugDownloads[0].url };
}

async function downloadIfNotExistsHelper(url) {
  await login();

  const zipFileName = url.split('/').reverse()[0].split('?')[0];
  console.log(`> Target zip file on TRUD is ${zipFileName}`);

  if (existingFiles.indexOf(zipFileName) > -1) {
    console.log(`> The zip file already exists so no need to download again.`);
    return zipFileName;
  }

  console.log(`> That zip is not stored locally. Downloading...`);
  const outputFile = path.join(ZIP_DIR, zipFileName);
  const stream = createWriteStream(ensureDir(outputFile));
  const { body } = await fetch(url, { headers: { Cookie } });
  await finished(Readable.fromWeb(body).pipe(stream));
  console.log(`> File downloaded.`);
  return zipFileName;
}

async function downloadIfNotExists({ url, drugUrl }) {
  const zipFileName = await downloadIfNotExistsHelper(url);
  const drugZipFileName = await downloadIfNotExistsHelper(drugUrl);
  return { zipFileName, drugZipFileName };
}

async function extractZipHelper(zipFileName) {
  const dirName = zipFileName.replace('.zip', '');
  const file = path.join(ZIP_DIR, zipFileName);
  const outDir = path.join(RAW_DIR, dirName);
  if (existsSync(outDir)) {
    console.log(
      `> The directory ${outDir} already exists, so I'm not unzipping.`
    );
    return dirName;
  }
  console.log(`> The directory ${outDir} does not yet exist. Creating...`);
  ensureDir(outDir, true);
  console.log(`> Extracting files from the zip...`);
  let toUnzip = 0;
  let unzipped = 0;
  let isRead = false;
  await new Promise((resolve) => {
    createReadStream(file)
      .pipe(unzip.Parse())
      .on('entry', function (entry) {
        if (
          entry.path.toLowerCase().match(/full.+sct2_description/) ||
          entry.path.toLowerCase().match(/full.+sct2_relationship_/)
        ) {
          console.log(`> Extracting ${entry.path}...`);
          toUnzip++;
          const outputFilePath = path.join(outDir, entry.path);
          const outStream = createWriteStream(ensureDir(outputFilePath));
          outStream.on('finish', () => {
            console.log(`> Extracted ${entry.path}.`);
            unzipped++;
            if (isRead && toUnzip === unzipped) {
              return resolve();
            }
          });
          entry.pipe(outStream);
        } else {
          entry.autodrain();
        }
      })
      .on('end', () => {
        console.log(`> Finished reading zip file.`);
        isRead = true;
        if (toUnzip === unzipped) {
          return resolve();
        }
      });
  });
  console.log(`> ${unzipped} files extracted.`);
  return dirName;
}

async function extractZip({ zipFileName, drugZipFileName }) {
  const dirName = await extractZipHelper(zipFileName);
  const drugDirName = await extractZipHelper(drugZipFileName);
  return { dirName, drugDirName };
}

function getFileNames({ dirName, drugDirName }) {
  const snomedId = `${dirName}-${drugDirName}`;

  const rawFilesDir = path.join(RAW_DIR, dirName);
  const drugRawFilesDir = path.join(RAW_DIR, drugDirName);
  const processedFilesDirFromRoot = path.join(PROCESSED_DIR, snomedId);
  const processedFilesDir = path.join('files', 'processed', snomedId);
  const singleDefinitionFile = path.join(processedFilesDir, 'defs-single.json');
  const definitionFile = path.join(processedFilesDir, 'defs.json');
  const readableDefinitionFile = path.join(
    processedFilesDir,
    'defs-readable.json'
  );

  const relationsFile = path.join(processedFilesDir, 'relationships.json');
  const readableRelationsFile = path.join(
    processedFilesDir,
    'relationships-readable.json'
  );

  return {
    rawFilesDir,
    drugRawFilesDir,
    definitionFile,
    singleDefinitionFile,
    readableDefinitionFile,
    relationsFile,
    readableRelationsFile,
    processedFilesDir,
    processedFilesDirFromRoot,
    latestDefsFile: path.join(PROCESSED_DIR, 'latest', 'defs.json'),
    latestReadableDefsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'defs-readable.json'
    ),
    latestSingleDefsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'defs-single.json'
    ),
    latestRelationsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'relationships.json'
    ),
    latestReadableRelationsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'relationships-readable.json'
    ),
  };
}

let definitions = {};
let relationships = {};
let relationshipTEMP = {};
function getBestDefinition(conceptId) {
  // if we have any that are active AND main then pick most recent
  const activeAndMainDef = Object.values(definitions[conceptId])
    .filter((data) => data.a && data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (activeAndMainDef.length > 0) {
    return activeAndMainDef[0].t;
  }

  // if no mains, but some actives, pick most recent
  const activeAndSynDef = Object.values(definitions[conceptId])
    .filter((data) => data.a && !data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (activeAndSynDef.length > 0) {
    return activeAndSynDef[0].t;
  }

  // if main but no actives, pick most recent
  const inactiveAndMainDef = Object.values(definitions[conceptId])
    .filter((data) => !data.a && data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (inactiveAndMainDef.length > 0) {
    return inactiveAndMainDef[0].t;
  }

  // no main and no active - investigate
  const inactiveAndMSynDef = Object.values(definitions[conceptId])
    .filter((data) => !data.a && !data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (inactiveAndMSynDef.length > 0) {
    return inactiveAndMSynDef[0].t;
  }
}
async function loadDataIntoMemoryHelper(rawFilesDir) {
  for (let directory of readdirSync(rawFilesDir)) {
    const descriptionFileDir = path.join(
      rawFilesDir,
      directory,
      'Full',
      'Terminology'
    );
    const descriptionFile = path.join(
      descriptionFileDir,
      readdirSync(descriptionFileDir)[0]
    );
    console.log(`> Reading the description file ${descriptionFile}...`);
    readFileSync(descriptionFile, 'utf8')
      .split('\n')
      .forEach((row) => {
        const [
          id,
          effectiveTime,
          active,
          moduleId,
          conceptId,
          languageCode,
          typeId,
          term,
          caseSignificanceId,
        ] = row.replace(/\r/g, '').split('\t');
        if (id === 'id' || id === '') return;
        if (!definitions[conceptId]) definitions[conceptId] = {};
        if (!definitions[conceptId][id]) {
          definitions[conceptId][id] = { t: term, e: effectiveTime };
          if (active === '1') {
            definitions[conceptId][id].a = 1;
          }
          if (typeId === '900000000000003001') {
            definitions[conceptId][id].m = 1;
          }
        } else {
          if (effectiveTime > definitions[conceptId][id].e) {
            definitions[conceptId][id].t = term;
            definitions[conceptId][id].e = effectiveTime;
            if (active === '1') {
              definitions[conceptId][id].a = 1;
            } else {
              delete definitions[conceptId][id].a;
            }
            if (typeId === '900000000000003001') {
              definitions[conceptId][id].m = 1;
            } else {
              delete definitions[conceptId][id].m;
            }
          }
        }
      });

    const relationshipFileDir = path.join(
      rawFilesDir,
      directory,
      'Full',
      'Terminology'
    );
    const relationshipFile = path.join(
      relationshipFileDir,
      readdirSync(relationshipFileDir)[1]
    );

    console.log(`> Reading the relationship file ${relationshipFile}...`);

    const rl = readline.createInterface({
      input: createReadStream(relationshipFile),
      terminal: false,
    });

    rl.on('line', (line) => {
      const [
        id,
        effectiveTime,
        active,
        moduleId,
        sourceId,
        destinationId,
        relationshipGroup,
        typeId,
        characteristicTypeId,
        modifierId,
      ] = line.replace(/\r/g, '').split('\t');
      if (id === 'id' || id === '' || typeId !== '116680003') return;
      if (!relationshipTEMP[id]) {
        relationshipTEMP[id] = {
          active,
          effectiveTime,
          sourceId,
          destinationId,
        };
      } else {
        if (effectiveTime > relationshipTEMP[id].effectiveTime) {
          relationshipTEMP[id].active = active;
          relationshipTEMP[id].effectiveTime = effectiveTime;
          relationshipTEMP[id].sourceId = sourceId;
          relationshipTEMP[id].destinationId = destinationId;
        }
      }
    });

    await once(rl, 'close');

    Object.values(relationshipTEMP).forEach(
      ({ active, sourceId, destinationId }) => {
        if (active === '1') {
          if (!relationships[destinationId]) relationships[destinationId] = {};
          relationships[destinationId][sourceId] = true;
        }
      }
    );
  }
}

async function loadDataIntoMemory({ dirName, drugDirName }) {
  const {
    processedFilesDirFromRoot,
    definitionFile,
    singleDefinitionFile,
    readableDefinitionFile,
    rawFilesDir,
    drugRawFilesDir,
    relationsFile,
    readableRelationsFile,
  } = getFileNames({ dirName, drugDirName });
  if (
    existsSync(definitionFile) &&
    existsSync(singleDefinitionFile) &&
    existsSync(readableDefinitionFile) &&
    existsSync(relationsFile) &&
    existsSync(readableRelationsFile)
  ) {
    console.log(`> The json files already exist so I'll move on...`);
    return { dirName, drugDirName };
  }
  ensureDir(processedFilesDirFromRoot, true);

  await loadDataIntoMemoryHelper(rawFilesDir);
  await loadDataIntoMemoryHelper(drugRawFilesDir);

  //
  console.log(
    `> Description file loaded. It has ${Object.keys(definitions).length} rows.`
  );
  console.log('> Writing the description data to 3 JSON files.');
  console.log('> First is defs-readable.json...');

  await new Promise((resolve) => {
    const readableJsonStream = new JsonStreamStringify(definitions, null, 2);
    const streamReadable = createWriteStream(ensureDir(readableDefinitionFile));
    readableJsonStream.pipe(streamReadable);
    readableJsonStream.on('end', () => {
      console.log('> defs-readable.json written');
      return resolve();
    });
  });

  console.log('> Now defs.json...');
  await new Promise((resolve) => {
    const jsonStream = new JsonStreamStringify(definitions);

    const stream = createWriteStream(ensureDir(definitionFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      console.log('> defs.json written');
      return resolve();
    });
  });

  console.log(
    '> Create a new lookup with just one definition per concept id...'
  );
  const bestDefs = {};
  Object.keys(definitions).forEach((conceptId) => {
    bestDefs[conceptId] = getBestDefinition(conceptId);
  });

  console.log('> Now defs-single.json...');
  await new Promise((resolve) => {
    const jsonStream = new JsonStreamStringify(bestDefs);

    const stream = createWriteStream(ensureDir(singleDefinitionFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      console.log('> defs-single.json written');
      return resolve();
    });
  });

  console.log(
    `> Relationships file loaded. It has ${
      Object.keys(relationships).length
    } rows.`
  );
  console.log('> Writing the relationship data to 2 JSON files.');
  console.log('> First is relationships-readable.json...');

  await new Promise((resolve) => {
    const readableJsonStream = new JsonStreamStringify(relationships, null, 2);
    const streamReadable = createWriteStream(ensureDir(readableRelationsFile));
    readableJsonStream.pipe(streamReadable);
    readableJsonStream.on('end', () => {
      console.log('> relationships-readable.json written');
      return resolve();
    });
  });

  console.log('> Now relationships.json...');
  await new Promise((resolve) => {
    const jsonStream = new JsonStreamStringify(relationships);

    const stream = createWriteStream(ensureDir(relationsFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      console.log('> relationships.json written');
      return resolve();
    });
  });

  return { dirName, drugDirName };
}

function copyToLatest({ dirName, drugDirName }) {
  const {
    latestDefsFile,
    latestReadableDefsFile,
    definitionFile,
    singleDefinitionFile,
    readableDefinitionFile,
    latestSingleDefsFile,
    latestRelationsFile,
    latestReadableRelationsFile,
    relationsFile,
    readableRelationsFile,
  } = getFileNames({ dirName, drugDirName });

  console.log('> Copying defs.json to latest directory...');
  // just copy to latest
  copyFileSync(definitionFile, ensureDir(latestDefsFile));
  console.log('> Copying defs-readable.json to latest directory...');
  copyFileSync(readableDefinitionFile, ensureDir(latestReadableDefsFile));
  console.log('> Copying defs-single.json to latest directory...');
  copyFileSync(singleDefinitionFile, ensureDir(latestSingleDefsFile));
  console.log('> Copying relationships.json to latest directory...');
  // just copy to latest
  copyFileSync(relationsFile, ensureDir(latestRelationsFile));
  console.log('> Copying relationships-readable.json to latest directory...');
  copyFileSync(readableRelationsFile, ensureDir(latestReadableRelationsFile));
  console.log('> All files copied.');
}

// Get latest TRUD version
getLatestUrl()
  .then(downloadIfNotExists)
  .then(extractZip)
  .then(loadDataIntoMemory)
  .then(copyToLatest);
