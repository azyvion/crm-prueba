package com.azyvion.crm.ui.clientes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.Cliente
import com.azyvion.crm.data.Prospecto
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.ui.common.Campo
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Dato
import com.azyvion.crm.ui.common.Etiqueta
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Titulo
import com.azyvion.crm.ui.common.abrirWhatsApp
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.colorEstadoCot
import com.azyvion.crm.ui.common.colorEtapa
import com.azyvion.crm.ui.common.enviarCorreo
import com.azyvion.crm.ui.common.fechaCorta
import com.azyvion.crm.ui.common.llamar
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.common.toast
import com.azyvion.crm.ui.tareas.NuevaTareaDialog
import kotlinx.coroutines.launch

/** Ficha de un cliente o prospecto: contacto rápido, datos, notas, actividades y cotizaciones. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FichaScreen(nav: NavController, tipo: String, id: String) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val esCliente = tipo == "Cliente"
    val ent = rememberCarga(id) {
        if (esCliente) a.cache.clientes.find { it.id == id } ?: a.repo.cliente(id) ?: error("Cliente no encontrado.")
        else a.cache.prospectos.find { it.id == id } ?: a.repo.prospectos().also { a.cache.prospectos = it }.find { it.id == id } ?: error("Prospecto no encontrado.")
    }
    val ficha = rememberCarga(id) { a.repo.ficha(tipo, id) }
    var nota by remember { mutableStateOf<String?>(null) }
    var tarea by remember { mutableStateOf(false) }
    var convertir by remember { mutableStateOf(false) }

    val nombre = when (val e = ent.datos) { is Cliente -> e.nombre; is Prospecto -> e.nombre; else -> "" }
    val telefono = when (val e = ent.datos) { is Cliente -> e.telefono; is Prospecto -> e.telefono; else -> "" }
    val correo = when (val e = ent.datos) { is Cliente -> e.correo; is Prospecto -> e.correo; else -> "" }

    /** Abre la app y deja constancia en la ficha (igual que «Contactar» en la web). */
    fun contactar(categoria: String, accion: () -> Unit) {
        accion()
        scope.launch { runCatching { a.repo.registrarActividad(tipo, id, categoria, "Contactado por $categoria") }; ficha.recargar() }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(nombre.ifBlank { tipo }, maxLines = 1) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } },
            actions = { IconButton(onClick = { nav.navigate(if (esCliente) "clienteForm?id=$id" else "prospectoForm?id=$id") }) { Icon(Icons.Default.Edit, "Editar") } },
        )
    }) { pad ->
        Contenido(ent) { e ->
            LazyColumn(Modifier.padding(pad), contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        Accion(Icons.Default.Phone, "Llamar", Modifier.weight(1f)) { contactar("Llamada") { llamar(ctx, telefono) } }
                        Accion(Icons.Default.Chat, "WhatsApp", Modifier.weight(1f)) { contactar("WhatsApp") { abrirWhatsApp(ctx, telefono, "Hola ${nombre.substringBefore(' ')}, ") } }
                        Accion(Icons.Default.Email, "Correo", Modifier.weight(1f)) { contactar("Correo") { enviarCorreo(ctx, correo) } }
                    }
                }
                item {
                    Tarjeta {
                        when (e) {
                            is Cliente -> {
                                Dato("Empresa", e.empresa); Dato("NIT", e.nit); Dato("Teléfono", e.telefono); Dato("Correo", e.correo)
                                Dato("Dirección", listOf(e.direccion, e.ciudad, e.pais).filter { it.isNotBlank() }.joinToString(", "))
                                Dato("Lista de precio", e.listaPrecio); Dato("Segmento", e.segmento); Dato("Estado", e.estado)
                                Dato("Origen", e.fuente)
                            }
                            is Prospecto -> {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Etiqueta(e.etapa, colorEtapa(e.etapa)); Spacer(Modifier.width(8.dp))
                                    Text("${Calc.qEntero(e.valorEstimado)} · ${e.probabilidad.toInt()}%", fontWeight = FontWeight.SemiBold)
                                }
                                Spacer(Modifier.height(6.dp))
                                Dato("Empresa", e.empresa); Dato("Teléfono", e.telefono); Dato("Correo", e.correo); Dato("Dirección", e.direccion)
                                Dato("Origen", e.origen)
                                Dato("Cierre estimado", if (e.fechaCierreEstimada.isBlank()) "" else fechaCorta(e.fechaCierreEstimada))
                                if (e.etapa == "Perdido") Dato("Motivo", listOf(e.motivoPerdida, e.motivoDetalle).filter { it.isNotBlank() }.joinToString(" — "))
                                Dato("Notas", e.notas)
                                if (e.etapa != "Ganado") {
                                    Spacer(Modifier.height(8.dp))
                                    FilledTonalButton(onClick = { convertir = true }, modifier = Modifier.fillMaxWidth()) { Text("Convertir en cliente") }
                                }
                            }
                        }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(onClick = { nota = "" }, modifier = Modifier.weight(1f)) { Text("Agregar nota") }
                        OutlinedButton(onClick = { tarea = true }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.TaskAlt, null); Spacer(Modifier.width(6.dp)); Text("Seguimiento") }
                    }
                }
                val f = ficha.datos
                if (f == null) { item { Text(if (ficha.cargando) "Cargando historial…" else (ficha.error ?: ""), color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                else {
                    if (f.cotizaciones.isNotEmpty()) {
                        item { Titulo("Cotizaciones") }
                        f.cotizaciones.forEach { c ->
                            item {
                                Tarjeta(onClick = { nav.navigate("cotizacion/${c.id}") }) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Column(Modifier.weight(1f)) { Text(c.numero, fontWeight = FontWeight.SemiBold); Text(fechaCorta(c.fecha), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                        Column(horizontalAlignment = Alignment.End) { Etiqueta(c.estado, colorEstadoCot(c.estado)); Text(Calc.q(c.total), fontWeight = FontWeight.SemiBold) }
                                    }
                                }
                            }
                        }
                    }
                    if (f.contactos.isNotEmpty()) {
                        item { Titulo("Contactos") }
                        f.contactos.forEach { k ->
                            item {
                                Tarjeta {
                                    Text(k.nombre, fontWeight = FontWeight.SemiBold); if (k.cargo.isNotBlank()) Text(k.cargo, fontSize = 13.sp)
                                    Row { if (k.telefono.isNotBlank()) TextButton(onClick = { llamar(ctx, k.telefono) }) { Text(k.telefono) }
                                          if (k.correo.isNotBlank()) TextButton(onClick = { enviarCorreo(ctx, k.correo) }) { Text(k.correo) } }
                                }
                            }
                        }
                    }
                    item { Titulo("Historial") }
                    val historial = (f.notas.map { Triple(it.fecha, "Nota · ${it.usuario}", it.contenido) } +
                        f.actividades.map { Triple(it.fecha, "${it.categoria} · ${it.usuario}", listOf(it.titulo, it.descripcion).filter { s -> s.isNotBlank() }.joinToString("\n")) })
                        .sortedByDescending { it.first }
                    if (historial.isEmpty()) item { Text("Sin notas ni actividades todavía.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    historial.forEach { (fecha, quien, texto) ->
                        item {
                            Column(Modifier.fillMaxWidth()) {
                                Text("${fechaCorta(fecha)} · $quien", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(texto, fontSize = 14.sp)
                                HorizontalDivider(Modifier.padding(top = 8.dp))
                            }
                        }
                    }
                }
            }
        }
    }

    nota?.let { texto ->
        AlertDialog(
            onDismissRequest = { nota = null }, title = { Text("Nueva nota") },
            text = { Campo("Nota", texto, { nota = it }, lineas = 4) },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try { a.repo.agregarNota(tipo, id, texto); nota = null; ficha.recargar() } catch (e: Exception) { toast(ctx, e.message ?: "Error") }
                    }
                }) { Text("Guardar") }
            },
            dismissButton = { TextButton(onClick = { nota = null }) { Text("Cancelar") } },
        )
    }
    if (tarea) NuevaTareaDialog(tipo = tipo, refId = id, refNombre = nombre, alCerrar = { guardada -> tarea = false; if (guardada) ficha.recargar() })
    if (convertir) {
        val p = ent.datos as? Prospecto
        var valor by remember { mutableStateOf(p?.valorEstimado?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "") }
        AlertDialog(
            onDismissRequest = { convertir = false }, title = { Text("Convertir en cliente") },
            text = {
                Column {
                    Text("Se crea el cliente con sus datos y el prospecto queda como Ganado en el embudo.", fontSize = 14.sp)
                    Campo("Valor ganado (Q)", valor, { valor = it }, teclado = androidx.compose.ui.text.input.KeyboardType.Decimal)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            val cid = a.repo.convertirProspecto(id, valor.toDoubleOrNull())
                            a.cache.prospectos = emptyList(); a.cache.clientes = emptyList()
                            convertir = false; toast(ctx, "Cliente creado.")
                            nav.popBackStack(); if (cid.isNotBlank()) nav.navigate("ficha/Cliente/$cid")
                        } catch (e: Exception) { toast(ctx, e.message ?: "Error") }
                    }
                }) { Text("Convertir") }
            },
            dismissButton = { TextButton(onClick = { convertir = false }) { Text("Cancelar") } },
        )
    }
}

@Composable
private fun Accion(icono: ImageVector, texto: String, modifier: Modifier, onClick: () -> Unit) {
    FilledTonalButton(onClick = onClick, modifier = modifier) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(icono, null); Text(texto, fontSize = 12.sp) }
    }
}

