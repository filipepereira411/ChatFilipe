@echo off
setlocal EnableDelayedExpansion
rem Recebe: radfilipe://IP:PORTA/
set "URL=%~1"
set "ALVO=%URL:radfilipe://=%"
set "ALVO=!ALVO:/=!"

if "!ALVO!"=="" goto SEM_ALVO

set "IP="
set "PORTA="
for /f "tokens=1,2 delims=:" %%A in ("!ALVO!") do (
  set "IP=%%A"
  set "PORTA=%%B"
)
if "!PORTA!"=="" set "PORTA=4899"

call "%~dp0conectar-radmin.cmd" "!IP!" "!PORTA!"
exit /b 0

:SEM_ALVO
echo Endereco radfilipe invalido: %URL%
pause
exit /b 1
