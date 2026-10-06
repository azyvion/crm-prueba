/* ═══════════════════════════════════════════════════════
   ai.js — Asistente IA Multimodelo con Soporte Gratuito
   Soporta: Google Gemini (Gratis), Claude y Endpoint Propio
   Respeta estrictamente los roles y permisos del CRM
═══════════════════════════════════════════════════════ */

var _azAiOpen = false;
var _azAiBusy = false;
var _AZ_AI_PROVIDER_LS = 'azyvion_ai_provider';     // 'gemini' | 'claude' | 'custom'
var _AZ_AI_GEMINI_KEY_LS = 'azyvion_gemini_api_key';
var _AZ_AI_CLAUDE_KEY_LS = 'azyvion_claude_api_key';
var _AZ_AI_CUSTOM_URL_LS = 'azyvion_ai_custom_url';
var _AZ_AI_CUSTOM_KEY_LS = 'azyvion_ai_custom_key';

function azAiToggle() {
    _azAiOpen = !_azAiOpen;
    var panel = document.getElementById('azAiPanel');
    if (panel) panel.classList.toggle('open', _azAiOpen);
    if (_azAiOpen) {
        _azAiCheckKey();
        setTimeout(function(){
            var inp = document.getElementById('azAiInput');
            if (inp) inp.focus();
        }, 250);
    }
}

function _azAiGetProvider() {
    return localStorage.getItem(_AZ_AI_PROVIDER_LS) || 'gemini';
}

function _azAiCheckKey() {
    var provider = _azAiGetProvider();
    var hasKey = false;
    if (provider === 'gemini') {
        hasKey = !!localStorage.getItem(_AZ_AI_GEMINI_KEY_LS);
    } else if (provider === 'claude') {
        hasKey = !!localStorage.getItem(_AZ_AI_CLAUDE_KEY_LS);
    } else if (provider === 'custom') {
        hasKey = !!localStorage.getItem(_AZ_AI_CUSTOM_URL_LS);
    }
    var banner = document.getElementById('azAiKeyBanner');
    if (banner) {
        banner.style.display = hasKey ? 'none' : 'block';
        banner.innerHTML = '<strong>Configura tu IA:</strong> Haz clic para conectar ' +
            (provider === 'gemini' ? 'Google Gemini (Gratuito)' : provider === 'claude' ? 'Claude' : 'IA Personalizada') +
            ' <a href="javascript:void(0)" onclick="azAiOpenKeySetup()" style="text-decoration:underline;margin-left:4px">Configurar</a>';
    }
}

