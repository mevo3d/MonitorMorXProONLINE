# Script de inicio para PowerShell
Write-Host "======================================"
Write-Host "   MONITOR X PRO - INICIO AUTOMATICO"
Write-Host "======================================"
Write-Host ""

# Cambiar al directorio correcto
Set-Location "C:\Users\BALERION\proyectos-automatizacion\Monitor-LegislativoMor"

# Verificar Node
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js no encontrado. Instala Node.js."
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "Directorio: $(Get-Location)"
Write-Host "Iniciando Monitor X Pro (Legislativo, Gobierno, Judicial)..."
Write-Host ""

# Iniciar
node indexMonitor.js

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: El programa se cerró con código $LASTEXITCODE" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
}