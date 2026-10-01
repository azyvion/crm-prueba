/* ═══════════════════════════════════════════════════════
   overview.js — Módulo de página de inicio (Overview)
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   DASHBOARD v2 — Saludo dinámico
════════════════════════════════════════════════════════════ */
window._ovGreeting = function _ovGreeting() {
    var h = new Date().getHours();
    var saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    var emoji  = h < 12 ? '🌤️' : h < 19 ? '☀️' : '🌙';
    var nombre = (window._usuario || '').split(' ')[0] || 'Usuario';
    var grEl   = document.getElementById('ovGreeting');
    var subEl  = document.getElementById('ovGreetingSub');
    if (grEl) grEl.textContent = saludo + ', ' + nombre + ' ' + emoji;
    if (subEl) {
        var now = new Date();
        var dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        var meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        subEl.textContent = dias[now.getDay()] + ', ' + now.getDate() + ' de ' + meses[now.getMonth()] + ' de ' + now.getFullYear();
    }
}

/* ════════════════════════════════════════════════════════════
   GRÁFICAS
════════════════════════════════════════════════════════════ */
var _charts = {};

function _chartDestroy(id) {
    if (_charts[id]) { try { _charts[id].destroy(); } catch(e){} delete _charts[id]; }
}

function _isDark() {
    return document.body.classList.contains('theme-dark');
}

function _chartColors() {
    return {
        text: _isDark() ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)',
        grid: _isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    };
}

/* Sparkline mini (línea simple) */
function _sparkline(canvasId, data, color) {
    var el = document.getElementById(canvasId);
    if (!el) return;
    _chartDestroy(canvasId);
    if (!data || data.length < 2) return;
    _charts[canvasId] = new Chart(el, {
        type: 'line',
        data: {
            labels: data.map(function(_,i){ return i; }),
            datasets: [{ data: data, borderColor: color, borderWidth: 2, tension: 0.4,
                fill: true,
                backgroundColor: color.replace('rgb','rgba').replace(')',',0.12)'),
                pointRadius: 0 }]
        },
        options: { responsive: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } } }
    });
}

