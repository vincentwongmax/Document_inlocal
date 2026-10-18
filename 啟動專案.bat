@echo off
rem ============================================================
rem  記帳本（mop-ledger）— 一鍵啟動
rem  雙擊這個檔案即可：自動裝相依套件 → 開啟開發伺服器 → 開瀏覽器
rem  關掉這個視窗（或按 Ctrl+C）就會停止伺服器
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title 記帳本 mop-ledger

echo.
echo   記帳本（mop-ledger）— 啟動中...
echo   ------------------------------------------------
echo.

rem ── 1. 找 node ────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo   [錯誤] 找不到 Node.js。
  echo          請先到 https://nodejs.org/ 下載安裝 LTS 版本，
  echo          安裝完之後再重新雙擊這個檔案。
  echo.
  pause
  exit /b 1
)

rem ── 2. 沒有 node_modules 就先安裝 ──────────────────────
if not exist "node_modules" (
  echo   [1/3] 第一次執行，正在安裝相依套件（npm install）...
  echo          這一步可能需要幾分鐘，請耐心等待。
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [錯誤] npm install 失敗，請檢查網路連線後再試一次。
    echo.
    pause
    exit /b 1
  )
  echo.
)

rem ── 3. 開啟開發伺服器 ──────────────────────────────────
echo   [2/3] 啟動開發伺服器（http://localhost:5173）...
echo.

rem 等一下讓伺服器先起來再開瀏覽器（3 秒後才開頁，避免開到「無法連線」）
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:5173"

call npm run dev

echo.
echo   伺服器已停止。
echo.
pause
endlocal
