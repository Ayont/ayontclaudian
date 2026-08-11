import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import jestPlugin from 'eslint-plugin-jest';
import obsidianmd from 'eslint-plugin-obsidianmd';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { defineConfig } from 'eslint/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const jestRecommended = jestPlugin.configs['flat/recommended'];
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));
const obsidianRuleSeverity = 'warn';

const stagedObsidianRules = {
  'obsidianmd/commands/no-command-in-command-id': obsidianRuleSeverity,
  'obsidianmd/commands/no-command-in-command-name': obsidianRuleSeverity,
  'obsidianmd/commands/no-default-hotkeys': obsidianRuleSeverity,
  'obsidianmd/commands/no-plugin-id-in-command-id': obsidianRuleSeverity,
  'obsidianmd/commands/no-plugin-name-in-command-name': obsidianRuleSeverity,
  'obsidianmd/detach-leaves': obsidianRuleSeverity,
  'obsidianmd/editor-drop-paste': obsidianRuleSeverity,
  'obsidianmd/hardcoded-config-path': obsidianRuleSeverity,
  'obsidianmd/no-forbidden-elements': obsidianRuleSeverity,
  'obsidianmd/no-global-this': obsidianRuleSeverity,
  'obsidianmd/no-plugin-as-component': obsidianRuleSeverity,
  'obsidianmd/no-sample-code': obsidianRuleSeverity,
  'obsidianmd/no-static-styles-assignment': obsidianRuleSeverity,
  'obsidianmd/no-tfile-tfolder-cast': obsidianRuleSeverity,
  'obsidianmd/no-unsupported-api': obsidianRuleSeverity,
  'obsidianmd/no-view-references-in-plugin': obsidianRuleSeverity,
  'obsidianmd/object-assign': obsidianRuleSeverity,
  'obsidianmd/platform': obsidianRuleSeverity,
  'obsidianmd/prefer-abstract-input-suggest': obsidianRuleSeverity,
  'obsidianmd/prefer-active-doc': obsidianRuleSeverity,
  'obsidianmd/prefer-file-manager-trash-file': obsidianRuleSeverity,
  'obsidianmd/prefer-get-language': obsidianRuleSeverity,
  'obsidianmd/prefer-instanceof': obsidianRuleSeverity,
  'obsidianmd/prefer-window-timers': obsidianRuleSeverity,
  'obsidianmd/regex-lookbehind': obsidianRuleSeverity,
  'obsidianmd/sample-names': obsidianRuleSeverity,
  'obsidianmd/settings-tab/no-manual-html-headings': obsidianRuleSeverity,
  'obsidianmd/settings-tab/no-problematic-settings-headings': obsidianRuleSeverity,
  // Off, and it has to be: this rule enforces ENGLISH sentence case, but the
  // product voice is German (see CLAUDE.md). German capitalises every noun, so
  // the rule's own suggestions are grammatically wrong — it asked for
  // 'Team-mission abgeschlossen.', 'Install-anleitung öffnen' and
  // 'Index vault for rag'. Following them would degrade the UI; not following
  // them produced 200+ permanently-unfixable warnings that buried the ~12
  // genuinely actionable ones (TFile casts, static style assignments,
  // Vault.delete) in the same output.
  //
  // The ignoreWords/brands/acronyms escape hatches only cover proper nouns, not
  // "every noun in the language", so there is no configuration that makes this
  // rule correct for a German UI.
  'obsidianmd/ui/sentence-case': 'off',
  'obsidianmd/vault/iterate': obsidianRuleSeverity,
};

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'main.js', 'tests/visual/**', 'playwright.config.ts'],
  },
  js.configs.recommended,
  {
    files: ['esbuild.config.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
      },
    },
  },
  ...tseslint.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    plugins: {
      obsidianmd,
    },
    rules: stagedObsidianRules,
  },
  {
    files: [
      'src/ClaudianService.ts',
      'src/InlineEditService.ts',
      'src/InstructionRefineService.ts',
      'src/images/**/*.ts',
      'src/prompt/**/*.ts',
      'src/sdk/**/*.ts',
      'src/security/**/*.ts',
      'src/tools/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./ui', './ui/*', '../ui', '../ui/*'],
              message: 'Service and shared modules must not import UI modules.',
            },
            {
              group: ['./ClaudianView', '../ClaudianView'],
              message: 'Service and shared modules must not import the view.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    ...jestRecommended,
    rules: {
      ...jestRecommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);
