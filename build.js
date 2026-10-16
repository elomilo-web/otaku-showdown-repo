// Bundles the game into src/template.html.
//   dist/otaku-showdown.html -> the page content that gets published (the host adds the document skeleton)
//   dist/preview.html        -> same page inside a skeleton like the host's, for local browser tests
//   dist/index.html          -> the same standalone page, ready to upload to a web host
// File order and the sets/ folder scan live in manifest.js.
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest.js');

const root = __dirname;
const js = manifest.readAll([...manifest.engineFiles(), ...manifest.uiFiles()]);
if (js.includes('</script')) throw new Error('script contains </script');

const html = fs.readFileSync(path.join(root, 'src', 'template.html'), 'utf8').replace('/*__SCRIPTS__*/', () => js);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'otaku-showdown.html'), html);

const skeleton = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px system-ui,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style></head><body>${html}</body></html>`;
fs.writeFileSync(path.join(root, 'dist', 'preview.html'), skeleton);
fs.writeFileSync(path.join(root, 'dist', 'index.html'), skeleton);   // standalone page for any web host (GitHub Pages, Netlify, nginx)
fs.rmSync(path.join(root, 'dist', 'trope-clash.html'), { force: true });
console.log('built', (html.length / 1024).toFixed(1) + ' KB');
