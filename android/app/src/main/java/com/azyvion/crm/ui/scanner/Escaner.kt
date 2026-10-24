package com.azyvion.crm.ui.scanner

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Escáner de códigos de barras / QR a pantalla completa. Devuelve el primer código leído. */
@Composable
fun EscanerDialog(alLeer: (String) -> Unit, alCerrar: () -> Unit) {
    val ctx = LocalContext.current
    var permiso by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var negado by remember { mutableStateOf(false) }
    val pedir = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> permiso = ok; negado = !ok }
    LaunchedEffect(Unit) { if (!permiso) pedir.launch(Manifest.permission.CAMERA) }

    Dialog(onDismissRequest = alCerrar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            if (permiso) VistaCamara(alLeer)
            else if (negado) Text("Sin permiso de cámara. Actívalo en Ajustes del teléfono para escanear.", color = Color.White,
                modifier = Modifier.align(Alignment.Center).padding(32.dp))
            // Marco guía
            Box(Modifier.align(Alignment.Center).fillMaxWidth(0.8f).height(180.dp).border(2.dp, Color.White.copy(alpha = 0.8f), RoundedCornerShape(16.dp)))
            Column(Modifier.align(Alignment.BottomCenter).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Apunta al código de barras", color = Color.White)
                TextButton(onClick = alCerrar) { Text("Cancelar", color = Color.White) }
            }
        }
    }
}

@OptIn(ExperimentalGetImage::class)
@Composable
private fun VistaCamara(alLeer: (String) -> Unit) {
    val ctx = LocalContext.current
    val ciclo = LocalLifecycleOwner.current
    val ejecutor = remember { Executors.newSingleThreadExecutor() }
    val escaner = remember { BarcodeScanning.getClient() }
    val leido = remember { AtomicBoolean(false) }
    DisposableEffect(Unit) { onDispose { ejecutor.shutdown(); escaner.close() } }

    AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
        val vista = PreviewView(c)
        val futuro = ProcessCameraProvider.getInstance(c)
        futuro.addListener({
            val proveedor = futuro.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(vista.surfaceProvider) }
            val analisis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analisis.setAnalyzer(ejecutor) { proxy ->
                val img = proxy.image
                if (img == null || leido.get()) { proxy.close(); return@setAnalyzer }
                escaner.process(InputImage.fromMediaImage(img, proxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener { codigos ->
                        val v = codigos.firstNotNullOfOrNull { it.rawValue?.trim()?.takeIf { s -> s.isNotEmpty() } }
                        if (v != null && leido.compareAndSet(false, true)) ContextCompat.getMainExecutor(ctx).execute { alLeer(v) }
                    }
                    .addOnCompleteListener { proxy.close() }
            }
            try {
                proveedor.unbindAll()
                proveedor.bindToLifecycle(ciclo, CameraSelector.DEFAULT_BACK_CAMERA, preview, analisis)
            } catch (_: Exception) { /* sin cámara trasera */ }
        }, ContextCompat.getMainExecutor(c))
        vista
    })
}
