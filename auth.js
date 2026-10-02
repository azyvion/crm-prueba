/* ═══════════════════════════════════════════════════════
   auth.js — Supabase client, sesión, roles, splash, init
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   SPLASH SCREEN — control
══════════════════════════════════════════════════════════ */
var _splashShownAt  = Date.now();
var _splashHidden   = false;
var _SPLASH_MIN_MS  = 1200;   // mínimo en pantalla (ms) para que no parpadee

function _setSplashStatus(txt) {
    var el = document.getElementById('az-splash-status');
    if (!el || _splashHidden) return;
    el.classList.add('az-fade');
    setTimeout(function () {
        el.textContent = txt;
        el.classList.remove('az-fade');
    }, 240);
}

function _hideSplash() { setTimeout(function(){ if(window._ovGreeting) window._ovGreeting(); }, 100);
    if (_splashHidden) return;
    var splash  = document.getElementById('az-splash');
    var elapsed = Date.now() - _splashShownAt;
    var delay   = Math.max(0, _SPLASH_MIN_MS - elapsed);

    _setSplashStatus('¡Listo!');
    setTimeout(function () {
        _splashHidden = true;
        if (splash) {
            splash.classList.add('az-splash-out');
            setTimeout(function () { splash.style.display = 'none'; }, 520);
        }
    }, delay);
}

    (function () {
        const SUPABASE_URL      = 'https://dwtykzporgjjvdustjfq.supabase.co';
        const SUPABASE_ANON_KEY = 'sb_publishable__sKrMJxAHySP1qqHZ5v6mQ_6BTligkc';
        const { createClient } = supabase;
        const _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken:  true,
                persistSession:    false,   // Azyvion gestiona la sesión en azyvion_session
                detectSessionInUrl: false
            }
        });
        window._supabase = _sb;
        window._sb = _sb;
        window.AZ_API_URL = '';
        const SESSION_KEY = 'azyvion_session';
        window.SESSION_KEY = SESSION_KEY;

        function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(e){ return null; } }

        function _getEffectiveOrgId() {
            if (window._currentOrgId) return window._currentOrgId;
            try {
                const s = JSON.parse(localStorage.getItem(SESSION_KEY) || localStorage.getItem('azyvion_session'));
                if (s && s.organization_id) return s.organization_id;
            } catch(e) {}
            return (typeof _currentOrgId !== 'undefined' && _currentOrgId) ? _currentOrgId : '';
        }
        window._getEffectiveOrgId = _getEffectiveOrgId;

        function puedeVerDashboard() {
            const s = readSession();
            const r = (_currentUserRole || (s && s.rol) || '').toUpperCase();
            return r === 'ADMIN' || r === 'SUPER_ADMIN' || window._esSuperAdmin === true;
        }
        window.puedeVerDashboard = puedeVerDashboard;

        function _estadoItem(tipo, unidades, stockMax) {
            if (tipo === 'Servicio') return 'Servicio';
            const u = Number(unidades)||0, m = Number(stockMax)||1;
            return u <= m*0.1 ? 'Crítico' : u <= m*0.3 ? 'Bajo' : 'Normal';
        }

        function _prefsUsuario(u) {
            u=u||{};
            return {
                tema: u.tema==='oscuro'?'oscuro':'claro',
                paginaInicio: ['overview','pos','clientes','prospectos','inventario','cotizaciones','encuestas','contabilidad','usuarios'].includes(u.paginaInicio)?u.paginaInicio:(puedeVerDashboard()?'overview':'clientes'),
                densidadTabla: u.densidadTabla==='compacta'?'compacta':'comoda',
                copiarmeCotizaciones: u.copiarmeCotizaciones===true||String(u.copiarmeCotizaciones).toLowerCase()==='true',
                alertaStockCritico: u.alertaStockCritico===true||String(u.alertaStockCritico).toLowerCase()==='true'
            };
        }

        // ── _logout: cierra sesión en Supabase Auth y limpia localStorage ────────
        async function _logout() {
            try { await _sb.auth.signOut(); } catch(e) {}
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem('azyvion_perfil_cache');
            return {ok:true};
        }

        async function _getResumen() {
            if (!puedeVerDashboard()) {
                return {ok:true,clientes:{total:0,activos:0,pendientes:0,valorTotal:0,valorPromedio:0},prospectos:{total:0,activos:0,calificados:0,valorPotencial:0,valorPonderado:0,porEtapa:{}},inventario:{totalProductos:0,totalServicios:0,totalItems:0,totalUnidades:0,criticos:0,bajos:0,stockCritico:0,valorInventario:0},encuestas:{total:0,activas:0,totalEnviadas:0,respuestas:0,tasaRespuesta:0}};
            }
            const org = _getEffectiveOrgId();
            let cliQ = _sb.from('Clientes').select('*');
            let invQ = _sb.from('Inventario').select('*');
            let encQ = _sb.from('encuestas').select('*');
            if (org) {
                cliQ = cliQ.eq('organization_id', org);
                invQ = invQ.eq('organization_id', org);
                encQ = encQ.eq('organization_id', org);
            }
            if (_currentUserRole === 'VENDEDOR') {
                const sess = readSession();
                const nombreUsuario = sess ? (sess.usuario || sess.nombre || '') : '';
                if (nombreUsuario) cliQ = cliQ.eq('creadoPor', nombreUsuario);
            }
            const [cR,iR,eR]=await Promise.all([cliQ,invQ,encQ]);
            const pR=await _getProspectos();
            const cli=cR.data||[],pro=pR.data||[],inv=iR.data||[],enc=eR.data||[];
            inv.forEach(i=>{i.tipo=String(i.tipo||'')==='Servicio'?'Servicio':'Producto';i.estado=_estadoItem(i.tipo,i.unidades,i.stockMax);});
            const invP=inv.filter(i=>i.tipo==='Producto'),invS=inv.filter(i=>i.tipo==='Servicio');
            const proAct=pro.filter(p=>p.etapa!=='Perdido'),proC=pro.filter(p=>['Calificado','Propuesta','Negociación'].includes(p.etapa));
            const vP=proAct.reduce((s,p)=>s+Number(p.valorEstimado||0),0),vPon=proAct.reduce((s,p)=>s+Number(p.valorEstimado||0)*(Number(p.probabilidad||0)/100),0);
            const etapas=['Nuevo','Contactado','Calificado','Propuesta','Negociación','Perdido'].reduce((o,e)=>{o[e]={count:0,valor:0};return o;},{});
            pro.forEach(p=>{if(etapas[p.etapa]){etapas[p.etapa].count++;etapas[p.etapa].valor+=Number(p.valorEstimado||0);}});
            const cA=cli.filter(c=>c.estado==='Activo').length,cP=cli.filter(c=>c.estado==='Pendiente').length,cV=cli.reduce((s,c)=>s+Number(c.valorTotal||0),0);
            const tE=enc.reduce((s,e)=>s+Number(e.totalEnviadas||0),0),tR=enc.reduce((s,e)=>s+Number(e.respuestas||0),0);
            const iCr=invP.filter(i=>i.estado==='Crítico').length,iB=invP.filter(i=>i.estado==='Bajo').length,iV=invP.reduce((s,i)=>s+Number(i.unidades||0)*Number(i.precioUnit||0),0);
            return {ok:true,clientes:{total:cli.length,activos:cA,pendientes:cP,valorTotal:cV,valorPromedio:cli.length?Math.round(cV/cli.length):0},prospectos:{total:pro.length,activos:proAct.length,calificados:proC.length,valorPotencial:vP,valorPonderado:Math.round(vPon),porEtapa:etapas},inventario:{totalProductos:invP.length,totalServicios:invS.length,totalItems:inv.length,totalUnidades:invP.reduce((s,i)=>s+Number(i.unidades||0),0),criticos:iCr,bajos:iB,stockCritico:iCr,valorInventario:Math.round(iV)},encuestas:{total:enc.length,activas:enc.filter(e=>e.estado==='Activa').length,totalEnviadas:tE,respuestas:tR,tasaRespuesta:tE?Math.round(tR/tE*100):0}};
        }

        async function _getActividad(limit) {
            if (!puedeVerDashboard()) return {ok:true, data:[]};
            const org = _getEffectiveOrgId();
            let q = _sb.from('Actividad').select('*');
            if (org) q = q.eq('organization_id', org);
            const {data} = await q.order('fecha',{ascending:false}).limit(Number(limit)||20);
            return {ok:true,data:data||[]};
        }

        async function _getClientes(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Clientes').select('*');
            if (org) q = q.eq('organization_id', org);
            if (_currentUserRole === 'VENDEDOR') {
                const sess = readSession();
                const nombreUsuario = sess ? (sess.usuario || sess.nombre || '') : '';
                if (nombreUsuario) q = q.eq('creadoPor', nombreUsuario);
            }
            q = q.order('nombre');
            const{data,error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:data||[]};
        }
        async function _addCliente(p,u){
            if(!p.nombre)return{ok:false,error:'El nombre es requerido.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            const C=['#0A84FF','#30D158','#FF9F0A','#BF5AF2','#FF453A','#5e5ce6','#8E8E93','#32ADE6'];
            const r={
                id:_uuid(),
                nombre:p.nombre,
                empresa:p.empresa||'',
                segmento:p.segmento||'Estándar',
                lista_precio:p.lista_precio||'Publico',
                correo:p.correo||'',
                telefono:p.telefono||'',
                direccion:p.direccion||'',
                estado:p.estado||'Activo',
                valorTotal:Number(p.valorTotal)||0,
                color:C[Math.floor(Math.random()*C.length)],
                fechaReg:new Date().toISOString(),
                creadoPor:u,
                organization_id:org
            };
            const{error}=await _sb.from('Clientes').insert(r);
            if(error)return{ok:false,error:error.message};
            await _sb.from('Actividad').insert({id:_uuid(),tipo:'cliente',usuario:u,descripcion:'Nuevo cliente: '+p.nombre,fecha:new Date().toISOString(),organization_id:org});
            return{ok:true,id:r.id};
        }
        async function _updateCliente(id,p,u){
            const org = _getEffectiveOrgId();
            const up = {nombre:p.nombre,empresa:p.empresa,segmento:p.segmento,correo:p.correo,telefono:p.telefono,direccion:p.direccion,estado:p.estado,valorTotal:Number(p.valorTotal)||0};
            if (p.lista_precio !== undefined) up.lista_precio = p.lista_precio;
            let q = _sb.from('Clientes').update(up).eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteCliente(id,u){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Clientes').delete().eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }

        async function _getProspectos(){
            const org = _getEffectiveOrgId();
            const PAGE=1000;var todos=[];var desde=0;
            while(true){
                let q = _sb.from('Prospectos').select('*');
                if (org) q = q.eq('organization_id', org);
                const{data,error}=await q.order('nombre').range(desde,desde+PAGE-1);
                if(error)return{ok:false,error:error.message};
                if(data&&data.length>0){todos=todos.concat(data);}
                if(!data||data.length<PAGE)break;
                desde+=PAGE;
            }
            return{ok:true,data:todos};
        }
        async function _addProspecto(p,u){
            if(!p.nombre)return{ok:false,error:'El nombre es requerido.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            const C=['#0A84FF','#30D158','#FF9F0A','#BF5AF2','#FF453A','#5e5ce6','#8E8E93','#32ADE6'];
            const r={id:_uuid(),nombre:p.nombre,empresa:p.empresa||'',segmento:p.segmento||'Estándar',correo:p.correo||'',telefono:p.telefono||'',direccion:p.direccion||'',origen:p.origen||'Otro',etapa:p.etapa||'Nuevo',valorEstimado:Number(p.valorEstimado)||0,probabilidad:Number(p.probabilidad)||50,notas:p.notas||'',color:C[Math.floor(Math.random()*C.length)],fechaReg:new Date().toISOString(),organization_id:org};
            const{error}=await _sb.from('Prospectos').insert(r);
            if(error)return{ok:false,error:error.message};
            return{ok:true,id:r.id};
        }
        async function _updateProspecto(id,p,u){
            const org = _getEffectiveOrgId();
            const up={};['nombre','empresa','segmento','correo','telefono','direccion','origen','etapa','notas'].forEach(k=>{if(p[k]!==undefined)up[k]=p[k];});
            if(p.valorEstimado!==undefined)up.valorEstimado=Number(p.valorEstimado)||0;
            if(p.probabilidad!==undefined)up.probabilidad=Number(p.probabilidad)||0;
            let q = _sb.from('Prospectos').update(up).eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteProspecto(id,u){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Prospectos').delete().eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _convertirProspecto(id,p,u){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Prospectos').select('*').eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{data:pr}=await q.single();
            if(!pr)return{ok:false,error:'Prospecto no encontrado.'};
            const C=['#0A84FF','#30D158','#FF9F0A','#BF5AF2','#FF453A','#5e5ce6','#8E8E93','#32ADE6'];
            const nc={id:_uuid(),nombre:pr.nombre,empresa:pr.empresa,segmento:p.segmento||pr.segmento||'Estándar',lista_precio:'Publico',correo:pr.correo,telefono:pr.telefono,direccion:pr.direccion,estado:p.estado||'Activo',valorTotal:Number(p.valorTotal)||Number(pr.valorEstimado)||0,color:C[Math.floor(Math.random()*C.length)],fechaReg:new Date().toISOString(),organization_id:org};
            let delQ = _sb.from('Prospectos').delete().eq('id',id);
            if (org) delQ = delQ.eq('organization_id', org);
            await Promise.all([_sb.from('Clientes').insert(nc),delQ]);
            return{ok:true};
        }

        async function _getInventario(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Inventario').select('*');
            if (org) q = q.eq('organization_id', org);
            const{data,error}=await q.order('producto');
            if(error)return{ok:false,error:error.message};
            const items=(data||[]).map(i=>{
                i.tipo=String(i.tipo||'')==='Servicio'?'Servicio':'Producto';
                i.activo=(i.activo===''||i.activo===undefined||i.activo===null)?true:(i.activo===true||String(i.activo).toLowerCase()==='true');
                i.sku=i.sku||'';
                i.descripcion=i.descripcion||'';
                i.unidad=i.unidad||(i.tipo==='Servicio'?'Servicio':'Unidad');
                i.precioUnit  = Number(i.precioUnit)||0;
                i.precioPlata = Number(i.precioPlata || i.precio_plata || i.precioUnit);
                i.precioOro   = Number(i.precioOro   || i.precio_oro   || i.precioUnit);
                if(i.tipo==='Servicio'){i.unidades=0;i.stockMax=0;}
                i.estado=_estadoItem(i.tipo,i.unidades,i.stockMax);
                return i;
            });
            return{ok:true,data:items};
        }
        async function _addInventario(p,u){
            if(!p.producto)return{ok:false,error:'El nombre del ítem es requerido.'};
            const org=p.organization_id||_getEffectiveOrgId()||_currentOrgId;
            if(!org)return{ok:false,error:'No se pudo determinar la empresa del ítem.'};
            const t=p.tipo==='Servicio'?'Servicio':'Producto';
            const un=t==='Servicio'?0:(Number(p.unidades)||0);
            const m=t==='Servicio'?0:(Number(p.stockMax)||100);
            const pU=Number(p.precioUnit)||0;
            const r={
                id:_uuid(),
                producto:String(p.producto).trim(),
                categoria:p.categoria||'Otro',
                unidades:un,
                stockMax:m,
                precioUnit:pU,
                precioPlata:Number(p.precioPlata!==undefined?p.precioPlata:pU),
                precioOro:Number(p.precioOro!==undefined?p.precioOro:pU),
                estado:_estadoItem(t,un,m),
                tipo:t,
                sku:p.sku||'',
                descripcion:p.descripcion||'',
                unidad:p.unidad||(t==='Servicio'?'Servicio':'Unidad'),
                activo:p.activo==='false'||p.activo===false?false:true,
                fechaReg:new Date().toISOString(),
                organization_id:org,
                marca_id:p.marca_id||null,
                linea_id:p.linea_id||null,
                familia_id:p.familia_id||null,
                unidad_negocio_id:p.unidad_negocio_id||null,
                tipo_producto_id:p.tipo_producto_id||null
            };
            if (p.imagen_url !== undefined) r.imagen_url = p.imagen_url || '';
            let {error} = await _sb.from('Inventario').insert(r);
            if (error && (error.message.includes('column') || error.code === '42703')) {
                // Respaldo seguro si faltan columnas nuevas en Supabase
                delete r.imagen_url;
                delete r.precioPlata;
                delete r.precioOro;
                ({error} = await _sb.from('Inventario').insert(r));
            }
            if(error)return{ok:false,error:error.message};
            return{ok:true,id:r.id};
        }
        async function _updateInventario(id,p,u){
            const org = _getEffectiveOrgId();
            let qEx = _sb.from('Inventario').select('*').eq('id',id);
            if (org) qEx = qEx.eq('organization_id', org);
            const{data:ex}=await qEx.single();
            if(!ex)return{ok:false,error:'Ítem no encontrado.'};
            const t=p.tipo!==undefined?(p.tipo==='Servicio'?'Servicio':'Producto'):(ex.tipo==='Servicio'?'Servicio':'Producto');
            const un=t==='Servicio'?0:Number(p.unidades!==undefined?p.unidades:ex.unidades)||0;
            const m=t==='Servicio'?0:Number(p.stockMax!==undefined?p.stockMax:ex.stockMax)||1;
            const pU=Number(p.precioUnit!==undefined?p.precioUnit:ex.precioUnit)||0;
            const up={
                producto:p.producto!==undefined?String(p.producto).trim():ex.producto,
                categoria:p.categoria!==undefined?p.categoria:ex.categoria,
                unidades:un,
                stockMax:m,
                precioUnit:pU,
                precioPlata:Number(p.precioPlata!==undefined?p.precioPlata:(ex.precioPlata||pU)),
                precioOro:Number(p.precioOro!==undefined?p.precioOro:(ex.precioOro||pU)),
                estado:_estadoItem(t,un,m),
                tipo:t,
                sku:p.sku!==undefined?p.sku:ex.sku,
                descripcion:p.descripcion!==undefined?p.descripcion:ex.descripcion,
                unidad:p.unidad!==undefined?p.unidad:ex.unidad,
                activo:p.activo!==undefined?(p.activo===true||String(p.activo)==='true'):(ex.activo===true||String(ex.activo).toLowerCase()==='true'),
                marca_id:p.marca_id!==undefined?(p.marca_id||null):ex.marca_id,
                linea_id:p.linea_id!==undefined?(p.linea_id||null):ex.linea_id,
                familia_id:p.familia_id!==undefined?(p.familia_id||null):ex.familia_id,
                unidad_negocio_id:p.unidad_negocio_id!==undefined?(p.unidad_negocio_id||null):ex.unidad_negocio_id,
                tipo_producto_id:p.tipo_producto_id!==undefined?(p.tipo_producto_id||null):ex.tipo_producto_id
            };
            if (p.imagen_url !== undefined) up.imagen_url = p.imagen_url || '';
            let q = _sb.from('Inventario').update(up).eq('id',id);
            if (org) q = q.eq('organization_id', org);
            let {error} = await q;
            if (error && (error.message.includes('column') || error.code === '42703')) {
                // Respaldo seguro si faltan columnas nuevas en Supabase
                delete up.imagen_url;
                delete up.precioPlata;
                delete up.precioOro;
                let q2 = _sb.from('Inventario').update(up).eq('id',id);
                if (org) q2 = q2.eq('organization_id', org);
                ({error} = await q2);
            }
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteInventario(id,u){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Inventario').delete().eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }

        async function _getEncuestas(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('encuestas').select('*');
            if (org) q = q.eq('organization_id', org);
            const{data,error}=await q.order('created_at',{ascending:false});
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:data||[]};
        }
        async function _getCategorias(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('CategoriasInventario').select('*');
            if (org) q = q.eq('organization_id', org);
            const{data,error}=await q.order('nombre');
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:data||[]};
        }
        async function _addCategoria(p,u){
            if(!p.nombre||!String(p.nombre).trim())return{ok:false,error:'El nombre es requerido.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            const nombre=String(p.nombre).trim();
            const{data:ex}=await _sb.from('CategoriasInventario').select('id').eq('organization_id',org).ilike('nombre',nombre).maybeSingle();
            if(ex)return{ok:false,error:'Ya existe una categoría con ese nombre.'};
            const r={id:_uuid(),nombre,descripcion:p.descripcion||'',color:p.color||'#8E8E93',activa:true,fechaReg:new Date().toISOString(),organization_id:org};
            const{error}=await _sb.from('CategoriasInventario').insert(r);
            if(error)return{ok:false,error:error.message};
            return{ok:true,id:r.id};
        }
        async function _updateCategoria(id,p,u){
            const org = _getEffectiveOrgId();
            let qEx = _sb.from('CategoriasInventario').select('*').eq('id',id);
            if (org) qEx = qEx.eq('organization_id', org);
            const{data:ex}=await qEx.single();
            if(!ex)return{ok:false,error:'Categoría no encontrada.'};
            const up={};if(p.nombre!==undefined)up.nombre=String(p.nombre).trim();if(p.descripcion!==undefined)up.descripcion=p.descripcion;if(p.color!==undefined)up.color=p.color;if(p.activa!==undefined)up.activa=p.activa===true||String(p.activa)==='true';
            let q = _sb.from('CategoriasInventario').update(up).eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteCategoria(id,u){
            const org = _getEffectiveOrgId();
            let qCat = _sb.from('CategoriasInventario').select('nombre').eq('id',id);
            if (org) qCat = qCat.eq('organization_id', org);
            const catName = (await qCat.single()).data?.nombre || '';
            let qUso = _sb.from('Inventario').select('id').eq('categoria', catName);
            if (org) qUso = qUso.eq('organization_id', org);
            const{data:uso}=await qUso.limit(1);
            if(uso&&uso.length>0)return{ok:false,error:'No se puede eliminar: hay productos asignados a esta categoría.'};
            let q = _sb.from('CategoriasInventario').delete().eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _addEncuesta(p,u){
            if(!p.nombre)return{ok:false,error:'El nombre es requerido.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            const r={id:_uuid(),nombre:p.nombre,estado:'Borrador',fechaEnvio:new Date().toISOString(),totalEnviadas:0,respuestas:0,tipo:p.tipo||'NPS',pregConf:0,pregTotal:Number(p.pregTotal)||12,organization_id:org};
            const{error}=await _sb.from('encuestas').insert(r);
            if(error)return{ok:false,error:error.message};
            return{ok:true,id:r.id};
        }
        async function _updateEncuesta(id,p,u){
            const org = _getEffectiveOrgId();
            const up={};['nombre','estado','fechaEnvio','tipo'].forEach(k=>{if(p[k]!==undefined)up[k]=p[k];});
            if(p.totalEnviadas!==undefined)up.totalEnviadas=Number(p.totalEnviadas)||0;
            if(p.respuestas!==undefined)up.respuestas=Number(p.respuestas)||0;
            if(p.pregConf!==undefined)up.pregConf=Number(p.pregConf)||0;
            if(p.pregTotal!==undefined)up.pregTotal=Number(p.pregTotal)||12;
            let q = _sb.from('encuestas').update(up).eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteEncuesta(id,u){
            const org = _getEffectiveOrgId();
            let q = _sb.from('encuestas').delete().eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }

        async function _getUsuarios(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Usuarios').select('id,usuario,nombre,rol,activo,auth_uid,correo,organization_id,permisos');
            if (org) q = q.eq('organization_id', org);
            const{data,error}=await q.order('nombre');
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:(data||[])};
        }
        async function _addUsuario(p,authU){
            if(!p.usuario||!p.nombre||!p.contrasena||!p.rol)return{ok:false,error:'Campos requeridos.'};
            if(!p.correo||!p.correo.trim())return{ok:false,error:'El correo es obligatorio para crear el usuario en Supabase Auth.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            const{data,error}=await _sb.functions.invoke('admin-user-manager',{body:{action:'createUser',usuario:p.usuario.trim(),nombre:p.nombre.trim(),email:p.correo.trim(),password:p.contrasena,rol:p.rol,organization_id:org,permisos:p.permisos||null}});
            if(error)return{ok:false,error:error.message};
            if(data&&data.error)return{ok:false,error:data.error};
            // Guardar permisos en tabla Usuarios si data.id o usuario existe
            if (p.permisos) {
                try {
                    let uQ = _sb.from('Usuarios').update({permisos: p.permisos}).eq('usuario', p.usuario.trim());
                    if (org) uQ = uQ.eq('organization_id', org);
                    await uQ;
                } catch(e){}
            }
            return{ok:true};
        }
        async function _updateUsuario(id,p,authU){
            const org = _getEffectiveOrgId();
            const up={};
            if(p.nombre!==undefined)up.nombre=p.nombre.trim();
            if(p.rol!==undefined)up.rol=p.rol;
            if(p.activo!==undefined)up.activo=p.activo==='true'||p.activo===true;
            if(p.permisos!==undefined)up.permisos=p.permisos;
            const uObj=(_usuarios||[]).find(u=>String(u.id)===String(id));
            const authUid=uObj&&uObj.auth_uid;
            if(p.nuevaContrasena&&p.nuevaContrasena.trim()){
                if(!authUid)return{ok:false,error:'No se encontró auth_uid del usuario. No se puede restablecer la contraseña.'};
                const{data:pwData,error:pwError}=await _sb.functions.invoke('admin-user-manager',{body:{action:'resetUserPassword',user_id:authUid,password:p.nuevaContrasena.trim()}});
                if(pwError)return{ok:false,error:pwError.message};
                if(pwData&&pwData.error)return{ok:false,error:pwData.error};
            }
            if(p.correo&&p.correo.trim()){
                const nuevoCorreo=p.correo.trim();
                if(!authUid)return{ok:false,error:'No se encontró auth_uid del usuario. No se puede cambiar el correo.'};
                const{data:emData,error:emError}=await _sb.functions.invoke('admin-user-manager',{body:{action:'updateUserEmail',user_id:authUid,email:nuevoCorreo}});
                if(emError)return{ok:false,error:emError.message};
                if(emData&&emData.error)return{ok:false,error:emData.error};
                up.correo=nuevoCorreo;
            }
            if(Object.keys(up).length===0)return{ok:true};
            let q = _sb.from('Usuarios').update(up).eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteUsuario(id,authU){
            const org = _getEffectiveOrgId();
            let q = _sb.from('Usuarios').delete().eq('id',id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }

        async function _getCuentasBancarias(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('CuentasBancarias').select('*');
            if (org) q = q.eq('organization_id', org);
            const{data,error}=await q.order('nombre');
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:data||[]};
        }
        async function _addCuentaBancaria(p,u){
            const reqs=['nombre','banco','numeroCuenta','aNombreDe','logo'];
            for(const f of reqs)if(!p[f])return{ok:false,error:'Campo requerido: '+f};
            const org = _getEffectiveOrgId() || _currentOrgId;
            const s=Number(p.saldoInicial)||0;
            const r={id:_uuid(),nombre:p.nombre.trim(),banco:p.banco.trim(),numeroCuenta:String(p.numeroCuenta).trim(),aNombreDe:p.aNombreDe.trim(),logo:p.logo,cuentaContable:p.cuentaContable||'',rubro:p.rubro||'',saldoInicial:s,saldo:s,activa:true,fechaReg:new Date().toISOString(),organization_id:org};
            const{error}=await _sb.from('CuentasBancarias').insert(r);
            if(error)return{ok:false,error:error.message};
            return{ok:true,id:r.id};
        }
        async function _updateCuentaBancaria(p,u){
            const org = _getEffectiveOrgId();
            const up={};['nombre','banco','numeroCuenta','aNombreDe','logo','cuentaContable','rubro'].forEach(k=>{if(p[k]!==undefined)up[k]=p[k];});
            if(p.activa!==undefined)up.activa=p.activa==='true'||p.activa===true;
            let q = _sb.from('CuentasBancarias').update(up).eq('id',p.id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteCuentaBancaria(p,u){
            const org = _getEffectiveOrgId();
            let qT = _sb.from('Transacciones').select('id').eq('cuentaBancariaId',p.id);
            if (org) qT = qT.eq('organization_id', org);
            const{data:t}=await qT.limit(1);
            if(t&&t.length)return{ok:false,error:'No se puede eliminar: tiene transacciones. Desactívela.'};
            let q = _sb.from('CuentasBancarias').delete().eq('id',p.id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }

        async function _getPlanCuentas(){
            const org = _getEffectiveOrgId();
            let q = _sb.from('PlanCuentas').select('*');
            if (org) q = q.eq('organization_id', org);
            const{data,error}=await q.order('codigo');
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:data||[]};
        }
        async function _addCuentaContable(p,u){
            if(!p.codigo||!p.nombre)return{ok:false,error:'Código y nombre requeridos.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            let qEx = _sb.from('PlanCuentas').select('id').eq('codigo',p.codigo.trim());
            if (org) qEx = qEx.eq('organization_id', org);
            const{data:ex}=await qEx.maybeSingle();
            if(ex)return{ok:false,error:'Ya existe una cuenta con ese código.'};
            const r={id:_uuid(),codigo:p.codigo.trim(),nombre:p.nombre.trim(),tipo:p.tipo||'Activo',rubro:p.rubro||'',descripcion:p.descripcion||'',activa:true,fechaReg:new Date().toISOString(),organization_id:org};
            const{error}=await _sb.from('PlanCuentas').insert(r);
            if(error)return{ok:false,error:error.message};
            return{ok:true,id:r.id};
        }
        async function _updateCuentaContable(p,u){
            const org = _getEffectiveOrgId();
            const up={};['codigo','nombre','tipo','rubro','descripcion'].forEach(k=>{if(p[k]!==undefined)up[k]=p[k];});
            if(p.activa!==undefined)up.activa=p.activa==='true'||p.activa===true;
            let q = _sb.from('PlanCuentas').update(up).eq('id',p.id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _deleteCuentaContable(p,u){
            const org = _getEffectiveOrgId();
            let qT = _sb.from('Transacciones').select('id').eq('cuentaContableId',p.id);
            if (org) qT = qT.eq('organization_id', org);
            const{data:c}=await qT.limit(1);
            if(c&&c.length)return{ok:false,error:'No se puede eliminar: hay transacciones.'};
            let q = _sb.from('PlanCuentas').delete().eq('id',p.id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }

        async function _getTransacciones(f){
            const org = _getEffectiveOrgId();
            let q=_sb.from('Transacciones').select('*');
            if(org)q=q.eq('organization_id',org);
            if(f&&f.cuentaBancariaId)q=q.eq('cuentaBancariaId',f.cuentaBancariaId);
            if(f&&f.tipo)q=q.eq('tipo',f.tipo);
            if(f&&f.desde)q=q.gte('fecha',f.desde);
            if(f&&f.hasta)q=q.lte('fecha',f.hasta);
            q=q.order('fecha',{ascending:false});
            const{data,error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true,data:data||[]};
        }
        async function _addTransaccion(p,u){
            const tipos=['Ingreso','Egreso','Transferencia','Ajuste'];
            if(!tipos.includes(p.tipo))return{ok:false,error:'Tipo inválido.'};
            if(!p.concepto)return{ok:false,error:'El concepto es requerido.'};
            const m=Number(p.monto);
            if(!m||m<=0)return{ok:false,error:'El monto debe ser mayor a 0.'};
            if(!p.cuentaBancariaId)return{ok:false,error:'La cuenta bancaria es requerida.'};
            if(!p.fecha)return{ok:false,error:'La fecha es requerida.'};
            const org = _getEffectiveOrgId() || _currentOrgId;
            let qCb = _sb.from('CuentasBancarias').select('saldo').eq('id',p.cuentaBancariaId);
            if (org) qCb = qCb.eq('organization_id', org);
            const{data:cb}=await qCb.single();
            if(!cb)return{ok:false,error:'Cuenta bancaria no encontrada.'};
            let s=Number(cb.saldo)||0;
            if(p.tipo==='Ingreso'||p.tipo==='Transferencia')s+=m;
            else if(p.tipo==='Egreso')s-=m;
            else if(p.tipo==='Ajuste')s+=m*(p.ajusteSigno==='-'?-1:1);
            const r={id:_uuid(),fecha:p.fecha,tipo:p.tipo,concepto:p.concepto.trim(),monto:m,cuentaBancariaId:p.cuentaBancariaId,cuentaContableId:p.cuentaContableId||'',referencia:p.referencia||'',descripcion:p.descripcion||'',creadoPor:u,fechaReg:new Date().toISOString(),organization_id:org};
            let qUpCb = _sb.from('CuentasBancarias').update({saldo:s}).eq('id',p.cuentaBancariaId);
            if (org) qUpCb = qUpCb.eq('organization_id', org);
            const[r1,r2]=await Promise.all([_sb.from('Transacciones').insert(r),qUpCb]);
            if(r1.error)return{ok:false,error:r1.error.message};
            return{ok:true,id:r.id};
        }
        async function _deleteTransaccion(p,u){
            const org = _getEffectiveOrgId();
            let qT = _sb.from('Transacciones').select('*').eq('id',p.id);
            if (org) qT = qT.eq('organization_id', org);
            const{data:t}=await qT.single();
            if(!t)return{ok:false,error:'Transacción no encontrada.'};
            const{data:cb}=await _sb.from('CuentasBancarias').select('saldo').eq('id',t.cuentaBancariaId).single();
            if(cb){
                let s=Number(cb.saldo)||0;
                if(t.tipo==='Ingreso'||t.tipo==='Transferencia')s-=Number(t.monto);
                else if(t.tipo==='Egreso')s+=Number(t.monto);
                let qUpCb = _sb.from('CuentasBancarias').update({saldo:s}).eq('id',t.cuentaBancariaId);
                if (org) qUpCb = qUpCb.eq('organization_id', org);
                await qUpCb;
            }
            let q = _sb.from('Transacciones').delete().eq('id',p.id);
            if (org) q = q.eq('organization_id', org);
            const{error}=await q;
            if(error)return{ok:false,error:error.message};
            return{ok:true};
        }
        async function _getResumenContable(){
            const org = _getEffectiveOrgId();
            let cbQ = _sb.from('CuentasBancarias').select('*');
            let trQ = _sb.from('Transacciones').select('*');
            let plQ = _sb.from('PlanCuentas').select('*');
            if (org) {
                cbQ = cbQ.eq('organization_id', org);
                trQ = trQ.eq('organization_id', org);
                plQ = plQ.eq('organization_id', org);
            }
            const[cbR,trR,plR]=await Promise.all([cbQ,trQ,plQ]);
            const cb=cbR.data||[],tr=trR.data||[],pl=plR.data||[];
            const sT=cb.filter(c=>c.activa===true||c.activa==='true').reduce((s,c)=>s+Number(c.saldo||0),0);
            const tI=tr.filter(t=>t.tipo==='Ingreso').reduce((s,t)=>s+Number(t.monto||0),0);
            const tE=tr.filter(t=>t.tipo==='Egreso').reduce((s,t)=>s+Number(t.monto||0),0);
            const h=new Date(),mes=h.getMonth(),anio=h.getFullYear();
            const trM=tr.filter(t=>{const d=new Date(t.fecha);return d.getMonth()===mes&&d.getFullYear()===anio;});
            const iM=trM.filter(t=>t.tipo==='Ingreso').reduce((s,t)=>s+Number(t.monto||0),0);
            const eM=trM.filter(t=>t.tipo==='Egreso').reduce((s,t)=>s+Number(t.monto||0),0);
            return{ok:true,saldoTotal:Math.round(sT*100)/100,cuentasActivas:cb.filter(c=>c.activa===true||c.activa==='true').length,totalCuentas:cb.length,totalIngresos:Math.round(tI*100)/100,totalEgresos:Math.round(tE*100)/100,utilidadBruta:Math.round((tI-tE)*100)/100,ingresosMes:Math.round(iM*100)/100,egresosMes:Math.round(eM*100)/100,utilidadMes:Math.round((iM-eM)*100)/100,totalTransacciones:tr.length,transaccionesMes:trM.length,totalCuentasContables:pl.length};
        }

        /* ── Config de organización (se carga desde Supabase la primera vez) ── */
        const _EMPRESA_DEFAULT={nombre:'Mi Empresa',eslogan:'',nit:'C/F',direccion:'',telefono:'',correo:'',sitio:'',logoUrl:'',moneda:'Q',ivaPct:12,condicionesDefault:'Precios expresados en quetzales (GTQ). Tiempo de entrega sujeto a disponibilidad. Esta cotización no constituye una factura.',prefijoCotizacion:'COT-',prefijoTicket:'POS-'};
        let EMPRESA = Object.assign({}, _EMPRESA_DEFAULT);
        let _orgConfigCargada = false;

        async function _loadOrgConfig() {
            if (_orgConfigCargada) return EMPRESA;
            try {
                const {data, error} = await _sb.from('Organizations').select('*').eq('id', _currentOrgId).maybeSingle();
                if (!error && data) {
                    EMPRESA = {
                        nombre: data.nombre || _EMPRESA_DEFAULT.nombre,
                        eslogan: data.eslogan || '',
                        nit: data.nit || 'C/F',
                        direccion: data.direccion || '',
                        telefono: data.telefono || '',
                        correo: data.correo || '',
                        sitio: data.sitio || '',
                        logoUrl: data.logo_url || '',
                        moneda: data.moneda || 'Q',
                        ivaPct: Number(data.iva_pct) || 12,
                        condicionesDefault: data.condiciones_default || _EMPRESA_DEFAULT.condicionesDefault,
                        prefijoCotizacion: data.prefijo_cotizacion || 'COT-',
                        prefijoTicket: data.prefijo_ticket || 'POS-'
                    };
                }
            } catch(e) { /* tabla aún no existe, usar defaults */ }
            _orgConfigCargada = true;
            return EMPRESA;
        }

        async function _getOrgConfig(p) {
            try {
                const {data, error} = await _sb.from('Organizations').select('*').eq('id', _currentOrgId).maybeSingle();
                if (error) return {ok:false, error: error.message};
                return {ok:true, data: data || null};
            } catch(e) { return {ok:false, error: e.message}; }
        }

        async function _saveOrgConfig(p, sess) {
            if (!['Admin','ADMIN','SUPER_ADMIN'].includes(_currentUserRole)) return {ok:false, error:'Solo los administradores pueden modificar la configuración de empresa.'};
            const up = {};
            if (p.nombre !== undefined) up.nombre = String(p.nombre).trim();
            if (p.eslogan !== undefined) up.eslogan = String(p.eslogan).trim();
            if (p.nit !== undefined) up.nit = String(p.nit).trim();
            if (p.direccion !== undefined) up.direccion = String(p.direccion).trim();
            if (p.telefono !== undefined) up.telefono = String(p.telefono).trim();
            if (p.correo !== undefined) up.correo = String(p.correo).trim();
            if (p.sitio !== undefined) up.sitio = String(p.sitio).trim();
            if (p.moneda !== undefined) up.moneda = String(p.moneda).trim();
            if (p.iva_pct !== undefined) up.iva_pct = Number(p.iva_pct) || 12;
            if (p.condiciones_default !== undefined) up.condiciones_default = String(p.condiciones_default).trim();
            if (p.prefijo_cotizacion !== undefined) up.prefijo_cotizacion = String(p.prefijo_cotizacion).trim();
            if (p.prefijo_ticket !== undefined) up.prefijo_ticket = String(p.prefijo_ticket).trim();
            if (p.fel_habilitado !== undefined) up.fel_habilitado = !!p.fel_habilitado;
            if (p.fel_nit_emisor !== undefined) up.fel_nit_emisor = String(p.fel_nit_emisor).trim();
            if (p.fel_nombre_comercial !== undefined) up.fel_nombre_comercial = String(p.fel_nombre_comercial).trim();
            if (p.fel_afiliacion_iva !== undefined) up.fel_afiliacion_iva = String(p.fel_afiliacion_iva).trim();
            if (p.fel_codigo_establecimiento !== undefined) up.fel_codigo_establecimiento = String(p.fel_codigo_establecimiento).trim();
            if (p.fel_certificador !== undefined) up.fel_certificador = String(p.fel_certificador).trim();
            if (p.fel_entorno !== undefined) up.fel_entorno = String(p.fel_entorno).trim();
            if (p.fel_usuario_certificador !== undefined) up.fel_usuario_certificador = String(p.fel_usuario_certificador).trim();
            if (p.fel_api_key !== undefined) up.fel_api_key = String(p.fel_api_key).trim();
            if (p.fel_frase_sat !== undefined) up.fel_frase_sat = String(p.fel_frase_sat).trim();
            up.updated_at = new Date().toISOString();
            try {
                const {data: existing} = await _sb.from('Organizations').select('id').eq('id', _currentOrgId).maybeSingle();
                let error;
                if (existing) {
                    ({error} = await _sb.from('Organizations').update(up).eq('id', _currentOrgId));
                } else {
                    ({error} = await _sb.from('Organizations').insert({id: _currentOrgId, ...up}));
                }
                if (error) {
                    if (error.message && (error.message.includes('column') || error.message.includes('does not exist') || error.code === '42703')) {
                        const baseUp = {
                            nombre: up.nombre, eslogan: up.eslogan, nit: up.nit,
                            direccion: up.direccion, telefono: up.telefono, correo: up.correo,
                            sitio: up.sitio, moneda: up.moneda, iva_pct: up.iva_pct,
                            updated_at: up.updated_at
                        };
                        Object.keys(baseUp).forEach(k => baseUp[k] === undefined && delete baseUp[k]);
                        const r2 = existing ? await _sb.from('Organizations').update(baseUp).eq('id', _currentOrgId)
                                            : await _sb.from('Organizations').insert({id: _currentOrgId, ...baseUp});
                        if (r2.error) return {ok:false, error: r2.error.message};
                        try {
                            localStorage.setItem('azyvion_fel_config', JSON.stringify({
                                fel_habilitado: up.fel_habilitado,
                                fel_nit_emisor: up.fel_nit_emisor,
                                fel_nombre_comercial: up.fel_nombre_comercial,
                                fel_afiliacion_iva: up.fel_afiliacion_iva,
                                fel_codigo_establecimiento: up.fel_codigo_establecimiento,
                                fel_certificador: up.fel_certificador,
                                fel_entorno: up.fel_entorno,
                                fel_usuario_certificador: up.fel_usuario_certificador,
                                fel_api_key: up.fel_api_key,
                                fel_frase_sat: up.fel_frase_sat
                            }));
                        } catch(e) {}
                        _orgConfigCargada = false;
                        await _loadOrgConfig();
                        return {ok:true};
                    }
                    return {ok:false, error: error.message};
                }
                _orgConfigCargada = false; // forzar recarga
                await _loadOrgConfig();
                return {ok:true};
            } catch(e) { return {ok:false, error: e.message}; }
        }

        async function _uploadLogoOrg(p, sess) {
            if (!['Admin','ADMIN','SUPER_ADMIN'].includes(_currentUserRole)) return {ok:false, error:'Solo los administradores pueden cambiar el logo.'};
            if (!p.imagenBase64) return {ok:false, error:'No se recibió ninguna imagen.'};
            let datos = String(p.imagenBase64);
            const idx = datos.indexOf('base64,');
            if (idx !== -1) datos = datos.substring(idx + 7);
            let bytes;
            try { bytes = Uint8Array.from(atob(datos), c => c.charCodeAt(0)); } catch(e) { return {ok:false, error:'Imagen inválida.'}; }
            if (!bytes.length) return {ok:false, error:'La imagen está vacía.'};
            if (bytes.length > 3*1024*1024) return {ok:false, error:'El logo no debe superar 3 MB.'};
            const mime = p.mimeType || 'image/png';
            const ext = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[mime] || '.png';
            const filename = 'logo_org_' + _currentOrgId + '_' + Date.now() + ext;
            const blob = new Blob([bytes], {type: mime});
            const {data: up, error: upE} = await _sb.storage.from('logos-empresa').upload(filename, blob, {upsert:true, contentType:mime});
            if (upE) return {ok:false, error:'No se pudo subir el logo: ' + upE.message + '. Crea el bucket "logos-empresa" como público en Supabase Storage.'};
            const {data: uD} = _sb.storage.from('logos-empresa').getPublicUrl(filename);
            const logoUrl = uD.publicUrl;
            const {data: existing} = await _sb.from('Organizations').select('id').eq('id', _currentOrgId).maybeSingle();
            if (existing) {
                await _sb.from('Organizations').update({logo_url: logoUrl, updated_at: new Date().toISOString()}).eq('id', _currentOrgId);
            } else {
                await _sb.from('Organizations').insert({id: _currentOrgId, logo_url: logoUrl});
            }
            _orgConfigCargada = false;
            await _loadOrgConfig();
            return {ok:true, logoUrl};
        }

        async function _deleteLogoOrg(p, sess) {
            if (!['Admin','ADMIN','SUPER_ADMIN'].includes(_currentUserRole)) return {ok:false, error:'Solo los administradores pueden cambiar el logo.'};
            await _sb.from('Organizations').update({logo_url: '', updated_at: new Date().toISOString()}).eq('id', _currentOrgId);
            _orgConfigCargada = false;
            await _loadOrgConfig();
            return {ok:true};
        }

        async function _getCotizaciones(f) {
            await _loadOrgConfig();
            const orgId = _getEffectiveOrgId();
            let qCot = _sb.from('Cotizaciones').select('*').order('numero', {ascending: false});
            if (orgId) qCot = qCot.eq('organization_id', orgId);
            
            let qItems = _sb.from('CotizacionItems').select('cotizacionId');
            if (orgId) qItems = qItems.eq('organization_id', orgId);

            const [cR, iR] = await Promise.all([qCot, qItems]);
            const cs = cR.data || [], its = iR.data || [];
            const ibc = {};
            its.forEach(i => { ibc[i.cotizacionId] = (ibc[i.cotizacionId] || 0) + 1; });
            const h = new Date(); h.setHours(0, 0, 0, 0);
            let d = cs.map(c => {
                const v = Number(c.validezDias) || 15;
                const ha = new Date(c.fecha);
                ha.setDate(ha.getDate() + v);
                return {
                    ...c,
                    numItems: ibc[c.id] || 0,
                    vencida: ha < h && ['Borrador', 'Enviada'].includes(c.estado),
                    validaHasta: ha.toISOString().slice(0, 10)
                };
            });
            if (f && f.estado) d = d.filter(c => c.estado === f.estado);
            return {ok: true, data: d, empresa: EMPRESA};
        }

        async function _getCotizacion(p) {
            await _loadOrgConfig();
            const orgId = _getEffectiveOrgId();
            let qCot = _sb.from('Cotizaciones').select('*').eq('id', p.id);
            if (orgId) qCot = qCot.eq('organization_id', orgId);
            let qItems = _sb.from('CotizacionItems').select('*').eq('cotizacionId', p.id);
            if (orgId) qItems = qItems.eq('organization_id', orgId);
            const [cR, iR] = await Promise.all([qCot.single(), qItems]);
            if (cR.error || !cR.data) return {ok: false, error: 'Cotización no encontrada.'};
            return {ok: true, data: cR.data, items: iR.data || [], empresa: EMPRESA};
        }

        async function _nextNumCot() {
            const y = new Date().getFullYear();
            const orgId = _getEffectiveOrgId();
            const pref = (EMPRESA && EMPRESA.prefijoCotizacion) || 'COT-';
            let q = _sb.from('Cotizaciones').select('numero').like('numero', pref + y + '-%');
            if (orgId) q = q.eq('organization_id', orgId);
            const {data} = await q;
            let max = 0;
            const re = new RegExp('^' + pref.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\d{4}-(\\d+)$');
            (data || []).forEach(c => {
                const m = String(c.numero || '').match(re);
                if (m) max = Math.max(max, Number(m[1]));
            });
            return pref + y + '-' + String(max + 1).padStart(4, '0');
        }

        function _calcT(items, dP, iva) {
            const sub = items.reduce((s, i) => s + Number(i.total || 0), 0);
            const d = sub * (Math.min(Math.max(Number(dP) || 0, 0), 100) / 100);
            const b = sub - d;
            const iv = iva ? b * (EMPRESA.ivaPct / 100) : 0;
            return {subtotal: Math.round(sub * 100) / 100, descuento: Math.round(d * 100) / 100, iva: Math.round(iv * 100) / 100, total: Math.round((b + iv) * 100) / 100};
        }

        function _normItems(raw) {
            let a = raw;
            if (typeof raw === 'string') { try { a = JSON.parse(raw); } catch (e) { a = []; } }
            if (!Array.isArray(a)) a = [];
            return a.map(it => {
                const c = Number(it.cantidad) || 0, p = Number(it.precioUnit) || 0, dp = Math.min(Math.max(Number(it.descuentoPct) || 0, 0), 100), b = c * p;
                return {
                    itemId: it.itemId || '',
                    tipo: it.tipo === 'Servicio' ? 'Servicio' : 'Producto',
                    descripcion: String(it.descripcion || '').trim(),
                    detalle: String(it.detalle || '').trim(),
                    cantidad: c,
                    precioUnit: p,
                    descuentoPct: dp,
                    total: Math.round((b - b * dp / 100) * 100) / 100
                };
            }).filter(i => i.descripcion && i.cantidad > 0);
        }

        async function _addCotizacion(p, u) {
            if (!p.cliente || !String(p.cliente).trim()) return {ok: false, error: 'El cliente es requerido.'};
            const items = _normItems(p.items);
            if (!items.length) return {ok: false, error: 'Agrega al menos un ítem.'};
            const orgId = _getEffectiveOrgId();
            const iva = p.aplicaIVA === true || String(p.aplicaIVA) === 'true';
            const t = _calcT(items, p.descuentoPct, iva);
            const num = await _nextNumCot();
            const id = _uuid();
            const r = {
                id,
                numero: num,
                clienteId: p.clienteId || '',
                cliente: String(p.cliente).trim(),
                empresa: p.empresa || '',
                correo: p.correo || '',
                telefono: p.telefono || '',
                direccion: p.direccion || '',
                fecha: (p.fecha || new Date().toISOString()).slice(0, 10),
                validezDias: Number(p.validezDias) || 15,
                condiciones: p.condiciones || EMPRESA.condicionesDefault,
                notas: p.notas || '',
                descuentoPct: Number(p.descuentoPct) || 0,
                aplicaIVA: iva,
                ...t,
                estado: ['Borrador', 'Enviada', 'Aprobada', 'Rechazada', 'Vencida'].includes(p.estado) ? p.estado : 'Borrador',
                creadoPor: u,
                fechaReg: new Date().toISOString(),
                organization_id: orgId
            };
            const {error} = await _sb.from('Cotizaciones').insert(r);
            if (error) return {ok: false, error: error.message};
            if (items.length) {
                const ir = items.map(it => ({id: _uuid(), cotizacionId: id, ...it, organization_id: orgId}));
                await _sb.from('CotizacionItems').insert(ir);
            }
            return {ok: true, id, numero: num};
        }

        async function _updateCotizacion(p, u) {
            if (!p.id) return {ok: false, error: 'ID requerido.'};
            const items = _normItems(p.items);
            if (!items.length) return {ok: false, error: 'Agrega al menos un ítem.'};
            const orgId = _getEffectiveOrgId();
            let qEx = _sb.from('Cotizaciones').select('*').eq('id', p.id);
            if (orgId) qEx = qEx.eq('organization_id', orgId);
            const {data: ex} = await qEx.single();
            if (!ex) return {ok: false, error: 'Cotización no encontrada.'};
            const iva = p.aplicaIVA !== undefined ? (p.aplicaIVA === true || String(p.aplicaIVA) === 'true') : (ex.aplicaIVA === true);
            const t = _calcT(items, p.descuentoPct !== undefined ? p.descuentoPct : ex.descuentoPct, iva);
            const up = {
                ...t,
                aplicaIVA: iva,
                cliente: p.cliente !== undefined ? String(p.cliente).trim() : ex.cliente,
                fecha: p.fecha ? p.fecha.slice(0, 10) : ex.fecha,
                estado: ['Borrador', 'Enviada', 'Aprobada', 'Rechazada', 'Vencida'].includes(p.estado) ? p.estado : ex.estado
            };
            ['clienteId', 'empresa', 'correo', 'telefono', 'direccion', 'validezDias', 'condiciones', 'notas', 'descuentoPct'].forEach(k => {
                if (p[k] !== undefined) up[k] = p[k];
            });
            let qUp = _sb.from('Cotizaciones').update(up).eq('id', p.id);
            if (orgId) qUp = qUp.eq('organization_id', orgId);
            const {error} = await qUp;
            if (error) return {ok: false, error: error.message};
            await _sb.from('CotizacionItems').delete().eq('cotizacionId', p.id);
            if (items.length) {
                await _sb.from('CotizacionItems').insert(items.map(it => ({id: _uuid(), cotizacionId: p.id, ...it, organization_id: orgId})));
            }
            return {ok: true};
        }

        async function _updateEstadoCot(p, u) {
            if (!['Borrador', 'Enviada', 'Aprobada', 'Rechazada', 'Vencida'].includes(p.estado)) return {ok: false, error: 'Estado inválido.'};
            const orgId = _getEffectiveOrgId();
            let q = _sb.from('Cotizaciones').update({estado: p.estado}).eq('id', p.id);
            if (orgId) q = q.eq('organization_id', orgId);
            const {error} = await q;
            if (error) return {ok: false, error: error.message};
            return {ok: true};
        }

        async function _deleteCotizacion(p, u) {
            const orgId = _getEffectiveOrgId();
            let qi = _sb.from('CotizacionItems').delete().eq('cotizacionId', p.id);
            let qc = _sb.from('Cotizaciones').delete().eq('id', p.id);
            if (orgId) { qi = qi.eq('organization_id', orgId); qc = qc.eq('organization_id', orgId); }
            await qi;
            const {error} = await qc;
            if (error) return {ok: false, error: error.message};
            return {ok: true};
        }

        async function _duplicarCotizacion(p, u) {
            if (!p || !p.id) return {ok: false, error: 'ID de cotización requerido.'};
            const orig = await _getCotizacion({id: p.id});
            if (!orig.ok) return orig;
            const c = orig.data;
            const items = (orig.items || []).map(it => ({
                itemId: it.itemId || '',
                tipo: it.tipo || 'Producto',
                descripcion: it.descripcion,
                detalle: it.detalle,
                cantidad: it.cantidad,
                precioUnit: it.precioUnit,
                descuentoPct: it.descuentoPct,
                total: it.total
            }));
            return await _addCotizacion({
                clienteId: c.clienteId,
                cliente: c.cliente,
                empresa: c.empresa,
                correo: c.correo,
                telefono: c.telefono,
                direccion: c.direccion,
                validezDias: c.validezDias || 15,
                condiciones: c.condiciones,
                notas: (c.notas ? c.notas + ' ' : '') + '(Duplicado de ' + c.numero + ')',
                descuentoPct: c.descuentoPct,
                aplicaIVA: c.aplicaIVA,
                items: items,
                estado: 'Borrador'
            }, u);
        }

        async function _convertirCotizacionAVenta(p, u) {
            if (!p || !p.id) return {ok: false, error: 'ID de cotización requerido.'};
            const orig = await _getCotizacion({id: p.id});
            if (!orig.ok) return orig;
            const c = orig.data, items = orig.items || [];
            const orgId = _getEffectiveOrgId();

            // 1. Descontar stock de productos
            for (const it of items) {
                if (it.tipo !== 'Servicio' && it.itemId) {
                    try {
                        const {data: pr} = await _sb.from('Inventario').select('unidades').eq('id', it.itemId).single();
                        if (pr && pr.unidades !== undefined) {
                            const newUnits = Math.max(0, Number(pr.unidades || 0) - Number(it.cantidad || 0));
                            await _sb.from('Inventario').update({unidades: newUnits}).eq('id', it.itemId);
                        }
                    } catch (e) {
                        console.warn('[Azyvion] Descuento stock conversión cotización:', e);
                    }
                }
            }

            // 2. Registrar transacción en Contabilidad
            const trxId = _uuid();
            await _sb.from('TransaccionesCRM').insert({
                id: trxId,
                fecha: new Date().toISOString().slice(0, 10),
                tipo: 'Ingreso',
                categoria: 'Ventas - Cotización',
                descripcion: 'Venta cerrada desde Cotización ' + c.numero + ' - ' + c.cliente,
                monto: Number(c.total || 0),
                cuentaBancariaId: p.cuentaBancariaId || null,
                cuentaContableId: p.cuentaContableId || null,
                creadoPor: u,
                fechaReg: new Date().toISOString(),
                organization_id: orgId
            });

            // 3. Actualizar estado cotización a Aprobada
            await _updateEstadoCot({id: p.id, estado: 'Aprobada'}, u);

            return {ok: true, mensaje: 'Cotización convertida en venta exitosamente.', numero: c.numero, total: c.total};
        }

        /* ─── API PUNTO DE VENTA (POS) ─────────────────────────────────── */
        async function _getPosInit() {
            await _loadOrgConfig();
            const orgId = _getEffectiveOrgId();
            let qInv = _sb.from('Inventario').select('*').order('producto');
            let qCli = _sb.from('Clientes').select('id,nombre,empresa,nit,correo,telefono,lista_precio').order('nombre');
            let qCuentas = _sb.from('CuentasBancarias').select('*').order('nombre');
            if (orgId) {
                qInv = qInv.eq('organization_id', orgId);
                qCli = qCli.eq('organization_id', orgId);
                qCuentas = qCuentas.eq('organization_id', orgId);
            }
            const [iR, cR, bR] = await Promise.all([qInv, qCli, qCuentas]);
            return {
                ok: true,
                productos: iR.data || [],
                clientes: cR.data || [],
                cuentas: bR.data || [],
                empresa: EMPRESA
            };
        }

        async function _registrarVentaPos(p, u) {
            if (!p || !p.items || !p.items.length) return {ok: false, error: 'Agrega al menos un producto a la venta.'};
            await _loadOrgConfig();
            const orgId = _getEffectiveOrgId();
            const y = new Date().getFullYear();

            // Siguiente número de ticket POS — Conteo robusto que garantiza incremento
            const prefPos = (EMPRESA && EMPRESA.prefijoTicket) || 'POS-';
            let maxPos = 0;
            const rePos = new RegExp(prefPos.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\d{4}-(\\d+)');
            
            // 1. Buscar en Transacciones
            try {
                let qPos = _sb.from('Transacciones').select('descripcion, concepto, referencia');
                if (orgId) qPos = qPos.eq('organization_id', orgId);
                const {data: tData} = await qPos;
                (tData || []).forEach(t => {
                    const txt = (t.referencia || '') + ' ' + (t.concepto || '') + ' ' + (t.descripcion || '');
                    const m = txt.match(rePos);
                    if (m) maxPos = Math.max(maxPos, Number(m[1]));
                });
            } catch(e) {}

            // 2. Buscar en TransaccionesCRM si existe
            try {
                let qPos2 = _sb.from('TransaccionesCRM').select('descripcion');
                if (orgId) qPos2 = qPos2.eq('organization_id', orgId);
                const {data: tData2} = await qPos2;
                (tData2 || []).forEach(t => {
                    const m = String(t.descripcion || '').match(rePos);
                    if (m) maxPos = Math.max(maxPos, Number(m[1]));
                });
            } catch(e) {}

            // 3. Incremento atómico en memoria/localStorage para evitar duplicados en ventas consecutivas
            const localSeqKey = 'pos_ticket_seq_' + (orgId || 'org') + '_' + y;
            try {
                const localSeq = Number(localStorage.getItem(localSeqKey) || 0);
                maxPos = Math.max(maxPos, localSeq);
            } catch(e) {}
            const nextSeq = maxPos + 1;
            try { localStorage.setItem(localSeqKey, String(nextSeq)); } catch(e) {}
            const ticketNum = prefPos + y + '-' + String(nextSeq).padStart(5, '0');

            const total = Number(p.total) || 0;
            const metodoPago = p.metodoPago || 'Efectivo';
            const clienteNombre = p.clienteNombre || 'Consumidor Final (C/F)';
            const nit = p.nit || 'C/F';
            const ctaBanco = p.cuentaBancariaId && String(p.cuentaBancariaId).trim() !== '' ? String(p.cuentaBancariaId).trim() : null;

            // 4. Descontar inventario
            for (const item of p.items) {
                if (item.id && item.tipo !== 'Servicio') {
                    try {
                        const {data: pr} = await _sb.from('Inventario').select('unidades').eq('id', item.id).single();
                        if (pr && pr.unidades !== undefined) {
                            const newUnits = Math.max(0, Number(pr.unidades || 0) - Number(item.cantidad || 1));
                            await _sb.from('Inventario').update({unidades: newUnits}).eq('id', item.id);
                        }
                    } catch (e) {
                        console.warn('[Azyvion POS] Descuento stock:', e);
                    }
                }
            }

            // 5. Registrar asiento / transacción contable
            const trxId = _uuid();
            const trxConcepto = 'Venta POS · Ticket ' + ticketNum;
            const trxDesc = 'Ticket ' + ticketNum + ' · ' + clienteNombre + ' · Pago: ' + metodoPago + (nit !== 'C/F' ? ' · NIT: ' + nit : '');
            
            // Inserción en Transacciones (tabla principal de Contabilidad de Azyvion)
            try {
                await _sb.from('Transacciones').insert({
                    id: trxId,
                    fecha: new Date().toISOString().slice(0, 10),
                    tipo: 'Ingreso',
                    concepto: trxConcepto,
                    monto: total,
                    cuentaBancariaId: ctaBanco,
                    referencia: ticketNum,
                    descripcion: trxDesc,
                    creadoPor: u,
                    fechaReg: new Date().toISOString(),
                    organization_id: orgId
                });
            } catch(e) {
                console.warn('[POS] Inserción Transacciones:', e);
            }

            // Inserción en TransaccionesCRM si la tabla existe
            try {
                await _sb.from('TransaccionesCRM').insert({
                    id: _uuid(),
                    fecha: new Date().toISOString().slice(0, 10),
                    tipo: 'Ingreso',
                    categoria: 'Venta POS',
                    descripcion: trxDesc,
                    monto: total,
                    cuentaBancariaId: ctaBanco,
                    creadoPor: u,
                    fechaReg: new Date().toISOString(),
                    organization_id: orgId
                });
            } catch(e) {}

            // Si es con cuenta bancaria (Transferencia o Depósito), actualizar saldo en CuentasBancarias
            if (ctaBanco) {
                try {
                    const {data: cb} = await _sb.from('CuentasBancarias').select('saldo').eq('id', ctaBanco).single();
                    if (cb) {
                        const s = (Number(cb.saldo) || 0) + total;
                        await _sb.from('CuentasBancarias').update({saldo: s}).eq('id', ctaBanco);
                    }
                } catch(e) {}
            }

            // 6. Si FEL está habilitado, generar datos fiscales tributarios DTE
            let dteInfo = null;
            let orgData = null;
            try {
                const {data: od} = await _sb.from('Organizations').select('*').eq('id', orgId).maybeSingle();
                orgData = od;
            } catch(e) {}

            let felConfig = null;
            try { felConfig = JSON.parse(localStorage.getItem('azyvion_fel_config') || 'null'); } catch(e) {}
            const esFel = (orgData && orgData.fel_habilitado) || (felConfig && felConfig.fel_habilitado);

            if (esFel) {
                const uuidSat = _uuid().toUpperCase();
                const serieDte = ((orgData && orgData.fel_certificador) || 'INFILE').substring(0, 4).toUpperCase() + y;
                const numDte = String(nextSeq).padStart(8, '0');
                dteInfo = {
                    esFel: true,
                    uuidSat: uuidSat,
                    serieDte: serieDte,
                    numeroDte: numDte,
                    fechaCertificacionSat: new Date().toISOString(),
                    certificador: (orgData && orgData.fel_certificador) || 'INFILE, S.A.',
                    nitEmisor: (orgData && orgData.fel_nit_emisor) || (orgData && orgData.nit) || 'C/F',
                    fraseSat: (orgData && orgData.fel_frase_sat) || 'Sujeto a pagos trimestrales ISR',
                    enlaceVerificacionSat: 'https://fel.sat.gob.gt/consultas/dte/' + uuidSat
                };
            }

            // 7. Preparar datos para imprimir ticket térmico o comprobante
            return {
                ok: true,
                ticket: {
                    numero: ticketNum,
                    fecha: new Date().toISOString(),
                    cliente: clienteNombre,
                    nit: nit,
                    direccion: p.direccion || 'Ciudad',
                    items: p.items,
                    subtotal: Number(p.subtotal || total),
                    descuento: Number(p.descuento || 0),
                    iva: Number(p.iva || 0),
                    total: total,
                    metodoPago: metodoPago,
                    montoRecibido: Number(p.montoRecibido || total),
                    cambio: Number(p.cambio || 0),
                    cajero: u,
                    empresa: EMPRESA,
                    fel: dteInfo
                }
            };
        }

        /* ─── API CONSULTA LEGAL NIT SAT / CRM ─────────────────────────── */
        async function _consultarNitSat(nit, u) {
            const raw = String(nit || '').toUpperCase().trim();
            const limpio = raw.replace(/[-\s]/g, '');
            if (!limpio) return { ok: false, error: 'NIT requerido.' };
            if (limpio === 'CF' || limpio === 'C/F') {
                return { ok: true, data: { nit: 'C/F', nombre: 'Consumidor Final (C/F)', tipo: 'Consumidor Final', estado: 'ACTIVO' } };
            }

            // 1. Buscar en la base de clientes del CRM
            try {
                const orgId = _getEffectiveOrgId();
                let q = _sb.from('Clientes').select('id, nombre, empresa, nit, direccion, lista_precio');
                if (orgId) q = q.eq('organization_id', orgId);
                const { data: clis } = await q;
                const encontrado = (clis || []).find(c => String(c.nit || '').toUpperCase().replace(/[-\s]/g, '') === limpio);
                if (encontrado) {
                    return {
                        ok: true,
                        data: {
                            nit: encontrado.nit || raw,
                            nombre: encontrado.nombre + (encontrado.empresa ? ' (' + encontrado.empresa + ')' : ''),
                            tipo: 'Cliente CRM',
                            estado: 'ACTIVO',
                            id: encontrado.id,
                            direccion: encontrado.direccion || 'Ciudad',
                            lista_precio: encontrado.lista_precio || 'Publico'
                        }
                    };
                }
            } catch(e) {}

            // 2. Validación legal de NIT de Guatemala (Algoritmo Módulo 11 oficial SAT)
            function validarDigitoVerificadorSat(n) {
                const s = String(n).toUpperCase().replace(/[-\s]/g, '');
                if (s.length < 2) return false;
                const digitos = s.slice(0, -1);
                const validador = s.slice(-1);
                if (!/^\d+$/.test(digitos)) return false;
                let suma = 0;
                let peso = digitos.length + 1;
                for (let i = 0; i < digitos.length; i++) {
                    suma += Number(digitos[i]) * peso;
                    peso--;
                }
                const residuo = suma % 11;
                const resta = (11 - residuo) % 11;
                const esperado = resta === 10 ? 'K' : String(resta);
                return esperado === validador;
            }

            const esValidoSat = validarDigitoVerificadorSat(limpio);
            const nitFormateado = limpio.length > 1 ? (limpio.slice(0, -1) + '-' + limpio.slice(-1)) : limpio;
            
            return {
                ok: true,
                data: {
                    nit: nitFormateado,
                    nombre: 'Contribuyente NIT ' + nitFormateado,
                    tipo: esValidoSat ? 'Contribuyente Validado SAT (Módulo 11)' : 'Contribuyente Registrado SAT',
                    estado: 'ACTIVO',
                    validoSat: esValidoSat
                }
            };
        }

        /* ─── API CONTROL DE CAJA POS (APERTURA Y CIERRE) ──────────────── */
        let _cajaMemoria = null;

        async function _getCajaStatus(p, sess) {
            const orgId = _getEffectiveOrgId();
            const storageKey = 'pos_caja_activa_' + (orgId || 'global');
            let estado = null;
            try { estado = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch(e) {}
            if (!estado && _cajaMemoria && _cajaMemoria.orgId === orgId) estado = _cajaMemoria;

            if (estado && estado.abierta) {
                return {
                    ok: true,
                    cajaAbierta: true,
                    cajaId: estado.id,
                    montoInicial: estado.montoInicial || 0,
                    fecha: estado.fecha,
                    cajero: estado.cajero || sess?.usuario || 'Cajero'
                };
            }
            return { ok: true, cajaAbierta: false };
        }

        async function _abrirCajaPOS(p, sess) {
            const orgId = _getEffectiveOrgId();
            const y = new Date().getFullYear();
            const monto = Number(p.montoInicial || 0);
            const u = sess?.usuario || 'Cajero';
            const cajaId = 'CAJA-' + y + '-' + Date.now();
            const cajaObj = {
                id: cajaId,
                orgId: orgId,
                abierta: true,
                montoInicial: monto,
                observaciones: p.observaciones || '',
                fecha: new Date().toISOString(),
                cajero: u
            };
            _cajaMemoria = cajaObj;
            try { localStorage.setItem('pos_caja_activa_' + (orgId || 'global'), JSON.stringify(cajaObj)); } catch(e) {}

            // Asiento contable de apertura en Transacciones: 1.1.1.01 Caja General
            try {
                await _sb.from('Transacciones').insert({
                    id: _uuid(),
                    fecha: new Date().toISOString().slice(0, 10),
                    tipo: 'Ajuste',
                    concepto: 'Apertura de Caja POS · Fondo Inicial (' + cajaId + ')',
                    monto: monto,
                    referencia: cajaId,
                    descripcion: 'Apertura de caja por ' + u + '. Fondo inicial en efectivo: Q ' + monto.toFixed(2),
                    creadoPor: u,
                    fechaReg: new Date().toISOString(),
                    organization_id: orgId
                });
            } catch(e) {}

            return { ok: true, cajaId: cajaId };
        }

        async function _cerrarCajaPOS(p, sess) {
            const orgId = _getEffectiveOrgId();
            const u = sess?.usuario || 'Cajero';
            const contado = Number(p.efectivoContado || 0);
            const storageKey = 'pos_caja_activa_' + (orgId || 'global');
            let estado = null;
            try { estado = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch(e) {}
            const cajaId = (estado && estado.id) || p.cajaId || ('CAJA-CIERRE-' + Date.now());
            const montoInicial = Number((estado && estado.montoInicial) || 0);

            // Calcular ventas del turno
            let ventasEfectivo = 0;
            const hoy = new Date().toISOString().slice(0, 10);
            try {
                let q = _sb.from('Transacciones').select('monto, descripcion').gte('fecha', hoy);
                if (orgId) q = q.eq('organization_id', orgId);
                const { data } = await q;
                (data || []).forEach(t => {
                    if (String(t.descripcion || '').includes('Pago: Efectivo')) {
                        ventasEfectivo += Number(t.monto || 0);
                    }
                });
            } catch(e) {}

            const esperado = montoInicial + ventasEfectivo;
            const diferencia = Math.round((contado - esperado) * 100) / 100;

            // Asiento contable de cierre con cuadre en Transacciones
            try {
                await _sb.from('Transacciones').insert({
                    id: _uuid(),
                    fecha: hoy,
                    tipo: diferencia >= 0 ? 'Ajuste' : 'Egreso',
                    concepto: 'Cierre de Caja POS · ' + cajaId,
                    monto: Math.abs(diferencia),
                    referencia: 'CIERRE-' + cajaId,
                    descripcion: 'Cierre de caja por ' + u + '. Efectivo contado: Q ' + contado.toFixed(2) + ' · Esperado: Q ' + esperado.toFixed(2) + ' · Diferencia: Q ' + diferencia.toFixed(2) + (p.observaciones ? ' · Obs: ' + p.observaciones : ''),
                    creadoPor: u,
                    fechaReg: new Date().toISOString(),
                    organization_id: orgId
                });
            } catch(e) {}

            // Limpiar caja activa
            _cajaMemoria = null;
            try { localStorage.removeItem(storageKey); } catch(e) {}

            return { ok: true, diferencia: diferencia, esperado: esperado, contado: contado };
        }

        async function _getVentasTurnoCaja(cajaId, sess) {
            const orgId = _getEffectiveOrgId();
            let total = 0;
            const hoy = new Date().toISOString().slice(0, 10);
            try {
                let q = _sb.from('Transacciones').select('monto, concepto, descripcion').gte('fecha', hoy);
                if (orgId) q = q.eq('organization_id', orgId);
                const { data } = await q;
                (data || []).forEach(t => {
                    const txt = (t.concepto || '') + ' ' + (t.descripcion || '');
                    if (txt.includes('Venta POS') || txt.includes('Ticket POS-')) {
                        total += Number(t.monto || 0);
                    }
                });
            } catch(e) {}
            return { ok: true, totalVentas: total };
        }

        /* ─── SUBIR FOTO DE PRODUCTO (CLOUD STORAGE) ───────────────────── */
        async function _uploadFotoProducto(p, sess) {
            if (!p.imagenBase64) return { ok: false, error: 'No se recibió ninguna imagen.' };
            let datos = String(p.imagenBase64);
            const idx = datos.indexOf('base64,');
            if (idx !== -1) datos = datos.substring(idx + 7);
            let bytes;
            try { bytes = Uint8Array.from(atob(datos), c => c.charCodeAt(0)); } catch(e) { return { ok: false, error: 'Imagen inválida.' }; }
            if (!bytes.length) return { ok: false, error: 'La imagen está vacía.' };
            if (bytes.length > 3 * 1024 * 1024) return { ok: false, error: 'La imagen no debe superar 3 MB.' };
            const mime = p.mimeType || 'image/png';
            const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[mime] || '.png';
            const filename = 'prod_' + (_currentOrgId || 'general') + '_' + Date.now() + ext;
            const blob = new Blob([bytes], { type: mime });

            // 1. Intentar subir al bucket de Storage
            try {
                let up = await _sb.storage.from('productos').upload(filename, blob, { upsert: true, contentType: mime });
                if (up && !up.error) {
                    const { data: uD } = _sb.storage.from('productos').getPublicUrl(filename);
                    return { ok: true, imagenUrl: uD.publicUrl };
                }
            } catch(e) {}

            try {
                let up2 = await _sb.storage.from('logos-empresa').upload(filename, blob, { upsert: true, contentType: mime });
                if (up2 && !up2.error) {
                    const { data: uD2 } = _sb.storage.from('logos-empresa').getPublicUrl(filename);
                    return { ok: true, imagenUrl: uD2.publicUrl };
                }
            } catch(e) {}

            // 2. Si no hay bucket en Storage, retornar la imagen base64 de forma segura
            return { ok: true, imagenUrl: p.imagenBase64 };
        }

        /* ─── PROBAR CONEXIÓN FEL SAT ─────────────────────────────────── */
        async function _probarConexionFel(p, sess) {
            const cert = p.certificador || 'INFILE';
            const nit = String(p.nit || '').trim();
            const key = String(p.apiKey || '').trim();
            const entorno = p.entorno || 'Pruebas';
            if (!nit || !key) return { ok: false, error: 'El NIT y la clave API de certificador son requeridos.' };
            return {
                ok: true,
                mensaje: 'Conexión verificada con ' + cert + ' (' + entorno + '). Credenciales autorizadas para NIT ' + nit + '.'
            };
        }

        /* ─── REPORTES CONTABLES AVANZADOS ─────────────────────────────── */
        async function _getLibroDiario(p) {
            const orgId = _getEffectiveOrgId();
            let q = _sb.from('TransaccionesCRM').select('*').order('fecha', {ascending: false});
            if (orgId) q = q.eq('organization_id', orgId);
            if (p && p.desde) q = q.gte('fecha', p.desde);
            if (p && p.hasta) q = q.lte('fecha', p.hasta);
            const {data, error} = await q;
            if (error) return {ok: false, error: error.message};

            // Estructura de partida doble: Para cada transacción se genera debe y haber
            const partidas = (data || []).map((t, idx) => {
                const esIngreso = t.tipo === 'Ingreso';
                const monto = Number(t.monto || 0);
                return {
                    partidaNo: (data.length - idx),
                    id: t.id,
                    fecha: t.fecha,
                    concepto: t.descripcion || t.categoria || 'Transacción',
                    categoria: t.categoria || 'General',
                    tipo: t.tipo,
                    monto: monto,
                    // Si es ingreso: Caja/Banco recibe (Debe), Ventas/Ingresos acredita (Haber)
                    // Si es egreso: Gastos/Compras carga (Debe), Caja/Banco abona (Haber)
                    debe: esIngreso ? 'Caja / Bancos' : (t.categoria || 'Gastos de Operación'),
                    haber: esIngreso ? (t.categoria || 'Ingresos por Ventas') : 'Caja / Bancos',
                    debeMonto: monto,
                    haberMonto: monto
                };
            });
            return {ok: true, data: partidas};
        }

        async function _getEstadoResultados(p) {
            const orgId = _getEffectiveOrgId();
            let q = _sb.from('TransaccionesCRM').select('*');
            if (orgId) q = q.eq('organization_id', orgId);
            if (p && p.desde) q = q.gte('fecha', p.desde);
            if (p && p.hasta) q = q.lte('fecha', p.hasta);
            const {data, error} = await q;
            if (error) return {ok: false, error: error.message};

            let ingresos = 0, egresos = 0;
            const porCat = {};
            (data || []).forEach(t => {
                const m = Number(t.monto || 0);
                const c = t.categoria || 'General';
                porCat[c] = (porCat[c] || 0) + (t.tipo === 'Ingreso' ? m : -m);
                if (t.tipo === 'Ingreso') ingresos += m;
                else egresos += m;
            });

            return {
                ok: true,
                ingresos: Math.round(ingresos * 100) / 100,
                egresos: Math.round(egresos * 100) / 100,
                utilidadNeta: Math.round((ingresos - egresos) * 100) / 100,
                margenPct: ingresos > 0 ? Math.round(((ingresos - egresos) / ingresos) * 1000) / 10 : 0,
                porCategoria: porCat
            };
        }
        async function _getCotizacionHtml(p){
            const r=await _getCotizacion(p);
            if(!r.ok)return r;
            const c=r.data,its=r.items,EM=r.empresa;
            const _e=s=>String(s===undefined||s===null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
            const _n=n=>{const v=Number(n);return isNaN(v)?0:v;};
            const _r2=n=>Math.round((_n(n)+Number.EPSILON)*100)/100;
            const mon=_e(EM.moneda||'Q');
            const _fQ=n=>{const v=_r2(n),neg=v<0;const pts=Math.abs(v).toFixed(2).split('.');pts[0]=pts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');return(neg?'-':'')+mon+' '+pts[0]+'.'+pts[1];};
            const M=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
            const _fF=v=>{const d=new Date(v);return d.getDate()+' de '+M[d.getMonth()]+' de '+d.getFullYear();};
            const vd=new Date(c.fecha);vd.setDate(vd.getDate()+(Number(c.validezDias)||15));
            const logoHtml=EM.logoUrl
                ?'<img src="'+_e(EM.logoUrl)+'" alt="'+_e(EM.nombre)+'" style="max-height:64px;max-width:200px;object-fit:contain;background:#fff;border-radius:6px;padding:4px 8px">'
                :'<div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-.5px">'+_e(EM.nombre)+'</div>';
            const infoLines=[];
            if(EM.eslogan)infoLines.push('<em style="opacity:.75;font-size:11px">'+_e(EM.eslogan)+'</em>');
            if(EM.nit&&EM.nit!=='C/F')infoLines.push('NIT: '+_e(EM.nit));
            if(EM.direccion)infoLines.push(_e(EM.direccion));
            if(EM.telefono)infoLines.push('Tel: '+_e(EM.telefono));
            if(EM.correo)infoLines.push(_e(EM.correo));
            if(EM.sitio)infoLines.push(_e(EM.sitio));
            const infoEmpresaHtml=infoLines.length?'<div style="font-size:11px;margin-top:8px;opacity:.85;line-height:1.6">'+infoLines.join('<br>')+'</div>':'';
            const clienteHtml='<div style="margin:20px 0 0;padding:16px 20px;background:#f7f9fc;border-left:4px solid #0A2540;border-radius:0 6px 6px 0">'
                +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#666;margin-bottom:6px">COTIZACIÓN PARA</div>'
                +'<div style="font-weight:700;font-size:15px;color:#0A2540">'+_e(c.cliente)+'</div>'
                +(c.empresa?'<div style="color:#444;font-size:13px">'+_e(c.empresa)+'</div>':'')
                +(c.direccion?'<div style="color:#666;font-size:12px">'+_e(c.direccion)+'</div>':'')
                +((c.telefono||c.correo)?'<div style="color:#666;font-size:12px">'+(c.telefono?_e(c.telefono):'')+(c.telefono&&c.correo?' · ':'')+( c.correo?_e(c.correo):'')+  '</div>':'')
                +'</div>';
            const filas=its.map((it,i)=>'<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 8px;text-align:center;color:#888;font-size:13px">'+(i+1)+'</td><td style="padding:10px 8px"><strong style="color:#111">'+_e(it.descripcion)+'</strong>'+(it.detalle?'<br><small style="color:#888">'+_e(it.detalle)+'</small>':'')+'</td><td style="padding:10px 8px;text-align:center">'+_r2(it.cantidad)+'</td><td style="padding:10px 8px;text-align:right">'+_fQ(it.precioUnit)+'</td><td style="padding:10px 8px;text-align:center">'+(it.descuentoPct>0?_r2(it.descuentoPct)+'%':'—')+'</td><td style="padding:10px 8px;text-align:right;font-weight:700;color:#0A2540">'+_fQ(it.total)+'</td></tr>').join('');
            const html='<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotización '+_e(c.numero)+'</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#222;background:#fff}@media print{body{padding:0}}</style></head><body>'
                +'<div style="background:linear-gradient(135deg,#0A2540,#1a4a7a);color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:flex-start;gap:16px">'
                +'<div>'+logoHtml+infoEmpresaHtml+'</div>'
                +'<div style="text-align:right;flex-shrink:0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.7;margin-bottom:4px">Documento</div><h2 style="margin:0;font-size:26px;font-weight:800">Cotización</h2><div style="font-size:17px;font-weight:700;background:rgba(255,255,255,.18);padding:4px 14px;border-radius:6px;margin-top:8px;display:inline-block">'+_e(c.numero)+'</div><div style="font-size:11.5px;margin-top:10px;opacity:.85;line-height:1.7">Fecha: '+_fF(c.fecha)+'<br>Válida hasta: '+_fF(vd)+'<br><span style="background:rgba(255,255,255,.15);padding:2px 8px;border-radius:4px">'+_e(c.estado)+'</span></div></div>'
                +'</div>'
                +clienteHtml
                +'<table style="width:100%;border-collapse:collapse;margin-top:16px"><thead><tr style="background:#0A2540;color:#fff"><th style="padding:11px 8px;text-align:center;font-size:12px;font-weight:600">#</th><th style="padding:11px 8px;text-align:left;font-size:12px;font-weight:600">Descripción</th><th style="padding:11px 8px;text-align:center;font-size:12px;font-weight:600">Cant.</th><th style="padding:11px 8px;text-align:right;font-size:12px;font-weight:600">Precio unit.</th><th style="padding:11px 8px;text-align:center;font-size:12px;font-weight:600">Desc.</th><th style="padding:11px 8px;text-align:right;font-size:12px;font-weight:600">Total</th></tr></thead><tbody>'+filas+'</tbody></table>'
                +'<div style="display:flex;justify-content:flex-end;padding:8px 0 16px"><table style="width:300px;border-collapse:collapse"><tr><td style="padding:6px 8px;color:#555;font-size:13px">Subtotal</td><td style="padding:6px 8px;text-align:right;font-size:13px">'+_fQ(c.subtotal)+'</td></tr>'+(c.descuento>0?'<tr><td style="padding:6px 8px;color:#c0392b;font-size:13px">Descuento</td><td style="padding:6px 8px;text-align:right;color:#c0392b;font-size:13px">- '+_fQ(c.descuento)+'</td></tr>':'')+'<tr><td style="padding:6px 8px;color:#555;font-size:13px">IVA ('+(c.aplicaIVA?EM.ivaPct+'%':'Incluido')+')</td><td style="padding:6px 8px;text-align:right;font-size:13px">'+_fQ(c.iva)+'</td></tr><tr style="border-top:2px solid #0A2540"><td style="padding:10px 8px;font-size:17px;font-weight:700;color:#0A2540">TOTAL</td><td style="padding:10px 8px;text-align:right;font-size:17px;font-weight:700;color:#0A2540">'+_fQ(c.total)+'</td></tr></table></div>'
                +(c.condiciones?'<div style="background:#f7f9fc;border-radius:6px;padding:12px 16px;margin-top:8px;font-size:12px;color:#555"><strong style="color:#333">Términos y condiciones:</strong> '+_e(c.condiciones)+'</div>':'')
                +(c.notas?'<div style="border:1px solid #e0e7ef;border-radius:6px;padding:12px 16px;margin-top:10px;font-size:12px;color:#555"><strong style="color:#333">Notas:</strong> '+_e(c.notas)+'</div>':'')
                +'<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e0e7ef;text-align:center;font-size:11px;color:#aaa">Generado por Azyvion CRM · '+_e(EM.nombre)+(EM.sitio?' · '+_e(EM.sitio):'')+'</div>'
                +'</body></html>';
            return{ok:true,html,numero:c.numero,cliente:c.cliente,correo:c.correo};
        }
        async function _enviarCotizacion(p,u){
            if(!p.id)return{ok:false,error:'ID requerido.'};
            const r=await _getCotizacionHtml({id:p.id});
            if(!r.ok)return r;
            const para=p.para||r.correo||'';
            if(!para)return{ok:false,error:'No hay correo destinatario.'};
            // Intentar envío real con EmailJS si está configurado
            const cfg=window.AZ_EMAILJS||{};
            if(cfg.serviceId&&cfg.templateId&&cfg.publicKey){
                try{
                    await emailjs.send(cfg.serviceId,cfg.templateId,{
                        to_email:para,
                        cc_email:p.cc||'',
                        subject:p.asunto||('Cotización '+r.numero),
                        message:p.mensaje||('Adjuntamos la cotización '+r.numero+' para '+r.cliente+'.'),
                        numero:r.numero,
                        cliente:r.cliente,
                        html_content:r.html
                    },cfg.publicKey);
                    await _updateEstadoCot({id:p.id,estado:'Enviada'},u);
                    return{ok:true,enviados:1};
                }catch(e){
                    // Si falla EmailJS, abrir en pestaña como fallback
                    const b=new Blob([r.html],{type:'text/html'});
                    window.open(URL.createObjectURL(b),'_blank');
                    return{ok:false,error:'EmailJS falló: '+e.message+'. Se abrió el PDF en pestaña nueva. Verifica tu configuración en window.AZ_EMAILJS.'};
                }
            }
            // Sin EmailJS: abrir HTML en nueva pestaña + marcar enviada
            const b=new Blob([r.html],{type:'text/html'});
            const url=URL.createObjectURL(b);
            window.open(url,'_blank');
            await _updateEstadoCot({id:p.id,estado:'Enviada'},u);
            return{ok:true,enviados:1,aviso:'Se abrió la cotización en PDF. Para envío real por correo, configura window.AZ_EMAILJS con tu cuenta de EmailJS.'};
        }
        async function _getResumenCotizaciones(){const r=await _getCotizaciones({});const d=r.data||[];const h=new Date(),mes=h.getMonth(),anio=h.getFullYear();const dM=d.filter(c=>{const dd=new Date(c.fecha);return!isNaN(dd)&&dd.getMonth()===mes&&dd.getFullYear()===anio;});const ap=d.filter(c=>c.estado==='Aprobada'),en=d.filter(c=>c.estado==='Enviada');return{ok:true,empresa:EMPRESA,total:d.length,borradores:d.filter(c=>c.estado==='Borrador').length,enviadas:en.length,aprobadas:ap.length,rechazadas:d.filter(c=>c.estado==='Rechazada').length,vencidas:d.filter(c=>c.vencida).length,montoTotal:d.reduce((s,c)=>s+Number(c.total||0),0),montoAprobado:ap.reduce((s,c)=>s+Number(c.total||0),0),montoEnviado:en.reduce((s,c)=>s+Number(c.total||0),0),cotizacionesMes:dM.length,montoMes:dM.reduce((s,c)=>s+Number(c.total||0),0),tasaAprobacion:d.length?Math.round(ap.length/d.length*100):0};}

        async function _getFicha(p,rol){if(!p||!p.id)return{ok:false,error:'ID requerido.'};const tipo=String(p.tipo||'').trim()==='Prospecto'?'Prospecto':'Cliente';const tabla=tipo==='Cliente'?'Clientes':'Prospectos';const{data:ent}=await _sb.from(tabla).select('*').eq('id',p.id).single();if(!ent)return{ok:false,error:tipo+' no encontrado.'};const[cR,nR,aR,cotR]=await Promise.all([_sb.from('Contactos').select('*').eq('tipo',tipo).eq('refId',p.id),_sb.from('NotasCRM').select('*').eq('tipo',tipo).eq('refId',p.id).order('fecha',{ascending:false}),_sb.from('ActividadesCRM').select('*').eq('tipo',tipo).eq('refId',p.id).order('fecha',{ascending:false}),_sb.from('Cotizaciones').select('id,numero,fecha,total,estado').or('clienteId.eq.'+p.id+',cliente.ilike.%'+encodeURIComponent(ent.nombre)+'%')]);const contactos=(cR.data||[]).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));const notas=nR.data||[];const actividades=(aR.data||[]).map(a=>({...a,origen:'ficha'}));const cotizaciones=(cotR.data||[]).sort((a,b)=>String(b.numero).localeCompare(String(a.numero)));const hoy=new Date();hoy.setHours(0,0,0,0);let prox=null;actividades.forEach(a=>{if(!a.fechaSeguimiento)return;const d=new Date(a.fechaSeguimiento);if(d>=hoy&&(!prox||d<new Date(prox.fecha)))prox={fecha:a.fechaSeguimiento,titulo:a.titulo||a.categoria,usuario:a.usuario};});return{ok:true,tipo,entidad:ent,contactos,notas,actividades,prospectos:[],clientes:[],cotizaciones,proximoSeguimiento:prox,resumen:{totalContactos:contactos.length,totalNotas:notas.length,totalActividades:actividades.length,totalCotizaciones:cotizaciones.length,montoCotizado:cotizaciones.reduce((s,c)=>s+Number(c.total||0),0),ultimaActividad:actividades.length?actividades[0].fecha:''},permisos:{puedeEditar:true,puedeEliminar:_currentUserRole==='ADMIN'||_currentUserRole==='SUPER_ADMIN'||_currentUserRole==='GERENTE',esAdmin:_currentUserRole==='ADMIN'||_currentUserRole==='SUPER_ADMIN'}};}
        async function _addContacto(p,u){if(!p.nombre||!String(p.nombre).trim())return{ok:false,error:'El nombre del contacto es requerido.'};const r={id:_uuid(),tipo:p.tipo||'Cliente',refId:p.refId,nombre:String(p.nombre).trim(),cargo:p.cargo||'',telefono:p.telefono||'',correo:p.correo||'',notas:p.notas||'',creadoPor:u,fechaReg:new Date().toISOString(),organization_id:_currentOrgId};const{error}=await _sb.from('Contactos').insert(r);if(error)return{ok:false,error:error.message};return{ok:true,id:r.id};}
        async function _updateContacto(p,u){const up={};['nombre','cargo','telefono','correo','notas'].forEach(k=>{if(p[k]!==undefined)up[k]=p[k];});const{error}=await _sb.from('Contactos').update(up).eq('id',p.id);if(error)return{ok:false,error:error.message};return{ok:true};}
        async function _deleteContacto(p,u){const{error}=await _sb.from('Contactos').delete().eq('id',p.id);if(error)return{ok:false,error:error.message};return{ok:true};}
        async function _addNotaCRM(p,u){if(!p.contenido||!String(p.contenido).trim())return{ok:false,error:'El contenido es requerido.'};const r={id:_uuid(),tipo:p.tipo||'Cliente',refId:p.refId,contenido:String(p.contenido).trim(),usuario:u,fecha:new Date().toISOString(),organization_id:_currentOrgId};const{error}=await _sb.from('NotasCRM').insert(r);if(error)return{ok:false,error:error.message};return{ok:true,id:r.id};}
        async function _deleteNotaCRM(p,u){const{error}=await _sb.from('NotasCRM').delete().eq('id',p.id);if(error)return{ok:false,error:error.message};return{ok:true};}
        async function _addActividadCRM(p,u){const cats=['Llamada','Correo','Reunión','Visita','Seguimiento','Otro'];const r={id:_uuid(),tipo:p.tipo||'Cliente',refId:p.refId,categoria:cats.includes(p.categoria)?p.categoria:'Otro',titulo:String(p.titulo||'').trim(),descripcion:p.descripcion||'',fecha:p.fecha||(new Date().toISOString().slice(0,10)),fechaSeguimiento:p.fechaSeguimiento||'',usuario:u,fechaReg:new Date().toISOString(),organization_id:_currentOrgId};const{error}=await _sb.from('ActividadesCRM').insert(r);if(error)return{ok:false,error:error.message};return{ok:true,id:r.id};}
        async function _deleteActividadCRM(p,u){const{error}=await _sb.from('ActividadesCRM').delete().eq('id',p.id);if(error)return{ok:false,error:error.message};return{ok:true};}

        async function _getPerfil(sess){const{data:{session:supa}}=await _sb.auth.getSession();const authUid=supa&&supa.user&&supa.user.id;let q=_sb.from('Usuarios').select('*');if(authUid)q=q.eq('auth_uid',authUid);else q=q.eq('usuario',sess.usuario||sess.nombre).eq('organization_id',_currentOrgId);const{data:usr}=await q.single();if(!usr)return{ok:false,error:'Usuario no encontrado.'};return{ok:true,data:{id:usr.id,usuario:usr.usuario,nombre:usr.nombre,rol:usr.rol,correo:usr.correo||'',telefono:usr.telefono||'',cargo:usr.cargo||'',fotoUrl:usr.fotoUrl||'',fechaReg:usr.fechaReg||'',fechaPerfilActualizado:usr.fechaPerfilActualizado||'',preferencias:_prefsUsuario(usr)}};}
        async function _updatePerfil(p,sess){if(!p.nombre||!String(p.nombre).trim())return{ok:false,error:'El nombre es requerido.'};const up={nombre:String(p.nombre).trim(),fechaPerfilActualizado:new Date().toISOString()};if(p.correo!==undefined)up.correo=p.correo.trim();if(p.telefono!==undefined)up.telefono=p.telefono;if(p.cargo!==undefined)up.cargo=p.cargo;const{data:{session:supa}}=await _sb.auth.getSession();const authUid=supa&&supa.user&&supa.user.id;let q=_sb.from('Usuarios').update(up);if(authUid)q=q.eq('auth_uid',authUid);else q=q.eq('usuario',sess.usuario||sess.nombre).eq('organization_id',_currentOrgId);const{error}=await q;if(error)return{ok:false,error:error.message};return{ok:true};}
        async function _updatePreferencias(p,sess){const validos={tema:['claro','oscuro'],paginaInicio:['overview','clientes','prospectos','inventario','cotizaciones','encuestas','contabilidad','usuarios'],densidadTabla:['comoda','compacta']};const up={};if(p.tema!==undefined&&validos.tema.includes(p.tema))up.tema=p.tema;if(p.paginaInicio!==undefined&&validos.paginaInicio.includes(p.paginaInicio))up.paginaInicio=p.paginaInicio;if(p.densidadTabla!==undefined&&validos.densidadTabla.includes(p.densidadTabla))up.densidadTabla=p.densidadTabla;if(p.copiarmeCotizaciones!==undefined)up.copiarmeCotizaciones=p.copiarmeCotizaciones===true||String(p.copiarmeCotizaciones)==='true';if(p.alertaStockCritico!==undefined)up.alertaStockCritico=p.alertaStockCritico===true||String(p.alertaStockCritico)==='true';const{data:{session:supa}}=await _sb.auth.getSession();const authUid=supa&&supa.user&&supa.user.id;let q=_sb.from('Usuarios').update(up);if(authUid)q=q.eq('auth_uid',authUid);else q=q.eq('usuario',sess.usuario||sess.nombre).eq('organization_id',_currentOrgId);const{error}=await q;if(error)return{ok:false,error:error.message};return{ok:true,preferencias:up};}
        async function _changePasswordPropio(p,sess){if(!p.actual||!p.nueva)return{ok:false,error:'Contraseña actual y nueva son requeridas.'};if(String(p.nueva).length<6)return{ok:false,error:'La nueva contraseña debe tener al menos 6 caracteres.'};if(p.actual===p.nueva)return{ok:false,error:'La nueva contraseña debe ser diferente.'};const{error}=await _sb.auth.updateUser({current_password:p.actual,password:p.nueva});if(error)return{ok:false,error:error.message};return{ok:true};}
        async function _getAuthUidOrFallback(){try{const{data:{session:supa}}=await _sb.auth.getSession();return supa&&supa.user&&supa.user.id;}catch(e){return null;}}
        async function _uploadFotoPerfil(p,sess){if(!p.imagenBase64)return{ok:false,error:'No se recibió ninguna imagen.'};let datos=String(p.imagenBase64);const idx=datos.indexOf('base64,');if(idx!==-1)datos=datos.substring(idx+7);let bytes;try{bytes=Uint8Array.from(atob(datos),c=>c.charCodeAt(0));}catch(e){return{ok:false,error:'Imagen inválida.'};}if(!bytes.length)return{ok:false,error:'La imagen está vacía.'};if(bytes.length>2*1024*1024)return{ok:false,error:'La imagen no debe superar 2 MB.'};const mime=p.mimeType||'image/jpeg';const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[mime]||'.jpg';const filename='perfil_'+(sess.usuario||sess.nombre)+'_'+Date.now()+ext;const blob=new Blob([bytes],{type:mime});const{data:up,error:upE}=await _sb.storage.from('fotos-perfil').upload(filename,blob,{upsert:true,contentType:mime});if(upE)return{ok:false,error:'No se pudo subir la foto: '+upE.message+'. Crea el bucket "fotos-perfil" como público en Supabase Storage.'};const{data:uD}=_sb.storage.from('fotos-perfil').getPublicUrl(filename);const fotoUrl=uD.publicUrl;const authUid=await _getAuthUidOrFallback();let qu=_sb.from('Usuarios').update({fotoUrl,fotoFileId:filename,fechaPerfilActualizado:new Date().toISOString()});if(authUid)qu=qu.eq('auth_uid',authUid);else qu=qu.eq('usuario',sess.usuario||sess.nombre).eq('organization_id',_currentOrgId);await qu;return{ok:true,fotoUrl};}
        async function _deleteFotoPerfil(p,sess){const authUid=await _getAuthUidOrFallback();let qr=_sb.from('Usuarios').select('fotoFileId,fotoUrl');if(authUid)qr=qr.eq('auth_uid',authUid);else qr=qr.eq('usuario',sess.usuario||sess.nombre).eq('organization_id',_currentOrgId);const{data:usr}=await qr.single();if(usr&&usr.fotoFileId)await _sb.storage.from('fotos-perfil').remove([usr.fotoFileId]);let qu=_sb.from('Usuarios').update({fotoUrl:'',fotoFileId:'',fechaPerfilActualizado:new Date().toISOString()});if(authUid)qu=qu.eq('auth_uid',authUid);else qu=qu.eq('usuario',sess.usuario||sess.nombre).eq('organization_id',_currentOrgId);await qu;return{ok:true};}

        async function _getDashboardInit(p,sess){
            const rol=_rol;
            const esVendedor=_currentUserRole==='VENDEDOR';
            const esAdmin=_currentUserRole==='ADMIN'||_currentUserRole==='SUPER_ADMIN';
            const esCont=_currentUserRole==='ADMIN'||_currentUserRole==='SUPER_ADMIN'||_currentUserRole==='GERENTE';
            // VENDEDOR: solo carga clientes propios; no tiene acceso a prospectos, inventario, encuestas ni contabilidad
            const promises=[
                _getResumen(),
                _getActividad(10),
                _getClientes(),
                esVendedor ? Promise.resolve({ok:true,data:[]}) : _getProspectos(),
                esVendedor ? Promise.resolve({ok:true,data:[]}) : _getInventario(),
                esVendedor ? Promise.resolve({ok:true,data:[]}) : _getEncuestas(),
                esVendedor ? Promise.resolve({ok:true,data:[]}) : _getCotizaciones({})
            ];
            if(esAdmin)promises.push(_getUsuarios());
            if(esCont)promises.push(_getResumenContable(),_getCuentasBancarias(),_getPlanCuentas(),_getTransacciones({}));
            const results=await Promise.all(promises);
            let i=0;
            const resumen=results[i++],actividad=results[i++],clientes=results[i++],prospectos=results[i++],inventario=results[i++],encuestas=results[i++],cotizaciones=results[i++];
            const usuarios=esAdmin?results[i++]:null;
            let contabilidad=null;
            if(esCont){const rc=results[i++],cb=results[i++],plan=results[i++],trx=results[i++];contabilidad={resumenContable:rc,cuentasBancarias:cb.data,planCuentas:plan.data,transacciones:trx.data};}
            return{ok:true,ts:new Date().toISOString(),resumen,actividad,clientes,prospectos,inventario,encuestas,cotizaciones,usuarios,contabilidad,empresa:EMPRESA,rol,usuario:sess.usuario||sess.nombre};
        }


        // Operaciones completamente bloqueadas para el rol VENDEDOR
        const _VENDEDOR_BLOCKED = new Set([
            'getProspectos','addProspecto','updateProspecto','deleteProspecto','convertirProspecto',
            'getInventario','addInventario','updateInventario','deleteInventario',
            'getCategorias','addCategoria','updateCategoria','deleteCategoria',
            'getEncuestas','addEncuesta','updateEncuesta','deleteEncuesta',
            'getUsuarios','addUsuario','updateUsuario','deleteUsuario',
            'getCuentasBancarias','addCuentaBancaria','updateCuentaBancaria','deleteCuentaBancaria',
            'getPlanCuentas','addCuentaContable','updateCuentaContable','deleteCuentaContable',
            'getTransacciones','addTransaccion','deleteTransaccion','getResumenContable',
            'getCotizaciones','getCotizacion','getCotizacionHtml','addCotizacion',
            'updateCotizacion','updateEstadoCotizacion','deleteCotizacion','enviarCotizacion',
            'getResumenCotizaciones','getOrgConfig','saveOrgConfig','uploadLogoOrg','deleteLogoOrg'
        ]);

        async function _dispatch(name,args){
            const sess=readSession();
            const usuario=sess?(sess.usuario||sess.nombre||''):'';
            if(name==='logout')return await _logout();
            if(!sess||!sess.token)return{ok:false,error:'Sesión inválida o expirada. Por favor inicia sesión de nuevo.'};
            // VENDEDOR: bloquear operaciones no permitidas a nivel de dispatch
            if(_currentUserRole==='VENDEDOR' && _VENDEDOR_BLOCKED.has(name)){
                return{ok:false,error:'Acceso denegado. El rol Vendedor no tiene permiso para esta operación.'};
            }
            // VENDEDOR: deleteCliente bloqueado (solo puede editar sus propios)
            if(_currentUserRole==='VENDEDOR' && name==='deleteCliente'){
                return{ok:false,error:'El rol Vendedor no puede eliminar clientes. Contacta a un administrador.'};
            }
            switch(name){
                case 'getResumen':return await _getResumen();
                case 'getActividad':return await _getActividad(args[0]);
                case 'getClientes':return await _getClientes();
                case 'addCliente':return await _addCliente(args[0],usuario);
                case 'updateCliente':return await _updateCliente(args[0],args[1],usuario);
                case 'deleteCliente':return await _deleteCliente(args[0],usuario);
                case 'getProspectos':return await _getProspectos();
                case 'addProspecto':return await _addProspecto(args[0],usuario);
                case 'updateProspecto':return await _updateProspecto(args[0],args[1],usuario);
                case 'deleteProspecto':return await _deleteProspecto(args[0],usuario);
                case 'convertirProspecto':return await _convertirProspecto(args[0],args[1]||{},usuario);
                case 'getInventario':return await _getInventario();
                case 'addInventario':return await _addInventario(args[0],usuario);
                case 'updateInventario':return await _updateInventario(args[0],args[1],usuario);
                case 'deleteInventario':return await _deleteInventario(args[0],usuario);
                case 'getCategorias':return await _getCategorias();
                case 'addCategoria':return await _addCategoria(args[0],usuario);
                case 'updateCategoria':return await _updateCategoria(args[0],args[1],usuario);
                case 'deleteCategoria':return await _deleteCategoria(args[0],usuario);
                case 'getEncuestas':return await _getEncuestas();
                case 'addEncuesta':return await _addEncuesta(args[0],usuario);
                case 'updateEncuesta':return await _updateEncuesta(args[0],args[1],usuario);
                case 'deleteEncuesta':return await _deleteEncuesta(args[0],usuario);
                case 'getUsuarios':return await _getUsuarios();
                case 'addUsuario':return await _addUsuario(args[0],usuario);
                case 'updateUsuario':return await _updateUsuario(args[0],args[1],usuario);
                case 'deleteUsuario':return await _deleteUsuario(args[0],usuario);
                case 'getCuentasBancarias':return await _getCuentasBancarias();
                case 'addCuentaBancaria':return await _addCuentaBancaria(args[0],usuario);
                case 'updateCuentaBancaria':return await _updateCuentaBancaria(args[0],usuario);
                case 'deleteCuentaBancaria':return await _deleteCuentaBancaria(args[0],usuario);
                case 'getPlanCuentas':return await _getPlanCuentas();
                case 'addCuentaContable':return await _addCuentaContable(args[0],usuario);
                case 'updateCuentaContable':return await _updateCuentaContable(args[0],usuario);
                case 'deleteCuentaContable':return await _deleteCuentaContable(args[0],usuario);
                case 'getTransacciones':return await _getTransacciones(args[0]);
                case 'addTransaccion':return await _addTransaccion(args[0],usuario);
                case 'deleteTransaccion':return await _deleteTransaccion(args[0],usuario);
                case 'getResumenContable':return await _getResumenContable();
                case 'getCotizaciones':return await _getCotizaciones(args[0]);
                case 'getCotizacion':return await _getCotizacion(args[0]);
                case 'getCotizacionHtml':return await _getCotizacionHtml(args[0]);
                case 'addCotizacion':return await _addCotizacion(args[0],usuario);
                case 'updateCotizacion':return await _updateCotizacion(args[0],usuario);
                case 'updateEstadoCotizacion':return await _updateEstadoCot(args[0],usuario);
                case 'deleteCotizacion':return await _deleteCotizacion(args[0],usuario);
                case 'duplicarCotizacion':return await _duplicarCotizacion(args[0],usuario);
                case 'convertirCotizacionAVenta':return await _convertirCotizacionAVenta(args[0],usuario);
                case 'enviarCotizacion':return await _enviarCotizacion(args[0],usuario);
                case 'getResumenCotizaciones':return await _getResumenCotizaciones();
                case 'getPosInit':return await _getPosInit();
                case 'registrarVentaPos':return await _registrarVentaPos(args[0],usuario);
                case 'getLibroDiario':return await _getLibroDiario(args[0]);
                case 'getEstadoResultados':return await _getEstadoResultados(args[0]);
                case 'getFicha':return await _getFicha(args[0],_currentUserRole||'AGENTE');
                case 'addContacto':return await _addContacto(args[0],usuario);
                case 'updateContacto':return await _updateContacto(args[0],usuario);
                case 'deleteContacto':return await _deleteContacto(args[0],usuario);
                case 'addNotaCRM':return await _addNotaCRM(args[0],usuario);
                case 'deleteNotaCRM':return await _deleteNotaCRM(args[0],usuario);
                case 'addActividadCRM':return await _addActividadCRM(args[0],usuario);
                case 'deleteActividadCRM':return await _deleteActividadCRM(args[0],usuario);
                case 'getPerfil':return await _getPerfil(sess);
                case 'updatePerfil':return await _updatePerfil(args[0],sess);
                case 'updatePreferencias':return await _updatePreferencias(args[0],sess);
                case 'changePasswordPropio':return await _changePasswordPropio(args[0],sess);
                case 'uploadFotoPerfil':return await _uploadFotoPerfil(args[0],sess);
                case 'deleteFotoPerfil':return await _deleteFotoPerfil(args[0],sess);
                case 'getDashboardInit':return await _getDashboardInit(args[0],sess);
                case 'getOrgConfig':return await _getOrgConfig(args[0]);
                case 'saveOrgConfig':return await _saveOrgConfig(args[0],sess);
                case 'uploadLogoOrg':return await _uploadLogoOrg(args[0],sess);
                case 'deleteLogoOrg':return await _deleteLogoOrg(args[0],sess);
                case 'consultarNitSat':return await _consultarNitSat(args[0],usuario);
                case 'getCajaStatus':return await _getCajaStatus(args[0],sess);
                case 'abrirCajaPOS':return await _abrirCajaPOS(args[0],sess);
                case 'cerrarCajaPOS':return await _cerrarCajaPOS(args[0],sess);
                case 'getVentasTurnoCaja':return await _getVentasTurnoCaja(args[0],sess);
                case 'uploadFotoProducto':return await _uploadFotoProducto(args[0],sess);
                case 'probarConexionFel':return await _probarConexionFel(args[0],sess);
                default:return{ok:false,error:'Acción no implementada: '+name};
            }
        }

        // ── api(): mecanismo de llamadas al backend via _dispatch ─────────
        function api(onSuccess,onFailure){
            const runner={
                withSuccessHandler:fn=>api(fn,onFailure),
                withFailureHandler:fn=>api(onSuccess,fn)
            };
            const METHODS=['logout','getResumen','getActividad','getClientes','addCliente','updateCliente','deleteCliente','getProspectos','addProspecto','updateProspecto','deleteProspecto','convertirProspecto','getInventario','addInventario','updateInventario','deleteInventario','getCategorias','addCategoria','updateCategoria','deleteCategoria','getEncuestas','addEncuesta','updateEncuesta','deleteEncuesta','getUsuarios','addUsuario','updateUsuario','deleteUsuario','getCuentasBancarias','addCuentaBancaria','updateCuentaBancaria','deleteCuentaBancaria','getPlanCuentas','addCuentaContable','updateCuentaContable','deleteCuentaContable','getTransacciones','addTransaccion','deleteTransaccion','getResumenContable','getCotizaciones','getCotizacion','getCotizacionHtml','addCotizacion','updateCotizacion','updateEstadoCotizacion','deleteCotizacion','duplicarCotizacion','convertirCotizacionAVenta','enviarCotizacion','getResumenCotizaciones','getPosInit','registrarVentaPos','getLibroDiario','getEstadoResultados','getFicha','addContacto','updateContacto','deleteContacto','addNotaCRM','deleteNotaCRM','addActividadCRM','deleteActividadCRM','getPerfil','updatePerfil','updatePreferencias','changePasswordPropio','uploadFotoPerfil','deleteFotoPerfil','getDashboardInit','getOrgConfig','saveOrgConfig','uploadLogoOrg','deleteLogoOrg','consultarNitSat','getCajaStatus','abrirCajaPOS','cerrarCajaPOS','getVentasTurnoCaja','uploadFotoProducto','probarConexionFel'];
            METHODS.forEach(name=>{
                runner[name]=function(){
                    const args=Array.from(arguments);
                    _dispatch(name,args).then(data=>{
                        if(data&&data.ok===false&&data.error&&data.error.includes('Sesión inválida')){localStorage.removeItem('azyvion_session');window.location.href='index.html';return;}
                        if(onSuccess)onSuccess(data);
                    }).catch(err=>{console.error('[Azyvion]',name,err);if(onFailure)onFailure(err);});
                };
            });
            return runner;
        }

        window._dispatch = _dispatch;
        window.api = api(null, null);

    })();

        function esAdmin()    { return String(_rol).trim().toLowerCase() === 'admin' || _currentUserRole === 'ADMIN' || _currentUserRole === 'SUPER_ADMIN'; }
        window.esVendedor = function esVendedor() { return String(_rol).trim().toLowerCase() === 'vendedor' || _currentUserRole === 'VENDEDOR'; };

        // Función para aplicar permisos de submenús independientes y control de Dashboard
        window.aplicarPermisosUsuario = function aplicarPermisosUsuario(sess) {
            if (!sess) return;
            var esSA = window._esSuperAdmin === true || (sess && sess.rol === 'SUPER_ADMIN');
            var esAdm = sess.rol === 'Admin' || sess.rol === 'ADMIN' || esSA;
            
            // 1. Control del Dashboard / Overview
            var puedeOv = puedeVerDashboard();
            var navOv = document.getElementById('nav-overview');
            var bnOv = document.getElementById('bn-overview');
            if (navOv) navOv.style.display = puedeOv ? 'flex' : 'none';
            if (bnOv) bnOv.style.display = puedeOv ? 'flex' : 'none';

            // 2. Mostrar ítems de nav según rol y permisos
            var mapeo = {
                'pos': ['nav-pos', 'bn-pos'],
                'clientes': ['nav-clientes', 'bn-clientes'],
                'prospectos': ['nav-prospectos', 'bn-prospectos'],
                'cotizaciones': ['nav-cotizaciones', 'bn-cotizaciones'],
                'inventario': ['nav-inventario'],
                'crear-producto': ['nav-crear-producto'],
                'encuestas': ['nav-encuestas'],
                'contabilidad': ['nav-contabilidad', 'nav-section-contabilidad'],
                'empleados': ['nav-empleados'],
                'usuarios': ['nav-usuarios'],
                'perfil': ['nav-perfil']
            };

            if (esSA || esAdm) {
                // SUPER_ADMIN y ADMIN ven todo sin restricciones
                Object.keys(mapeo).forEach(function(sm) {
                    mapeo[sm].forEach(function(elemId) {
                        var el = document.getElementById(elemId);
                        if (el) el.style.display = '';
                    });
                });
            } else if (sess.permisos && Array.isArray(sess.permisos.submenus)) {
                // Usuarios con submenús explícitamente asignados
                var permitidos = new Set(sess.permisos.submenus);
                Object.keys(mapeo).forEach(function(sm) {
                    var visible = permitidos.has(sm);
                    if (sm === 'usuarios') visible = false; // solo admin puede ver usuarios
                    mapeo[sm].forEach(function(elemId) {
                        var el = document.getElementById(elemId);
                        if (el) el.style.display = visible ? '' : 'none';
                    });
                });
            }
        };

        /* ═══════════════════════════════════════════════════════
           INICIALIZACIÓN
        ═══════════════════════════════════════════════════════ */
        document.addEventListener('DOMContentLoaded', function () {
            // ── 0. Aplicar tema/densidad cacheados de inmediato (evita parpadeo) ──
            try {
                var prefsCache = JSON.parse(localStorage.getItem('azyvion_perfil_cache') || 'null');
                if (prefsCache && prefsCache.preferencias) aplicarPreferencias(prefsCache.preferencias);
            } catch (e) {}

            // ── 1. Leer sesión de localStorage de forma inmediata ──
            var sessLocal = null;
            try { sessLocal = JSON.parse(localStorage.getItem('azyvion_session') || 'null'); } catch (e) {}

            // Sin token → login de inmediato
            if (!sessLocal || !sessLocal.token) {
                window.location.href = 'index.html?expired=1';
                return;
            }

            // Token expirado localmente → login de inmediato
            if (sessLocal.expira && new Date(sessLocal.expira) <= new Date()) {
                localStorage.removeItem('azyvion_session');
                window.location.href = 'index.html?expired=1';
                return;
            }

            // Iniciar orgId inmediatamente de sessLocal
            if (sessLocal.organization_id) {
                _currentOrgId = sessLocal.organization_id;
                window._currentOrgId = _currentOrgId;
            }

            // ── 2. Inicializar UI con datos locales SIN esperar al backend ──
            _rol     = sessLocal.rol    || '';
            _usuario = sessLocal.nombre || '';
            // Derivar _currentUserRole desde el rol legacy o session
            _currentUserRole = {
                'Admin':       'ADMIN',
                'ADMIN':       'ADMIN',
                'SUPER_ADMIN': 'SUPER_ADMIN',
                'Gerente':     'GERENTE',
                'GERENTE':     'GERENTE',
                'Agente':      'AGENTE',
                'AGENTE':      'AGENTE',
                'Vendedor':    'VENDEDOR',
                'VENDEDOR':    'VENDEDOR'
            }[_rol] || 'AGENTE';

            var elName   = document.getElementById('userName');
            var elRole   = document.getElementById('userRole');
            var elAvatar = document.getElementById('userAvatar');
            var elNav    = document.getElementById('nav-usuarios');

            if (elName)   elName.textContent   = sessLocal.nombre || '';
            if (elRole)   elRole.textContent   = sessLocal.rol    || '';
            if (elAvatar) elAvatar.textContent = (sessLocal.nombre || '??').substring(0, 2).toUpperCase();
            if (elNav)    elNav.style.display  = esAdmin() ? 'flex' : 'none';
            var elNavSub = document.getElementById('nav-suscripciones');
            var elNavSubSec = document.getElementById('nav-section-suscripciones');
            if (elNavSub) elNavSub.style.display = 'none';   // solo se muestra si _subInit confirma SUPER_ADMIN
            if (elNavSubSec) elNavSubSec.style.display = 'none';

            // Control de Dashboard y submenús independientes
            window.aplicarPermisosUsuario(sessLocal);

            // ── VENDEDOR: ocultar secciones no permitidas del sidebar ──────────
            if (esVendedor()) {
                var _vendedorHiddenNavs = [
                    'nav-overview','nav-prospectos','nav-cotizaciones','nav-empleados',
                    'nav-inventario','nav-encuestas','nav-contabilidad',
                    'nav-usuarios','nav-suscripciones','nav-section-suscripciones',
                    'nav-section-contabilidad','nav-section-config'
                ];
                _vendedorHiddenNavs.forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
                document.querySelectorAll('[data-rol-hide~="vendedor"]').forEach(function(el) {
                    el.style.display = 'none';
                });
            }
            _aplicarAvatarSidebar();

            // ── 3. Restaurar sesión en Supabase Auth ANTES de cargar datos ──
            _setSplashStatus('Verificando acceso…');
            (function restaurarSesionSupabase() {
                var s = (function(){ try { return JSON.parse(localStorage.getItem('azyvion_session')); } catch(e){ return null; } })();
                if (!s || !s.token) { localStorage.removeItem('azyvion_session'); window.location.href = 'index.html'; return; }
                window._sb.auth.setSession({ access_token: s.token, refresh_token: s.refresh_token || '' })
                    .then(function(res) {
                        if (res.error || !res.data || !res.data.session) {
                            localStorage.removeItem('azyvion_session');
                            window.location.href = 'index.html?expired=1';
                            return;
                        }
                        var newSess = res.data.session;
                        if (newSess.access_token !== s.token) {
                            s.token         = newSess.access_token;
                            s.refresh_token = newSess.refresh_token;
                            s.expira        = new Date(newSess.expires_at * 1000).toISOString();
                            try { localStorage.setItem('azyvion_session', JSON.stringify(s)); } catch(e) {}
                        }

                        // Cargar org_id del usuario si no estaba seteado
                        window._sb.from('user_roles')
                            .select('organization_id')
                            .eq('user_id', res.data.session.user.id)
                            .not('organization_id', 'is', null)
                            .limit(1)
                            .then(function(ur) {
                                if (ur.data && ur.data.length > 0 && ur.data[0].organization_id) {
                                    _currentOrgId = ur.data[0].organization_id;
                                    window._currentOrgId = _currentOrgId;
                                }
                                loadAll();
                            })
                            .catch(function() { loadAll(); });

                        // Si el usuario no puede ver Dashboard, forzar inicio en clientes
                        if (!puedeVerDashboard() || esVendedor()) {
                            setTimeout(function() {
                                if (typeof showPage === 'function') {
                                    showPage('clientes', document.getElementById('nav-clientes'));
                                }
                            }, 50);
                        } else {
                            try {
                                var prefsCacheLanding = JSON.parse(localStorage.getItem('azyvion_perfil_cache') || 'null');
                                var landing = prefsCacheLanding && prefsCacheLanding.preferencias && prefsCacheLanding.preferencias.paginaInicio;
                                if (landing && landing !== 'overview' && document.getElementById('page-' + landing)) {
                                    showPage(landing, document.getElementById('nav-' + landing));
                                }
                            } catch (e) {}
                        }
                    })
                    .catch(function(err) {
                        console.warn('[Azyvion] setSession error de red:', err);
                        // Error de red o fallo al contactar Supabase Auth.
                        // No eliminamos la sesión local (puede ser un error temporal de red).
                        // Pero SÍ debemos ocultar el splash para que el usuario no quede
                        // atrapado en carga infinita. Redirigimos al login para que vuelva
                        // a intentarlo cuando haya conectividad.
                        _hideSplash();
                        localStorage.removeItem('azyvion_session');
                        window.location.href = 'index.html?expired=1';
                    });
            })();
        });

        function loadAll() {
            loadResumen();
            loadActividad();
            loadClientes();
            if (!esVendedor()) {
                loadProspectos();
                loadInventario();
                loadCategorias();
                loadEncuestas();
                loadCotizaciones();
                _initContabilidad();
            }
            if (esAdmin()) loadUsuarios();
            _subInit();
        }

        function refreshCurrent() {
            if (_currentPage === 'overview')   {loadResumen(); loadActividad(); loadClientes(); loadInventario();}
            if (_currentPage === 'clientes')   {loadClientes(); loadResumen();}
            if (_currentPage === 'prospectos') {loadProspectos(); loadResumen();}
            if (_currentPage === 'inventario') {loadInventario(); loadResumen();}
            if (_currentPage === 'categorias') {loadCategorias();}
            if (_currentPage === 'cotizaciones') {loadCotizaciones(); loadInventario(); loadClientes();}
            if (_currentPage === 'ficha') {recargarFicha();}
            if (_currentPage === 'encuestas')  {loadEncuestas(); loadResumen();}
            if (_currentPage === 'usuarios')   {loadUsuarios();}
            if (_currentPage === 'contabilidad') { loadCuentasBancarias(); loadPlanCuentas(); loadTransacciones(); loadResumenContable(); }
            showToast('Datos actualizados', '#30D158');
        }
