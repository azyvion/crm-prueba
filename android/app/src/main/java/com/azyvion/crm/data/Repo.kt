package com.azyvion.crm.data

import com.azyvion.crm.domain.Calc
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID

/** Resultado del inicio de sesión. */
sealed interface ResultadoLogin {
    data object Ok : ResultadoLogin
    /** Empresa sin licencia. Si [sesionPendiente] no es null, el usuario es administrador y puede activar una. */
    data class SinLicencia(val mensaje: String, val sesionPendiente: Sesion?) : ResultadoLogin
    data class Error(val mensaje: String) : ResultadoLogin
}

/**
 * Operaciones del CRM. Es la misma lógica de auth.js; la seguridad real está en el servidor
 * (RLS por empresa con licencia, funciones RPC con permisos y validaciones).
 */
class Repo(private val api: Api, private val sesiones: SessionStore) {
    private val ses get() = sesiones.actual.value ?: throw ApiException("Tu sesión terminó.", 401)
    private val org get() = ses.orgId
    private val usuario get() = ses.usuario.ifBlank { ses.nombre }
    private fun ahora() = Instant.now().toString()
    private fun uuid() = UUID.randomUUID().toString()
    private fun eqOrg(): Array<Pair<String, String>> = if (org.isNotBlank()) arrayOf("organization_id" to "eq.$org") else emptyArray()

