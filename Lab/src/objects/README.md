# Dossier Objects - Modèles 3D

Placez vos modèles 3D dans ce dossier pour qu'ils soient chargés automatiquement dans l'application AR.

## Formats supportés

- **`.glb`** (recommandé) - Format binaire GLTF, tout inclus dans un seul fichier
- **`.gltf`** - Format texte GLTF (attention : les ressources externes référencées ne sont pas supportées)

## Ordre de chargement

L'application essaie de charger les modèles dans cet ordre :
1. `model.glb`
2. `model.gltf`
3. `default.glb`
4. `default.gltf`
5. Autres fichiers `.glb` ou `.gltf`

Si aucun modèle n'est trouvé, le cube par défaut sera utilisé.

## Avantages

- Les fichiers sont traités comme des assets Vite et sont optimisés lors du build (`npm run build`)
- Les fichiers sont inclus automatiquement dans le bundle
- Meilleure gestion des dépendances et du cache
- Les fichiers sont versionnés avec le code source

## Recommandations

- Utilisez le format `.glb` pour inclure toutes les textures et ressources dans un seul fichier
- Optimisez vos modèles pour de meilleures performances en AR
- Taille recommandée : moins de 2 mètres dans la plus grande dimension (redimensionnement automatique)

## Exemple

Placez votre fichier `model.glb` dans ce dossier et il sera automatiquement chargé au démarrage de l'application AR.
