@echo off
REM Script para iniciar automáticamente el Monitor X Pro
REM Para usar con Programador de Tareas de Windows

echo ======================================
echo    MONITOR X PRO - INICIO AUTOMATICO
echo ======================================
echo.

REM Cambiar al directorio del proyecto
cd /d "C:\Users\BALERION\proyectos-automatizacion\monitor-morelos"

REM Verificar que Node.js está disponible
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js no está instalado o no está en el PATH
    echo Por favor instala Node.js desde https://nodejs.org
    pause
    exit /b 1
)

REM Verificar que el archivo index.js existe
if not exist "index.js" (
    echo ERROR: No se encuentra el archivo index.js
    echo Verifica que estás en el directorio correcto
    pause
    exit /b 1
)

REM Mostrar información de inicio
echo Directorio actual: %CD%
echo Fecha y hora: %DATE% %TIME%
echo.
echo Iniciando Monitor X Pro...
echo.

REM Iniciar guardian de WhatsApp en segundo plano (opcional)
echo Iniciando guardian de WhatsApp en segundo plano...
start "Guardian WhatsApp" powershell -ExecutionPolicy Bypass -File "guardian-whatsapp.ps1"

REM Iniciar el programa principal
echo.
echo Iniciando Monitor X Pro...
node index.js

REM El guardian se cerrará automáticamente cuando termine este proceso

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