    // ═════════════ Sesión y licencia ═════════════
    suspend fun login(usuarioOCorreo: String, contrasena: String): ResultadoLogin {
        val (code, r) = api.funcion("login-crm", buildJsonObject { put("usuario", usuarioOCorreo.trim()); put("contrasena", contrasena) })
        val sesion = r.obj("session")?.let { s ->
            val permisos = r.obj("permisos")
            Sesion(
                accessToken = s.s("access_token"), refreshToken = s.s("refresh_token"),
                expiraEn = s.num("expires_at")?.toLong() ?: (System.currentTimeMillis() / 1000 + 3600),
                nombre = r.s("nombre"), usuario = r.s("usuario"), rol = r.s("rol"), orgId = r.s("organization_id"),
                submenus = (permisos?.get("submenus") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList(),
            )
        }
        if (r.bool("sinLicencia") == true) {
            val msg = r.str("error") ?: "Tu empresa no tiene una licencia vigente."
            return ResultadoLogin.SinLicencia(msg, if (r.bool("puedeActivar") == true) sesion else null)
        }
        if (r.bool("ok") != true || sesion == null) return ResultadoLogin.Error(r.str("error") ?: "No se pudo iniciar sesión ($code).")
        sesiones.guardar(sesion)
        sesiones.ultimoUsuario = usuarioOCorreo.trim()
        return ResultadoLogin.Ok
    }

    /** Guarda una sesión pendiente (administrador sin licencia) para poder llamar a licencia_activar. */
    fun usarSesion(s: Sesion) = sesiones.guardar(s)

    fun cerrarSesion() = sesiones.cerrar()

    suspend fun miLicencia(): MiLicencia = MiLicencia.de(api.rpc("mi_licencia").asObj())

    suspend fun activarLicencia(clave: String): MiLicencia {
        val c = Calc.normalizarLicencia(clave) ?: throw ApiException("Escribe el código completo: AZV-XXXX-XXXX-XXXX.")
        return MiLicencia.de(api.rpc("licencia_activar", buildJsonObject { put("p_clave", c) }).asObj())
    }

    suspend fun empresa(): Empresa =
        api.select("Organizations", "select" to "*", "id" to "eq.$org").firstOrNull()?.let { Empresa.de(it) } ?: Empresa.VACIA

    // ═════════════ Clientes ═════════════
    suspend fun clientes(): List<Cliente> {
        val f = mutableListOf("select" to "*", "order" to "nombre", *eqOrg())
        if (ses.esVendedor) f += "creadoPor" to "eq.$usuario"
        return api.select("Clientes", *f.toTypedArray()).map { Cliente.de(it) }
    }

    suspend fun cliente(id: String): Cliente? = api.select("Clientes", "select" to "*", "id" to "eq.$id").firstOrNull()?.let { Cliente.de(it) }

    data class DatosCliente(
        val nombre: String, val empresa: String, val nit: String, val telefono: String, val correo: String,
        val direccion: String, val ciudad: String, val pais: String, val fuente: String, val segmento: String,
        val listaPrecio: String, val estado: String,
    )

    private fun validarCliente(d: DatosCliente): String? = when {
        d.nombre.isBlank() -> "El nombre comercial es requerido."
        d.empresa.isBlank() -> "La razón social es obligatoria."
        d.nit.isBlank() -> "El NIT es obligatorio."
        d.telefono.isBlank() -> "El teléfono es obligatorio."
        d.direccion.isBlank() -> "La dirección es obligatoria."
        d.ciudad.isBlank() -> "La ciudad es obligatoria."
        d.pais.isBlank() -> "El país es obligatorio."
        d.fuente.isBlank() -> "La fuente / origen es obligatoria."
        else -> null
    }

    suspend fun guardarCliente(id: String?, d: DatosCliente): String {
        validarCliente(d)?.let { throw ApiException(it) }
        val campos = buildJsonObject {
            put("nombre", d.nombre.trim()); put("empresa", d.empresa.trim()); put("nit", d.nit.trim())
            put("telefono", d.telefono.trim()); put("correo", d.correo.trim()); put("direccion", d.direccion.trim())
            put("ciudad", d.ciudad.trim()); put("pais", d.pais.trim()); put("fuente", d.fuente.trim())
            put("segmento", d.segmento); put("lista_precio", d.listaPrecio); put("estado", d.estado)
        }
        if (id != null) {
            if (api.update("Clientes", campos, "id" to "eq.$id", *eqOrg()).isEmpty()) throw ApiException("No se pudo actualizar el cliente.")
            return id
        }
        val nuevo = uuid()
        api.insert("Clientes", JsonObject(campos + mapOf(
            "id" to JsonPrimitive(nuevo), "valorTotal" to JsonPrimitive(0), "color" to JsonPrimitive("#1F5F99"),
            "fechaReg" to JsonPrimitive(ahora()), "creadoPor" to JsonPrimitive(usuario), "organization_id" to JsonPrimitive(org),
        )))
        runCatching {
            api.insert("Actividad", buildJsonObject {
                put("id", uuid()); put("tipo", "cliente"); put("usuario", usuario); put("descripcion", "Nuevo cliente: ${d.nombre}")
                put("fecha", ahora()); put("organization_id", org)
            })
        }
        return nuevo
    }

    // ═════════════ Prospectos y embudo ═════════════
    suspend fun prospectos(): List<Prospecto> {
        val todos = mutableListOf<Prospecto>()
        var desde = 0
        while (true) {   // paginado de 1000 en 1000 (límite de PostgREST)
            val pag = api.select("Prospectos", "select" to "*", "order" to "nombre", "offset" to "$desde", "limit" to "1000", *eqOrg())
            todos += pag.map { Prospecto.de(it) }
            if (pag.size < 1000) break
            desde += 1000
        }
        return todos
    }

    data class DatosProspecto(
        val nombre: String, val empresa: String, val telefono: String, val correo: String, val direccion: String,
        val origen: String, val etapa: String, val valor: Double, val probabilidad: Double, val fechaCierre: String,
        val motivo: String, val motivoDetalle: String, val notas: String,
    )

    suspend fun guardarProspecto(id: String?, d: DatosProspecto): String {
        when {
            d.nombre.isBlank() -> throw ApiException("El nombre es requerido.")
            d.empresa.isBlank() -> throw ApiException("La empresa es obligatoria.")
            d.telefono.isBlank() -> throw ApiException("El teléfono es obligatorio.")
            d.direccion.isBlank() -> throw ApiException("La dirección es obligatoria.")
        }
        val campos = buildJsonObject {
            put("nombre", d.nombre.trim()); put("empresa", d.empresa.trim()); put("telefono", d.telefono.trim())
            put("correo", d.correo.trim()); put("direccion", d.direccion.trim()); put("origen", d.origen)
            put("etapa", d.etapa); put("valorEstimado", d.valor); put("probabilidad", d.probabilidad.coerceIn(0.0, 100.0))
            put("notas", d.notas)
            put("fecha_cierre_estimada", if (d.fechaCierre.isBlank()) JsonNull else JsonPrimitive(d.fechaCierre))
            put("motivo_perdida", if (d.motivo.isBlank()) JsonNull else JsonPrimitive(d.motivo))
            put("motivo_perdida_detalle", if (d.motivoDetalle.isBlank()) JsonNull else JsonPrimitive(d.motivoDetalle))
        }
        if (id != null) {
            if (api.update("Prospectos", campos, "id" to "eq.$id", *eqOrg()).isEmpty()) throw ApiException("No se pudo actualizar el prospecto.")
            return id
        }
        val nuevo = uuid()
        api.insert("Prospectos", JsonObject(campos + mapOf(
            "id" to JsonPrimitive(nuevo), "segmento" to JsonPrimitive("Estándar"), "color" to JsonPrimitive("#1F5F99"),
            "fechaReg" to JsonPrimitive(ahora()), "organization_id" to JsonPrimitive(org),
        )))
        return nuevo
    }

    /** Conversión atómica (crm_convertir_prospecto): crea el cliente y deja el prospecto como Ganado. */
    suspend fun convertirProspecto(id: String, valor: Double?): String {
        val r = api.rpc("crm_convertir_prospecto", buildJsonObject {
            put("p_id", id); put("p_estado", "Activo"); put("p_valor", valor?.let { JsonPrimitive(it) } ?: JsonNull)
        }).asObj()
        return r.s("cliente_id")
    }

    // ═════════════ Ficha (cliente o prospecto) ═════════════
    data class Ficha(val notas: List<Nota>, val actividades: List<Actividad>, val contactos: List<Contacto>, val cotizaciones: List<Cotizacion>)

    suspend fun ficha(tipo: String, id: String): Ficha {
        val notas = api.select("NotasCRM", "select" to "*", "tipo" to "eq.$tipo", "refId" to "eq.$id", "order" to "fecha.desc").map { Nota.de(it) }
        val acts = api.select("ActividadesCRM", "select" to "*", "tipo" to "eq.$tipo", "refId" to "eq.$id", "order" to "fechaReg.desc").map { Actividad.de(it) }
        val contactos = api.select("Contactos", "select" to "*", "tipo" to "eq.$tipo", "refId" to "eq.$id", "order" to "nombre").map { Contacto.de(it) }
        val cots = if (tipo == "Cliente") api.select("Cotizaciones", "select" to "*", "clienteId" to "eq.$id", "order" to "numero.desc").map { Cotizacion.de(it) } else emptyList()
        return Ficha(notas, acts, contactos, cots)
    }

    suspend fun agregarNota(tipo: String, refId: String, texto: String) {
        if (texto.isBlank()) throw ApiException("Escribe la nota.")
        api.insert("NotasCRM", buildJsonObject {
            put("id", uuid()); put("tipo", tipo); put("refId", refId); put("contenido", texto.trim())
            put("usuario", usuario); put("fecha", ahora()); put("organization_id", org)
        })
    }

    /** Registra una llamada / WhatsApp / visita en la ficha (como _addActividadCRM / _registrarMensaje). */
    suspend fun registrarActividad(tipo: String, refId: String, categoria: String, titulo: String, descripcion: String = "") {
        api.insert("ActividadesCRM", buildJsonObject {
            put("id", uuid()); put("tipo", tipo); put("refId", refId); put("categoria", categoria)
            put("titulo", titulo.take(200)); put("descripcion", descripcion.take(2000))
            put("fecha", com.azyvion.crm.domain.hoyGT().toString()); put("prioridad", "Normal")
            put("usuario", usuario); put("fechaReg", ahora()); put("organization_id", org)
        })
    }

    // ═════════════ Tareas ═════════════
    suspend fun tareas(soloMias: Boolean, completadas: Boolean): List<Tarea> {
        val r = api.rpcOk("crm_tareas", buildJsonObject {
            put("p_desde", JsonNull); put("p_hasta", JsonNull); put("p_solo_mias", soloMias); put("p_completadas", completadas)
        })
        return r.arr("filas").map { Tarea.de(it) }
    }

    suspend fun crearTarea(titulo: String, fecha: String, hora: String, prioridad: String, descripcion: String, tipo: String = "General", refId: String? = null) {
        if (titulo.isBlank()) throw ApiException("Escriba qué hay que hacer.")
        if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(fecha)) throw ApiException("Indique la fecha de la tarea.")
        api.insert("ActividadesCRM", buildJsonObject {
            put("id", uuid()); put("tipo", tipo); put("refId", refId?.let { JsonPrimitive(it) } ?: JsonNull)
            put("categoria", "Tarea"); put("titulo", titulo.trim().take(200)); put("descripcion", descripcion.take(2000))
            put("fecha", com.azyvion.crm.domain.hoyGT().toString()); put("fechaSeguimiento", fecha)
            put("hora_seguimiento", if (Regex("^\\d{2}:\\d{2}$").matches(hora)) JsonPrimitive(hora) else JsonNull)
            put("prioridad", if (prioridad in listOf("Baja", "Normal", "Alta")) prioridad else "Normal")
            put("responsable", usuario); put("usuario", usuario); put("fechaReg", ahora()); put("organization_id", org)
        })
    }

