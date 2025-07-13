# Script PowerShell para mantener WhatsApp siempre visible y activo
# Ejecutar en una ventana separada para evitar minimización

Write-Host "🔄 Iniciando monitor de ventana WhatsApp..." -ForegroundColor Green
Write-Host "📱 Este script mantiene WhatsApp visible y activo" -ForegroundColor Blue
Write-Host "⚠️  NO cerrar esta ventana mientras el monitor esté funcionando" -ForegroundColor Yellow
Write-Host ""

$whatsappTitles = @(
    "*WhatsApp*",
    "*whatsapp*", 
    "*WEB.WHATSAPP*",
    "*web.whatsapp*"
)

function Bring-WhatsAppToFront {
    foreach ($title in $whatsappTitles) {
        try {
            # Buscar ventanas de WhatsApp
            $processes = Get-Process | Where-Object { 
                $_.MainWindowTitle -like $title -and $_.MainWindowHandle -ne 0 
            }
            
            foreach ($process in $processes) {
                if ($process.MainWindowHandle -ne 0) {
                    # Importar funciones de Windows API
                    Add-Type @"
                        using System;
                        using System.Runtime.InteropServices;
                        public class Win32 {
                            [DllImport("user32.dll")]
                            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                            [DllImport("user32.dll")]
                            public static extern bool SetForegroundWindow(IntPtr hWnd);
                            [DllImport("user32.dll")]
                            public static extern bool IsIconic(IntPtr hWnd);
                        }
"@
                    
                    $hwnd = $process.MainWindowHandle
                    
                    # Verificar si está minimizada
                    if ([Win32]::IsIconic($hwnd)) {
                        Write-Host "📱 Restaurando ventana WhatsApp minimizada..." -ForegroundColor Yellow
                        [Win32]::ShowWindow($hwnd, 9) # SW_RESTORE
                    }
                    
                    # Traer al frente
                    [Win32]::SetForegroundWindow($hwnd)
                    [Win32]::ShowWindow($hwnd, 3) # SW_MAXIMIZE
                    
                    Write-Host "✅ WhatsApp traído al frente: $($process.MainWindowTitle)" -ForegroundColor Green
                    return $true
                }
            }
        } catch {
            # Silenciosamente continuar si hay errores
        }
    }
    return $false
}

# Monitoreo continuo
$counter = 0
Write-Host "🔄 Iniciando monitoreo cada 30 segundos..." -ForegroundColor Cyan

while ($true) {
    $counter++
    
    $found = Bring-WhatsAppToFront
    
    if (-not $found) {
        Write-Host "⚠️  [$counter] WhatsApp no encontrado o no está abierto" -ForegroundColor Red
    } else {
        Write-Host "✅ [$counter] WhatsApp verificado y activo" -ForegroundColor Green
    }
    
    # Mostrar tiempo cada 10 iteraciones
    if ($counter % 10 -eq 0) {
        Write-Host "🕐 $(Get-Date -Format 'HH:mm:ss') - Verificaciones: $counter" -ForegroundColor Blue
    }
    
    Start-Sleep -Seconds 30
}