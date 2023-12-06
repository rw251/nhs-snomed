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
const ZIP_DIR = path.join(FILES_DIR, 'zip');
const RAW_DIR = path.join(FILES_DIR, 'raw');
const PROCESSED_DIR = path.join(FILES_DIR, 'processed');

const existingFiles = readdirSync(ZIP_DIR);

function ensureDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
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
      const [, zipFileName] = url.match(/\/([^/]+).zip/);
      return { url, zipFileName };
    });
  // if (existingFiles.length === 0) {
  //   // first time
  //   return { url: downloads[0].url, isFirst: true };
  // } else {
  //   let minIndex = Number.MAX_SAFE_INTEGER;
  //   downloads.forEach(({ url, zipFileName }, i) => {
  //     if (existingFiles.indexOf(zipFileName) > -1) {
  //       minIndex = Math.min(i, minIndex);
  //     }
  //   });
  //   if (minIndex < 0 || minIndex === Number.MAX_SAFE_INTEGER) {
  //     console.log(
  //       `Something strange going on with download list. Was expecting to find previous downloads there but haven't as the minIndex is: ${minIndex}`
  //     );
  //     process.exit();
  //   }
  //   if (minIndex === 0) return { url: downloads[0], isFirst: false };
  //   else return { url: downloads[minIndex - 1], isFirst: false };
  // }
  const latest =
    'https://isd.digital.nhs.uk/download/api/v1/keys/b851973bc9f1c7db67dea4f6504cd62f51847376/content/items/101/uk_sct2cl_37.0.0_20230927000001Z.zip?consumer=webapp-releases-page';
  return { url: latest, isFirst: true };
}

async function downloadIfNotExists({ url, isFirst }) {
  await login();

  const filename = url.split('/').reverse()[0].split('?')[0];
  console.log(`> The most recent zip file on TRUD is ${filename}`);

  if (existingFiles.indexOf(filename) > -1) {
    console.log(`> The zip file already exists so no need to download again.`);
    return { filename, isFirst };
  }

  console.log(`> That zip is not stored locally. Downloading...`);
  const outputFile = path.join(ZIP_DIR, filename);
  const stream = createWriteStream(ensureDir(outputFile));
  const { body } = await fetch(url, { headers: { Cookie } });
  await finished(Readable.fromWeb(body).pipe(stream));
  console.log(`> File downloaded.`);
  return { filename, isFirst };
}

