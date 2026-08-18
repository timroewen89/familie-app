/**
 * Unit-test voor de MD5-implementatie in js/picnic.js (nodig voor het
 * login-secret van de Picnic-API), vergeleken met Node's crypto.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(here, '..', '..', 'js', 'picnic.js'), 'utf8');
// Module in Node laden: alleen de top-level IIFE uitvoeren (raakt geen DOM).
src = src.replace('const Picnic =', 'globalThis.Picnic =');
eval(src);

const cases = ['test', 'wachtwoord123', 'héél gëheim!', '', 'a'.repeat(100), '🍕 pizza'];
for (const input of cases) {
  const expected = crypto.createHash('md5').update(input, 'utf8').digest('hex');
  const actual = globalThis.Picnic.md5(input);
  if (actual !== expected) {
    console.error(`FAAL: md5(${JSON.stringify(input)}) = ${actual}, verwacht ${expected}`);
    process.exit(1);
  }
  console.log('OK  ', JSON.stringify(input.slice(0, 20)));
}
console.log('MD5-TESTS GESLAAGD');
