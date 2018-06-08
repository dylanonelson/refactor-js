#!/usr/bin/env node

const chalk = require('chalk');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

const recastPrintOptions = JSON.stringify({
  quote: 'single',
});

function progress(msg) {
  console.log(`=> ${msg}`);
};

const IMPORT_DECLARATION_TRANSFORM = path.resolve(
  __dirname,
  './node_modules/refactoring-codemods/lib/transformers/import-declaration-transform.js',
);

const IMPORT_RELATIVE_TRANSFORM = path.resolve(
  __dirname,
  './node_modules/refactoring-codemods/lib/transformers/import-relative-transform.js'
);

function resolvePaths(...paths) {
  return paths.map(p => (
    path.resolve(process.cwd(), p)
  ));
}

function isdir(p) {
  return fs.lstatSync(p).isDirectory();
}

function isdirEmpty(p) {
  return fs.readdirSync(p).length === 0;
}

function rmdirIfEmpty(p) {
  if (isdir(p) && isdirEmpty(p)) {
    fs.rmdirSync(p);
    return true;
  }

  return false;
}

function cleandirs(dir) {
  const files = fs.readdirSync(dir).map(file => (
    path.join(dir, file)
  ));
  files.forEach(rmdirIfEmpty);
  rmdirIfEmpty(dir);
}

function mkdirs([from, to]) {
  const fromParts = from.split(path.sep);
  const toParts = to.split(path.sep);

  toParts.reduce((acc, part) => {
    if (part === '') return part;
    const full = acc + path.sep + part;
    // This is a non-existent directory
    if (fs.existsSync(full) === false && full !== to) {
      progress(`Creating new directory at ${full}`);
      fs.mkdirSync(full);
    }

    return full;
  }, '');
  return Promise.resolve([from, to]);
}

function mvFile([from, to]) {
  [from, to] = resolvePaths(from, to);

  progress(`Moving file from ${from} to ${to}`);

  fs.closeSync(fs.openSync(to, 'w'));

  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(from);
    read.on('end', () => {
      fs.unlinkSync(from);
      resolve([from, to]);
    })
    read.pipe(fs.createWriteStream(to));
  });
}

function readJsFiles(dir, regex) {
  const files = fs.readdirSync(dir)
  const test = str => ((regex || /\.m?jsx?$/).test(str));
  const isNodeModule = str => /node_modules/.test(str);

  return files.reduce((acc, file) => {
    const fileName = path.resolve(dir, file);

    if (fs.lstatSync(fileName).isDirectory()) {
      acc.push(...readJsFiles(fileName, regex));
    }
    if (test(fileName) && !isNodeModule(fileName)) {
      acc.push(fileName);
    }

    return acc;
  }, []);
}

function getSrc() {
  const [src] = resolvePaths('./src');
  return src;
}

function updateOtherImports([from, to]) {
  return new Promise((resolve, reject) => {
    const jsFiles = readJsFiles(getSrc());
    progress(`Updating ${jsFiles.length} js files that import file ${from}...`);
    child_process.spawnSync(
      'jscodeshift',
      [
        '-t',
        IMPORT_DECLARATION_TRANSFORM,
        ...jsFiles,
        '--prevFilePath',
        from,
        '--nextFilePath',
        to,
        `--printOptions=${recastPrintOptions}`,
      ],
      {
        stdio: 'inherit',
      },
    );
    resolve([from, to]);
  });
}

function updateSelfImports([from, to]) {
  return new Promise((resolve, reject) => {
    progress(`Updating relative imports in file ${to}...`);
    child_process.spawnSync(
      'jscodeshift',
      [
        '-t',
        IMPORT_RELATIVE_TRANSFORM,
        to,
        '--prevFilePath',
        from,
        '--nextFilePath',
        to,
        `--printOptions=${recastPrintOptions}`,
      ],
      {
        stdio: 'inherit',
      },
    );
    resolve([from, to]);
  });
}

function refactorFile(from, to) {
  progress(`Refactoring file ${from}...`);
  return mkdirs([from, to])
    .then(mvFile)
    .then(updateOtherImports)
    .then(updateSelfImports);
}

let promise = Promise.resolve();

function refactorPath(from, to) {
  [from, to] = resolvePaths(from, to);
  const isDir = isdir(from);
  const isFile = fs.lstatSync(from).isFile();

  let fromFiles;
  let toFiles;
  if (isDir) {
    console.log('Moving directory at');
    fromFiles = readJsFiles(from);
    toFiles = fromFiles.map(file => {
      return file.replace(from, to);
    });
  } else if (isFile) {
    console.log('Moving file at');
    fromFiles = [from];
    toFiles = [to];
  }
  console.log(chalk.yellow(from));
  console.log('to')
  console.log(chalk.bold.green(to));
  console.log();
  fromFiles.forEach((file, idx) => {
    promise = promise.then(() => {
      console.log(chalk.blue(`Refactoring file ${idx + 1}/${fromFiles.length}`));
      return refactorFile(file, toFiles[idx])
    }).then(() => {
      console.log(chalk.cyan('Success!'));
      console.log();
    });
  });

  if (isdir(from)) {
    promise = promise.then(() => cleandirs(from));
  }
}

const [_, __, from, to] = process.argv;

refactorPath(from, to);
