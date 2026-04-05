@echo off
echo === HEL Baza Deploy to Vercel ===
echo.

cd /d "%~dp0hel-pim"

echo [1/4] Initializing git...
git init
git add -A
git commit -m "Initial commit: HEL PIM frontend"

echo [2/4] Adding GitHub remote...
git remote add origin https://github.com/KFIsrael/hel-baza.git
git branch -M main

echo [3/4] Pushing to GitHub...
git push -u origin main

echo [4/4] Deploying to Vercel...
npx vercel --prod

echo.
echo === Done! ===
pause
