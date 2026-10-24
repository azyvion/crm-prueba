package com.azyvion.crm.ui.tareas

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Snooze
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.Tarea
import com.azyvion.crm.domain.hoyGT
import com.azyvion.crm.ui.common.Campo
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Etiqueta
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Selector
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Vacio
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.colorPrioridad
import com.azyvion.crm.ui.common.fechaCorta
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.common.toast
import com.azyvion.crm.ui.theme.Rojo
import kotlinx.coroutines.launch
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TareasScreen(nav: NavController) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var filtro by rememberSaveable { mutableStateOf("Pendientes") }
    var soloMias by rememberSaveable { mutableStateOf(true) }
    val completadas = filtro == "Completadas"
    val c = rememberCarga(soloMias, completadas) { a.repo.tareas(soloMias, completadas) }
    var nueva by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Tareas", fontWeight = FontWeight.Bold) }, actions = {
                Text("Solo mías", fontSize = 13.sp); Spacer(Modifier.width(6.dp))
                Switch(checked = soloMias, onCheckedChange = { soloMias = it })
                IconButton(onClick = { c.recargar() }) { Icon(Icons.Default.Refresh, "Actualizar") }
            })
        },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { nueva = true }, icon = { Icon(Icons.Default.Add, null) }, text = { Text("Tarea") }) },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("Pendientes", "Hoy", "Vencidas", "Próximas", "Completadas")) { f ->
                    FilterChip(selected = filtro == f, onClick = { filtro = f }, label = { Text(f) })
                }
            }
            Contenido(c) { lista ->
                val hoy = hoyGT().toString()
                val filtradas = lista.filter { t ->
                    when (filtro) {
                        "Hoy" -> !t.completada && t.fechaSeguimiento == hoy
                        "Vencidas" -> !t.completada && t.fechaSeguimiento < hoy
                        "Próximas" -> !t.completada && t.fechaSeguimiento > hoy
                        "Completadas" -> t.completada
                        else -> !t.completada
                    }
                }
                LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (filtradas.isEmpty()) item { Vacio(if (filtro == "Completadas") "Sin tareas completadas." else "No hay tareas aquí. 🎉") }
                    items(filtradas, key = { it.id }) { t ->
                        FilaTarea(t, hoy,
                            alCompletar = { valor ->
                                scope.launch {
                                    try { a.repo.completarTarea(t.id, valor); c.recargar() } catch (e: Exception) { toast(ctx, e.message ?: "Error") }
                                }
                            },
                            alPosponer = {
                                val d = runCatching { LocalDate.parse(t.fechaSeguimiento) }.getOrElse { hoyGT() }.let { if (it.isBefore(hoyGT())) hoyGT() else it }.plusDays(1)
                                DatePickerDialog(ctx, { _, y, m, dd ->
                                    scope.launch {
                                        try { a.repo.posponerTarea(t.id, "%04d-%02d-%02d".format(y, m + 1, dd)); c.recargar() }
                                        catch (e: Exception) { toast(ctx, e.message ?: "Error") }
                                    }
                                }, d.year, d.monthValue - 1, d.dayOfMonth).show()
                            },
                            alAbrir = { if (t.refId.isNotBlank() && t.tipo != "General") nav.navigate("ficha/${t.tipo}/${t.refId}") },
                        )
                    }
                }
            }
        }
    }
    if (nueva) NuevaTareaDialog(alCerrar = { guardada -> nueva = false; if (guardada) c.recargar() })
}

@Composable
private fun FilaTarea(t: Tarea, hoy: String, alCompletar: (Boolean) -> Unit, alPosponer: () -> Unit, alAbrir: () -> Unit) {
    Tarjeta(onClick = alAbrir) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = t.completada, onCheckedChange = alCompletar)
            Column(Modifier.weight(1f)) {
                Text(t.titulo, fontWeight = FontWeight.SemiBold, textDecoration = if (t.completada) TextDecoration.LineThrough else null)
                val vencida = !t.completada && t.fechaSeguimiento < hoy
                Text(
                    listOfNotNull(if (t.fechaSeguimiento == hoy) "Hoy" else fechaCorta(t.fechaSeguimiento), t.hora.ifBlank { null },
                        t.refNombre.ifBlank { null }, t.responsable.ifBlank { null }).joinToString(" · "),
                    fontSize = 13.sp, color = if (vencida) Rojo else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (t.descripcion.isNotBlank()) Text(t.descripcion, fontSize = 13.sp, maxLines = 2)
            }
            Column(horizontalAlignment = Alignment.End) {
                Etiqueta(t.prioridad, colorPrioridad(t.prioridad))
                if (!t.completada) IconButton(onClick = alPosponer) { Icon(Icons.Default.Snooze, "Posponer") }
            }
        }
    }
}

/** Crear una tarea general o un seguimiento de un cliente/prospecto. */
@Composable
fun NuevaTareaDialog(tipo: String = "General", refId: String? = null, refNombre: String = "", alCerrar: (Boolean) -> Unit) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var titulo by remember { mutableStateOf(if (refNombre.isNotBlank()) "Dar seguimiento a ${refNombre.substringBefore(' ')}" else "") }
    var fecha by remember { mutableStateOf(hoyGT().plusDays(1).toString()) }
    var hora by remember { mutableStateOf("") }
    var prioridad by remember { mutableStateOf("Normal") }
    var desc by remember { mutableStateOf("") }
    var ocupado by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!ocupado) alCerrar(false) },
        title = { Text(if (refId != null) "Nuevo seguimiento" else "Nueva tarea") },
        text = {
            Column {
                Campo("¿Qué hay que hacer?", titulo, { titulo = it })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = {
                        val d = LocalDate.parse(fecha)
                        DatePickerDialog(ctx, { _, y, m, dd -> fecha = "%04d-%02d-%02d".format(y, m + 1, dd) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
                    }, modifier = Modifier.weight(1f)) { Text(fechaCorta(fecha)) }
                    OutlinedButton(onClick = {
                        TimePickerDialog(ctx, { _, h, mi -> hora = "%02d:%02d".format(h, mi) }, 9, 0, true).show()
                    }, modifier = Modifier.weight(1f)) { Text(hora.ifBlank { "Hora (opcional)" }) }
                }
                Spacer(Modifier.height(8.dp))
                Selector("Prioridad", listOf("Baja", "Normal", "Alta"), prioridad, { prioridad = it })
                Campo("Detalle", desc, { desc = it }, lineas = 2)
            }
        },
        confirmButton = {
            TextButton(enabled = !ocupado, onClick = {
                ocupado = true
                scope.launch {
                    try { a.repo.crearTarea(titulo, fecha, hora, prioridad, desc, tipo, refId); toast(ctx, "Tarea creada"); alCerrar(true) }
                    catch (e: Exception) { toast(ctx, e.message ?: "Error") }
                    ocupado = false
                }
            }) { Text("Guardar") }
        },
        dismissButton = { TextButton(onClick = { alCerrar(false) }) { Text("Cancelar") } },
    )
}
