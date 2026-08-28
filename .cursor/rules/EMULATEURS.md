# Émulateurs Android — Abstergo-Chase

## Appareils (Utiles\Android)

| AVD | Serial ADB |
|-----|------------|
| Galaxy_S23_Ultra | `emulator-5554` |
| Galaxy_A12 | `emulator-5556` |
| Galaxy_Tab_A7 | `emulator-5558` |

Scripts : `C:\Users\Alexa\Documents\Work\Utiles\Android\`

- `start-all.ps1` — lance les 3
- `start-one.ps1 -Name <AVD>` — lance un appareil
- `stop-all.ps1` — arrête les 3

## Deploy debug (build + install + launch)

Procédure complète documentée dans `.cursor/rules/flutter-debug-apk-publish.mdc`.

```powershell
C:\Users\Alexa\Documents\Work\Utiles\Flutter\build-abstergo.ps1 -Action deploy-debug
```

- Build **debug** avec `Flutter/config/cognito.release.json`
- Lance automatiquement les AVD manquants
- Installe et ouvre `com.brokenveilprotocol.app` sur les 3 émulateurs