    suspend fun completarTarea(id: String, completada: Boolean) {
        val r = api.update("ActividadesCRM", buildJsonObject {
            put("completada", completada)
            put("completada_en", if (completada) JsonPrimitive(ahora()) else JsonNull)
            put("completada_por", if (completada) JsonPrimitive(usuario) else JsonNull)
        }, "id" to "eq.$id")
        if (r.isEmpty()) throw ApiException("La tarea no existe o no tiene permiso para modificarla.")
    }

    suspend fun posponerTarea(id: String, fecha: String) {
        if (api.update("ActividadesCRM", buildJsonObject { put("fechaSeguimiento", fecha) }, "id" to "eq.$id").isEmpty())
            throw ApiException("No se pudo mover la tarea.")
    }

    // ═════════════ Inventario ═════════════
    suspend fun productos(): List<Producto> =
        api.select("Inventario", "select" to "*", "order" to "producto", *eqOrg()).map { Producto.de(it) }

    // ═════════════ Cotizaciones ═════════════
    suspend fun cotizaciones(): List<Cotizacion> =
        api.select("Cotizaciones", "select" to "*", "order" to "numero.desc", *eqOrg()).map { Cotizacion.de(it) }

    suspend fun cotizacion(id: String): Pair<Cotizacion, List<CotItem>> {
        val c = api.select("Cotizaciones", "select" to "*", "id" to "eq.$id").firstOrNull() ?: throw ApiException("Cotización no encontrada.")
        val items = api.select("CotizacionItems", "select" to "*", "cotizacionId" to "eq.$id").map { CotItem.de(it) }
        return Cotizacion.de(c) to items
    }

