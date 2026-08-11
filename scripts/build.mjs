#!/usr/bin/env node
/**
 * Combined build script - runs CSS build then esbuild
 * Avoids npm echoing commands
 */

import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Run CSS build silently. The mode arg is forwarded so a production build also
// minifies the stylesheet; `npm run build:css` on its own stays readable.
const args = process.argv.slice(2).join(' ');
execSync(`node scripts/build-css.mjs ${args}`, { cwd: ROOT, stdio: 'inherit' });

// Run esbuild with args passed through
execSync(`node esbuild.config.mjs ${args}`, { cwd: ROOT, stdio: 'inherit' });
