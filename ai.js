/* ═══════════════════════════════════════════════════════
   ai.js — Asistente IA Oficial CRM AZYVION
   Motor exclusivo: Azyvion AI (https://azyvion-ai.onrender.com)
   Streaming en tiempo real con estricto control de roles
═══════════════════════════════════════════════════════ */

var _azAiOpen = false;
var _azAiBusy = false;
var _AZ_AI_RENDER_URL = 'https://azyvion-ai.onrender.com/api/chat';

function azAiToggle() {
    _azAiOpen = !_azAiOpen;
    var panel = document.getElementById('azAiPanel');
    if (panel) panel.classList.toggle('open', _azAiOpen);
    if (_azAiOpen) {
        setTimeout(function(){
            var inp = document.getElementById('azAiInput');
            if (inp) inp.focus();
        }, 250);
    }
}

/**
 * Genera el contexto respetando los roles y privilegios del usuario actual
 */
function _azAiBuildContext() {
    var rol = (window._currentUserRole || window._rol || 'AGENTE').toUpperCase();
    var esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(rol);
    var esGerente = rol === 'GERENTE';
    var esVendedor = rol === 'VENDEDOR';
    var esCajero = rol === 'CAJERO';

    var usuarioNombre = (window._usuario || 'Usuario').split(' ')[0];

    // Contexto restringido por roles
    var cli = (_clientes || []);
    var pro = (_prospectos || []);
    var cot = (_cotizaciones || []);
    var inv = (_inventario || []);

    var contextoData = [];

    contextoData.push('=== USUARIO Y ROL EN CRM ===');
    contextoData.push('Usuario: ' + usuarioNombre);
    contextoData.push('Rol: ' + rol);

    if (esAdmin || esGerente) {
        var cliA = cli.filter(function(c){ return c.estado==='Activo'; }).length;
        var cliP = cli.filter(function(c){ return c.estado==='Pendiente'; }).length;
        var cliVal = cli.reduce(function(s,c){ return s+Number(c.valorTotal||0); }, 0);
        var proVal = pro.filter(function(p){ return p.etapa!=='Perdido'; }).reduce(function(s,p){ return s+Number(p.valorEstimado||0); }, 0);
        var cotAp = cot.filter(function(c){ return c.estado==='Aprobada'; });
        var cotMonto = cotAp.reduce(function(s,c){ return s+Number(c.total||0); }, 0);
        var invVal = inv.reduce(function(s,i){ return s+Number(i.unidades||0)*Number(i.precioUnit||0); }, 0);
        var invCrit = inv.filter(function(i){ return i.estado==='Crítico'; });

        contextoData.push('\n=== RESUMEN GLOBAL (NIVEL ADMINISTRATIVO) ===');
        contextoData.push('CLIENTES: ' + cli.length + ' totales (' + cliA + ' activos, ' + cliP + ' pendientes). Valor cartera: Q ' + Math.round(cliVal).toLocaleString());
        contextoData.push('PIPELINE PROSPECTOS: ' + pro.length + ' registros. Valor estimado: Q ' + Math.round(proVal).toLocaleString());
        contextoData.push('COTIZACIONES: ' + cot.length + ' totales (' + cotAp.length + ' aprobadas por Q ' + Math.round(cotMonto).toLocaleString() + ')');
        contextoData.push('INVENTARIO: ' + inv.length + ' ítems registrados. Valuación stock: Q ' + Math.round(invVal).toLocaleString());
        if (invCrit.length) {
            contextoData.push('Stock crítico (' + invCrit.length + '): ' + invCrit.slice(0, 5).map(function(i){ return i.producto; }).join(', '));
        }
    } else if (esVendedor) {
        var misCli = cli.filter(function(c){ return !c.creadoPor || c.creadoPor === window._usuario; });
        var misCot = cot.filter(function(c){ return !c.creadoPor || c.creadoPor === window._usuario; });
        var misCotAp = misCot.filter(function(c){ return c.estado==='Aprobada'; });

        contextoData.push('\n=== DATOS PERMITIDOS PARA VENDEDOR ===');
        contextoData.push('Tus Clientes asignados: ' + misCli.length);
        contextoData.push('Tus Cotizaciones: ' + misCot.length + ' (' + misCotAp.length + ' aprobadas)');
        contextoData.push('Catálogo de Productos disponibles para cotizar: ' + inv.filter(function(i){ return i.activo !== false; }).length + ' productos en catálogo');
        contextoData.push('RESTRICCIÓN ESTRICTA: No tienes acceso a costos contables, arqueos de otros usuarios ni valuación total de la empresa.');
    } else if (esCajero) {
        contextoData.push('\n=== DATOS PERMITIDOS PARA CAJERO (POS) ===');
        contextoData.push('Acceso al catálogo de venta rápida POS y gestión de cobros.');
        contextoData.push('Ítems con stock disponible en tienda: ' + inv.filter(function(i){ return Number(i.unidades || 0) > 0; }).length);
        contextoData.push('RESTRICCIÓN ESTRICTA: No tienes acceso a reportes contables generales, comisiones de terceros ni configuraciones del sistema.');
    } else {
        contextoData.push('\n=== DATOS GENERALES ===');
        contextoData.push('Acceso a módulos autorizados de gestión operativa.');
    }

    var manual = [
        'MANUAL Y REGLAS DE NEGOCIO DEL CRM AZYVION:',
        '1. PUNTO DE VENTA (POS): Venta rápida de mostrador. Métodos: Efectivo (calcula cambio), Tarjeta, Transferencia. Tickets térmicos y SAT FEL. Apertura y cierre de turnos de caja con arqueo. Botón para cobrar cotizaciones aprobadas con 1 solo clic.',
        '2. CLIENTES: Directorio con listas de precio (Público, Plata, Oro). Campos obligatorios: Razón Social, NIT, Teléfono, Dirección, Ciudad, País y Fuente/Origen.',
        '3. PROSPECTOS: Embudo comercial (Nuevo, Contactado, Propuesta, Negociación, Ganado, Perdido). Campos obligatorios: Empresa, Teléfono, Dirección, Origen.',
        '4. COTIZACIONES: Catálogo protegido (descripción y precio unitario no editables). Sin descuentos por ítem ni general. IVA configurable por empresa en Ajustes (modalidad con IVA incluido o sobre el subtotal). Vista previa obligatoria antes de guardar. Solo Administradores pueden editar o eliminar.',
        '5. INVENTARIO: Submenú unificado Producto con filtros Marca, Línea, Familia. SKU obligatorio. Precios por nivel (Público, Plata, Oro). Alertas de stock crítico.',
        '6. ENCUESTAS: Enlace público con token único (encuesta.html?token=...) para responder sin login.',
        '7. CONTABILIDAD: Libro Diario con partida doble estricta (Debe = Haber), Estado de Resultados (P&L).'
    ].join('\n');

    return 'Eres Azyvion AI, el Asistente Inteligente Oficial y Asesor Experto integrado en CRM AZYVION.\n' +
        'Tu propósito es responder de forma concisa, cordial y precisa dudas del usuario sobre el uso del CRM, clientes, cotizaciones, inventario y ventas.\n\n' +
        'POLÍTICA DE ROLES Y SEGURIDAD:\n' +
        'El usuario actual tiene rol: ' + rol + '.\n' +
        'Si el usuario te solicita datos confidenciales o fuera de su alcance (por ejemplo, finanzas globales si es cajero o vendedor), infórmale amablemente que por seguridad de la empresa esa información está restringida a los Administradores.\n\n' +
        manual + '\n\n' +
        contextoData.join('\n') + '\n\n' +
        'Responde siempre en español con tono profesional, conciso y útil.';
}

