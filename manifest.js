// Which source files make up the game, in load order. Sets are picked up automatically from src/sets/.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'src');

exports.engineFiles = () => [
  'core.js', 'engine.js', 'builtins.js',
  ...fs.readdirSync(path.join(src, 'sets')).filter(f => f.endsWith('.js')).sort().map(f => 'sets/' + f),
  'ai.js'
];
exports.uiFiles = () => ['store.js', 'duel.js', 'online.js', 'editor.js', 'main.js'];
exports.readAll = files => files.map(f => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