function azAiOpenKeySetup() {
    var prov = prompt(
        'Elige el proveedor de Inteligencia Artificial para el CRM:\n' +
        '1 = Google Gemini (GRATUITO - Sin costo en aistudio.google.com)\n' +
        '2 = Nuestra IA Propia / Endpoint Personalizado (Webhook o Servidor Propio)\n' +
        '3 = Anthropic Claude (Requiere API Key de pago)\n\n' +
        'Ingresa 1, 2 o 3:',
        _azAiGetProvider() === 'custom' ? '2' : _azAiGetProvider() === 'claude' ? '3' : '1'
    );

    if (prov === null) return;
    prov = prov.trim();

    if (prov === '1') {
        localStorage.setItem(_AZ_AI_PROVIDER_LS, 'gemini');
        var curKey = localStorage.getItem(_AZ_AI_GEMINI_KEY_LS) || '';
        var key = prompt(
            'Ingresa tu API Key de Google Gemini (100% GRATUITA):\n' +
            'Puedes obtenerla gratis en: https://aistudio.google.com/app/apikey\n\n' +
            'No requiere tarjeta de crédito y ofrece hasta 15 consultas por minuto gratis.',
            curKey
        );
        if (key !== null) {
            key = key.trim();
            if (key) {
                localStorage.setItem(_AZ_AI_GEMINI_KEY_LS, key);
                showToast('Google Gemini configurado como IA gratuita', '#30D158');
            } else {
                localStorage.removeItem(_AZ_AI_GEMINI_KEY_LS);
                showToast('API Key eliminada', '#FF9F0A');
            }
        }
    } else if (prov === '2') {
        localStorage.setItem(_AZ_AI_PROVIDER_LS, 'custom');
        var curUrl = localStorage.getItem(_AZ_AI_CUSTOM_URL_LS) || '';
        var url = prompt(
            'Ingresa la URL del endpoint de tu IA Propia:\n(Ej: https://tu-servidor.com/api/ai o webhook)',
            curUrl
        );
        if (url !== null) {
            url = url.trim();
            if (url) {
                localStorage.setItem(_AZ_AI_CUSTOM_URL_LS, url);
                var curTok = localStorage.getItem(_AZ_AI_CUSTOM_KEY_LS) || '';
                var tok = prompt('Token / Clave de autorización (Opcional, dejar vacío si no requiere):', curTok);
                if (tok !== null) localStorage.setItem(_AZ_AI_CUSTOM_KEY_LS, tok.trim());
                showToast('Endpoint de IA propia guardado', '#30D158');
            } else {
                localStorage.removeItem(_AZ_AI_CUSTOM_URL_LS);
                showToast('IA Propia desactivada', '#FF9F0A');
            }
        }
    } else if (prov === '3') {
        localStorage.setItem(_AZ_AI_PROVIDER_LS, 'claude');
        var curKey = localStorage.getItem(_AZ_AI_CLAUDE_KEY_LS) || '';
        var key = prompt('Ingresa tu API Key de Anthropic (Claude):\nhttps://console.anthropic.com/', curKey);
        if (key !== null) {
            key = key.trim();
            if (key) {
                localStorage.setItem(_AZ_AI_CLAUDE_KEY_LS, key);
                showToast('API Key de Claude guardada', '#30D158');
            } else {
                localStorage.removeItem(_AZ_AI_CLAUDE_KEY_LS);
                showToast('API Key de Claude eliminada', '#FF9F0A');
            }
        }
    }
    _azAiCheckKey();
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
        contextoData.push('RESTRICCIÓN: No tienes acceso a costos contables, arqueos de otros usuarios ni valuación total de la empresa.');
    } else if (esCajero) {
        contextoData.push('\n=== DATOS PERMITIDOS PARA CAJERO (POS) ===');
        contextoData.push('Acceso al catálogo de venta rápida POS y gestión de cobros.');
        contextoData.push('Ítems con stock disponible en tienda: ' + inv.filter(function(i){ return Number(i.unidades || 0) > 0; }).length);
        contextoData.push('RESTRICCIÓN: No tienes acceso a reportes contables generales, comisiones de terceros ni configuraciones del sistema.');
    } else {
        contextoData.push('\n=== DATOS GENERALES ===');
        contextoData.push('Acceso a módulos autorizados de gestión operativa.');
    }

    return 'Eres el Asistente Inteligente oficial del CRM Azyvion.\n' +
        'Tu propósito es responder de forma concisa, cordial y precisa dudas del usuario sobre el uso del CRM, clientes, cotizaciones, inventario y ventas.\n\n' +
        'POLÍTICA DE ROLES Y SEGURIDAD:\n' +
        'El usuario actual tiene rol: ' + rol + '.\n' +
        'Si el usuario te solicita datos confidenciales o fuera de su alcance (por ejemplo, finanzas globales si es cajero o vendedor), infórmale amablemente que por seguridad de la empresa esa información está restringida a los Administradores.\n\n' +
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

    var provider = _azAiGetProvider();
    var apiKey = '';
    var customUrl = '';

    if (provider === 'gemini') {
        apiKey = localStorage.getItem(_AZ_AI_GEMINI_KEY_LS) || '';
        if (!apiKey) { azAiOpenKeySetup(); return; }
    } else if (provider === 'claude') {
        apiKey = localStorage.getItem(_AZ_AI_CLAUDE_KEY_LS) || '';
        if (!apiKey) { azAiOpenKeySetup(); return; }
    } else if (provider === 'custom') {
        customUrl = localStorage.getItem(_AZ_AI_CUSTOM_URL_LS) || '';
        if (!customUrl) { azAiOpenKeySetup(); return; }
    }

    _azAiAddMsg(text, 'user');
    _azAiHistory.push({ role: 'user', content: text });
    if (inp) inp.value = '';
    if (inp) inp.style.height = 'auto';

    var suggs = document.getElementById('azAiSuggs');
    if (suggs) suggs.style.display = 'none';

    _azAiBusy = true;
    var sendBtn = document.getElementById('azAiSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    var typingEl = _azAiAddMsg('Consultando IA…', 'bot typing');
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
        _azAiAddMsg('Error de conexión IA: ' + (err.message || String(err)) + '. Puedes reconfigurar la clave en el icono de ajustes.', 'bot');
        _azAiHistory.pop();
        _azAiBusy = false;
        if (sendBtn) sendBtn.disabled = false;
    };

    // ── LLAMADA SEGÚN PROVEEDOR ──
    if (provider === 'gemini') {
        // Google Gemini 1.5 Flash (Gratuito)
        var contents = [];
        var turns = _azAiHistory.slice(-8);
        turns.forEach(function(t) {
            contents.push({
                role: t.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: t.content }]
            });
        });

        var geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + encodeURIComponent(apiKey);

        fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: contents,
                generationConfig: {
                    maxOutputTokens: 600,
                    temperature: 0.4
                }
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.error) {
                onFail(new Error(data.error.message || JSON.stringify(data.error)));
            } else if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
                var reply = data.candidates[0].content.parts.map(function(p){ return p.text; }).join('\n');
                onDone(reply || 'Sin respuesta');
            } else {
                onDone('No se obtuvo respuesta del modelo Gemini.');
            }
        })
        .catch(onFail);

    } else if (provider === 'custom') {
        // Endpoint propio / IA creada
        var customTok = localStorage.getItem(_AZ_AI_CUSTOM_KEY_LS) || '';
        var headers = { 'Content-Type': 'application/json' };
        if (customTok) headers['Authorization'] = 'Bearer ' + customTok;

        fetch(customUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                system: systemPrompt,
                messages: _azAiHistory.slice(-8),
                prompt: text,
                user: window._usuario || '',
                role: window._currentUserRole || 'AGENTE'
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            var reply = data.reply || data.response || data.text || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || JSON.stringify(data);
            onDone(reply);
        })
        .catch(onFail);

    } else {
        // Anthropic Claude
        fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 600,
                system: systemPrompt,
                messages: _azAiHistory.slice(-10)
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.error) {
                onFail(new Error(data.error.message || JSON.stringify(data.error)));
            } else {
                var reply = data.content && data.content[0] && data.content[0].text || 'Sin respuesta';
                onDone(reply);
            }
        })
        .catch(onFail);
    }
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
