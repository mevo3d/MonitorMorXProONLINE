# Guardian WhatsApp - Script para mantener WhatsApp siempre ejecutándose
# Detecta si el proceso de Node.js del monitor principal está activo
# Si el monitor principal se cierra, este script también se cierra

param(
    [int]$MonitorPID = $null  # PID del proceso principal del monitor
)

Write-Host "🛡️ GUARDIAN WHATSAPP INICIADO" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

if ($MonitorPID) {
    Write-Host "🔗 Vinculado al proceso monitor PID: $MonitorPID" -ForegroundColor Green
} else {
    Write-Host "⚠️ No se especificó PID del monitor principal" -ForegroundColor Yellow
    Write-Host "💡 El guardian funcionará independientemente" -ForegroundColor Blue
}

Write-Host ""

# Función para verificar si un proceso existe
function Test-ProcessExists {
    param([int]$PID)
    
    try {
        $process = Get-Process -Id $PID -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# Función para buscar procesos de WhatsApp (Chromium) relacionados con nuestro proyecto
function Find-WhatsAppProcesses {
    $whatsappProcesses = @()
    
    # Buscar procesos de Chrome/Chromium que contengan "whatsapp" en sus argumentos
    $chromeProcesses = Get-Process | Where-Object { 
        $_.ProcessName -like "*chrome*" -or 
        $_.ProcessName -like "*chromium*" -or
        $_.ProcessName -like "*node*"
    }
    
    foreach ($process in $chromeProcesses) {
        try {
            $commandLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($process.Id)").CommandLine
            if ($commandLine -and ($commandLine -like "*whatsapp*" -or $commandLine -like "*monitor-xpro*")) {
                $whatsappProcesses += $process
            }
        } catch {
            # Ignorar errores de acceso
        }
    }
    
    return $whatsappProcesses
}

# Función para verificar si hay ventanas de WhatsApp abiertas
function Test-WhatsAppWindow {
    try {
        Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            using System.Text;
            public class WindowAPI {
                [DllImport("user32.dll")]
                public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                [DllImport("user32.dll")]
                public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                [DllImport("user32.dll")]
                public static extern bool IsWindowVisible(IntPtr hWnd);
                public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
            }
"@
        
        $whatsappFound = $false
        $callback = {
            param($hWnd, $lParam)
            
            if ([WindowAPI]::IsWindowVisible($hWnd)) {
                $title = New-Object System.Text.StringBuilder(256)
                [void][WindowAPI]::GetWindowText($hWnd, $title, $title.Capacity)
                $titleStr = $title.ToString()
                
                if ($titleStr -like "*WhatsApp*" -or $titleStr -like "*whatsapp*") {
                    $script:whatsappFound = $true
                    return $false # Detener búsqueda
                }
            }
            return $true # Continuar búsqueda
        }
        
        [WindowAPI]::EnumWindows($callback, [IntPtr]::Zero)
        return $whatsappFound
        
    } catch {
        return $false
    }
}

# Loop principal de monitoreo
$counter = 0
$lastWhatsAppCheck = Get-Date
$checkInterval = 15 # segundos

Write-Host "🔄 Iniciando monitoreo cada $checkInterval segundos..." -ForegroundColor Green
Write-Host "📋 El guardian verificará:" -ForegroundColor Blue
Write-Host "   • Procesos de WhatsApp activos" -ForegroundColor Blue
Write-Host "   • Ventanas de WhatsApp visibles" -ForegroundColor Blue
if ($MonitorPID) {
    Write-Host "   • Estado del proceso monitor principal" -ForegroundColor Blue
}
Write-Host ""

while ($true) {
    $counter++
    $currentTime = Get-Date
    
    # Verificar si el monitor principal sigue activo (si se especificó PID)
    if ($MonitorPID -and -not (Test-ProcessExists -PID $MonitorPID)) {
        Write-Host ""
        Write-Host "🛑 Proceso monitor principal (PID: $MonitorPID) terminado" -ForegroundColor Red
        Write-Host "🚪 Guardian cerrando automáticamente..." -ForegroundColor Yellow
        break
    }
    
    # Verificar estado de WhatsApp cada cierto tiempo
    if (($currentTime - $lastWhatsAppCheck).TotalSeconds -ge $checkInterval) {
        $lastWhatsAppCheck = $currentTime
        
        $whatsappProcesses = Find-WhatsAppProcesses
        $whatsappWindow = Test-WhatsAppWindow
        
        $status = "✅"
        $message = "WhatsApp funcionando"
        
        if ($whatsappProcesses.Count -eq 0 -and -not $whatsappWindow) {
            $status = "❌"
            $message = "WhatsApp no detectado"
        } elseif ($whatsappProcesses.Count -eq 0) {
            $status = "⚠️"
            $message = "Ventana WhatsApp visible pero sin procesos"
        } elseif (-not $whatsappWindow) {
            $status = "⚠️"
            $message = "Procesos WhatsApp activos pero ventana no visible"
        }
        
        Write-Host "[$counter] $status $message | Procesos: $($whatsappProcesses.Count) | Ventana: $whatsappWindow | $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor $(if ($status -eq "✅") { "Green" } elseif ($status -eq "⚠️") { "Yellow" } else { "Red" })
        
        # Si no hay WhatsApp, mostrar información adicional
        if ($whatsappProcesses.Count -eq 0 -and -not $whatsappWindow) {
            Write-Host "   💡 El monitor principal debería reiniciar WhatsApp automáticamente" -ForegroundColor Cyan
        }
    }
    
    # Mostrar mensaje de actividad cada 5 minutos
    if ($counter % 20 -eq 0) {
        Write-Host ""
        Write-Host "🕐 $(Get-Date -Format 'HH:mm:ss') - Guardian activo | Verificaciones: $counter" -ForegroundColor Blue
        if ($MonitorPID) {
            $monitorStatus = if (Test-ProcessExists -PID $MonitorPID) { "✅ Activo" } else { "❌ Inactivo" }
            Write-Host "📊 Monitor principal: $monitorStatus" -ForegroundColor Blue
        }
        Write-Host ""
    }
    
    Start-Sleep -Seconds $checkInterval
}

Write-Host ""
Write-Host "🛑 Guardian WhatsApp finalizado" -ForegroundColor Yellow
Write-Host "===============================================" -ForegroundColor Cyan