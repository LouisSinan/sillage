@echo off
rem Windows entry point, the counterpart of the Makefile: sillage install | launch | default | update | test | uninstall
rem Double-clicking it installs Sillage (first time) and starts it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sillage.ps1" %*
if errorlevel 1 pause
