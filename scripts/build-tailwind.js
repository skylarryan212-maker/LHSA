const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');

async function build() {
  const srcPath = path.join(__dirname, '..', 'src', 'styles', 'globals.css');
  const outPath = path.join(__dirname, '..', 'dist', 'webview.css');

  let css = fs.readFileSync(srcPath, 'utf8');

  // Replace Tailwind import with directives
  css = css.replace(/@import ['"]tailwindcss['"];?/g, '@tailwind base;\n@tailwind components;\n@tailwind utilities;');

  // Inline tw-animate-css if present
  try {
    const animPath = path.join(__dirname, '..', 'node_modules', 'tw-animate-css', 'dist', 'tw-animate.css');
    if (fs.existsSync(animPath)) {
      const animCss = fs.readFileSync(animPath, 'utf8');
      css = css.replace(/@import ['"]tw-animate-css['"];?/g, animCss);
    }
  } catch (err) {
    // ignore
  }

  // Run PostCSS with Tailwind plugin (uses tailwind.config.js)
  const result = await postcss([tailwind(path.join(process.cwd(), 'tailwind.config.js'))]).process(css, {
    from: srcPath,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.css, 'utf8');
  console.log('Wrote', outPath);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
