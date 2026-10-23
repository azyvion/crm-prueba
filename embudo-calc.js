/* ═══════════════════════════════════════════════════════════════════
   embudo-calc.js — Cálculos puros del embudo de ventas (sin DOM ni red) · Azyvion CRM
   Mismas reglas que supabase/migrations/20261023_10_embudo_ventas.sql: «Ganado» y «Perdido»
   son etapas cerradas (probabilidad 100 / 0); el resto son oportunidades abiertas.
   Se carga antes de prospectos.js y también se puede requerir desde Node (pruebas).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';

    const ETAPAS_ABIERTAS = ['Nuevo', 'Contactado', 'Calificado', 'Propuesta', 'Negociación'];
    const ETAPAS_CERRADAS = ['Ganado', 'Perdido'];
    // Probabilidad sugerida al cambiar de etapa (el vendedor la puede ajustar en etapas abiertas)
    const PROB_ETAPA = { 'Nuevo': 10, 'Contactado': 20, 'Calificado': 40, 'Propuesta': 60, 'Negociación': 80, 'Ganado': 100, 'Perdido': 0 };
    const MOTIVOS_PERDIDA = ['Precio', 'Eligió a la competencia', 'Sin presupuesto', 'Sin respuesta', 'No era el momento',
        'No necesitaba el producto', 'No calificaba', 'Otro'];
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    const num = n => { const v = Number(n); return isFinite(v) ? v : 0; };
    const esAbierto = p => ETAPAS_ABIERTAS.indexOf(p && p.etapa) >= 0;
    const ponderado = p => num(p.valorEstimado) * Math.max(0, Math.min(100, num(p.probabilidad))) / 100;
    const pad = n => (n < 10 ? '0' : '') + n;
    // Clave de mes «AAAA-MM» en hora local. Una fecha «AAAA-MM-DD» (columna date) se toma tal cual,
    // sin pasar por Date, para que no cambie de mes por la zona horaria.
    function claveMes(f) {
        if (!f) return '';
        if (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f)) return f.slice(0, 7);
        const d = f instanceof Date ? f : new Date(f);
        return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1);
    }
    function claveDia(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function etiquetaMes(clave) { const [a, m] = clave.split('-'); return MESES[Number(m) - 1] + ' ' + a; }
    function sumar(lista) {
        return lista.reduce((o, p) => { o.n++; o.valor += num(p.valorEstimado); o.ponderado += ponderado(p); return o; },
            { n: 0, valor: 0, ponderado: 0 });
    }

    /** Probabilidad que se fija al elegir una etapa (null si la etapa no se conoce). */
    function probSugerida(etapa) { return Object.prototype.hasOwnProperty.call(PROB_ETAPA, etapa) ? PROB_ETAPA[etapa] : null; }

    /** Resumen por etapa: cantidad, valor, ponderado y probabilidad promedio. */
    function porEtapa(pros) {
        return ETAPAS_ABIERTAS.concat(ETAPAS_CERRADAS).map(etapa => {
            const g = (pros || []).filter(p => p.etapa === etapa);
            const s = sumar(g);
            s.etapa = etapa;
            s.probPromedio = g.length ? Math.round(g.reduce((t, p) => t + num(p.probabilidad), 0) / g.length) : PROB_ETAPA[etapa];
            return s;
        });
    }

    /**
     * Pronóstico por mes de cierre estimado de las oportunidades abiertas, desde el mes de `hoy`
     * y `meses` meses en total. Las vencidas (fecha < hoy), sin fecha o posteriores van aparte para
     * que nada se cuente dos veces ni se pierda. «ganado» = lo cerrado como Ganado en ese mes.
     */
    function pronostico(pros, hoy, meses) {
        hoy = hoy || new Date(); meses = meses || 6;
        const claves = [];
        for (let i = 0; i < meses; i++) claves.push(claveMes(new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)));
        const hoyDia = claveDia(hoy);
        const abiertos = (pros || []).filter(esAbierto);
        const filas = claves.map(k => ({ clave: k, etiqueta: etiquetaMes(k), n: 0, valor: 0, ponderado: 0, ganado: 0, nGanado: 0 }));
        const idx = {}; claves.forEach((k, i) => { idx[k] = i; });
        const vencidos = [], sinFecha = [], posteriores = [];
        abiertos.forEach(p => {
            const f = p.fecha_cierre_estimada;
            if (!f) { sinFecha.push(p); return; }
            if (String(f).slice(0, 10) < hoyDia) { vencidos.push(p); return; }
            const i = idx[claveMes(f)];
            if (i === undefined) { posteriores.push(p); return; }
            filas[i].n++; filas[i].valor += num(p.valorEstimado); filas[i].ponderado += ponderado(p);
        });
        (pros || []).forEach(p => {
            if (p.etapa !== 'Ganado' || !p.cerrado_en) return;
            const i = idx[claveMes(p.cerrado_en)];
            if (i !== undefined) { filas[i].ganado += num(p.valorEstimado); filas[i].nGanado++; }
        });
        return { meses: filas, vencidos: sumar(vencidos), sinFecha: sumar(sinFecha), posteriores: sumar(posteriores), abiertos: sumar(abiertos) };
    }

    /** Tasa de cierre de los últimos `dias` días (según la fecha de cierre registrada). */
    function tasaCierre(pros, hoy, dias) {
        hoy = hoy || new Date(); dias = dias || 90;
        const desde = hoy.getTime() - dias * 86400000;
        let ganados = 0, perdidos = 0, valorGanado = 0;
        (pros || []).forEach(p => {
            if (!p.cerrado_en) return;
            const t = new Date(p.cerrado_en).getTime();
            if (isNaN(t) || t < desde || t > hoy.getTime()) return;
            if (p.etapa === 'Ganado') { ganados++; valorGanado += num(p.valorEstimado); }
            else if (p.etapa === 'Perdido') perdidos++;
        });
        const total = ganados + perdidos;
        return { ganados, perdidos, valorGanado, tasa: total ? Math.round(ganados / total * 100) : null };
    }

    /**
     * Motivos de pérdida de los últimos `dias` días, de mayor a menor cantidad. Los perdidos sin
     * motivo (anteriores al Lote 8) se cuentan aparte en `sinMotivo` (todo el historial).
     */
    function motivosPerdida(pros, hoy, dias) {
        hoy = hoy || new Date(); dias = dias || 90;
        const desde = hoy.getTime() - dias * 86400000;
        const m = {}; let total = 0, sinMotivo = 0;
        (pros || []).forEach(p => {
            if (p.etapa !== 'Perdido') return;
            if (!p.motivo_perdida) { sinMotivo++; return; }
            const t = new Date(p.cerrado_en).getTime();
            if (isNaN(t) || t < desde) return;
            const k = p.motivo_perdida;
            m[k] = m[k] || { motivo: k, n: 0, valor: 0 };
            m[k].n++; m[k].valor += num(p.valorEstimado); total++;
        });
        const lista = Object.keys(m).map(k => m[k]).sort((a, b) => b.n - a.n || b.valor - a.valor || a.motivo.localeCompare(b.motivo, 'es'));
        lista.forEach(x => { x.pct = total ? Math.round(x.n / total * 100) : 0; });
        return { lista, total, sinMotivo };
    }

    /** ¿La fecha estimada de cierre de una oportunidad abierta ya pasó? */
    function estaVencido(p, hoy) {
        return esAbierto(p) && !!p.fecha_cierre_estimada && String(p.fecha_cierre_estimada).slice(0, 10) < claveDia(hoy || new Date());
    }

    /** Valida el formulario antes de enviarlo; devuelve el mensaje de error o ''. */
    function validar(d) {
        if (ETAPAS_ABIERTAS.indexOf(d.etapa) < 0 && ETAPAS_CERRADAS.indexOf(d.etapa) < 0) return 'Etapa inválida';
        const prob = Number(d.probabilidad);
        if (d.probabilidad === '' || !isFinite(prob) || prob < 0 || prob > 100) return 'La probabilidad debe estar entre 0 y 100';
        const valor = Number(d.valorEstimado || 0);
        if (!isFinite(valor) || valor < 0) return 'El valor estimado no puede ser negativo';
        if (d.etapa === 'Perdido' && !String(d.motivo_perdida || '').trim()) return 'Indique el motivo de pérdida';
        if (d.fecha_cierre_estimada && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha_cierre_estimada)) return 'Fecha de cierre inválida';
        return '';
    }

    const api = { ETAPAS_ABIERTAS, ETAPAS_CERRADAS, PROB_ETAPA, MOTIVOS_PERDIDA, esAbierto, ponderado, claveMes, etiquetaMes,
        probSugerida, porEtapa, pronostico, tasaCierre, motivosPerdida, estaVencido, validar };
    root.EmbudoCalc = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