var _azAiHistory = [];

function _azAiAddMsg(text, role) {
    var msgs = document.getElementById('azAiMsgs');
    if (!msgs) return;
    var div = document.createElement('div');
    div.className = 'az-ai-msg ' + (role === 'user' ? 'user' : 'bot');
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function azAiSend(presetText) {
    if (_azAiBusy) return;
    var inp = document.getElementById('azAiInput');
    var text = (presetText || (inp ? inp.value.trim() : '')).trim();
    if (!text) return;

    _azAiAddMsg(text, 'user');
    _azAiHistory.push({ role: 'user', content: text });
    if (inp) inp.value = '';
    if (inp) inp.style.height = 'auto';

    var suggs = document.getElementById('azAiSuggs');
    if (suggs) suggs.style.display = 'none';

    _azAiBusy = true;
    var sendBtn = document.getElementById('azAiSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    var typingEl = _azAiAddMsg('Consultando Azyvion AI…', 'bot typing');
    var systemPrompt = _azAiBuildContext();

    var onDone = function(reply) {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        _azAiAddMsg(reply, 'bot');
        _azAiHistory.push({ role: 'assistant', content: reply });
        _azAiBusy = false;
        if (sendBtn) sendBtn.disabled = false;
    };

    var onFail = function(err) {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        _azAiAddMsg('Error de conexión con Azyvion AI: ' + (err.message || String(err)), 'bot');
        _azAiHistory.pop();
        _azAiBusy = false;
        if (sendBtn) sendBtn.disabled = false;
    };

    // ── LLAMADA EXCLUSIVA A AZYVION AI (RENDER) ──
    var sseMessages = _azAiHistory.slice(-8).map(function(m){
        return { role: m.role === 'bot' || m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
    });

    var callRenderWithRetry = function(retryCount) {
        fetch(_AZ_AI_RENDER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: sseMessages,
                language: 'Spanish (es-GT)',
                projectContext: systemPrompt
            })
        })
        .then(function(res) {
            if (res.status === 503 && retryCount > 0) {
                // Servidor despertando (cold start)
                if (typingEl) typingEl.textContent = 'Iniciando Azyvion AI (servidor en reposo)…';
                setTimeout(function(){ callRenderWithRetry(retryCount - 1); }, 3000);
                return;
            }
            if (!res.ok) {
                throw new Error('Servidor Azyvion AI respondió con estado ' + res.status);
            }

            // Streaming SSE Reader en tiempo real
            if (res.body && typeof res.body.getReader === 'function') {
                var reader = res.body.getReader();
                var decoder = new TextDecoder('utf-8');
                var buffer = '';
                var fullText = '';

                function pump() {
                    reader.read().then(function(result) {
                        if (result.done) {
                            onDone(fullText || 'Sin respuesta');
                            return;
                        }
                        buffer += decoder.decode(result.value, { stream: true });
                        var lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (var i = 0; i < lines.length; i++) {
                            var line = lines[i].trim();
                            if (line.indexOf('data:') === 0) {
                                var dataStr = line.substring(5).trim();
                                if (dataStr) {
                                    try {
                                        var d = JSON.parse(dataStr);
                                        if (d.text) {
                                            fullText += d.text;
                                            if (typingEl) {
                                                typingEl.classList.remove('typing');
                                                typingEl.textContent = fullText;
                                                var mEl = document.getElementById('azAiMsgs');
                                                if (mEl) mEl.scrollTop = mEl.scrollHeight;
                                            }
                                        }
                                    } catch(e){}
                                }
                            }
                        }
                        pump();
                    }).catch(function(streamErr) {
                        if (fullText) {
                            onDone(fullText);
                        } else {
                            onFail(streamErr);
                        }
                    });
                }
                pump();
            } else {
                // Fallback para navegadores sin ReadableStream
                res.text().then(function(raw) {
                    var textAccum = '';
                    var rLines = raw.split('\n');
                    for (var j = 0; j < rLines.length; j++) {
                        var rLine = rLines[j].trim();
                        if (rLine.indexOf('data:') === 0) {
                            var payload = rLine.substring(5).trim();
                            if (payload) {
                                try {
                                    var pObj = JSON.parse(payload);
                                    if (pObj.text) textAccum += pObj.text;
                                } catch(e){}
                            }
                        }
                    }
                    onDone(textAccum || raw);
                }).catch(onFail);
            }
        })
        .catch(function(err) {
            console.warn('Fallback a respuesta asistida local:', err);
            var pLower = text.toLowerCase();
            var rol = (window._currentUserRole || window._rol || 'AGENTE').toUpperCase();
            var esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(rol);
            var reply = '';

            if (pLower.includes('pos') || pLower.includes('cobrar') || pLower.includes('caja')) {
                reply = 'En el **Punto de Venta (POS)** de AZYVION:\n• Puedes aperturar turno con monto inicial en efectivo.\n• Cobrar en efectivo con cálculo de vuelto automático, tarjeta o transferencia.\n• Cobrar cotizaciones aprobadas con 1 clic usando el botón "Cobrar en POS".\n• Realizar el arqueo y cierre de caja al finalizar la jornada.';
            } else if (pLower.includes('cotiz') || pLower.includes('precio') || pLower.includes('iva')) {
                reply = 'Para las **Cotizaciones** en CRM AZYVION:\n• Los productos se toman del catálogo con descripción y precio bloqueados para proteger las tarifas.\n• El IVA se calcula automáticamente según la configuración de tu empresa (incluido o sobre el subtotal).\n• Tienes una **Vista previa interactiva** antes de guardar.\n• Solo los Administradores pueden editar o eliminar cotizaciones.';
            } else if (pLower.includes('cliente') || pLower.includes('nit')) {
                reply = 'Para registrar un **Nuevo Cliente**:\n• Debes completar: Razón Social, NIT, Teléfono, Dirección, Ciudad, País y Fuente.\n• Puedes asignarle una lista de precio (**Público**, **Plata** u **Oro**) para aplicar tarifas preferenciales automáticas.';
            } else if (pLower.includes('inventario') || pLower.includes('producto') || pLower.includes('sku')) {
                reply = 'En **Inventario / Producto**:\n• Todos los productos están unificados en un catálogo sin pestañas, con filtros por Marca, Línea y Familia.\n• El código SKU es obligatorio para control de inventario.\n• Puedes configurar precios por nivel y revisar alertas de stock bajo.';
            } else if (!esAdmin && (pLower.includes('ganancia') || pLower.includes('total dinero') || pLower.includes('cartera') || pLower.includes('financiero'))) {
                reply = 'Por políticas de confidencialidad del CRM AZYVION, los reportes financieros globales están reservados exclusivamente para los Administradores.';
            } else {
                reply = 'Hola. Soy el Asistente IA de CRM AZYVION. Puedo ayudarte con dudas sobre Punto de Venta (POS), cotizaciones, clientes, inventario o encuestas públicas. ¿En qué puedo orientarte hoy?';
            }
            onDone(reply);
        });
    };

    callRenderWithRetry(1);
}

/* Auto-resize textarea */
document.addEventListener('DOMContentLoaded', function() {
    var inp = document.getElementById('azAiInput');
    if (inp) {
        inp.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 90) + 'px';
        });
    }
});
