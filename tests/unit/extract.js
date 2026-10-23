// Extrae funciones top-level/anidadas por nombre desde los .js del CRM (no son
// módulos) para probar el código real, no una copia.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function skipQuoted(s, j, q) {
  for (let k = j + 1; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (q === '`' && s[k] === '$' && s[k + 1] === '{') {
      // interpolación: saltar hasta la llave que la cierra
      let d = 1; k += 2;
      for (; k < s.length && d > 0; k++) {
        if (s[k] === '"' || s[k] === "'" || s[k] === '`') k = skipQuoted(s, k, s[k]);
        else if (s[k] === '{') d++;
        else if (s[k] === '}') d--;
      }
      k--;
      continue;
    }
    if (s[k] === q) return k;
  }
  return s.length;
}

function skipRegex(s, j) {
  let inClass = false;
  for (let k = j + 1; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '[') inClass = true;
    else if (s[k] === ']') inClass = false;
    else if (s[k] === '/' && !inClass) return k;
  }
  return s.length;
}

function extractFunction(source, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(source);
  if (!m) throw new Error('No se encontró la función ' + name);
  const i = source.indexOf('{', m.index);
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipQuoted(source, j, c);
    } else if (c === '/' && source[j + 1] === '/') {
      j = source.indexOf('\n', j);
    } else if (c === '/' && source[j + 1] === '*') {
      j = source.indexOf('*/', j) + 1;
    } else if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]\s*$|^\s*$|return\s*$/.test(source.slice(Math.max(0, j - 12), j))) {
      j = skipRegex(source, j);
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(m.index, j + 1);
    }
  }
  throw new Error('Función sin cerrar: ' + name);
}

function load(file, names, globals) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const code = names.map((n) => extractFunction(src, n)).join('\n') +
    '\n;({' + names.join(',') + '})';
  return vm.runInNewContext(code, Object.assign({ console }, globals || {}));
}

module.exports = { load, extractFunction, ROOT };
