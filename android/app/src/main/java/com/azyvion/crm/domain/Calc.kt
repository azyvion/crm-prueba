package com.azyvion.crm.domain

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Cálculos puros. Son traducciones exactas de pos-calc.js, embudo-calc.js y _calcT de auth.js:
 * el servidor recalcula y rechaza la venta si el total no coincide, así que deben dar lo mismo.
 */
object Calc {
    /** Redondeo «mitad hacia arriba» sobre la representación decimal, como numeric de PostgreSQL. */
    fun r2(v: Double): Double {
        if (!v.isFinite()) return 0.0
        return BigDecimal(v.toString()).setScale(2, RoundingMode.HALF_UP).toDouble()
    }

    private val formato = (NumberFormat.getNumberInstance(Locale("es", "GT")) as java.text.DecimalFormat).apply {
        minimumFractionDigits = 2; maximumFractionDigits = 2
    }
    fun q(v: Double, moneda: String = "Q"): String = "$moneda ${formato.format(v)}"
    fun qEntero(v: Double): String = "Q " + NumberFormat.getIntegerInstance(Locale("es", "GT")).format(v.roundToLong())

    // ── POS ─────────────────────────────────────────────────
    fun precioSegunLista(publico: Double, plata: Double, oro: Double, lista: String): Double = when (lista) {
        "Plata" -> if (plata > 0) plata else publico
        "Oro" -> if (oro > 0) oro else if (plata > 0) plata else publico
        else -> publico
    }

    data class Linea(val cantidad: Double, val precioUnit: Double)
    data class Totales(val subtotal: Double, val descuento: Double, val base: Double, val iva: Double, val total: Double, val descPct: Double)

    fun totalesPos(items: List<Linea>, descPct: Double, ivaPct: Double, ivaModalidad: String): Totales {
        val pct = descPct.coerceIn(0.0, 100.0)
        var subtotal = 0.0
        items.forEach { subtotal += r2(it.cantidad * it.precioUnit) }
        subtotal = r2(subtotal)
        val descuento = r2(subtotal * pct / 100)
        val base = r2(subtotal - descuento)
        val iva: Double; val total: Double
        if (ivaModalidad == "sobre") { iva = r2(base * ivaPct / 100); total = r2(base + iva) }
        else { total = base; iva = r2(total - total / (1 + ivaPct / 100)) }
        return Totales(subtotal, descuento, base, iva, total, pct)
    }

    fun redondearEfectivo(monto: Double, paso: Double): Double {
        if (!(paso > 0) || !(monto >= paso)) return r2(monto)
        val veces = BigDecimal(monto / paso).setScale(6, RoundingMode.HALF_UP).toDouble()
        return r2(Math.round(veces) * paso)
    }

    data class Pago(val metodo: String, val monto: Double?, val referencia: String = "", val cuentaBancariaId: String? = null)
    data class ResultadoPagos(val ok: Boolean, val error: String, val falta: Double, val cambio: Double, val efectivoAplicado: Double)

    fun validarPagos(total: Double, pagos: List<Pago>, redondeo: Double = 0.0, metodos: List<String> = listOf("Efectivo", "Tarjeta", "Transferencia")): ResultadoPagos {
        fun mal(m: String, falta: Double = total) = ResultadoPagos(false, m, r2(falta), 0.0, 0.0)
        if (!(total > 0)) return mal("El total debe ser mayor a cero.")
        if (pagos.isEmpty()) return mal("Indique al menos un método de pago.")
        var efectivo = 0.0; var electronico = 0.0
        for (p in pagos) {
            if (p.metodo !in listOf("Efectivo", "Tarjeta", "Transferencia")) return mal("Método de pago no soportado.")
            if (p.metodo !in metodos) return mal("El método ${p.metodo} no está habilitado.")
            val m = p.monto
            if (m == null || !m.isFinite() || m <= 0) return mal("Ingrese un monto válido en cada pago.")
            if (abs(r2(m) - m) > 1e-9) return mal("Los montos admiten máximo 2 decimales.")
            if (p.metodo == "Efectivo") efectivo += m
            else {
                electronico += m
                if (p.referencia.trim().length < 3) return mal("Ingrese la referencia (autorización o boleta) del pago con ${p.metodo.lowercase()}.")
            }
        }
        efectivo = r2(efectivo); electronico = r2(electronico)
        if (electronico > total) return mal("Los pagos electrónicos superan el total.")
        val bruto = r2(total - electronico)
        val aplicado = redondearEfectivo(bruto, redondeo)
        if (efectivo < aplicado) { val f = r2(aplicado - efectivo); return mal("Pago insuficiente: faltan ${q(f)}.", f) }
        if (aplicado == 0.0 && efectivo > 0) return mal("El total ya está cubierto con pagos electrónicos; quite el efectivo.", 0.0)
        return ResultadoPagos(true, "", 0.0, r2(efectivo - aplicado), aplicado)
    }

