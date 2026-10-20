import js from '@eslint/js';
import globals from 'globals';
import { readdirSync, readFileSync } from 'node:fs';

// Apps Script puts every .gs file in one shared global scope. Declare each file's
// top-level names as globals so `no-undef` still catches genuine typos.
const projectGlobals = {};
for (const f of readdirSync('src').filter(f => f.endsWith('.gs'))) {
  const src = readFileSync(`src/${f}`, 'utf8');
  for (const [, kind, name] of src.matchAll(/^(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    projectGlobals[name] = kind === 'let' || kind === 'var' ? 'writable' : 'readonly';
  }
}

const appsScriptGlobals = Object.fromEntries([
  'CalendarApp', 'GmailApp', 'HtmlService', 'LockService', 'PropertiesService', 'ScriptApp',
  'Session', 'SpreadsheetApp', 'UrlFetchApp', 'Utilities'
].map(g => [g, 'readonly']));

export default [
  { ignores: ['node_modules/', 'dist/', 'paste-ready/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      // BUNDLED_HTML_ exists only in dist/Code.gs (added by scripts/bundle.mjs).
      globals: { ...globals.es2021, console: 'readonly', BUNDLED_HTML_: 'readonly', ...appsScriptGlobals, ...projectGlobals }
    },
    rules: {
      // Top-level functions are entry points (menus, triggers) or used from other files.
      'no-unused-vars': ['error', { vars: 'local', args: 'none' }],
      'no-redeclare': ['error', { builtinGlobals: false }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node }
  }
];
