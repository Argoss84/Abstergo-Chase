# Refonte de l’interface mobile

Branche : `Refonte-graphique-codex` · 8 octobre 2026.

Le parcours guidé et la réorganisation de la navigation suivent le choix validé par l’utilisateur. L’identité cyan, magenta et violet est conservée, avec des surfaces plus sobres et une meilleure hiérarchie des actions.

## Audit et changements

| Écran ou composant | Constat | Résultat |
| --- | --- | --- |
| Accueil réel (`BootstrapPage`) | Les actions principales et les réglages occupaient le même niveau ; les grandes polices comprimaient les lignes. | Création et connexion mises en avant, compte et paramètres regroupés, présentation adaptée aux petits écrans, avertissements d’autorisations harmonisés. |
| Connexion | Saisie peu accompagnée et espace clavier compté deux fois. | Autofill, actions du clavier, affichage du mot de passe, formulaire défilant avec titre explicatif. |
| Compte | Boutons côte à côte et messages techniques peu adaptés au mobile. | Actions qui se répartissent sur plusieurs lignes, champs adaptés à la saisie, messages lisibles, contrôles de cycle de vie après les appels asynchrones. |
| Rejoindre | Enchaînement peu explicite et possibilité de relancer une connexion en cours ; une partie démarrée affichait d’abord un lobby vide en erreur. | Code limité à six caractères, nom de joueur visible, connexion par clavier, indicateur d’attente et protection contre les doubles actions ; scan QR conservé. Le serveur reconnaît le code avant la navigation : lobby en attente ou accès direct à la partie avec l’identité mémorisée. Les codes inconnus restent sur la page de connexion. |
| Création | Une longue page réunissait réglages, placement et création ; le résumé mobile formait une colonne décentrée. | Trois étapes de même largeur : **Réglages → Terrain → Validation**, navigation arrière conservant les données, résumé en quatre blocs alignés à gauche, résumé final et action de création accessible en bas. |
| Paramètres de partie | Une liste uniforme mélangeait règles, terrain et rôles ; les champs éloignés pouvaient échapper à la validation. | Règles essentielles visibles, groupes terrain et rôles repliables, titre et actions fixes au-dessus du clavier ; validation de tous les champs, ouverture et défilement vers une erreur masquée. Les portées indiquent les mètres et le hack se saisit en secondes, converties exactement en millisecondes. |
| Terrain de création | Le rayon visuel des objectifs utilisait la valeur par défaut. | L’aperçu utilise le rayon configuré ; changer le rayon du terrain réinitialise le placement et recharge les rues. |
| Salon | QR et code se disputaient la largeur ; les rôles étaient isolés sous les noms sur un téléphone courant ; boutons flottants superposés au contenu. | Code et QR empilés si nécessaire, identités alignées à gauche et rôles dans une colonne de largeur constante, séparateurs légers, repère discret pour son joueur et statut « Vous » sous le nom. Les petits écrans et grandes polices utilisent des rôles placés sous l’identité, sur le même alignement. État de connexion explicite, commandes **Infos / Chat** dans une barre inférieure. |
| Partie | La pulsation reconstruisait tout l’écran, y compris les couches statiques de carte ; panneaux floutés et éléments superposés. | Animation limitée aux effets concernés, panneaux simples bornés et défilants, barre de statut lisible, respect des zones système ; panneau de fin défilant et commandes placées sous celui-ci. |
| Pings sur la carte | L’encadré du message était centré sur le point et masquait le cercle pulsant ; une icône de diffusion ajoutait un repère redondant. | Message placé au-dessus du rayon maximal de la pulsation, avec un espace de 8 unités adapté au zoom ; texte maintenu droit lorsque la carte tourne et icône sous le ping supprimée. Le cercle conserve ses coordonnées et son animation. |
| Chats du salon et de partie | Deux interfaces similaires construisaient toute la liste de messages. | Composant commun utilisant `ListView.builder`, messages récents visibles, couleurs adaptées aux deux thèmes, envoi au clavier, saisie maintenue au-dessus du clavier. |
| Paramètres de l’application | Largeur non bornée et choix vocal trop large avec des caractères agrandis. | Mise en page commune, sélection du mode vocal verticale sur écrans étroits, réglages et persistance existants conservés. |
| Prérequis du salon | Une phrase technique réunissait les conditions sans indiquer précisément ce qui manquait. | Checklist avec rôles attribués, au moins un Agent et au moins un Rogue, icônes originales et total des conditions remplies. Le bouton de démarrage reste gouverné par les mêmes règles. |
| Thème partagé | Certains contrastes et styles dépendaient de couleurs fixes ; actions peu hiérarchisées. | Palette Material complète, texte sans halo, surfaces et erreurs cohérentes, boutons tactiles d’au moins 48 unités et distinction entre actions principales et secondaires. |

