# Session Android debug avec Docker

Session préparée le 8 octobre 2026 sur `Refonte-graphique-codex`, relancée avec Flutter attaché le 13 octobre 2026.

## Services actifs

| Conteneur | Rôle | Accès local |
| --- | --- | --- |
| `docker-db-1` | PostgreSQL, état healthy | Réseau Docker uniquement |
| `docker-serverbdd-1` | API avec JWT Cognito | `http://localhost:5176` |
| `docker-signaling-1` | Socket.IO, transport WebSocket | `http://localhost:5177` |
| `docker-monitor-1` | Supervision des connexions et des parties | `http://127.0.0.1:8090` |

Les ports 5175 et 5174 sont occupés par d’autres projets. Les ports locaux 5176 et 5177 évitent ces conflits. Le volume PostgreSQL existant `docker_serverbdd_pg_data` est conservé. La signalisation utilise `BDD_URL=http://host.docker.internal:5176`.

Les images API et signalisation ont été reconstruites à partir du dépôt. L’API renvoie `{"status":"ok"}` sur `/health` et refuse un accès sans jeton à `/api/users/me` avec HTTP 401. Le handshake Engine.IO / Socket.IO est validé. Les deux émulateurs atteignent l’API et obtiennent une réponse HTTP 101 de la signalisation. La signalisation prend aussi en charge `session:lookup` pour orienter directement un joueur vers le lobby ou la partie.

Lors de cette mise à jour de la signalisation, l’arrêt a déclenché la sauvegarde de l’état runtime. Le dossier `/app/data` a été copié sous `Flutter/.dart_tool/signaling-runtime-20261008-201816/data`, vérifié, puis restauré avant le démarrage du nouveau conteneur. Le lobby existant a été conservé et sa reconnaissance par le nouveau protocole contrôlée.

Pour remettre les mêmes services en route depuis `Docker`, garder ces variables lors des commandes Compose :

```powershell
$env:SERVERBDD_PUBLISH_PORT = '5176'
docker compose -f docker-compose.serverbdd.yml --env-file .env.serverbdd up -d db serverbdd
$env:SIGNALING_PUBLISH_PORT = '5177'
$env:BDD_URL = 'http://host.docker.internal:5176'
docker compose -f docker-compose.signaling.yml up -d signaling
$env:MONITOR_PUBLISH_PORT = '127.0.0.1:8090'
$env:SIGNALING_URL = 'http://host.docker.internal:5177'
docker compose -f docker-compose.monitor.yml up -d monitor
```

## Build utilisé

Depuis `Flutter`, avec le SDK déjà utilisé par le projet :

```powershell
& 'C:\Users\Alexa\Documents\Work\Utiles\Flutter\bin\flutter.bat' build apk --debug --no-pub --dart-define-from-file=config/cognito.release.json --dart-define=SERVERBDD_DEVELOPMENT_URL=http://10.0.2.2:5176 --dart-define=SIGNALING_DEVELOPMENT_URL=http://10.0.2.2:5177
```

`cognito.release.json` est utilisé sans modification. Les deux paramètres supplémentaires concernent les ports de développement locaux. La présence des paramètres Cognito et des deux adresses locales dans l’APK a été contrôlée sans afficher les secrets.

Sortie : `build/app/outputs/flutter-apk/app-debug.apk`. Le manifeste confirme `debuggable`, Android minimum API 24 et cible API 36.

## Émulateurs

| Profil | Identifiant ADB | Android |
| --- | --- | --- |
| `Codex_Pixel_API_34_1` | `emulator-5554` | 14 / API 34 |
| `Codex_Pixel_API_34_2` | `emulator-5556` | 14 / API 34 |
| `Codex_Pixel_API_34_3` | `emulator-5558` | 14 / API 34 |

Les profils ont été créés avec l’image Android déjà disponible, sous `Flutter/build/android-emulators`. Chaque appareil utilise une résolution 1080 × 2400, 1536 Mo de mémoire et deux cœurs ; l’accélération WHPX est active. Les positions simulées sont à Lyon.

Pour retrouver les profils avec les outils Android, définir `ANDROID_AVD_HOME` vers ce dossier. Depuis `Flutter` :

