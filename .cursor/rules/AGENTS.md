# Instructions Codex — Flutter / builds Android

## Configuration runtime (obligatoire)

À **chaque** génération d’APK (`debug`, `release`, `profile`) ou d’App Bundle, utiliser le fichier de defines :

**`@Flutter/config/cognito.release.json`**

(chemin relatif au dossier `Flutter/` : `config/cognito.release.json`)

Ce JSON alimente les `--dart-define` consommés par `lib/app/config/app_runtime_config.dart` (`COGNITO_*`, `SIGNALING_*`, `VOICE_STUN_URL`, etc.). Ne pas builder sans ces valeurs.

## Commandes (depuis `Flutter/`)

```bash
flutter build apk --debug --dart-define-from-file=config/cognito.release.json
flutter build apk --release --dart-define-from-file=config/cognito.release.json
flutter build appbundle --release --dart-define-from-file=config/cognito.release.json
```

Pour exécuter ou installer sur un appareil :

```bash
flutter run -d <device_id> --dart-define-from-file=config/cognito.release.json
```

## Règle

Ne jamais lancer `flutter build apk`, `flutter build appbundle` ni `flutter run` pour ce projet **sans** `--dart-define-from-file=config/cognito.release.json`.
