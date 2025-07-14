# Script PowerShell para iniciar automáticamente el Monitor X Pro
# Para usar con Programador de Tareas de Windows

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "   MONITOR X PRO - INICIO AUTOMATICO" -ForegroundColor Cyan  
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Cambiar al directorio del proyecto
$proyectoDir = "C:\Users\BALERION\proyectos-automatizacion\monitor-morelos"
Set-Location $proyectoDir

# Verificar que Node.js está disponible
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js encontrado: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ ERROR: Node.js no está instalado o no está en el PATH" -ForegroundColor Red
    Write-Host "Por favor instala Node.js desde https://nodejs.org" -ForegroundColor Yellow
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Verificar que el archivo index.js existe
if (-not (Test-Path "index.js")) {
    Write-Host "❌ ERROR: No se encuentra el archivo index.js" -ForegroundColor Red
    Write-Host "Directorio actual: $(Get-Location)" -ForegroundColor Yellow
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Mostrar información de inicio
Write-Host "📁 Directorio: $(Get-Location)" -ForegroundColor Blue
Write-Host "🕐 Fecha y hora: $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')" -ForegroundColor Blue
Write-Host ""
Write-Host "🚀 Iniciando Monitor X Pro..." -ForegroundColor Green
Write-Host ""

# Iniciar el programa
try {
    node index.js
    Write-Host ""
    Write-Host "✅ Programa finalizado normalmente" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "❌ ERROR: El programa se cerró inesperadamente" -ForegroundColor Red
    Write-Host "Detalles: $($_.Exception.Message)" -ForegroundColor Yellow
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "🕐 Finalizado: $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')" -ForegroundColor Blue