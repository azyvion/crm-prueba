/* ═══════════════════════════════════════════════════════
   ai.js — Asistente IA (chat con Claude)
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   ASISTENTE IA — Chat con Claude (API key en localStorage)
════════════════════════════════════════════════════════════ */
var _azAiOpen = false;
var _azAiBusy = false;
var _AZ_AI_KEY_LS = 'azyvion_claude_api_key';

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

function _azAiCheckKey() {
    var key = localStorage.getItem(_AZ_AI_KEY_LS) || '';
    var banner = document.getElementById('azAiKeyBanner');
    if (banner) banner.style.display = key ? 'none' : 'block';
}

function azAiOpenKeySetup() {
    var current = localStorage.getItem(_AZ_AI_KEY_LS) || '';
    var key = prompt('Ingresa tu API Key de Anthropic (Claude):\nhttps://console.anthropic.com/\n\nSe guarda solo en tu navegador, nunca en el servidor.', current);
    if (key !== null) {
        key = key.trim();
        if (key) { localStorage.setItem(_AZ_AI_KEY_LS, key); showToast('API Key guardada', '#30D158'); }
        else { localStorage.removeItem(_AZ_AI_KEY_LS); showToast('API Key eliminada', '#FF9F0A'); }
        _azAiCheckKey();
    }
}

function _azAiBuildContext() {
    var cli  = (_clientes||[]).length;
    var cliA = (_clientes||[]).filter(function(c){ return c.estado==='Activo'; }).length;
    var cliP = (_clientes||[]).filter(function(c){ return c.estado==='Pendiente'; }).length;
    var cliTop = (_clientes||[]).slice().sort(function(a,b){ return Number(b.valorTotal||0)-Number(a.valorTotal||0); }).slice(0,3).map(function(c){ return c.nombre + ' (Q'+Number(c.valorTotal||0).toLocaleString()+')'; }).join(', ');
    var cliVal = (_clientes||[]).reduce(function(s,c){ return s+Number(c.valorTotal||0); }, 0);

    var proA = (_prospectos||[]).filter(function(p){ return p.etapa!=='Perdido'; }).length;
    var proVal = (_prospectos||[]).filter(function(p){ return p.etapa!=='Perdido'; }).reduce(function(s,p){ return s+Number(p.valorEstimado||0); }, 0);
    var proPond = (_prospectos||[]).filter(function(p){ return p.etapa!=='Perdido'; }).reduce(function(s,p){ return s+Number(p.valorEstimado||0)*(Number(p.probabilidad||0)/100); }, 0);
    var etapas = ['Nuevo','Contactado','Calificado','Propuesta','Negociación','Perdido'];
    var etStr = etapas.map(function(e){ return e+':'+(_prospectos||[]).filter(function(p){ return p.etapa===e; }).length; }).join(', ');

    var cotAp = (_cotizaciones||[]).filter(function(c){ return c.estado==='Aprobada'; });
    var cotEn = (_cotizaciones||[]).filter(function(c){ return ['Enviada','Aprobada','Rechazada'].includes(c.estado); });
    var cotMonto = cotAp.reduce(function(s,c){ return s+Number(c.total||0); }, 0);
    var cotTasa = cotEn.length ? Math.round(cotAp.length/cotEn.length*100) : 0;

    var invCrit = (_inventario||[]).filter(function(i){ return i.estado==='Crítico'; });
    var invBajo = (_inventario||[]).filter(function(i){ return i.estado==='Bajo'; });
    var invVal  = (_inventario||[]).reduce(function(s,i){ return s+Number(i.unidades||0)*Number(i.precioUnit||0); }, 0);

    var enc = _encuestas || [];
    var encEnv = enc.reduce(function(s,e){ return s+Number(e.totalEnviadas||0); }, 0);
    var encResp = enc.reduce(function(s,e){ return s+Number(e.respuestas||0); }, 0);
    var encTasa = encEnv ? Math.round(encResp/encEnv*100) : 0;

    return 'Eres el asistente inteligente del CRM Azyvion. Responde de forma concisa y útil en español.\n\n' +
        '=== DATOS ACTUALES DEL CRM ===\n' +
        'CLIENTES: ' + cli + ' total | ' + cliA + ' activos | ' + cliP + ' pendientes\n' +
        'Valor total de clientes: Q ' + cliVal.toLocaleString() + '\n' +
        'Top clientes: ' + (cliTop || 'sin datos') + '\n\n' +
        'PROSPECTOS: ' + proA + ' activos | Pipeline Q ' + Math.round(proVal).toLocaleString() + ' | Ponderado Q ' + Math.round(proPond).toLocaleString() + '\n' +
        'Por etapa: ' + etStr + '\n\n' +
        'COTIZACIONES: ' + (_cotizaciones||[]).length + ' total | ' + cotAp.length + ' aprobadas | Tasa conversión ' + cotTasa + '%\n' +
        'Monto aprobado: Q ' + Math.round(cotMonto).toLocaleString() + '\n\n' +
        'INVENTARIO: ' + (_inventario||[]).length + ' ítems | ' + invCrit.length + ' críticos | ' + invBajo.length + ' bajo\n' +
        'Valor inventario: Q ' + Math.round(invVal).toLocaleString() + '\n' +
        (invCrit.length ? 'Críticos: ' + invCrit.slice(0,5).map(function(i){ return i.producto; }).join(', ') + '\n' : '') + '\n' +
        'ENCUESTAS: ' + enc.length + ' | Tasa respuesta ' + encTasa + '% (' + encResp + '/' + encEnv + ')\n\n' +
        'Responde siempre en español. Si el usuario pregunta sobre datos que no tienes, dilo claramente.';
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

    var apiKey = localStorage.getItem(_AZ_AI_KEY_LS) || '';
    if (!apiKey) { azAiOpenKeySetup(); return; }

    _azAiAddMsg(text, 'user');
    _azAiHistory.push({ role: 'user', content: text });
    if (inp) inp.value = '';
    if (inp) inp.style.height = 'auto';

    var suggs = document.getElementById('azAiSuggs');
    if (suggs) suggs.style.display = 'none';

    _azAiBusy = true;
    var sendBtn = document.getElementById('azAiSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    var typingEl = _azAiAddMsg('Pensando…', 'bot typing');

    var systemPrompt = _azAiBuildContext();
    var messages = _azAiHistory.slice(-10); // últimas 10 turns

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
            messages: messages
        })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (data.error) {
            _azAiAddMsg('Error: ' + (data.error.message || JSON.stringify(data.error)), 'bot');
            _azAiHistory.pop();
        } else {
            var reply = data.content && data.content[0] && data.content[0].text || 'Sin respuesta';
            _azAiAddMsg(reply, 'bot');
            _azAiHistory.push({ role: 'assistant', content: reply });
        }
    })
    .catch(function(err) {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        _azAiAddMsg('Error de conexión: ' + (err.message || String(err)) + '. Verifica tu API key y conexión.', 'bot');
        _azAiHistory.pop();
    })
    .finally(function() {
        _azAiBusy = false;
        if (sendBtn) sendBtn.disabled = false;
    });
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
    // Configurar API key en ajustes de perfil (añadir enlace)
    setTimeout(function() {
        var perfilBody = document.getElementById('perfilBody');
        if (perfilBody && !document.getElementById('azAiKeySection')) {
            // Se añade la sección cuando se renderiza el perfil (hook)
        }
    }, 2000);
});
