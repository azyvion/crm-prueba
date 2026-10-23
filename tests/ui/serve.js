// Servidor estático mínimo para el arnés de pruebas de la interfaz (sin dependencias).
// Uso: node tests/ui/serve.js [puerto]   →   http://localhost:4173/tests/ui/pos_harness.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
}).listen(Number(process.argv[2]) || 4173, '127.0.0.1', () => console.log('POS harness en http://localhost:' + (Number(process.argv[2]) || 4173) + '/tests/ui/pos_harness.html'));
