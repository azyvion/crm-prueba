package com.azyvion.crm.data

import kotlinx.serialization.json.JsonObject

data class Cliente(
    val id: String, val nombre: String, val empresa: String, val nit: String, val segmento: String,
    val listaPrecio: String, val correo: String, val telefono: String, val direccion: String,
    val ciudad: String, val pais: String, val fuente: String, val estado: String, val valorTotal: Double,
    val creadoPor: String, val fechaNacimiento: String,
) {
    companion object {
        fun de(o: JsonObject) = Cliente(
            id = o.s("id"), nombre = o.s("nombre"), empresa = o.s("empresa"), nit = o.s("nit"),
            segmento = o.str("segmento") ?: "Estándar", listaPrecio = o.str("lista_precio") ?: "Publico",
            correo = o.s("correo"), telefono = o.s("telefono"), direccion = o.s("direccion"), ciudad = o.s("ciudad"),
            pais = o.str("pais") ?: "Guatemala", fuente = o.s("fuente"), estado = o.str("estado") ?: "Activo",
            valorTotal = o.n("valorTotal"), creadoPor = o.s("creadoPor"), fechaNacimiento = o.s("fecha_nacimiento"),
        )
    }
}

data class Prospecto(
    val id: String, val nombre: String, val empresa: String, val segmento: String, val correo: String,
    val telefono: String, val direccion: String, val origen: String, val etapa: String, val valorEstimado: Double,
    val probabilidad: Double, val notas: String, val fechaReg: String, val fechaCierreEstimada: String,
    val motivoPerdida: String, val motivoDetalle: String, val cerradoEn: String, val clienteId: String,
) {
    companion object {
        fun de(o: JsonObject) = Prospecto(
            id = o.s("id"), nombre = o.s("nombre"), empresa = o.s("empresa"), segmento = o.str("segmento") ?: "Estándar",
            correo = o.s("correo"), telefono = o.s("telefono"), direccion = o.s("direccion"), origen = o.str("origen") ?: "Otro",
            etapa = o.str("etapa") ?: "Nuevo", valorEstimado = o.n("valorEstimado"), probabilidad = o.n("probabilidad"),
            notas = o.s("notas"), fechaReg = o.s("fechaReg"), fechaCierreEstimada = o.s("fecha_cierre_estimada"),
            motivoPerdida = o.s("motivo_perdida"), motivoDetalle = o.s("motivo_perdida_detalle"),
            cerradoEn = o.s("cerrado_en"), clienteId = o.s("clienteId"),
        )
    }
}

data class Producto(
    val id: String, val nombre: String, val sku: String, val codigoBarras: String, val categoria: String,
    val tipo: String, val unidades: Double, val stockMinimo: Double, val precioPublico: Double,
    val precioPlata: Double, val precioOro: Double, val activo: Boolean, val descripcion: String,
    val unidad: String, val imagenUrl: String,
) {
    val esServicio get() = tipo == "Servicio"
    companion object {
        fun de(o: JsonObject): Producto {
            val tipo = if (o.s("tipo") == "Servicio") "Servicio" else "Producto"
            val pub = o.n("precioUnit")
            return Producto(
                id = o.s("id"), nombre = o.s("producto"), sku = o.s("sku"), codigoBarras = o.s("codigo_barras"),
                categoria = o.s("categoria"), tipo = tipo, unidades = if (tipo == "Servicio") 0.0 else o.n("unidades"),
                stockMinimo = o.n("stock_minimo"), precioPublico = pub,
                precioPlata = o.num("precioPlata")?.takeIf { it > 0 } ?: o.num("precio_plata") ?: 0.0,
                precioOro = o.num("precioOro")?.takeIf { it > 0 } ?: o.num("precio_oro") ?: 0.0,
                activo = o.bool("activo") ?: true, descripcion = o.s("descripcion"),
                unidad = o.str("unidad") ?: (if (tipo == "Servicio") "Servicio" else "Unidad"), imagenUrl = o.s("imagen_url"),
            )
        }
    }
}

data class Tarea(
    val id: String, val tipo: String, val refId: String, val refNombre: String, val categoria: String,
    val titulo: String, val descripcion: String, val fechaSeguimiento: String, val hora: String,
    val prioridad: String, val responsable: String, val completada: Boolean,
) {
    companion object {
        fun de(o: JsonObject) = Tarea(
            id = o.s("id"), tipo = o.str("tipo") ?: "General", refId = o.s("refId"), refNombre = o.s("refNombre"),
            categoria = o.str("categoria") ?: "Tarea", titulo = o.s("titulo"), descripcion = o.s("descripcion"),
            fechaSeguimiento = o.s("fechaSeguimiento").take(10), hora = o.s("hora").take(5),
            prioridad = o.str("prioridad") ?: "Normal", responsable = o.s("responsable"), completada = o.bool("completada") ?: false,
        )
    }
}

