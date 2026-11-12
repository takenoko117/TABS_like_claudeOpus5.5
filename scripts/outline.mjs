#!/usr/bin/env node
// ソースファイルの目次（クラス・関数・メソッド・export 定数と行番号）を出すスクリプト。
// 巨大なファイルを全部読まずに、読むべき行の範囲を知るために使う。
//
// 使い方:
//   npm run outline -- src/game/GameApp.ts            目次を表示
//   npm run outline -- src/game/GameApp.ts rogue      名前に "rogue" を含む行だけ（大文字小文字は区別しない）
//   npm run outline -- src/style.css                  CSS は行頭のコメント見出しを表示
//   npm run outline -- src/game src/ui                フォルダを渡すと、中のファイルと行数の一覧
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('使い方: npm run outline -- <ファイルまたはフォルダ...> [絞り込む文字列]');
  process.exit(1);
}

// 最後の引数が存在しないパスなら、絞り込み文字列として扱う
let filter = null;
const last = args[args.length - 1];
try {
  statSync(last);
} catch {
  filter = last.toLowerCase();
  args.pop();
}

const TOP_DECL = /^(export\s+)?(default\s+)?(abstract\s+)?(declare\s+)?(class|interface|type|enum|function|async\s+function)\s+[\w$]+/;
const EXPORT_CONST = /^export\s+(const|let)\s+[\w$]+/;
const METHOD =
  /^ {2}(?:(?:private|public|protected|static|readonly|async|override|abstract|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\(/;
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'function', 'super', 'new']);

// 末尾の改行は 1 行と数えない（エディタの行数に合わせる）
function readLines(path) {
  return readFileSync(path, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
}

function lineCount(path) {
  return readLines(path).length;
}

function listDir(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listDir(p));
    else if (['.ts', '.css', '.html', '.mjs'].includes(extname(p))) out.push(p);
  }
  return out;
}

function short(text) {
  const t = text.trim().replace(/\s*\{\s*$/, '');
  return t.length > 110 ? `${t.slice(0, 107)}...` : t;
}

function outlineCss(lines) {
  const rows = [];
  lines.forEach((l, i) => {
    if (/^\/\*/.test(l)) {
      // 区切り線だけの行は、次の行の見出しを拾う
      const text = /^\/\*\s*[=-]{5,}/.test(l) ? (lines[i + 1] ?? '').trim() : l;
      rows.push({ line: i + 1, text: short(text.replace(/\*\/\s*$/, '')), indent: 0 });
    }
  });
  return rows;
}

function outlineTs(lines) {
  const rows = [];
  let current = null; // 今いるトップレベルのクラス
  lines.forEach((l, i) => {
    if (/^\}/.test(l) && current) {
      current.row.text += `  (〜L${i + 1})`;
      current = null;
      return;
    }
    if (TOP_DECL.test(l) || EXPORT_CONST.test(l)) {
      const row = { line: i + 1, text: short(l), indent: 0 };
      rows.push(row);
      if (/\bclass\s/.test(l) && !/\}\s*;?\s*$/.test(l)) current = { row };
      return;
    }
    if (current) {
      const m = METHOD.exec(l);
      if (m && !NOT_METHOD.has(m[1])) rows.push({ line: i + 1, text: short(l), indent: 1 });
    }
  });
  return rows;
}

for (const arg of args) {
  if (statSync(arg).isDirectory()) {
    const files = listDir(arg).map((p) => ({ p, n: lineCount(p) }));
    for (const { p, n } of files) {
      if (filter && !p.toLowerCase().includes(filter)) continue;
      console.log(`${String(n).padStart(6)}  ${relative('.', p).replaceAll('\\', '/')}`);
    }
    continue;
  }
  const lines = readLines(arg);
  const rows = extname(arg) === '.css' ? outlineCss(lines) : outlineTs(lines);
  console.log(`=== ${arg.replaceAll('\\', '/')} (${lines.length} 行)`);
  for (const r of rows) {
    if (filter && !r.text.toLowerCase().includes(filter)) continue;
    console.log(`${String(r.line).padStart(6)}  ${'  '.repeat(r.indent)}${r.text}`);
  }
}
