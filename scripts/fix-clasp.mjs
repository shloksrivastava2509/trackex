// `clasp create --rootDir src` writes .clasp.json inside src/ with a rootDir that then
// points at src/src. Move it to the repo root and push Config.gs first.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

if (existsSync('src/.clasp.json')) {
  const config = JSON.parse(readFileSync('src/.clasp.json', 'utf8'));
  writeFileSync('.clasp.json', JSON.stringify({ ...config, rootDir: 'src', filePushOrder: ['src/Config.gs'] }, null, 2) + '\n');
  unlinkSync('src/.clasp.json');
  console.log('Moved src/.clasp.json → .clasp.json');
}