data class Cotizacion(
    val id: String, val numero: String, val clienteId: String, val cliente: String, val empresa: String,
    val correo: String, val telefono: String, val fecha: String, val validezDias: Int, val estado: String,
    val subtotal: Double, val descuento: Double, val descuentoPct: Double, val iva: Double, val total: Double,
    val aplicaIVA: Boolean, val notas: String, val condiciones: String, val creadoPor: String,
) {
    companion object {
        fun de(o: JsonObject) = Cotizacion(
            id = o.s("id"), numero = o.s("numero"), clienteId = o.s("clienteId"), cliente = o.s("cliente"),
            empresa = o.s("empresa"), correo = o.s("correo"), telefono = o.s("telefono"), fecha = o.s("fecha").take(10),
            validezDias = o.num("validezDias")?.toInt() ?: 15, estado = o.str("estado") ?: "Borrador",
            subtotal = o.n("subtotal"), descuento = o.n("descuento"), descuentoPct = o.n("descuentoPct"), iva = o.n("iva"),
            total = o.n("total"), aplicaIVA = o.bool("aplicaIVA") ?: false, notas = o.s("notas"),
            condiciones = o.s("condiciones"), creadoPor = o.s("creadoPor"),
        )
    }
}

data class CotItem(
    val itemId: String?, val tipo: String, val descripcion: String, val detalle: String, val unidadMedida: String,
    val cantidad: Double, val precioUnit: Double, val descuentoPct: Double, val total: Double,
) {
    companion object {
        fun de(o: JsonObject) = CotItem(
            itemId = o.str("itemId"), tipo = o.str("tipo") ?: "Producto", descripcion = o.s("descripcion"), detalle = o.s("detalle"),
            unidadMedida = o.str("unidadMedida") ?: "UND", cantidad = o.n("cantidad"), precioUnit = o.n("precioUnit"),
            descuentoPct = o.n("descuentoPct"), total = o.n("total"),
        )
    }
}

/** Configuración de la empresa que afecta cálculos y documentos. */
data class Empresa(
    val nombre: String, val nit: String, val telefono: String, val direccion: String, val moneda: String,
    val ivaPct: Double, val ivaModalidad: String, val prefijoCotizacion: String, val condicionesDefault: String,
    val diasVigencia: Int,
) {
    companion object {
        val VACIA = Empresa("", "", "", "", "Q", 12.0, "incluido", "COT-", "", 15)
        fun de(o: JsonObject) = Empresa(
            nombre = o.s("nombre"), nit = o.str("nit") ?: "C/F", telefono = o.s("telefono"), direccion = o.s("direccion"),
            moneda = o.str("moneda") ?: "Q", ivaPct = o.num("iva_pct") ?: 12.0, ivaModalidad = o.str("iva_modalidad") ?: "incluido",
            prefijoCotizacion = o.str("prefijo_cotizacion") ?: "COT-",
            condicionesDefault = o.str("condiciones_default") ?: "Precios sujetos a cambio sin previo aviso.",
            diasVigencia = o.num("dias_vigencia_cotizacion")?.toInt() ?: 15,
        )
    }
}

/** Resultado de mi_licencia(). */
data class MiLicencia(
    val vigente: Boolean, val interna: Boolean, val motivo: String, val plan: String, val venceEn: String,
    val diasRestantes: Int?, val maxUsuarios: Int, val usuariosActivos: Int, val puedeActivar: Boolean,
) {
    companion object {
        fun de(o: JsonObject) = MiLicencia(
            vigente = o.bool("vigente") ?: false, interna = o.bool("interna") ?: false, motivo = o.s("motivo"),
            plan = o.s("plan"), venceEn = o.s("vence_en"), diasRestantes = o.num("dias_restantes")?.toInt(),
            maxUsuarios = o.num("max_usuarios")?.toInt() ?: 0, usuariosActivos = o.num("usuarios_activos")?.toInt() ?: 0,
            puedeActivar = o.bool("puede_activar") ?: false,
        )
    }
}

data class CuentaBancaria(val id: String, val nombre: String, val banco: String) {
    companion object { fun de(o: JsonObject) = CuentaBancaria(o.s("id"), o.s("nombre"), o.s("banco")) }
}

data class Nota(val id: String, val contenido: String, val usuario: String, val fecha: String) {
    companion object { fun de(o: JsonObject) = Nota(o.s("id"), o.s("contenido"), o.s("usuario"), o.s("fecha")) }
}

data class Actividad(val id: String, val categoria: String, val titulo: String, val descripcion: String, val fecha: String, val usuario: String) {
    companion object { fun de(o: JsonObject) = Actividad(o.s("id"), o.str("categoria") ?: "Otro", o.s("titulo"), o.s("descripcion"), o.s("fecha"), o.s("usuario")) }
}

data class Contacto(val id: String, val nombre: String, val cargo: String, val telefono: String, val correo: String) {
    companion object { fun de(o: JsonObject) = Contacto(o.s("id"), o.s("nombre"), o.s("cargo"), o.s("telefono"), o.s("correo")) }
}
