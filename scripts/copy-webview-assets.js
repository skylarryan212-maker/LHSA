const fs = require('fs');
const path = require('path');

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return false;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

const repoRoot = path.resolve(__dirname, '..');
const katexFonts = path.join(repoRoot, 'node_modules', 'katex', 'dist', 'fonts');
const outFonts = path.join(repoRoot, 'dist', 'fonts');

if (!fs.existsSync(katexFonts)) {
  console.warn('katex fonts not found at', katexFonts);
  process.exit(0);
}

copyDir(katexFonts, outFonts);
console.log('Copied KaTeX fonts to', outFonts);