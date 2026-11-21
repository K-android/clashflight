import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const webIfcDir = path.dirname(
  fileURLToPath(import.meta.resolve('web-ifc'))
);

const destDir = path.resolve(rootDir, 'packages/app/public/wasm');
fs.mkdirSync(destDir, { recursive: true });

for (const file of fs.readdirSync(webIfcDir)) {
  if (file.endsWith('.wasm')) {
    fs.copyFileSync(path.join(webIfcDir, file), path.join(destDir, file));
    console.log(`Copied ${file} -> packages/app/public/wasm/${file}`);
  }
}
