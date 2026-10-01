/* ═══════════════════════════════════════════════════════
   utils.js — Funciones helper globales
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

/* ── UUID (IDs de negocio: Clientes, Cotizaciones, etc.) ── */
function _uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
}

/* ── Estado de ítem de inventario ── */
function _estadoItem(tipo, unidades, stockMax) {
    if (tipo === 'Servicio') return 'Servicio';
    const u = Number(unidades)||0, m = Number(stockMax)||1;
    return u <= m*0.1 ? 'Crítico' : u <= m*0.3 ? 'Bajo' : 'Normal';
}

/* ═══════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════ */
let _toastTimer;
function showToast(msg, color) {
    color = color || '#30D158';
    const t = document.getElementById('toast');
    const icon = color === '#FF453A'
        ? '<svg viewBox="0 0 24 24" style="stroke:#FF453A"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : color === '#FF9F0A'
            ? '<svg viewBox="0 0 24 24" style="stroke:#FF9F0A"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
            : `<svg viewBox="0 0 24 24" style="stroke:${color}"><polyline points="20 6 9 17 4 12"/></svg>`;
    t.innerHTML = icon + ' ' + escHtml(msg);
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ═══════════════════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════════════════ */
function v(id) {const el = document.getElementById(id); return el ? el.value : '';}
function valOf(id) {const el = document.getElementById(id); return el ? el.value : '';}
function escHtml(s) {return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');}
function escAttr(s) {return escHtml(s).replace(/'/g, '&#39;');}
function initials(n) {return (n || '').split(' ').map(w => w[0] || '').join('').substring(0, 2).toUpperCase();}

function fechaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString('es-GT');
}

/* Exporta a CSV con BOM para que Excel respete los acentos */
function descargarCSV(filas, nombreBase) {
    if (!filas.length) {showToast('No hay datos para exportar', '#FF9F0A'); return;}
    const cols = Object.keys(filas[0]);
    const esc = val => {
        const s = val === null || val === undefined ? '' : String(val);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [cols.join(',')]
        .concat(filas.map(f => cols.map(c => esc(f[c])).join(',')))
        .join('\r\n');

    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `azyvion_${nombreBase}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`${filas.length} registros exportados`, '#30D158');
}

function tagEstado(e) {
    const m = {Activo: 'tag-success', Pendiente: 'tag-warning', Inactivo: 'tag-danger'};
    return `<span class="tag ${m[e] || 'tag-gray'}">${e}</span>`;
}
function tagEtapa(e) {
    const m = {
        'Nuevo': 'tag-nuevo', 'Contactado': 'tag-contactado', 'Calificado': 'tag-calificado',
        'Propuesta': 'tag-propuesta', 'Negociación': 'tag-negociacion', 'Perdido': 'tag-perdido'
    };
    return `<span class="tag ${m[e] || 'tag-gray'}">${escHtml(e) || '—'}</span>`;
}
function tagSegmento(s) {
    const m = {Corporativo: 'tag-accent', Premium: 'tag-purple', Estándar: 'tag-gray'};
    return `<span class="tag ${m[s] || 'tag-gray'}">${s}</span>`;
}
// Tag de categoría: colores rotativos automáticos basados en el nombre
const _catColorCache = {};
const _catColors = ['tag-accent','tag-purple','tag-success','tag-warning','tag-danger','tag-gray'];
function tagCat(c) {
    if (!_catColorCache[c]) {
        const keys = Object.keys(_catColorCache);
        _catColorCache[c] = _catColors[keys.length % _catColors.length];
    }
    return `<span class="tag ${_catColorCache[c]}">${escHtml(c||'—')}</span>`;
}
function tagEstadoInv(e) {
    const m = {Crítico: 'tag-danger', Bajo: 'tag-warning', Normal: 'tag-success'};
    return `<span class="tag ${m[e] || 'tag-gray'}">${e}</span>`;
}

function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60) return 'Hace ' + Math.round(diff) + ' seg';
    if (diff < 3600) return 'Hace ' + Math.round(diff / 60) + ' min';
    if (diff < 86400) return 'Hace ' + Math.round(diff / 3600) + ' h';
    if (diff < 604800) return 'Hace ' + Math.round(diff / 86400) + ' días';
    return new Date(iso).toLocaleDateString('es-GT');
}
