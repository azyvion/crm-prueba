package com.azyvion.crm.ui.licencia

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.azyvion.crm.data.MiLicencia
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.ui.common.ContactoVentas
import com.azyvion.crm.ui.common.VENTAS_CORREO
import com.azyvion.crm.ui.common.VENTAS_TELEFONO
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.theme.Verde
import kotlinx.coroutines.launch

/** Empresa sin licencia vigente: contacto de ventas y, si es administrador, activar una licencia nueva. */
@Composable
fun BloqueoScreen(lic: MiLicencia, alActivar: (MiLicencia) -> Unit) {
    val a = app()
    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Default.Lock, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(16.dp))
        ContactoVentas(
            if (lic.motivo == "VENCIDA") "Tu licencia venció" else "Tu empresa no tiene una licencia activa",
            if (lic.puedeActivar) "Para seguir usando el CRM activa una licencia nueva o contáctanos:"
            else "Pide a tu administrador que active una licencia, o contáctanos:",
        )
        if (lic.puedeActivar) {
            Spacer(Modifier.height(16.dp))
            ActivarLicencia(activar = { a.repo.activarLicencia(it) }, alTerminar = alActivar)
        }
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = { a.repo.cerrarSesion() }) { Text("Cerrar sesión") }
    }
}

/** Campo para escribir el código AZV-XXXX-XXXX-XXXX y activarlo. */
@Composable
fun ActivarLicencia(activar: suspend (String) -> MiLicencia, alTerminar: (MiLicencia) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var codigo by remember { mutableStateOf("") }
    var ocupado by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    Column(Modifier.fillMaxWidth()) {
        Text("¿Ya tienes un código de licencia? Actívalo aquí", fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = codigo, onValueChange = { codigo = Calc.formatearLicencia(it) }, singleLine = true,
                placeholder = { Text("AZV-XXXX-XXXX-XXXX") }, textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Button(enabled = !ocupado, onClick = {
                val c = Calc.normalizarLicencia(codigo)
                if (c == null) { msg = "Escribe el código completo: AZV-XXXX-XXXX-XXXX." to false; return@Button }
                ocupado = true; msg = null
                scope.launch {
                    try {
                        val r = activar(c)
                        msg = "Licencia activada." to true
                        alTerminar(r)
                    } catch (e: Exception) { msg = (e.message ?: "No se pudo activar la licencia.") to false }
                    ocupado = false
                }
            }) { if (ocupado) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Activar") }
        }
        msg?.let { (t, ok) -> Spacer(Modifier.height(6.dp)); Text(t, color = if (ok) Verde else MaterialTheme.colorScheme.error, fontSize = 13.sp) }
    }
}

/** Aviso de vencimiento (últimos 15 días), igual que licencia.js. */
fun avisoVencimiento(l: MiLicencia?): String? {
    if (l == null || !l.vigente || l.interna) return null
    val d = l.diasRestantes ?: return null
    if (d > 15) return null
    val cuando = when { d <= 0 -> "vence hoy"; d == 1 -> "vence mañana"; else -> "vence en $d días" }
    return "Tu licencia $cuando. Renuévala con ventas: $VENTAS_TELEFONO · $VENTAS_CORREO"
}
