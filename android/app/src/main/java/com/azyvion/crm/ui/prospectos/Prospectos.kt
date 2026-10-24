package com.azyvion.crm.ui.prospectos

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.Repo
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.domain.Embudo
import com.azyvion.crm.domain.hoyGT
import com.azyvion.crm.ui.common.BotonPrincipal
import com.azyvion.crm.ui.common.Campo
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Selector
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Titulo
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.colorEtapa
import com.azyvion.crm.ui.common.fechaCorta
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.common.toast
import com.azyvion.crm.ui.theme.Azul
import com.azyvion.crm.ui.theme.Rojo
import com.azyvion.crm.ui.theme.Verde
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProspectoFormScreen(nav: NavController, id: String?) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var nombre by rememberSaveable { mutableStateOf("") }
    var empresa by rememberSaveable { mutableStateOf("") }
    var telefono by rememberSaveable { mutableStateOf("") }
    var correo by rememberSaveable { mutableStateOf("") }
    var direccion by rememberSaveable { mutableStateOf("") }
    var origen by rememberSaveable { mutableStateOf("Referido") }
    var etapa by rememberSaveable { mutableStateOf("Nuevo") }
    var valor by rememberSaveable { mutableStateOf("") }
    var prob by rememberSaveable { mutableStateOf("10") }
    var cierre by rememberSaveable { mutableStateOf("") }
    var motivo by rememberSaveable { mutableStateOf("") }
    var detalle by rememberSaveable { mutableStateOf("") }
    var notas by rememberSaveable { mutableStateOf("") }
    var cargado by rememberSaveable { mutableStateOf(id == null) }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val cerrada = etapa == "Ganado" || etapa == "Perdido"

    LaunchedEffect(id) {
        if (id != null && !cargado) {
            val p = a.cache.prospectos.find { it.id == id } ?: runCatching { a.repo.prospectos() }.getOrNull()?.find { it.id == id }
            if (p != null) {
                nombre = p.nombre; empresa = p.empresa; telefono = p.telefono; correo = p.correo; direccion = p.direccion
                origen = p.origen; etapa = p.etapa; valor = if (p.valorEstimado % 1.0 == 0.0) p.valorEstimado.toLong().toString() else p.valorEstimado.toString()
                prob = p.probabilidad.toInt().toString(); cierre = p.fechaCierreEstimada.take(10); motivo = p.motivoPerdida
                detalle = p.motivoDetalle; notas = p.notas
            }
            cargado = true
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(if (id == null) "Nuevo prospecto" else "Editar prospecto") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } })
    }) { pad ->
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Campo("Nombre completo *", nombre, { nombre = it })
            Campo("Empresa *", empresa, { empresa = it })
            Row {
                Campo("Teléfono *", telefono, { telefono = it }, Modifier.weight(1f), teclado = KeyboardType.Phone)
                Spacer(Modifier.width(8.dp))
                Campo("Correo", correo, { correo = it }, Modifier.weight(1f), teclado = KeyboardType.Email)
            }
            Campo("Dirección *", direccion, { direccion = it })
            Selector("Origen", Embudo.ORIGENES, origen, { origen = it })
            Spacer(Modifier.height(8.dp))
            // Al cambiar de etapa se sugiere la probabilidad (en etapas cerradas la fija el servidor)
            Selector("Etapa", Embudo.ETAPAS, etapa, { etapa = it; prob = (Embudo.PROB[it] ?: 10).toString() })
            Row {
                Campo("Valor estimado (Q)", valor, { valor = it }, Modifier.weight(1f), teclado = KeyboardType.Decimal)
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(value = prob, onValueChange = { prob = it.filter { c -> c.isDigit() }.take(3) }, enabled = !cerrada,
                    label = { Text("Probabilidad %") }, singleLine = true, modifier = Modifier.weight(1f).padding(vertical = 4.dp),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            if (!cerrada) {
                OutlinedTextField(
                    value = if (cierre.isBlank()) "" else fechaCorta(cierre), onValueChange = {}, readOnly = true,
                    label = { Text("Fecha de cierre estimada") }, supportingText = { Text("Se usa para el pronóstico mensual") },
                    trailingIcon = {
                        Row {
                            if (cierre.isNotBlank()) IconButton(onClick = { cierre = "" }) { Icon(Icons.Default.Clear, "Quitar fecha") }
                            IconButton(onClick = {
                                val d = runCatching { java.time.LocalDate.parse(cierre) }.getOrElse { hoyGT().plusDays(30) }
                                DatePickerDialog(ctx, { _, y, m, dd -> cierre = "%04d-%02d-%02d".format(y, m + 1, dd) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
                            }) { Icon(Icons.Default.CalendarMonth, "Elegir fecha") }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                )
            }
            if (etapa == "Perdido") {
                Selector("Motivo de pérdida *", Embudo.MOTIVOS, motivo.ifBlank { "Seleccione…" }, { motivo = it })
                Campo("Detalle del motivo", detalle, { detalle = it })
            }
            Campo("Notas", notas, { notas = it }, lineas = 3)
            error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(16.dp))
            BotonPrincipal("Guardar", {
                val m = if (motivo == "Seleccione…") "" else motivo
                val v = Embudo.validar(etapa, prob, valor, m, cierre)
                if (v.isNotEmpty()) { error = v; return@BotonPrincipal }
                ocupado = true; error = null
                scope.launch {
                    try {
                        val nuevo = a.repo.guardarProspecto(id, Repo.DatosProspecto(nombre, empresa, telefono, correo, direccion, origen, etapa,
                            valor.toDoubleOrNull() ?: 0.0, prob.toDoubleOrNull() ?: 0.0, if (cerrada) cierre else cierre, m, detalle, notas))
                        a.cache.prospectos = emptyList()
                        toast(ctx, if (id == null) "Prospecto creado" else "Prospecto actualizado")
                        nav.popBackStack()
                        if (id == null) nav.navigate("ficha/Prospecto/$nuevo")
                    } catch (e: Exception) { error = e.message }
                    ocupado = false
                }
            }, ocupado = ocupado, habilitado = cargado)
        }
    }
}

/** Embudo por etapa, pronóstico de 6 meses, tasa de cierre y motivos de pérdida (como la web). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmbudoScreen(nav: NavController) {
    val a = app()
    val c = rememberCarga { a.repo.prospectos().also { a.cache.prospectos = it } }
    Scaffold(topBar = {
        TopAppBar(title = { Text("Embudo y pronóstico") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } })
    }) { pad ->
        Contenido(c) { lista ->
            val hoy = hoyGT()
            val ops = lista.map { Embudo.Op(it.etapa, it.valorEstimado, it.probabilidad, it.fechaCierreEstimada, it.cerradoEn) }
            val pr = Embudo.pronostico(ops, hoy)
            val desde = java.time.Instant.now().minusSeconds(90L * 86400)
            val cerrados = lista.filter { it.cerradoEn.isNotBlank() && runCatching { java.time.OffsetDateTime.parse(it.cerradoEn).toInstant() >= desde }.getOrDefault(false) }
            val ganados = cerrados.count { it.etapa == "Ganado" }
            val perdidos = cerrados.filter { it.etapa == "Perdido" }
            val motivos = perdidos.filter { it.motivoPerdida.isNotBlank() }.groupBy { it.motivoPerdida }
                .map { (m, l) -> Triple(m, l.size, l.sumOf { it.valorEstimado }) }.sortedByDescending { it.second }
            LazyColumn(Modifier.padding(pad), contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Tarjeta {
                        Titulo("Embudo abierto")
                        Text("${pr.abiertos.n} oportunidades · ${Calc.qEntero(pr.abiertos.valor)} · ponderado ${Calc.qEntero(pr.abiertos.ponderado)}",
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(10.dp))
                        val max = Embudo.ABIERTAS.maxOf { e -> lista.filter { it.etapa == e }.sumOf { it.valorEstimado } }.coerceAtLeast(1.0)
                        Embudo.ABIERTAS.forEach { e ->
                            val g = lista.filter { it.etapa == e }
                            val v = g.sumOf { it.valorEstimado }
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                                Box(Modifier.size(10.dp).background(colorEtapa(e), CircleShape)); Spacer(Modifier.width(8.dp))
                                Text(e, Modifier.weight(1f), fontWeight = FontWeight.Medium)
                                Text("${g.size} · ${Calc.qEntero(v)}", fontSize = 13.sp)
                            }
                            Barra((v / max).toFloat(), colorEtapa(e))
                        }
                    }
                }
                item {
                    Tarjeta {
                        Titulo("Pronóstico de cierre")
                        Text(if (ganados + perdidos.size == 0) "Tasa de cierre (90 días): sin cierres aún"
                             else "Tasa de cierre (90 días): ${Math.round(ganados * 100.0 / (ganados + perdidos.size))}% · $ganados ganados / ${perdidos.size} perdidos",
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(10.dp))
                        val max = pr.meses.maxOf { maxOf(it.grupo.valor, it.ganado) }.coerceAtLeast(1.0)
                        pr.meses.forEachIndexed { i, m ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                                Text(m.etiqueta + if (i == 0) " (este mes)" else "", Modifier.weight(1f), fontWeight = if (i == 0) FontWeight.Bold else FontWeight.Normal)
                                Text(Calc.qEntero(m.grupo.ponderado), fontWeight = FontWeight.SemiBold)
                            }
                            Barra((m.grupo.ponderado / max).toFloat(), Azul)
                            Text("Total ${Calc.qEntero(m.grupo.valor)}" + if (m.ganado > 0) " · ganado ${Calc.qEntero(m.ganado)}" else "",
                                fontSize = 12.sp, color = if (m.ganado > 0) Verde else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Spacer(Modifier.height(8.dp))
                        if (pr.vencidos.n > 0) Text("Vencidos: ${pr.vencidos.n} · ${Calc.qEntero(pr.vencidos.valor)}", color = Rojo, fontSize = 13.sp)
                        if (pr.sinFecha.n > 0) Text("Sin fecha de cierre: ${pr.sinFecha.n} · ${Calc.qEntero(pr.sinFecha.valor)}", fontSize = 13.sp)
                        if (pr.posteriores.n > 0) Text("Después de 6 meses: ${pr.posteriores.n} · ${Calc.qEntero(pr.posteriores.valor)}", fontSize = 13.sp)
                    }
                }
                item {
                    Tarjeta {
                        Titulo("Motivos de pérdida (90 días)")
                        if (motivos.isEmpty()) Text("Sin pérdidas con motivo en los últimos 90 días.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        val total = motivos.sumOf { it.second }.coerceAtLeast(1)
                        motivos.forEach { (m, n, v) ->
                            Row(Modifier.padding(top = 6.dp)) { Text("$m · $n", Modifier.weight(1f)); Text("${n * 100 / total}% · ${Calc.qEntero(v)}", fontSize = 13.sp) }
                            Barra(n.toFloat() / total, Rojo)
                        }
                        val sinMotivo = lista.count { it.etapa == "Perdido" && it.motivoPerdida.isBlank() }
                        if (sinMotivo > 0) Text("$sinMotivo perdidos anteriores sin motivo registrado.", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun Barra(fraccion: Float, color: Color) {
    Box(Modifier.fillMaxWidth().height(8.dp).padding(top = 2.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))) {
        Box(Modifier.fillMaxWidth(fraccion.coerceIn(0f, 1f)).fillMaxHeight().background(color, RoundedCornerShape(4.dp)))
    }
}
