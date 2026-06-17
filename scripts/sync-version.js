#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const versionsPath = path.join(__dirname, '..', 'versions.json');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

manifestJson.version = packageJson.version;

fs.writeFileSync(manifestPath, JSON.stringify(manifestJson, null, 2) + '\n');

// Keep versions.json in sync so Obsidian's updater and BRAT always see the
// latest release on the default branch.
let versions = {};
try {
  versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
} catch {
  // If versions.json is missing, start fresh.
}

const updatedVersions = { [packageJson.version]: manifestJson.minAppVersion };
for (const [version, minAppVersion] of Object.entries(versions)) {
  if (version !== packageJson.version) {
    updatedVersions[version] = minAppVersion;
  }
}

fs.writeFileSync(versionsPath, JSON.stringify(updatedVersions, null, 2) + '\n');

console.log(`Synced version to ${packageJson.version}`);