async function extractZip({ filename: zipFile, isFirst }) {
  // isFirst = true;
  const name = zipFile.replace('.zip', '');
  const file = path.join(ZIP_DIR, zipFile);
  const outDir = path.join(RAW_DIR, name);
  if (existsSync(outDir)) {
    console.log(
      `> The directory ${outDir} already exists, so I'm not unzipping.`
    );
    return { filename: name, isFirst };
  }
  console.log(`> The directory ${outDir} does not yet exist. Creating...`);
  ensureDir(outDir);
  console.log(`> Extracting files from the zip...`);
  let toUnzip = 0;
  let unzipped = 0;
  let isRead = false;
  await new Promise((resolve) => {
    createReadStream(file)
      .pipe(unzip.Parse())
      .on('entry', function (entry) {
        if (
          isFirst &&
          entry.path.toLowerCase().match(/full.+sct2_description/)
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
  return { filename: name, isFirst };
}

function getFileNames(dir, startingFromProjectDir) {
  const rawFilesDir = path.join(RAW_DIR, dir);
  const processedFilesDirFromRoot = path.join(PROCESSED_DIR, dir);
  const processedFilesDir = startingFromProjectDir
    ? path.join('files', 'processed', dir)
    : processedFilesDirFromRoot;
  const definitionFile = path.join(processedFilesDir, 'defs.json');
  const readableDefinitionFile = path.join(
    processedFilesDir,
    'defs-readable.json'
  );
  return {
    rawFilesDir,
    definitionFile,
    readableDefinitionFile,
    processedFilesDir,
    processedFilesDirFromRoot,
    latestDefsFile: path.join(PROCESSED_DIR, 'latest', 'defs.json'),
    latestReadableDefsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'defs-readable.json'
    ),
  };
}

async function loadDataIntoMemory({ filename: dir, isFirst }) {
  const {
    processedFilesDirFromRoot,
    rawFilesDir,
    definitionFile,
    readableDefinitionFile,
  } = getFileNames(dir);
  if (existsSync(definitionFile) && existsSync(readableDefinitionFile)) {
    console.log(`> The json files already exist so I'll move on...`);
    return { dir, isFirst };
  }
  ensureDir(processedFilesDirFromRoot);

  const definitions = {};
  for (let directory of readdirSync(rawFilesDir)) {
    const descriptionFileDir = path.join(
      rawFilesDir,
      directory,
      isFirst ? 'Full' : 'Delta',
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
  }

  //
  console.log(
    `> Description file loaded. It has ${Object.keys(definitions).length} rows.`
  );

  return new Promise((resolve) => {
    let done = 0;
    const jsonStream = new JsonStreamStringify(definitions);

    const stream = createWriteStream(ensureDir(definitionFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      console.log('> defs.json written');
      done++;
      if (done === 2) return resolve({ dir, isFirst });
    });

    const readableJsonStream = new JsonStreamStringify(definitions, null, 2);
    const streamReadable = createWriteStream(ensureDir(readableDefinitionFile));
    readableJsonStream.pipe(streamReadable);
    readableJsonStream.on('end', () => {
      console.log('> defs-readable.json written');
      done++;
      if (done === 2) return resolve({ dir, isFirst });
    });
  });
}

function combineLatest({ dir, isFirst }) {
  const {
    latestDefsFile,
    latestReadableDefsFile,
    definitionFile,
    readableDefinitionFile,
  } = getFileNames(dir);
  if (isFirst) {
    console.log('> This is the first time, so copy the json files to latest.');
    console.log('> Copying defs.json...');
    // just copy to latest
    copyFileSync(definitionFile, ensureDir(latestDefsFile));
    console.log('> Copying defs-readable.json...');
    copyFileSync(readableDefinitionFile, ensureDir(latestReadableDefsFile));
    console.log('> All files copied.');
  } else {
    // load latest
    console.log(`> Loading latest defs.json file...`);
    const latestDefs = JSON.parse(readFileSync(latestDefsFile, 'utf8'));

    // load update
    console.log(`> Loading updated defs...`);
    const defs = JSON.parse(readFileSync(definitionFile, 'utf8'));

    console.log(`> Both files loaded`);

    Object.entries(defs).forEach(([conceptId, data]) => {
      if (!latestDefs[conceptId]) {
        latestDefs[conceptId] = data;
      } else {
        Object.keys(data).forEach((descriptionId) => {
          if (!latestDefs[conceptId][descriptionId])
            latestDefs[conceptId][descriptionId] = data[descriptionId];
          else if (
            data[descriptionId].e > latestDefs[conceptId][descriptionId].e
          ) {
            latestDefs[conceptId][descriptionId] = data[descriptionId];
          }
        });
      }
    });

    console.log('> Writing updated files...');
    const jsonStream = new JsonStreamStringify(latestDefs);

    const stream = createWriteStream(ensureDir(latestDefsFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () =>
      console.log('> Latest defs.json written to file.')
    );

    const readableJsonStream = new JsonStreamStringify(latestDefs, null, 2);
    const streamReadable = createWriteStream(ensureDir(latestReadableDefsFile));
    readableJsonStream.pipe(streamReadable);
    readableJsonStream.on('end', () =>
      console.log('> Latest defs-readable.json written to file.')
    );
  }
}

// Get latest TRUD version
getLatestUrl()
  .then(downloadIfNotExists)
  .then(extractZip)
  .then(loadDataIntoMemory)
  .then(combineLatest);
