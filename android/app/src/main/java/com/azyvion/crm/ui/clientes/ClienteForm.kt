package com.azyvion.crm.ui.clientes

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.azyvion.crm.data.Repo
import com.azyvion.crm.ui.common.BotonPrincipal
import com.azyvion.crm.ui.common.Campo
import com.azyvion.crm.ui.common.Selector
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.toast
import kotlinx.coroutines.launch

/** Alta o edición de cliente (mismos campos obligatorios que la web). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClienteFormScreen(nav: NavController, id: String?) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var nombre by rememberSaveable { mutableStateOf("") }
    var empresa by rememberSaveable { mutableStateOf("") }
    var nit by rememberSaveable { mutableStateOf("C/F") }
    var telefono by rememberSaveable { mutableStateOf("") }
    var correo by rememberSaveable { mutableStateOf("") }
    var direccion by rememberSaveable { mutableStateOf("") }
    var ciudad by rememberSaveable { mutableStateOf("Guatemala") }
    var pais by rememberSaveable { mutableStateOf("Guatemala") }
    var fuente by rememberSaveable { mutableStateOf("Referido") }
    var segmento by rememberSaveable { mutableStateOf("Estándar") }
    var lista by rememberSaveable { mutableStateOf("Publico") }
    var estado by rememberSaveable { mutableStateOf("Activo") }
    var cargado by rememberSaveable { mutableStateOf(id == null) }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        if (id != null && !cargado) {
            val c = a.cache.clientes.find { it.id == id } ?: runCatching { a.repo.cliente(id) }.getOrNull()
            if (c != null) {
                nombre = c.nombre; empresa = c.empresa; nit = c.nit; telefono = c.telefono; correo = c.correo
                direccion = c.direccion; ciudad = c.ciudad; pais = c.pais; fuente = c.fuente.ifBlank { "Referido" }
                segmento = c.segmento; lista = c.listaPrecio; estado = c.estado
            }
            cargado = true
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(if (id == null) "Nuevo cliente" else "Editar cliente") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } })
    }) { pad ->
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Campo("Nombre comercial *", nombre, { nombre = it })
            Campo("Razón social *", empresa, { empresa = it })
            Row {
                Campo("NIT *", nit, { nit = it }, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Campo("Teléfono *", telefono, { telefono = it }, Modifier.weight(1f), teclado = KeyboardType.Phone)
            }
            Campo("Correo", correo, { correo = it }, teclado = KeyboardType.Email)
            Campo("Dirección *", direccion, { direccion = it })
            Row {
                Campo("Ciudad *", ciudad, { ciudad = it }, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Campo("País *", pais, { pais = it }, Modifier.weight(1f))
            }
            Spacer(Modifier.height(4.dp))
            Selector("Origen *", listOf("Referido", "Sitio web", "Llamada fría", "Evento", "Redes sociales", "Tienda", "Otro"), fuente, { fuente = it })
            Spacer(Modifier.height(8.dp))
            Row {
                Selector("Segmento", listOf("Estándar", "Premium", "Corporativo"), segmento, { segmento = it }, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Selector("Lista de precio", listOf("Publico", "Plata", "Oro"), lista, { lista = it }, Modifier.weight(1f))
            }
            Spacer(Modifier.height(8.dp))
            Selector("Estado", listOf("Activo", "Pendiente", "Inactivo"), estado, { estado = it })
            error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(16.dp))
            BotonPrincipal("Guardar", {
                ocupado = true; error = null
                scope.launch {
                    try {
                        val nuevo = a.repo.guardarCliente(id, Repo.DatosCliente(nombre, empresa, nit, telefono, correo, direccion, ciudad, pais, fuente, segmento, lista, estado))
                        a.cache.clientes = emptyList()
                        toast(ctx, if (id == null) "Cliente creado" else "Cliente actualizado")
                        nav.popBackStack()
                        if (id == null) nav.navigate("ficha/Cliente/$nuevo")
                    } catch (e: Exception) { error = e.message }
                    ocupado = false
                }
            }, ocupado = ocupado, habilitado = cargado)
        }
    }
}
