# Publication Play Store (App Bundle)

Procédure pour générer un **Android App Bundle** (`.aab`) signé, prêt à uploader sur la Google Play Console.

## Prérequis (une fois par machine)

Les secrets de signature ne sont **pas** dans git. Ils doivent être présents dans `Flutter/android/` :

| Fichier | Rôle |
|---------|------|
| `upload-keystore.jks` | Keystore d’upload Play Store |
| `key.properties` | Mots de passe + alias (`keyAlias=upload`) |
| `config/cognito.release.json` | Dart defines runtime (`COGNITO_*`, signaling, etc.) |

Sans `key.properties` + `upload-keystore.jks`, Gradle signe en **debug** : le Play Store refusera le bundle.

Modèle : `android/key.properties.example`.

## Augmenter la version à chaque release

Avant **chaque** publication, mettre à jour `version` dans `pubspec.yaml`.

Format Flutter : `versionName+versionCode` (ex. `1.0.2+3`).

- **versionName** (partie avant `+`) : version affichée aux utilisateurs — à incrémenter à chaque release :
  - `1.0.0` → `1.0.1` → `1.0.2` → `1.0.3` → `1.0.4` → …
- **versionCode** (partie après `+`) : entier **strictement croissant** exigé par le Play Store. Chaque upload doit avoir un `versionCode` **supérieur** au précédent (ex. `+2` → `+3` → `+4`).

Exemple pour passer en 1.0.2 alors que le dernier build était `1.0.0+2` :

```yaml
version: 1.0.2+3
```

Ne jamais republier un même `versionCode`.

## Build

Depuis le dossier `Flutter/` :

```powershell
. C:\Users\Alexa\Documents\Work\Utiles\Flutter\env.ps1
flutter build appbundle --release --dart-define-from-file=config/cognito.release.json
```

**Toujours** passer `--dart-define-from-file=config/cognito.release.json` (même règle que pour les APK debug / release).

## Sortie

```
Flutter/build/app/outputs/bundle/release/app-release.aab
```

Uploader ce fichier dans la Play Console (test interne, production, etc.).

## Checklist rapide

1. Keystore + `key.properties` présents sous `android/`
2. Version bumpée dans `pubspec.yaml` (versionName **et** versionCode)
3. `flutter build appbundle --release --dart-define-from-file=config/cognito.release.json`
4. Upload de `app-release.aab` sur Play Console
