// 打包成单个 HTML 文件（dist/rogueaim.html），无需服务器，双击即可在浏览器里玩。
// 用法：node tools/build-single.mjs   （会通过 npx 调用 esbuild）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const js = execFileSync('npx', ['--yes', 'esbuild@0.24.0', 'src/main.js', '--bundle', '--format=iife', '--minify', '--legal-comments=none'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const css = readFileSync('style.css', 'utf8');
let html = readFileSync('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () =>
  `<!-- three.js r169, MIT License, Copyright 2010-2024 Three.js Authors -->\n  <script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
writeFileSync('dist/rogueaim.html', html);
console.log(`dist/rogueaim.html ${(html.length / 1024).toFixed(0)} KB`);
