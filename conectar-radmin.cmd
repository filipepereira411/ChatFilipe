@echo off
setlocal
set "IP=%~1"
set "PORTA=%~2"
if "%PORTA%"=="" set "PORTA=4899"
if "%IP%"=="" goto SEM_IP

set "RADMIN="
for %%P in (
  "%ProgramFiles%\Radmin Viewer 3\radmin.exe"
  "%ProgramFiles(x86)%\Radmin Viewer 3\radmin.exe"
  "%ProgramFiles%\Radmin Viewer 2\radmin.exe"
  "%ProgramFiles(x86)%\Radmin Viewer 2\radmin.exe"
) do if exist %%~P set "RADMIN=%%~P"

if not defined RADMIN goto SEM_RADMIN
start "" "%RADMIN%" /connect:%IP%:%PORTA%
exit /b 0

:SEM_IP
echo Uso: conectar-radmin.cmd IP [porta]
pause
exit /b 1

:SEM_RADMIN
echo Radmin Viewer nao encontrado nas pastas habituais.
echo Ajuste o caminho neste ficheiro para a sua instalacao.
pause
exit /b 1