```powershell
$env:ANDROID_AVD_HOME = Join-Path (Get-Location) 'build\android-emulators'
& 'C:\Users\Alexa\Documents\Codex\DevOfflineKit\sdk\android\emulator\emulator.exe' -avd Codex_Pixel_API_34_1 -port 5554
# Dans un second terminal avec le même ANDROID_AVD_HOME :
& 'C:\Users\Alexa\Documents\Codex\DevOfflineKit\sdk\android\emulator\emulator.exe' -avd Codex_Pixel_API_34_2 -port 5556
```

Le dernier APK inclut la liste des joueurs, la checklist de démarrage et la reprise directe depuis « Rejoindre une partie ». Il utilise le même fichier Cognito et conserve les données et sessions lors d’une installation avec `adb install -r`. Le dernier code saisi est retrouvé ; la destination est déterminée sur le serveur avant la navigation et le joueur conserve son identité mémorisée. Aucune nouvelle partie multijoueur n’a été créée automatiquement.

## Accès debug du 9 octobre 2026

Les trois conteneurs existants ont été redémarrés sans recréation. PostgreSQL est healthy, l’API répond sur `/health` et le monitor est connecté à la signalisation. La partie déjà présente a été retrouvée après le redémarrage. Le monitor est publié uniquement sur localhost.

Les deux émulateurs affichent l’accueil avec leurs sessions utilisateur conservées. Le premier a été redémarré à froid après un blocage au chargement du snapshot Android, sans effacement des données. Le dernier APK a été recompilé avec `cognito.release.json` et les deux adresses Docker de développement. Chaque appareil possède sa propre session `flutter run` attachée ; les services Dart et DevTools répondent et le hot reload a été vérifié sur les deux appareils.

