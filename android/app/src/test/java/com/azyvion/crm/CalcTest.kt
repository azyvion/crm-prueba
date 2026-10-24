package com.azyvion.crm

import com.azyvion.crm.domain.Calc
import com.azyvion.crm.domain.Embudo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Mismos casos que tests/unit/pos.test.js, quote_math.test.js, embudo.test.js y licencias.test.js. */
class CalcTest {
    @Test fun redondeoComoNumeric() {
        assertEquals(10.0, Calc.r2(9.995), 0.0)
        assertEquals(1.01, Calc.r2(1.005), 0.0)
        assertEquals(-1.01, Calc.r2(-1.005), 0.0)
    }

    @Test fun precioSegunLista() {
        assertEquals(90.0, Calc.precioSegunLista(100.0, 90.0, 80.0, "Plata"), 0.0)
        assertEquals(80.0, Calc.precioSegunLista(100.0, 90.0, 80.0, "Oro"), 0.0)
        assertEquals(90.0, Calc.precioSegunLista(100.0, 90.0, 0.0, "Oro"), 0.0)
        assertEquals(100.0, Calc.precioSegunLista(100.0, 0.0, 0.0, "Plata"), 0.0)
    }

    @Test fun totalesPosIvaIncluidoYSobre() {
        val l = listOf(Calc.Linea(2.0, 100.0), Calc.Linea(1.0, 250.5))
        val inc = Calc.totalesPos(l, 10.0, 12.0, "incluido")
        assertEquals(450.5, inc.subtotal, 0.0); assertEquals(45.05, inc.descuento, 0.0); assertEquals(405.45, inc.total, 0.0)
        assertEquals(43.44, inc.iva, 0.0)
        val sobre = Calc.totalesPos(l, 0.0, 12.0, "sobre")
        assertEquals(54.06, sobre.iva, 0.0); assertEquals(504.56, sobre.total, 0.0)
    }

    @Test fun validarPagos() {
        assertTrue(Calc.validarPagos(100.0, listOf(Calc.Pago("Efectivo", 150.0))).let { it.ok && it.cambio == 50.0 })
        assertFalse(Calc.validarPagos(100.0, listOf(Calc.Pago("Efectivo", 90.0))).ok)
        assertFalse(Calc.validarPagos(100.0, listOf(Calc.Pago("Tarjeta", 100.0, "12"))).ok)          // referencia corta
        assertTrue(Calc.validarPagos(100.0, listOf(Calc.Pago("Tarjeta", 60.0, "AUT123"), Calc.Pago("Efectivo", 40.0))).ok)
        assertFalse(Calc.validarPagos(100.0, listOf(Calc.Pago("Tarjeta", 100.0, "AUT123"), Calc.Pago("Efectivo", 5.0))).ok)
        assertFalse(Calc.validarPagos(100.0, listOf(Calc.Pago("Efectivo", 100.001))).ok)
        // redondeo del efectivo a Q0.50: 99.80 → 100.00
        assertEquals(100.0, Calc.validarPagos(99.8, listOf(Calc.Pago("Efectivo", 100.0)), 0.5).efectivoAplicado, 0.0)
    }

    @Test fun totalesCotizacion() {
        val inc = Calc.totalesCotizacion(listOf(112.0), 0.0, true, 12.0, "incluido")
        assertEquals(112.0, inc.total, 0.0); assertEquals(12.0, inc.iva, 0.0)
        val sobre = Calc.totalesCotizacion(listOf(100.0), 0.0, true, 12.0, "sobre")
        assertEquals(112.0, sobre.total, 0.0)
        assertEquals(100.0, Calc.totalesCotizacion(listOf(100.0), 0.0, false, 12.0, "incluido").total, 0.0)
        assertEquals(90.0, Calc.totalLinea(1.0, 100.0, 10.0), 0.0)
    }

    @Test fun licencia() {
        assertEquals("AZV-AB12-CD34-EF56", Calc.normalizarLicencia(" azv-ab12 cd34-EF56 "))
        assertNull(Calc.normalizarLicencia("AZV-123"))
        assertEquals("AZV-AB12-CD34-EF56", Calc.formatearLicencia("ab12cd34ef56"))
        assertEquals("A", Calc.formatearLicencia("a"))
    }

    @Test fun pronosticoSinDuplicar() {
        val hoy = LocalDate.of(2026, 10, 23)
        val ops = listOf(
            Embudo.Op("Propuesta", 1000.0, 50.0, "2026-10-23", ""),
            Embudo.Op("Propuesta", 4000.0, 80.0, "2026-11-01", ""),
            Embudo.Op("Propuesta", 300.0, 50.0, "2026-10-22", ""),
            Embudo.Op("Propuesta", 900.0, 50.0, "", ""),
            Embudo.Op("Propuesta", 700.0, 50.0, "2027-04-01", ""),
            Embudo.Op("Perdido", 5000.0, 0.0, "2026-10-25", ""),
            Embudo.Op("Ganado", 1500.0, 100.0, "", "2026-10-05T15:00:00+00:00"),
        )
        val r = Embudo.pronostico(ops, hoy)
        assertEquals(listOf("2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"), r.meses.map { it.clave })
        assertEquals(500.0, r.meses[0].grupo.ponderado, 0.0)
        assertEquals(3200.0, r.meses[1].grupo.ponderado, 0.0)
        assertEquals(1, r.vencidos.n); assertEquals(1, r.sinFecha.n); assertEquals(1, r.posteriores.n)
        assertEquals(r.abiertos.n, r.meses.sumOf { it.grupo.n } + r.vencidos.n + r.sinFecha.n + r.posteriores.n)
        assertEquals(1500.0, r.meses[0].ganado, 0.0)
    }

    @Test fun validarProspecto() {
        assertEquals("", Embudo.validar("Propuesta", "60", "1000", "", "2026-11-15"))
        assertTrue(Embudo.validar("Perdido", "0", "1000", " ", "").contains("motivo"))
        assertTrue(Embudo.validar("Propuesta", "101", "1000", "", "").contains("probabilidad"))
        assertTrue(Embudo.validar("Propuesta", "50", "-5", "", "").contains("negativo"))
    }
}
