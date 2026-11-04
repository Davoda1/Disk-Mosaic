const path = require('node:path');

function engineExecutableName(platform = process.platform) {
  return platform === 'win32' ? 'diskmosaic-engine.exe' : 'diskmosaic-engine';
}

function resolveEnginePath({ packaged, resourcesPath, appDir, platform = process.platform }) {
  const exe = engineExecutableName(platform);
  if (packaged) {
    return path.join(resourcesPath, 'engine', exe);
  }
  return path.resolve(appDir, '..', 'dependencies', 'cargo-target', 'release', exe);
}

module.exports = { engineExecutableName, resolveEnginePath };