| Appareil | DevTools |
| --- | --- |
| `emulator-5554` | [Inspecteur et debugger](http://127.0.0.1:9111/ODYMPFELPrY=/devtools/?uri=ws%3A%2F%2F127.0.0.1%3A9111%2FODYMPFELPrY%3D%2Fws) |
| `emulator-5556` | [Inspecteur et debugger](http://127.0.0.1:9112/99arF-l9IMU=/devtools/?uri=ws%3A%2F%2F127.0.0.1%3A9112%2F99arF-l9IMU%3D%2Fws) |

Ces adresses restent valables tant que les sessions Flutter actuelles sont actives. DevTools donne accès aux widgets, aux logs Dart, au debugger, à la mémoire et aux requêtes réseau. Pour les performances, ces sessions utilisent le mode debug, dont les mesures incluent le coût des outils de développement.

Les logs Android des processus de l’application et les sorties Docker sont enregistrés en continu dans `.dart_tool/debug-session-20261009/`. Les collecteurs fonctionnent indépendamment du terminal ; leurs PID et commandes sont conservés dans `collectors.json`. Les collecteurs Android suivent les PID actuels : après un redémarrage complet de l’application, relancer le collecteur avec son nouveau PID.

Pour suivre les logs depuis le dossier `Flutter` dans un autre terminal :

```powershell
Get-Content .dart_tool/debug-session-20261009/emulator-5554.log -Tail 80 -Wait
# Dans un autre terminal pour le second appareil :
Get-Content .dart_tool/debug-session-20261009/emulator-5556.log -Tail 80 -Wait
```

Dans les terminaux Flutter attachés, `r` recharge le code, `R` redémarre l’application et `d` détache Flutter en laissant l’application ouverte. Le [tableau de supervision](http://127.0.0.1:8090) permet de suivre les connexions et les parties côté serveur.

## Correction du blocage GPS sur 5556

Le rapport ANR de 12:40 UTC identifie le thread principal bloqué dans `NmeaClient.stop()` → `LocationManager.removeNmeaListener()` → `unregisterGnssNmeaCallback`, après réception d’une position GPS. Le défaut correspond au [signalement Geolocator #1795](https://github.com/Baseflow/flutter-geolocator/issues/1795).

La version Android 5.0.2 du plugin est conservée dans `third_party/geolocator_android` avec sa licence. La seule correction native évite d’enregistrer les écouteurs NMEA/GNSS optionnels lorsque l’application ne demande pas d’altitude MSL, et évite leur retrait lorsqu’ils n’ont jamais été enregistrés. L’application ne lit pas ces métadonnées ; latitude, longitude, fournisseur GPS, permissions et suivi de position restent disponibles. Le détail du correctif est dans [PATCHES.md](../../third_party/geolocator_android/PATCHES.md).

Le contrôleur de création évite aussi les recherches GPS concurrentes, ignore les réponses après fermeture de l’écran et propose un message lisible en cas de timeout. Les 164 tests Flutter passent et l’analyse ne rapporte aucune erreur. L’APK reste debuggable avec Android minimum API 24 et cible API 36.

5556 a été redémarré à froid pour libérer le service Android bloqué, sans effacer ses données. Le nouvel APK est installé sur les deux appareils, leurs sessions Flutter debug sont attachées et les collecteurs de logs utilisent leurs nouveaux PID. La position GPS est simulée à Lyon.

Vérification sur 5556 : cinq chargements GPS aboutissent à l’affichage de la carte, dont quatre après sortie complète et réouverture de la création. Aucun événement Android `am_anr` ou `am_crash` n’apparaît après le redémarrage. Le service Dart répond pendant ces opérations. Les résultats et la capture du terrain sont dans `.dart_tool/debug-session-20261009/gps-repeat-results.json` et `gps-terrain-5556.png`. L’appareil est laissé à l’étape Terrain avec sa carte chargée.

## Redéploiement du 13 octobre 2026

PostgreSQL, l’API, la signalisation et la supervision ont été redémarrés dans leurs conteneurs existants. PostgreSQL est healthy, l’API répond sur `/health` et la supervision est connectée à la signalisation. Le code du serveur de signalisation présent dans Docker correspond à celui du dépôt.

Les deux profils Android ont démarré à froid sans effacement de données. L’APK debug a été recompilé avec `cognito.release.json`, le correctif GPS local et les adresses Docker de développement, puis installé et lancé sur `emulator-5554` et `emulator-5556`. Le manifeste conserve Android minimum API 24 et cible API 36. Les deux appareils obtiennent HTTP 200 de l’API et HTTP 101 pour le handshake WebSocket de la signalisation.

Les deux applications affichent **Connexion** : une connexion utilisateur est nécessaire pour tester une partie. Aucun événement ANR ou crash de l’application n’est présent au contrôle de démarrage. Chaque application possède une session Flutter debug attachée et son service Dart répond.

| Appareil | Accès DevTools actuel |
| --- | --- |
| `emulator-5554` | [Inspecteur et debugger](http://127.0.0.1:9111/TsSWYOYUxY8=/devtools/?uri=ws%3A%2F%2F127.0.0.1%3A9111%2FTsSWYOYUxY8%3D%2Fws) |
| `emulator-5556` | [Inspecteur et debugger](http://127.0.0.1:9112/mbJef7BSVDA=/devtools/?uri=ws%3A%2F%2F127.0.0.1%3A9112%2FmbJef7BSVDA%3D%2Fws) |

Les logs Android et Docker sont enregistrés en continu dans `.dart_tool/debug-session-20261013/`, avec les commandes et PID des six collecteurs dans `collectors.json`. Les adresses DevTools restent valables tant que les sessions Flutter actuelles sont actives.

Un troisième profil indépendant, `Codex_Pixel_API_34_3`, a ensuite été créé avec la même image Android 14, deux cœurs et 1536 Mo de mémoire. Il tourne sur `emulator-5558` avec le même APK debug et une session Flutter attachée. Les données des autres appareils ne sont pas copiées. L’API et le handshake WebSocket sont vérifiés depuis ce nouvel appareil ; aucun crash ou ANR de l’application n’est présent au démarrage. Lors du contrôle, l’app affiche la demande d’autorisation de localisation du premier lancement.

[DevTools de 5558](http://127.0.0.1:9113/NjvxCiDcP2w=/devtools/?uri=ws%3A%2F%2F127.0.0.1%3A9113%2FNjvxCiDcP2w%3D%2Fws). Ses logs sont collectés dans `emulator-5558.log`, avec un septième collecteur enregistré dans `collectors.json`.
