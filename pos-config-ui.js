/* ═══════════════════════════════════════════════════════════════════
   pos-config-ui.js — Ajustes → Empresa: redes sociales y configuración del POS
   Se monta en #redesMount y #posCfgMount (perfil.js). Lee/escribe
   Organizations.redes_sociales y Organizations.pos_config (el servidor valida).
   Los valores por defecto vienen de PosCalc.CFG_DEFAULTS (= pos_cfg_defaults() en SQL).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';
    const esc = s => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const D = () => (root.PosCalc && root.PosCalc.CFG_DEFAULTS) || {};

    const REDES = [
        ['facebook', 'Facebook', 'facebook.com/miempresa'],
        ['instagram', 'Instagram', '@miempresa'],
        ['tiktok', 'TikTok', '@miempresa'],
        ['whatsapp', 'WhatsApp', '+502 5555-1234'],
        ['x', 'X (Twitter)', '@miempresa'],
        ['youtube', 'YouTube', 'youtube.com/@miempresa']
    ];

    // t: num | sel | bool | text | area | list | nums
    const GRUPOS = [
        ['Ventas', [
            { k: 'descuento_max_default', t: 'num', min: 0, max: 100, step: 1, label: 'Descuento máximo por defecto (%)', desc: 'Tope para usuarios con permiso de descuento que no tienen un máximo propio (Usuarios → Permisos del POS)' },
            { k: 'vender_sin_stock', t: 'sel', label: 'Vender sin existencias', desc: 'Qué hacer cuando el inventario no alcanza', opts: [['no', 'No permitir'], ['permiso', 'Solo usuarios con permiso «sin_stock»'], ['si', 'Permitir a todos']] },
            { k: 'stock_bajo_umbral', t: 'num', min: 0, max: 100000, step: 1, label: 'Aviso de stock bajo (unidades)', desc: 'Avisa al cajero cuando al vender quedan N o menos. 0 = sin aviso' },
            { k: 'nit_obligatorio_desde', t: 'num', min: 0, max: 100000000, step: 0.01, label: 'NIT obligatorio desde (Q)', desc: 'Ventas de este monto o más no pueden ir a Consumidor Final. 0 = nunca' },
            { k: 'propina_habilitada', t: 'bool', label: 'Permitir propina', desc: 'Línea opcional al cobrar (no es parte del total gravado). La propina queda registrada en la venta' },
            { k: 'propina_sugeridas', t: 'nums', label: 'Porcentajes de propina sugeridos', desc: 'Separados por coma. Ej. 10, 15' }
        ]],
        ['Métodos de pago', [
            { k: 'metodos_habilitados', t: 'metodos', label: 'Métodos habilitados y nombre que ve el cajero', desc: 'Al menos uno. El nombre solo cambia lo que se muestra' }
        ]],
        ['Caja y turnos', [
            { k: 'caja_obligatoria', t: 'sel', label: 'Caja abierta para cobrar', desc: 'Automático: según el plan (Starter no usa turnos)', opts: [['auto', 'Automático según el plan'], ['si', 'Siempre obligatoria'], ['no', 'Nunca obligatoria']] },
            { k: 'redondeo_efectivo', t: 'sel', label: 'Redondeo de efectivo', desc: 'Al múltiplo más cercano, solo sobre la parte pagada en efectivo', opts: [['0', 'Sin redondeo'], ['0.05', 'Q 0.05'], ['0.1', 'Q 0.10'], ['0.25', 'Q 0.25'], ['0.5', 'Q 0.50'], ['1', 'Q 1.00']] },
            { k: 'tolerancia_cuadre', t: 'num', min: 0, max: 100000000, step: 0.01, label: 'Tolerancia de cuadre (Q)', desc: 'Diferencias de hasta este monto no exigen explicación al cerrar' },
            { k: 'cuadre_max_sin_supervisor', t: 'num', min: 0, max: 100000000, step: 0.01, label: 'Diferencia máxima sin supervisor (Q)', desc: 'Si la diferencia es mayor, solo un administrador o gerente puede cerrar. 0 = sin límite' },
            { k: 'efectivo_max_caja', t: 'num', min: 0, max: 100000000, step: 1, label: 'Efectivo máximo en caja (Q)', desc: 'Muestra una alerta para hacer un retiro de seguridad. 0 = sin aviso' },
            { k: 'turno_horas_max', t: 'num', min: 0, max: 168, step: 1, label: 'Horas máximas de un turno', desc: 'Recordatorio para cerrar el turno. 0 = sin límite. (El cierre nunca es automático: requiere contar el efectivo)' },
            { k: 'turno_bloquear', t: 'bool', label: 'Bloquear ventas con el turno vencido', desc: 'Obliga a cerrar y abrir un turno nuevo' }
        ]],
        ['Devoluciones', [
            { k: 'plazo_devolucion_dias', t: 'num', min: 0, max: 3650, step: 1, label: 'Plazo para devoluciones (días)', desc: 'Pasado el plazo solo un administrador puede autorizar. 0 = sin plazo' },
            { k: 'motivos_devolucion', t: 'list', label: 'Motivos de devolución (uno por línea)', desc: 'El cajero elige de esta lista. Vacío = texto libre' },
            { k: 'motivos_sin_reingreso', t: 'list', label: 'Motivos que NO reingresan al inventario', desc: 'Para estos motivos el reingreso viene desmarcado (el cajero puede cambiarlo)' }
        ]],
        ['Comprobante', [
            { k: 'ancho_papel', t: 'sel', label: 'Ancho de papel', desc: 'Impresora térmica', opts: [['80', '80 mm'], ['58', '58 mm']] },
            { k: 'ticket_encabezado', t: 'area', label: 'Encabezado adicional', desc: 'Texto bajo los datos de la empresa (horario, sucursal, leyenda). El pie ya se configura arriba («Pie de ticket POS»)' },
            { k: 'mostrar_sku', t: 'bool', label: 'Mostrar SKU de cada artículo', desc: '' },
            { k: 'mostrar_cajero', t: 'bool', label: 'Mostrar cajero', desc: '' },
            { k: 'mostrar_turno', t: 'bool', label: 'Mostrar número de turno', desc: '' },
            { k: 'mostrar_iva', t: 'bool', label: 'Mostrar desglose de IVA', desc: '' },
            { k: 'mostrar_redes', t: 'bool', label: 'Mostrar redes sociales', desc: 'Las que llene en «Redes sociales» de esta misma pantalla' },
            { k: 'mostrar_qr', t: 'bool', label: 'Mostrar código QR con el número de venta', desc: 'Para ubicar la venta rápido en devoluciones y consultas' },
            { k: 'ticket_autoimprimir', t: 'bool', label: 'Imprimir automáticamente al cobrar', desc: 'Abre el diálogo de impresión al registrar la venta' },
            { k: 'ticket_copias', t: 'sel', label: 'Copias a imprimir', desc: 'Original para el cliente y copia para caja', opts: [['1', '1 (solo cliente)'], ['2', '2 (cliente + caja)'], ['3', '3']] }
        ]]
    ];

    function row(f, v) {
        const id = 'posc_' + f.k, lbl = `<div class="ajustes-row-label"><div class="ajustes-row-name">${esc(f.label)}</div>${f.desc ? `<div class="ajustes-row-desc">${esc(f.desc)}</div>` : ''}</div>`;
        if (f.t === 'bool') return `<div class="ajustes-row ajustes-row-toggle">${lbl}<label class="switch ${v ? 'on' : ''}"><input type="checkbox" id="${id}" ${v ? 'checked' : ''} onchange="this.closest('label').classList.toggle('on', this.checked)"/><span class="knob"></span></label></div>`;
        if (f.t === 'num') return `<div class="ajustes-row">${lbl}<div class="ajustes-row-control" style="max-width:160px"><input class="form-input" id="${id}" type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}"/></div></div>`;
        if (f.t === 'sel') return `<div class="ajustes-row">${lbl}<div class="ajustes-row-control" style="max-width:280px"><select class="form-select" id="${id}">${f.opts.map(o => `<option value="${esc(o[0])}" ${String(v) === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div></div>`;
        if (f.t === 'area') return `<div class="ajustes-row" style="align-items:flex-start">${lbl}<div class="ajustes-row-control"><textarea class="form-input" id="${id}" rows="2" maxlength="300" style="resize:vertical">${esc(v)}</textarea></div></div>`;
        if (f.t === 'list') return `<div class="ajustes-row" style="align-items:flex-start">${lbl}<div class="ajustes-row-control"><textarea class="form-input" id="${id}" rows="4" style="resize:vertical">${esc((v || []).join('\n'))}</textarea></div></div>`;
        if (f.t === 'nums') return `<div class="ajustes-row">${lbl}<div class="ajustes-row-control" style="max-width:220px"><input class="form-input" id="${id}" value="${esc((v || []).join(', '))}" placeholder="10, 15"/></div></div>`;
        if (f.t === 'metodos') {
            const cfg = v || {};
            return `<div class="ajustes-row" style="align-items:flex-start">${lbl}<div class="ajustes-row-control" style="display:flex;flex-direction:column;gap:6px">
                ${['Efectivo', 'Tarjeta', 'Transferencia'].map(m => `<label style="display:flex;align-items:center;gap:8px;font-size:13px">
                    <input type="checkbox" id="posc_met_${m}" ${(cfg.habilitados || []).indexOf(m) >= 0 ? 'checked' : ''}/> <span style="width:100px">${m}</span>
                    <input class="form-input" id="posc_lbl_${m}" maxlength="30" placeholder="Nombre (opcional)" value="${esc((cfg.etiquetas || {})[m] || '')}" style="flex:1"/></label>`).join('')}
            </div></div>`;
        }
        return '';
    }

    function mount() {
        const r = document.getElementById('redesMount');
        if (r && !r.dataset.listo) {
            r.dataset.listo = '1';
            r.innerHTML = REDES.map(x => `<div class="ajustes-row"><div class="ajustes-row-label"><div class="ajustes-row-name">${x[1]}</div><div class="ajustes-row-desc">${x[0] === 'whatsapp' ? 'Número con código de país' : 'Usuario o enlace'}</div></div>
                <div class="ajustes-row-control"><input class="form-input" id="posr_${x[0]}" maxlength="120" placeholder="${esc(x[2])}"/></div></div>`).join('');
        }
        const p = document.getElementById('posCfgMount');
        if (p && !p.dataset.listo) {
            p.dataset.listo = '1';
            const d = D();
            p.innerHTML = `<div class="ajustes-row" style="flex-direction:column;align-items:flex-start;gap:4px;border-top:1px solid var(--border);padding-top:18px;margin-top:10px">
                    <div class="ajustes-row-name" style="font-size:14px;font-weight:700">Punto de Venta</div>
                    <div class="ajustes-row-desc">Reglas y formato del POS de esta empresa. El servidor las aplica en cada venta, devolución y cierre.</div></div>` +
                GRUPOS.map(g => `<div class="ajustes-row" style="padding-bottom:0"><div class="ajustes-row-name" style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted)">${g[0]}</div></div>` +
                    g[1].map(f => row(f, f.t === 'metodos' ? { habilitados: d.metodos_habilitados, etiquetas: {} } : d[f.k])).join('')).join('');
        }
    }

    /** Rellena el formulario con lo guardado (mezclado con los valores por defecto). */
    function fill(data) {
        mount();
        const d = Object.assign({}, D(), (data && data.pos_config) || {});
        const redes = (data && data.redes_sociales) || {};
        REDES.forEach(x => { const el = document.getElementById('posr_' + x[0]); if (el) el.value = redes[x[0]] || ''; });
        GRUPOS.forEach(g => g[1].forEach(f => {
            if (f.t === 'metodos') {
                ['Efectivo', 'Tarjeta', 'Transferencia'].forEach(m => {
                    const c = document.getElementById('posc_met_' + m); if (c) c.checked = (d.metodos_habilitados || []).indexOf(m) >= 0;
                    const l = document.getElementById('posc_lbl_' + m); if (l) l.value = (d.etiquetas_metodos || {})[m] || '';
                });
                return;
            }
            const el = document.getElementById('posc_' + f.k); if (!el) return;
            const v = d[f.k];
            if (f.t === 'bool') { el.checked = !!v; const lb = el.closest('label'); if (lb) lb.classList.toggle('on', !!v); }
            else if (f.t === 'list') el.value = (v || []).join('\n');
            else if (f.t === 'nums') el.value = (v || []).join(', ');
            else el.value = v === undefined || v === null ? '' : v;
        }));
    }

    /** Devuelve { redes_sociales, pos_config } listo para guardar (o {} si el formulario no está montado). */
    function read() {
        if (!document.getElementById('posCfgMount') || !document.getElementById('posCfgMount').dataset.listo) return {};
        const redes = {};
        REDES.forEach(x => { const el = document.getElementById('posr_' + x[0]); if (el && el.value.trim()) redes[x[0]] = el.value.trim(); });
        const cfg = {};
        GRUPOS.forEach(g => g[1].forEach(f => {
            if (f.t === 'metodos') {
                cfg.metodos_habilitados = ['Efectivo', 'Tarjeta', 'Transferencia'].filter(m => { const c = document.getElementById('posc_met_' + m); return c && c.checked; });
                cfg.etiquetas_metodos = {};
                ['Efectivo', 'Tarjeta', 'Transferencia'].forEach(m => { const l = document.getElementById('posc_lbl_' + m); if (l && l.value.trim()) cfg.etiquetas_metodos[m] = l.value.trim(); });
                return;
            }
            const el = document.getElementById('posc_' + f.k); if (!el) return;
            if (f.t === 'bool') cfg[f.k] = !!el.checked;
            else if (f.t === 'num') cfg[f.k] = el.value === '' ? D()[f.k] : Number(el.value);
            else if (f.t === 'sel') cfg[f.k] = (typeof D()[f.k] === 'number') ? Number(el.value) : el.value;
            else if (f.t === 'list') cfg[f.k] = el.value.split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean);
            else if (f.t === 'nums') cfg[f.k] = el.value.split(',').map(x => x.trim()).filter(Boolean).map(Number).filter(n => isFinite(n));
            else cfg[f.k] = el.value;
        }));
        return { redes_sociales: redes, pos_config: cfg };
    }

    root.PosCfgUI = { mount: mount, fill: fill, read: read, REDES: REDES, GRUPOS: GRUPOS };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.PosCfgUI;
})(typeof window !== 'undefined' ? window : globalThis);