    fun nuevaClave(): String = "pos-" + UUID.randomUUID().toString()

    // ── Cotizaciones (_normItems y _calcT de auth.js) ─────────
    fun totalLinea(cantidad: Double, precio: Double, descPct: Double): Double {
        val b = cantidad * precio
        return r2(b - b * descPct.coerceIn(0.0, 100.0) / 100)
    }

    data class TotCot(val subtotal: Double, val descuento: Double, val iva: Double, val total: Double)
    fun totalesCotizacion(lineas: List<Double>, descPct: Double, aplicaIva: Boolean, ivaPct: Double, modalidad: String): TotCot {
        val sub = r2(lineas.sum())
        val d = r2(sub * (descPct.coerceIn(0.0, 100.0) / 100))
        val bruto = r2(sub - d)
        if (!aplicaIva || modalidad == "exento" || !(ivaPct > 0)) return TotCot(sub, d, 0.0, bruto)
        if (modalidad == "sobre") { val iv = r2(bruto * ivaPct / 100); return TotCot(sub, d, iv, r2(bruto + iv)) }
        val neto = r2(bruto / (1 + ivaPct / 100))
        val iv = r2(bruto - neto)
        return TotCot(r2(neto + d), d, iv, bruto)
    }

    // ── Licencia ─────────────────────────────────────────────
    fun normalizarLicencia(v: String?): String? {
        val c = (v ?: "").uppercase().replace(Regex("[^0-9A-Z]"), "")
        return if (c.length == 15 && c.startsWith("AZV")) "AZV-${c.substring(3, 7)}-${c.substring(7, 11)}-${c.substring(11, 15)}" else null
    }
    fun formatearLicencia(v: String): String {
        var c = v.uppercase().replace(Regex("[^0-9A-Z]"), "")
        if (c.isNotEmpty() && !"AZV".startsWith(c.take(3)) && !c.startsWith("AZV")) c = "AZV$c"
        c = c.take(15)
        return listOf(c.take(3), c.drop(3).take(4), c.drop(7).take(4), c.drop(11).take(4)).filter { it.isNotEmpty() }.joinToString("-")
    }
}

/** Embudo de ventas: mismas reglas que embudo-calc.js y la migración 10. */
object Embudo {
    val ABIERTAS = listOf("Nuevo", "Contactado", "Calificado", "Propuesta", "Negociación")
    val ETAPAS = ABIERTAS + listOf("Ganado", "Perdido")
    val PROB = mapOf("Nuevo" to 10, "Contactado" to 20, "Calificado" to 40, "Propuesta" to 60, "Negociación" to 80, "Ganado" to 100, "Perdido" to 0)
    val MOTIVOS = listOf("Precio", "Eligió a la competencia", "Sin presupuesto", "Sin respuesta", "No era el momento",
        "No necesitaba el producto", "No calificaba", "Otro")
    val ORIGENES = listOf("Referido", "Sitio web", "Llamada fría", "Evento", "Redes sociales", "Otro")
    private val MESES = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    fun esAbierto(etapa: String) = etapa in ABIERTAS
    fun ponderado(valor: Double, prob: Double) = valor * prob.coerceIn(0.0, 100.0) / 100