    suspend fun cambiarEstadoCotizacion(id: String, estado: String) {
        if (estado !in listOf("Borrador", "Enviada", "Aprobada", "Rechazada", "Vencida")) throw ApiException("Estado inválido.")
        api.update("Cotizaciones", buildJsonObject { put("estado", estado) }, "id" to "eq.$id", *eqOrg())
    }

    data class LineaCot(val itemId: String?, val tipo: String, val descripcion: String, val cantidad: Double, val precio: Double, val descPct: Double)

    private suspend fun siguienteNumero(pref: String): String {
        val y = java.time.Year.now().value
        val re = Regex("^" + Regex.escape(pref) + "\\d{4}-(\\d+)$")
        val max = api.select("Cotizaciones", "select" to "numero", "numero" to "like.$pref$y-*", *eqOrg())
            .mapNotNull { re.find(it.s("numero"))?.groupValues?.get(1)?.toIntOrNull() }.maxOrNull() ?: 0
        return "$pref$y-" + (max + 1).toString().padStart(4, '0')
    }

    /** Igual que _addCotizacion: número con reintento ante duplicado y compensación si fallan los ítems. */
    suspend fun crearCotizacion(cliente: Cliente?, nombreCliente: String, lineas: List<LineaCot>, descPct: Double, aplicaIva: Boolean, notas: String, emp: Empresa): String {
        if (nombreCliente.isBlank()) throw ApiException("El cliente es requerido.")
        val items = lineas.filter { it.descripcion.isNotBlank() && it.cantidad > 0 }
        if (items.isEmpty()) throw ApiException("Agrega al menos un ítem.")
        val totLineas = items.map { Calc.totalLinea(it.cantidad, it.precio, it.descPct) }
        val t = Calc.totalesCotizacion(totLineas, descPct, aplicaIva, emp.ivaPct, emp.ivaModalidad)
        val id = uuid()
        var numero = siguienteNumero(emp.prefijoCotizacion)
        fun fila() = buildJsonObject {
            put("id", id); put("numero", numero); put("clienteId", cliente?.id?.let { JsonPrimitive(it) } ?: JsonNull)
            put("cliente", nombreCliente.trim()); put("empresa", cliente?.empresa.orEmpty()); put("correo", cliente?.correo.orEmpty())
            put("telefono", cliente?.telefono.orEmpty()); put("direccion", cliente?.direccion.orEmpty())
            put("fecha", com.azyvion.crm.domain.hoyGT().toString()); put("validezDias", emp.diasVigencia)
            put("condiciones", emp.condicionesDefault); put("notas", notas); put("descuentoPct", descPct); put("aplicaIVA", aplicaIva)
            put("subtotal", t.subtotal); put("descuento", t.descuento); put("iva", t.iva); put("total", t.total)
            put("estado", "Borrador"); put("creadoPor", usuario); put("fechaReg", ahora()); put("organization_id", org)
        }
        var ultimo: ApiException? = null
        for (intento in 0 until 3) {
            try { api.insert("Cotizaciones", fila()); ultimo = null; break }
            catch (e: ApiException) {
                ultimo = e
                if (e.datos?.str("code") != "23505") break
                numero = siguienteNumero(emp.prefijoCotizacion)
            }
        }
        ultimo?.let { throw it }
        val arr = buildJsonArray {
            items.forEachIndexed { i, it ->
                add(buildJsonObject {
                    put("itemId", it.itemId?.let { v -> JsonPrimitive(v) } ?: JsonNull); put("tipo", it.tipo)
                    put("descripcion", it.descripcion.trim()); put("detalle", ""); put("unidadMedida", "UND")
                    put("cantidad", it.cantidad); put("precioUnit", it.precio); put("descuentoPct", it.descPct); put("total", totLineas[i])
                })
            }
        }
        try {
            api.rpc("replace_cotizacion_items", buildJsonObject { put("p_cotizacion_id", id); put("p_items", arr) })
        } catch (e: ApiException) {
            runCatching { api.delete("Cotizaciones", "id" to "eq.$id") }
            throw ApiException("No se pudieron guardar los ítems: ${e.message}")
        }
        return numero
    }