/* Pipeline horizontal bars */
function renderChartPipeline(prospectos) {
    var el = document.getElementById('chartPipeline');
    if (!el) return;
    _chartDestroy('chartPipeline');
    var etapas = ['Nuevo','Contactado','Calificado','Propuesta','Negociación'];
    var counts = etapas.map(function(e){ return prospectos.filter(function(p){ return p.etapa===e; }).length; });
    var valores = etapas.map(function(e){ return prospectos.filter(function(p){ return p.etapa===e; }).reduce(function(s,p){ return s+Number(p.valorEstimado||0); }, 0); });
    var cc = _chartColors();
    _charts['chartPipeline'] = new Chart(el, {
        type: 'bar',
        data: {
            labels: etapas,
            datasets: [{
                label: 'Prospectos',
                data: counts,
                backgroundColor: ['#8E8E93','#0A84FF','#14B8A6','#BF5AF2','#FF9F0A'],
                borderRadius: 6, borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: function(ctx) {
                            return 'Q ' + (valores[ctx.dataIndex]||0).toLocaleString();
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { color: cc.text, font: {size:11} }, grid: { color: cc.grid }, beginAtZero: true },
                y: { ticks: { color: cc.text, font: {size:12} }, grid: { display: false } }
            }
        }
    });
    var total = prospectos.filter(function(p){ return p.etapa!=='Perdido'; }).length;
    var sub = document.getElementById('ov-pipeline-sub');
    if (sub) sub.textContent = total + ' oportunidades abiertas';
}

/* Cotizaciones donut */
function renderChartCotizaciones(cotizaciones) {
    var el = document.getElementById('chartCotizaciones');
    if (!el) return;
    _chartDestroy('chartCotizaciones');
    var estados = ['Borrador','Enviada','Aprobada','Rechazada'];
    var colores = ['#8E8E93','#0A84FF','#22C55E','#EF4444'];
    var counts  = estados.map(function(e){ return cotizaciones.filter(function(c){ return c.estado===e; }).length; });
    var sub = document.getElementById('ov-cot-sub');
    if (sub) {
        var ap = cotizaciones.filter(function(c){ return c.estado==='Aprobada'; });
        var env = cotizaciones.filter(function(c){ return ['Enviada','Aprobada','Rechazada'].includes(c.estado); });
        var tasa = env.length ? Math.round(ap.length/env.length*100) : 0;
        sub.textContent = tasa + '% conversión · ' + cotizaciones.length + ' total';
    }
    _charts['chartCotizaciones'] = new Chart(el, {
        type: 'doughnut',
        data: { labels: estados, datasets: [{ data: counts, backgroundColor: colores, borderWidth: 2,
            borderColor: _isDark() ? '#1F2024' : '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font:{size:11}, color: _chartColors().text, padding:8, boxWidth:12 } } }
        }
    });
}

/* Segmentos donut */
function renderChartSegmentos(clientes) {
    var el = document.getElementById('chartSegmentos');
    if (!el) return;
    _chartDestroy('chartSegmentos');
    var segs = ['Estándar','Premium','Corporativo'];
    var cols = ['#3B6EF5','#F59E0B','#8B5CF6'];
    var counts = segs.map(function(s){ return clientes.filter(function(c){ return c.segmento===s; }).length; });
    var sub = document.getElementById('ov-seg-sub');
    if (sub) {
        var max = segs[counts.indexOf(Math.max.apply(null,counts))];
        sub.textContent = 'Mayor: ' + max + ' (' + Math.max.apply(null,counts) + ')';
    }
    _charts['chartSegmentos'] = new Chart(el, {
        type: 'doughnut',
        data: { labels: segs, datasets: [{ data: counts, backgroundColor: cols, borderWidth: 2,
            borderColor: _isDark() ? '#1F2024' : '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font:{size:11}, color: _chartColors().text, padding:8, boxWidth:12 } } }
        }
    });
}

/* Top clientes por valor */
function renderOvTopClientes() {
    var el = document.getElementById('ovTopClientes');
    if (!el) return;
    var sorted = (_clientes||[]).slice().sort(function(a,b){ return Number(b.valorTotal||0)-Number(a.valorTotal||0); }).slice(0,5);
    var maxV = sorted.length ? Number(sorted[0].valorTotal||0) : 1;
    if (!sorted.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">Sin clientes</div>'; return; }
    el.innerHTML = sorted.map(function(c,i){
        var pct = Math.round(Number(c.valorTotal||0)/Math.max(maxV,1)*100);
        return '<div class="ov-top-client">' +
            '<div class="ov-top-rank">' + (i+1) + '</div>' +
            '<div class="mini-avatar" style="background:'+c.color+';width:28px;height:28px;font-size:11px">' + ((c.nombre||'?').substring(0,2).toUpperCase()) + '</div>' +
            '<div class="ov-top-bar-wrap">' +
              '<div class="ov-top-name">' + escHtml(c.nombre) + '</div>' +
              '<div class="ov-top-bar-track"><div class="ov-top-bar-fill" style="width:'+pct+'%"></div></div>' +
            '</div>' +
            '<div class="ov-top-val">Q ' + Number(c.valorTotal||0).toLocaleString() + '</div>' +
            '</div>';
    }).join('');
}

/* Alertas */
function renderOvAlertas() {
    var el = document.getElementById('ovAlertas');
    if (!el) return;
    var alertas = [];
    var inv = (_inventario||[]);
    var criticos = inv.filter(function(i){ return i.estado==='Crítico'; });
    if (criticos.length) {
        alertas.push({ color:'#EF4444', bg:'var(--danger-bg)', txt: criticos.length + ' producto(s) con stock crítico', btn: 'Ver inventario', action: "showPage('inventario',document.getElementById('nav-inventario'))" });
    }
    var bajos = inv.filter(function(i){ return i.estado==='Bajo'; });
    if (bajos.length) {
        alertas.push({ color:'#F59E0B', bg:'var(--warning-bg)', txt: bajos.length + ' producto(s) con stock bajo', btn: 'Revisar', action: "showPage('inventario',document.getElementById('nav-inventario'))" });
    }
    var pros = (_prospectos||[]).filter(function(p){ return p.etapa==='Propuesta'||p.etapa==='Negociación'; });
    if (pros.length) {
        alertas.push({ color:'#3B6EF5', bg:'var(--accent-bg)', txt: pros.length + ' prospecto(s) en etapa avanzada (Propuesta/Negociación)', btn: 'Ver', action: "showPage('prospectos',document.getElementById('nav-prospectos'))" });
    }
    var cots = (_cotizaciones||[]).filter(function(c){ return c.estado==='Enviada'; });
    if (cots.length) {
        alertas.push({ color:'#14B8A6', bg:'rgba(20,184,166,.1)', txt: cots.length + ' cotización(es) enviadas esperando respuesta', btn: 'Ver', action: "showPage('cotizaciones',document.getElementById('nav-cotizaciones'))" });
    }
    var pend = (_clientes||[]).filter(function(c){ return c.estado==='Pendiente'; });
    if (pend.length) {
        alertas.push({ color:'#8E8E93', bg:'var(--bg)', txt: pend.length + ' cliente(s) pendiente(s) de activar', btn: 'Activar', action: "showPage('clientes',document.getElementById('nav-clientes'))" });
    }
    if (!alertas.length) {
        el.innerHTML = '<div class="ov-alert" style="background:var(--success-bg)"><div class="ov-alert-dot" style="background:#22C55E"></div><div class="ov-alert-txt" style="color:#1a8a3a">✅ Todo en orden, sin alertas activas.</div></div>';
        return;
    }
    el.innerHTML = alertas.slice(0,4).map(function(a){
        return '<div class="ov-alert" style="background:'+a.bg+'">' +
            '<div class="ov-alert-dot" style="background:'+a.color+'"></div>' +
            '<div class="ov-alert-txt">'+a.txt+'</div>' +
            '<button class="ov-alert-btn" onclick="'+a.action+'">'+a.btn+'</button>' +
            '</div>';
    }).join('');
}

/* Actualiza los KPIs del overview con los datos ya cargados */
function renderOvKpis() {
    var cli = _clientes || [];
    var pro = _prospectos || [];
    var cot = _cotizaciones || [];
    var inv = _inventario || [];

    var activos = cli.filter(function(c){ return c.estado==='Activo'; }).length;
    document.getElementById('ov-cli').textContent = activos;
    var ovCliD = document.getElementById('ov-cli-d');
    if (ovCliD) ovCliD.textContent = cli.length + ' total registrados';

    var proAct = pro.filter(function(p){ return p.etapa!=='Perdido'; });
    document.getElementById('ov-pro').textContent = proAct.length;
    var pond = proAct.reduce(function(s,p){ return s+Number(p.valorEstimado||0)*(Number(p.probabilidad||0)/100); }, 0);
    var ovProD = document.getElementById('ov-pro-d');
    if (ovProD) ovProD.textContent = 'Pipeline Q ' + Math.round(pond).toLocaleString();

    var aprobadas = cot.filter(function(c){ return c.estado==='Aprobada'; });
    var enviadas  = cot.filter(function(c){ return ['Enviada','Aprobada','Rechazada'].includes(c.estado); });
    var tasa = enviadas.length ? Math.round(aprobadas.length/enviadas.length*100) : 0;
    document.getElementById('ov-cot-ap').textContent = aprobadas.length;
    var ovCotD = document.getElementById('ov-cot-ap-d');
    if (ovCotD) ovCotD.textContent = tasa + '% de conversión';

    var valorPond = proAct.reduce(function(s,p){ return s+Number(p.valorEstimado||0)*(Number(p.probabilidad||0)/100); }, 0);
    document.getElementById('ov-pond').textContent = 'Q ' + Math.round(valorPond).toLocaleString();
    var valorPot  = proAct.reduce(function(s,p){ return s+Number(p.valorEstimado||0); }, 0);
    var ovPondD = document.getElementById('ov-pond-d');
    if (ovPondD) ovPondD.textContent = 'Q ' + Math.round(valorPot).toLocaleString() + ' potencial';

    var crit = inv.filter(function(i){ return i.estado==='Crítico'; }).length;
    var bajo = inv.filter(function(i){ return i.estado==='Bajo'; }).length;
    document.getElementById('ov-crit').textContent = crit;
    var ovCritD = document.getElementById('ov-crit-d');
    if (ovCritD) ovCritD.textContent = bajo + ' con stock bajo';

    // encuestas
    var enc = _encuestas || [];
    var totalEnv = enc.reduce(function(s,e){ return s+Number(e.totalEnviadas||0); }, 0);
    var totalResp = enc.reduce(function(s,e){ return s+Number(e.respuestas||0); }, 0);
    var tasaEnc = totalEnv ? Math.round(totalResp/totalEnv*100) : 0;
    document.getElementById('ov-tasa').textContent = tasaEnc + '%';
    var ovTasaD = document.getElementById('ov-tasa-d');
    if (ovTasaD) ovTasaD.textContent = totalResp + ' respuestas de ' + totalEnv;
}

/* Render completo del overview — llamado tras cargar datos */
function renderOverview() {
    _ovGreeting();
    renderOvKpis();
    renderOvTopClientes();
    renderOvAlertas();
    if (typeof _prospectos !== 'undefined') renderChartPipeline(_prospectos);
    if (typeof _cotizaciones !== 'undefined') renderChartCotizaciones(_cotizaciones);
    if (typeof _clientes !== 'undefined') renderChartSegmentos(_clientes);
    if (typeof _ovApplyRoles === 'function') _ovApplyRoles();
}

/* Hook en loadAll/loadResumen para refrescar overview */
(function() {
    var _origLoadClientes = window.loadClientes;
    var _origLoadProspectos = window.loadProspectos;
    var _origLoadInventario = window.loadInventario;
    var _origLoadCotizaciones = window.loadCotizaciones;
    var _origLoadEncuestas = window.loadEncuestas;

    function _refreshOverviewIfNeeded() {
        if (document.getElementById('page-overview') &&
            document.getElementById('page-overview').classList.contains('active')) {
            renderOverview();
        }
    }

    if (_origLoadClientes) window.loadClientes = function() {
        var r = _origLoadClientes.apply(this, arguments);
        setTimeout(_refreshOverviewIfNeeded, 800);
        return r;
    };
    if (_origLoadProspectos) window.loadProspectos = function() {
        var r = _origLoadProspectos.apply(this, arguments);
        setTimeout(_refreshOverviewIfNeeded, 800);
        return r;
    };
    if (_origLoadInventario) window.loadInventario = function() {
        var r = _origLoadInventario.apply(this, arguments);
        setTimeout(_refreshOverviewIfNeeded, 800);
        return r;
    };
    if (_origLoadCotizaciones) window.loadCotizaciones = function() {
        var r = _origLoadCotizaciones.apply(this, arguments);
        setTimeout(_refreshOverviewIfNeeded, 800);
        return r;
    };
    if (_origLoadEncuestas) window.loadEncuestas = function() {
        var r = _origLoadEncuestas.apply(this, arguments);
        setTimeout(_refreshOverviewIfNeeded, 800);
        return r;
    };

    // Render inicial cuando la página overview es visible
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            window._ovGreeting();
            // Actualizar el saludo cada minuto
            setInterval(window._ovGreeting, 60000);
        }, 100);
    });

    // Hook en showPage para re-renderizar gráficas al volver al overview
    var _origShowPage2 = window.showPage;
    if (_origShowPage2) {
        window.showPage = function(id, navEl) {
            _origShowPage2(id, navEl);
            if (id === 'overview') {
                setTimeout(renderOverview, 150);
            }
        };
    }
})();
