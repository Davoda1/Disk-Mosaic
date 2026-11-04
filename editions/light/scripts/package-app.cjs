'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

// The runtime has no npm production dependencies. Only these two source trees
// and a minimal application manifest belong in app.asar.
function copyRegularTree(source, destination) {
  const info = fs.lstatSync(source);
  assert(!info.isSymbolicLink(), `Package inputs must not be symbolic links: ${source}`);
  if (info.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source).sort()) {
      copyRegularTree(path.join(source, name), path.join(destination, name));
    }
  } else {
    assert(info.isFile(), `Package inputs must be regular files: ${source}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, info.mode & 0o777);
  }
}

function stageApplication(root, staging, platform) {
  assert(['linux', 'win32'].includes(platform), 'Only Linux and Windows packaging are supported.');
  const gui = path.join(root, 'gui');
  const metadata = JSON.parse(fs.readFileSync(path.join(gui, 'package.json'), 'utf8'));
  assert.match(metadata.name, /^[a-z][a-z0-9-]+$/);
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
  assert.match(metadata.devDependencies.electron, /^\d+\.\d+\.\d+$/);
  assert.equal(metadata.build.linux.executableName, metadata.name);
  assert.equal(metadata.main, 'electron/main.cjs');
  assert(!metadata.dependencies || Object.keys(metadata.dependencies).length === 0,
    'New runtime dependencies require an explicit packaging review.');

  const app = path.join(staging, 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const name of ['electron', 'renderer']) copyRegularTree(path.join(gui, name), path.join(app, name));
  const runtimeMetadata = Object.fromEntries(
    ['name', 'version', 'description', 'main', 'author', 'homepage', 'license'].map(key => [key, metadata[key]])
  );
  fs.writeFileSync(path.join(app, 'package.json'), `${JSON.stringify(runtimeMetadata, null, 2)}\n`);

  const resources = path.join(staging, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const engine = platform === 'win32' ? 'diskmosaic-engine.exe' : 'diskmosaic-engine';
  for (const resource of metadata.build.extraResources) {
    assert.match(resource.to, /^[A-Za-z0-9_.-]+$/);
    assert(!['.', '..'].includes(resource.to), 'Resource destinations must be simple names.');
    const source = path.resolve(gui, resource.from);
    const destination = path.join(resources, resource.to);
    if (resource.to === 'engine') {
      assert(resource.filter.includes(engine), `Missing engine resource filter: ${engine}`);
      copyRegularTree(path.join(source, engine), path.join(destination, engine));
      if (platform === 'linux') fs.chmodSync(path.join(destination, engine), 0o755);
    } else {
      assert(!resource.filter, 'Only the platform engine uses a resource filter.');
      copyRegularTree(source, destination);
    }
  }
  return { metadata, app, resources };
}

async function packageApplication(root, platform) {
  root = path.resolve(root);
  const localRequire = createRequire(path.join(root, 'gui/package.json'));
  const { packager } = await import(pathToFileURL(localRequire.resolve('@electron/packager')).href);
  const asar = await import(pathToFileURL(localRequire.resolve('@electron/asar')).href);
  const temporary = path.join(root, 'dependencies/tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const staging = fs.mkdtempSync(path.join(temporary, 'package-app-'));
  try {
    const { metadata, app, resources } = stageApplication(root, staging, platform);
    const output = path.join(root, 'dist/package');
    const [built] = await packager({
      dir: app,
      out: output,
      name: metadata.build.productName,
      executableName: platform === 'linux' ? metadata.name : metadata.build.productName,
      appBundleId: metadata.build.appId,
      appCopyright: metadata.build.copyright,
      appVersion: metadata.version,
      buildVersion: metadata.version,
      electronVersion: metadata.devDependencies.electron,
      platform,
      arch: 'x64',
      asar: true,
      prune: false,
      overwrite: true,
      tmpdir: temporary,
      download: { cacheRoot: path.join(root, 'dependencies/electron-cache') },
      extraResource: fs.readdirSync(resources).sort().map(name => path.join(resources, name)),
      ...(platform === 'win32' ? {
        icon: path.join(root, 'gui', metadata.build.win.icon),
        win32metadata: { CompanyName: metadata.author, FileDescription: metadata.description },
      } : {}),
    });
    assert(built, 'Electron Packager did not produce an application.');
    const unpacked = path.join(output, platform === 'linux' ? 'linux-unpacked' : 'win-unpacked');
    fs.rmSync(unpacked, { recursive: true, force: true });
    fs.renameSync(built, unpacked);

    // Keep Electron's complete license alongside the project license.
    const electronLicense = path.join(unpacked, 'LICENSE');
    assert(fs.statSync(electronLicense).isFile(), 'Electron license is missing.');
    fs.renameSync(electronLicense, path.join(unpacked, 'LICENSE.electron.txt'));
    for (const name of fs.readdirSync(resources).sort()) {
      if (name !== 'engine') fs.copyFileSync(path.join(resources, name), path.join(unpacked, name));
    }
    assert(fs.statSync(path.join(unpacked, 'LICENSES.chromium.html')).isFile(), 'Chromium notices are missing.');
    const archive = path.join(unpacked, 'resources/app.asar');
    const names = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
    assert(names.includes('electron/main.cjs') && names.includes('renderer/index.html'), 'Application archive is incomplete.');
    for (const name of names) {
      assert(name === 'package.json' || /^(electron|renderer)(\/|$)/.test(name), `Unexpected runtime archive entry: ${name}`);
    }
    const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
    assert.equal(packagedMetadata.version, metadata.version);
    assert.equal(packagedMetadata.name, metadata.name);
    const executable = platform === 'linux' ? metadata.name : `${metadata.build.productName}.exe`;
    assert(fs.lstatSync(path.join(unpacked, executable)).isFile(), 'The application executable is missing.');
    console.log(`Prepared ${metadata.build.productName} ${metadata.version} for ${platform}-x64: ${unpacked}`);
    return unpacked;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { stageApplication, packageApplication };
if (require.main === module) {
  packageApplication(path.resolve(__dirname, '..'), process.argv[2]).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
