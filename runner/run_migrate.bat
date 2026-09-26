@echo off
cd /d "C:\Users\김태린\Documents\Codex\2026-05-06\new-chat\FlowFit-full-current-20260506-080454\flowfit-runner"
echo Starting migration... > migrate_log.txt
npm run db:migrate >> migrate_log.txt 2>&1
echo Exit code: %ERRORLEVEL% >> migrate_log.txt
echo Done. >> migrate_log.txt