    // ═════════════ Punto de venta ═════════════
    data class PosPermisos(
        val descuento: Boolean, val cajaMov: Boolean, val descuentoMax: Double, val privilegiado: Boolean,
        val redondeo: Double, val metodos: List<String>, val cajaObligatoria: String, val puedeVenderSinStock: Boolean,
    )

    suspend fun posPermisos(): PosPermisos {
        val r = api.rpcOk("pos_mis_permisos")
        val p = r.obj("permisos") ?: JsonObject(emptyMap())
        val cfg = r.obj("config") ?: JsonObject(emptyMap())
        val metodos = (cfg["metodos_habilitados"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }?.takeIf { it.isNotEmpty() }
            ?: listOf("Efectivo", "Tarjeta", "Transferencia")
        return PosPermisos(
            descuento = p.bool("descuento") ?: false, cajaMov = p.bool("caja_mov") ?: false,
            descuentoMax = r.num("descuentoMax") ?: 0.0, privilegiado = r.bool("privilegiado") ?: false,
            redondeo = cfg.num("redondeo_efectivo") ?: 0.0, metodos = metodos,
            cajaObligatoria = cfg.str("caja_obligatoria") ?: "auto", puedeVenderSinStock = r.bool("puedeVenderSinStock") ?: false,
        )
    }

    data class EstadoCaja(val abierta: Boolean, val cajaId: String, val cajero: String, val montoInicial: Double, val resumen: JsonObject?)

    suspend fun estadoCaja(): EstadoCaja {
        val r = api.rpcOk("pos_estado_caja")
        return EstadoCaja(r.bool("cajaAbierta") ?: false, r.s("cajaId"), r.s("cajero"), r.n("montoInicial"), r.obj("resumen"))
    }

    suspend fun abrirCaja(monto: Double, obs: String) { api.rpcOk("pos_abrir_caja", buildJsonObject { put("p_monto", monto); put("p_obs", obs) }) }

    suspend fun cerrarCaja(cajaId: String, contado: Double, obs: String): JsonObject =
        api.rpcOk("pos_cerrar_caja", buildJsonObject { put("p_caja_id", cajaId); put("p_contado", contado); put("p_obs", obs) })

    suspend fun movimientoCaja(tipo: String, monto: Double, motivo: String) {
        api.rpcOk("pos_caja_movimiento", buildJsonObject { put("p_tipo", tipo); put("p_monto", monto); put("p_motivo", motivo) })
    }

    suspend fun clientesPos(): List<Cliente> =
        api.select("Clientes", "select" to "id,nombre,empresa,nit,correo,telefono,direccion,lista_precio", "order" to "nombre", *eqOrg()).map { Cliente.de(it) }

    suspend fun cuentasBancarias(): List<CuentaBancaria> =
        runCatching { api.select("CuentasBancarias", "select" to "id,nombre,banco", "order" to "nombre", *eqOrg()).map { CuentaBancaria.de(it) } }.getOrDefault(emptyList())

    data class ItemVenta(val productoId: String, val cantidad: Double, val precioUnit: Double)

    /** pos_registrar_venta: el servidor valida existencias, precios, permisos y el total; la clave evita cobros dobles. */
    suspend fun registrarVenta(
        clave: String, items: List<ItemVenta>, descPct: Double, total: Double, lista: String,
        cliente: Cliente?, pagos: List<Calc.Pago>, permitirSinCaja: Boolean,
    ): Pair<JsonObject, Boolean> {
        val p = buildJsonObject {
            put("idempotency_key", clave)
            put("items", buildJsonArray { items.forEach { add(buildJsonObject { put("id", it.productoId); put("cantidad", it.cantidad); put("precioUnit", it.precioUnit) }) } })
            put("descuentoPct", descPct); put("total", total); put("propina", 0); put("listaPrecio", lista)
            put("clienteId", cliente?.id?.let { JsonPrimitive(it) } ?: JsonNull)
            put("clienteNombre", cliente?.nombre ?: "Consumidor Final (C/F)")
            put("nit", cliente?.nit?.ifBlank { null } ?: "C/F"); put("direccion", cliente?.direccion?.ifBlank { null } ?: "Ciudad")
            put("permitir_sin_caja", permitirSinCaja); put("cotizacionId", JsonNull)
            put("pagos", buildJsonArray {
                pagos.forEach { g ->
                    add(buildJsonObject {
                        put("metodo", g.metodo); put("monto", g.monto ?: 0.0)
                        if (g.metodo != "Efectivo") put("referencia", g.referencia.trim())
                        if (g.metodo == "Transferencia" && g.cuentaBancariaId != null) put("cuentaBancariaId", g.cuentaBancariaId)
                    })
                }
            })
        }
        val r = api.rpcOk("pos_registrar_venta", buildJsonObject { put("p", p) })
        return (r.obj("ticket") ?: JsonObject(emptyMap())) to (r.bool("duplicado") == true)
    }

    /** Si el cobro quedó «incierto» (se cortó la red), consulta si la venta se registró con esa clave. */
    suspend fun ventaPorClave(clave: String): JsonObject? = runCatching {
        api.rpcOk("pos_obtener_ticket", buildJsonObject { put("p_venta_id", JsonNull); put("p_key", clave); put("p_reimpresion", false) }).obj("ticket")
    }.getOrNull()
}
