const fs = require('fs');
function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, c) { fs.writeFileSync(p, c); console.log('OK: ' + p); }

// 1. Fix useSpecBuilder.ts - import statusMeta + add computations + add return values
let f = read('components/spec-builder/hooks/useSpecBuilder.ts');
f = f.replace(
  'exportCSV, SEED_ITEMS, FILE_CATS, guessMap, extOf',
  'exportCSV, SEED_ITEMS, FILE_CATS, guessMap, extOf, statusMeta'
);
write('components/spec-builder/hooks/useSpecBuilder.ts', f);