L’audit couvre les écrans Flutter accessibles depuis le routeur, les cartes, chats et panneaux associés. `HomeMenuPage` est un ancien écran de remplacement : le routeur affiche `BootstrapPage`. Les prototypes du dossier `Lab` ne font pas partie de cette application mobile.

## Fluidité

- `GamePage` écoute le contrôleur de jeu ; la pulsation possède des builders locaux pour le trajet, les zones de capture, les pings, le compte à rebours et le menu d’action.
- Les géométries et marqueurs statiques restent en dehors du builder de pulsation. Les tuiles sont isolées avec `RepaintBoundary`. Le cache de calcul des zones déjà présent est conservé, et les zones masquées ne sont pas calculées.
- Les effets décoratifs s’arrêtent lorsque l’application quitte le premier plan et respectent la réduction des animations demandée par le système.
- Un minuteur léger expire les pings sans dépendre de la reconstruction de chaque image ; il est annulé à la destruction de la page.
- Les chats construisent les messages à la demande. Le test avec 600 messages vérifie que moins de 60 entrées sont construites pour la première vue.

Ces changements suivent les recommandations Flutter sur les [builders d’animation](https://api.flutter.dev/flutter/widgets/AnimatedBuilder-class.html) et la [limitation du travail de rendu](https://docs.flutter.dev/perf/best-practices). Aucun gain de FPS ou de batterie n’a été chiffré sur appareil.

## Compatibilité Android

Les fichiers de configuration Android et les versions des dépendances restent inchangés. Le correctif GPS du 9 octobre sélectionne une copie locale de `geolocator_android` 5.0.2 dans le verrou de versions, avec une correction ciblée du blocage NMEA sur le thread principal ; voir [PATCHES.md](../../third_party/geolocator_android/PATCHES.md). La validation utilise le SDK Flutter déjà référencé par `android/local.properties` : **Flutter 3.44.8 / Dart 3.12.2**.

| Métadonnée de l’APK debug | Valeur conservée |
| --- | --- |
| Android minimum | API 24 (Android 7.0) |
| Cible / compilation | API 36 / 36 |
| Architectures | `armeabi-v7a`, `arm64-v8a`, `x86_64` |
| Version de l’application | `1.0.5` (code 6) |

## Vérification

- Analyse statique sans problème signalé.
- Suite complète : **164 tests réussis**. La checklist est vérifiée en clair, en sombre et avec des caractères agrandis. Les tests de navigation garantissent qu’une partie démarrée n’instancie pas le lobby, que l’identité mémorisée est transférée et que les erreurs, nouvelles tentatives et sorties pendant la recherche sont gérées. Les tests GPS supplémentaires couvrent le timeout, la nouvelle tentative, les appels concurrents et la fermeture de l’écran avant réception d’un résultat ou d’une erreur.
- Nouvelle liste des joueurs : **31 tests ciblés réussis**, incluant l’alignement sur téléphone courant, les grandes polices sur petit écran, les rôles en lecture seule et l’attribution ou le retrait d’un rôle par l’organisateur. Les icônes originales `agent_marker.png` et `rogue_marker.png` sont conservées dans la liste et le sélecteur de rôle, pour l’organisateur comme pour les invités.
- Compilation de l’APK Android debug et contrôle de son manifeste avec `aapt`.
- Vérifications graphiques en thèmes clair et sombre, largeur de 320 unités, facteur de texte jusqu’à 1,5 et hauteur réduite à 480 unités pour la fin de partie.
- Tests du retour natif dans les étapes, de la conservation des réglages, du transfert vers le salon, des doubles soumissions, du rayon dessiné, du clavier et de la construction différée des chats.
- Un test vérifie que l’épaisseur du trajet évolue pendant la pulsation sans réévaluer l’écran de jeu complet.
- Test d’intégration serveur isolé : recherche de code sans ajouter de joueur, reconnaissance du lobby et de la partie, reconnexion conservant le rôle sans doublon. Le protocole `session:lookup` / `session:resolved` doit être déployé avec cette version mobile ; il est actif sur le Docker local.

Quelques tests existants nécessitaient aussi des corrections de compilation : inférence des overrides Riverpod et utilisation du bon type `GameBootstrapData`. Les assertions fonctionnelles sont conservées. L’ouverture d’un salon sans code ne lance plus une localisation inutile.

Les aperçus ci-dessous proviennent des widgets réels avec des données simulées. Les requêtes de tuiles sont bloquées par l’environnement de test Flutter : les fonds de carte peuvent être gris. Le profil utilise une session simulée sans jeton, et l’espace du clavier représente un clavier simulé. Les écrans de réglages et leur éditeur ont aussi été vérifiés sur deux émulateurs Android 14 avec le dernier APK debug. GPS réel, caméra QR, audio/vocal, reprise réseau et fluidité mesurée restent à contrôler sur appareil.

Pour reproduire les vérifications depuis `Flutter`, avec le SDK du projet :

```powershell
flutter analyze --no-pub
flutter test --no-pub
flutter test test/ui/ui_adaptation_test.dart --no-pub --dart-define=SAVE_UI_PREVIEWS=true
flutter build apk --debug --no-pub
```

L’APK se trouve dans `build/app/outputs/flutter-apk/app-debug.apk` après compilation.

## Aperçus

| Parcours | Clair | Sombre |
| --- | --- | --- |
| Accueil | [Voir](previews/home-light.png) | [Voir](previews/home-dark.png) |
| Accueil compact, texte agrandi | [Voir](previews/home-small-light.png) | [Voir](previews/home-small-dark.png) |
| Création : réglages | [Voir](previews/create-settings-light.png) | [Voir](previews/create-settings-dark.png) |
| Création : réglages, petit écran | [Voir](previews/create-settings-small-light.png) | [Voir](previews/create-settings-small-dark.png) |
| Éditeur des paramètres | [Voir](previews/create-details-light.png) | [Voir](previews/create-details-dark.png) |
| Éditeur compact, texte agrandi | [Voir](previews/create-details-small-light.png) | [Voir](previews/create-details-small-dark.png) |
| Éditeur avec clavier simulé | [Voir](previews/create-details-keyboard-light.png) | [Voir](previews/create-details-keyboard-dark.png) |
| Création : validation | [Voir](previews/create-review-light.png) | [Voir](previews/create-review-dark.png) |
| Rejoindre | [Voir](previews/join-light.png) | [Voir](previews/join-dark.png) |
| Salon compact | [Voir](previews/lobby-small-light.png) | [Voir](previews/lobby-small-dark.png) |
| Liste des joueurs : organisateur | [Voir](previews/lobby-players-light.png) | [Voir](previews/lobby-players-dark.png) |
| Liste des joueurs : invité | [Voir](previews/lobby-players-guest-light.png) | [Voir](previews/lobby-players-guest-dark.png) |
| Liste des joueurs : petit écran, texte agrandi | [Voir](previews/lobby-players-small-light.png) | [Voir](previews/lobby-players-small-dark.png) |
| Commandes de l’organisateur | [Voir](previews/lobby-host-small-light.png) | [Voir](previews/lobby-host-small-dark.png) |
| Prérequis : conditions à compléter | [Voir](previews/lobby-start-pending-light.png) | [Voir](previews/lobby-start-pending-dark.png) |
| Prérequis : équipe prête | [Voir](previews/lobby-start-ready-light.png) | [Voir](previews/lobby-start-ready-dark.png) |
| Compte compact | [Voir](previews/account-small-light.png) | [Voir](previews/account-small-dark.png) |
| Connexion compacte | [Voir](previews/login-small-light.png) | [Voir](previews/login-small-dark.png) |
| Paramètres compacts | [Voir](previews/settings-small-light.png) | [Voir](previews/settings-small-dark.png) |
| Réglages du vocal | [Voir](previews/settings-vocal-light.png) | [Voir](previews/settings-vocal-dark.png) |
| Fin de partie, hauteur réduite | [Voir](previews/game-finished-small-light.png) | [Voir](previews/game-finished-small-dark.png) |

[Partie et effets de trajet](previews/game-dark.png) · [Chat avec clavier simulé](previews/chat-keyboard-dark.png)
