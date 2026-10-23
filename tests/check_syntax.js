// Verifica la sintaxis de todos los .js y de los <script> inline de los .html.
// Uso: node tests/check_syntax.js   (sale con código 1 si hay errores)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'supabase', 'tests', 'azyvion-ai-main', 'docs']);
let checked = 0;
const errors = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) check(p, fs.readFileSync(p, 'utf8'));
    else if (e.name.endsWith('.html')) {
      const html = fs.readFileSync(p, 'utf8');
      const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
      let m, n = 0;
      while ((m = re.exec(html))) {
        const attrs = m[1] || '';
        if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(attrs)) continue;
        n++;
        const line = html.slice(0, m.index).split('\n').length;
        check(`${p}#script${n}@L${line}`, m[2], /type\s*=\s*["']?module/i.test(attrs));
      }
    }
  }
}

function check(name, src, isModule) {
  checked++;
  try {
    // Los <script type="module"> se validan envueltos en una función (sin import/export).
    new vm.Script(isModule ? `(async () => {\n${src.replace(/^\s*(import|export)\b.*$/gm, '')}\n})` : src, { filename: name });
  } catch (e) {
    errors.push(`${path.relative(ROOT, name)}: ${e.message}`);
  }
}

walk(ROOT);
if (errors.length) {
  console.error(`✖ ${errors.length} error(es) de sintaxis en ${checked} fuentes:\n` + errors.join('\n'));
  process.exit(1);
}
console.log(`✔ Sintaxis OK en ${checked} fuentes (.js y <script> inline).`);
