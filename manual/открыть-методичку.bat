@echo off
rem Открывает собранную методичку (папка book) в браузере через локальный веб-сервер Python.
rem Двойной щелчок – и всё. Закройте это окно, чтобы остановить сервер.
chcp 65001 >nul
setlocal
set PORT=8790
cd /d "%~dp0book" 2>nul
if not exist index.html (
  echo Книга ещё не собрана: в папке manual выполните  quarto render
  pause
  exit /b 1
)

set PY=
python --version >nul 2>&1 && set PY=python
if not defined PY py --version >nul 2>&1 && set PY=py
if not defined PY (
  echo Не найден Python. Установите его с https://www.python.org/downloads/ ^(галочка «Add python.exe to PATH»^)
  pause
  exit /b 1
)

echo Методичка: http://localhost:%PORT%/
echo Не закрывайте это окно, пока читаете. Закрыли – сервер остановился.
start "" cmd /c "timeout /t 1 >nul & start http://localhost:%PORT%/"
%PY% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo Сервер не запустился: возможно, порт %PORT% занят. Поменяйте PORT в начале файла.
  pause
)
