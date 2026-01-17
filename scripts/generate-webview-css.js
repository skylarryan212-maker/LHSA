const fs = require('fs');
const path = require('path');

const distCss = path.resolve(__dirname, '..', 'dist', 'webview.css');
const outTs = path.resolve(__dirname, '..', 'src', 'webview.css.ts');

if (!fs.existsSync(distCss)) {
  console.error('Missing built CSS:', distCss);
  process.exit(1);
}

const css = fs.readFileSync(distCss, 'utf8');
const content = `// generated file — do not edit\nexport default ${JSON.stringify(css)};\n`;
fs.writeFileSync(outTs, content);
console.log('Wrote', outTs);
