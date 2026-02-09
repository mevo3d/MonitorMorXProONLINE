@echo off
REM Script para iniciar automáticamente el Monitor X Pro
REM Para usar con Programador de Tareas de Windows

echo ======================================
echo    MONITOR X PRO - INICIO AUTOMATICO
echo ======================================
echo.

REM Cambiar al directorio del proyecto (Ruta Corregida)
cd /d "C:\Users\BALERION\proyectos-automatizacion\Monitor-LegislativoMor"

REM Verificar que Node.js está disponible
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js no está instalado o no está en el PATH
    echo Por favor instala Node.js desde https://nodejs.org
    pause
    exit /b 1
)

REM Verificar que el archivo principal existe
if not exist "indexMonitor.js" (
    echo ERROR: No se encuentra el archivo indexMonitor.js
    echo Verifica que estás en el directorio correcto
    pause
    exit /b 1
)

REM Mostrar información de inicio
echo Directorio actual: %CD%
echo Fecha y hora: %DATE% %TIME%
echo.
echo Iniciando Monitor X Pro (Legislativo, Gobierno, Judicial)...
echo.

REM Iniciar el programa principal
node indexMonitor.js

REM Si el programa se cierra por error, pausar para ver el mensaje
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: El programa se cerró con código de error %ERRORLEVEL%
    echo Revisa los logs para más información
    pause
)

echo.
echo Programa finalizado
echo %DATE% %TIME%