    data class Grupo(val n: Int, val valor: Double, val ponderado: Double)
    data class Mes(val clave: String, val etiqueta: String, val grupo: Grupo, val ganado: Double)
    data class Pronostico(val meses: List<Mes>, val vencidos: Grupo, val sinFecha: Grupo, val posteriores: Grupo, val abiertos: Grupo)
    data class Op(val etapa: String, val valor: Double, val prob: Double, val fechaCierre: String, val cerradoEn: String)

    private fun sumar(l: List<Op>) = Grupo(l.size, l.sumOf { it.valor }, l.sumOf { ponderado(it.valor, it.prob) })

    /** Clave «AAAA-MM» del cierre. cerrado_en viene en UTC; se pasa a hora de Guatemala (UTC-6). */
    fun mesDeCierre(iso: String): String? = runCatching {
        java.time.OffsetDateTime.parse(iso.replace(" ", "T").let { if (Regex("[+-]\\d\\d$").containsMatchIn(it)) "$it:00" else it })
            .atZoneSameInstant(java.time.ZoneId.of("America/Guatemala")).let { "%04d-%02d".format(it.year, it.monthValue) }
    }.getOrNull()

    fun pronostico(ops: List<Op>, hoy: LocalDate, meses: Int = 6): Pronostico {
        val claves = (0 until meses).map { YearMonth.from(hoy).plusMonths(it.toLong()) }
        val idx = claves.mapIndexed { i, ym -> ym.toString() to i }.toMap()
        val hoyStr = hoy.toString()
        val abiertos = ops.filter { esAbierto(it.etapa) }
        val porMes = Array(meses) { mutableListOf<Op>() }
        val ganado = DoubleArray(meses)
        val venc = mutableListOf<Op>(); val sin = mutableListOf<Op>(); val post = mutableListOf<Op>()
        abiertos.forEach { o ->
            val f = o.fechaCierre.take(10)
            when {
                f.isEmpty() -> sin += o
                f < hoyStr -> venc += o
                else -> idx[f.take(7)]?.let { porMes[it] += o } ?: post.add(o)
            }
        }
        ops.filter { it.etapa == "Ganado" && it.cerradoEn.isNotEmpty() }.forEach { o ->
            mesDeCierre(o.cerradoEn)?.let { idx[it] }?.let { ganado[it] += o.valor }
        }
        return Pronostico(
            claves.mapIndexed { i, ym -> Mes(ym.toString(), MESES[ym.monthValue - 1] + " " + ym.year, sumar(porMes[i]), ganado[i]) },
            sumar(venc), sumar(sin), sumar(post), sumar(abiertos),
        )
    }

    fun estaVencido(etapa: String, fechaCierre: String, hoy: LocalDate) =
        esAbierto(etapa) && fechaCierre.isNotEmpty() && fechaCierre.take(10) < hoy.toString()

    fun validar(etapa: String, prob: String, valor: String, motivo: String, fecha: String): String {
        if (etapa !in ETAPAS) return "Etapa inválida"
        val p = prob.toDoubleOrNull()
        if (p == null || p < 0 || p > 100) return "La probabilidad debe estar entre 0 y 100"
        val v = if (valor.isBlank()) 0.0 else valor.toDoubleOrNull()
        if (v == null || v < 0) return "El valor estimado no puede ser negativo"
        if (etapa == "Perdido" && motivo.isBlank()) return "Indique el motivo de pérdida"
        if (fecha.isNotEmpty() && runCatching { LocalDate.parse(fecha, DateTimeFormatter.ISO_LOCAL_DATE) }.isFailure) return "Fecha de cierre inválida"
        return ""
    }
}

/** Fecha de hoy en Guatemala (igual que licencia_hoy() y crm_tareas en el servidor). */
fun hoyGT(): LocalDate = LocalDate.now(java.time.ZoneId.of("America/Guatemala"))
