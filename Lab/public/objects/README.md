# Dossier Objects

⚠️ **Ce dossier n'est plus utilisé.** Les modèles 3D doivent maintenant être placés dans `src/objects/` pour être inclus dans le build Vite.

## Nouveau emplacement

Placez vos modèles 3D dans le dossier **`src/objects/`** pour qu'ils soient chargés automatiquement dans l'application AR.

## Formats supportés

- **`.glb`** (recommandé) - Format binaire GLTF, tout inclus dans un seul fichier
- **`.gltf`** - Format texte GLTF (attention : les ressources externes référencées ne sont pas supportées)

## Ordre de chargement

L'application essaie de charger les modèles dans cet ordre :
1. `src/objects/model.glb`
2. `src/objects/model.gltf`
3. `src/objects/default.glb`
4. `src/objects/default.gltf`
5. Autres fichiers dans `src/objects/`

Si aucun modèle n'est trouvé, le cube par défaut sera utilisé.

## Avantages de src/objects/

- Les fichiers sont traités comme des assets Vite et sont optimisés lors du build
- Les fichiers sont inclus automatiquement dans le bundle
- Meilleure gestion des dépendances et du cache

## Recommandations

- Utilisez le format `.glb` pour inclure toutes les textures et ressources dans un seul fichier
- Optimisez vos modèles pour de meilleures performances en AR
- Taille recommandée : moins de 2 mètres dans la plus grande dimension (redimensionnement automatique)
