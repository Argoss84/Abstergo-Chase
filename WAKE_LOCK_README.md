# Wake Lock - Empêcher l'écran de se mettre en veille

## Vue d'ensemble

Cette implémentation utilise l'API Screen Wake Lock pour empêcher l'écran de se mettre en veille automatiquement sur les appareils mobiles. Cela est particulièrement utile pour les applications de jeu en temps réel où l'utilisateur doit garder l'écran allumé.

## Fonctionnalités

### 🔒 Wake Lock Global
- **WakeLockProvider** : Composant wrapper qui applique le Wake Lock à toute l'application
- **Activation automatique** : Le Wake Lock s'active dès que l'utilisateur se connecte
- **Gestion intelligente** : Le Wake Lock se libère automatiquement quand l'application passe en arrière-plan

### 📱 Support Mobile
- **API moderne** : Utilise l'API Screen Wake Lock (supportée par Chrome, Safari, Firefox)
- **Fallback gracieux** : Affiche un avertissement si l'API n'est pas supportée
- **Gestion des permissions** : Gère automatiquement les permissions utilisateur

### 🎮 Intégration dans le jeu
- **Pages de jeu** : Wake Lock actif sur Agent, Rogue, et Lobby
- **Hook personnalisé** : `useWakeLock` disponible pour une utilisation locale
- **Gestion des événements** : Réagit aux changements de visibilité de la page

## Implémentation

### 1. WakeLockProvider (Global)
```typescript
// src/components/WakeLockProvider.tsx
// Applique le Wake Lock à toute l'application
```

### 2. Hook useWakeLock (Local)
```typescript
// src/utils/useWakeLock.ts
// Hook personnalisé pour une utilisation locale
```

### 3. Intégration dans App.tsx
```typescript
// L'application entière est enveloppée dans WakeLockProvider
<WakeLockProvider enabled={true}>
  <IonApp>
    {/* ... */}
  </IonApp>
</WakeLockProvider>
```

## Comportement

### ✅ Activation
- L'écran reste allumé tant que l'application est active
- Le Wake Lock se réactive automatiquement quand l'utilisateur revient à l'application
- Messages de confirmation dans la console

### 🔄 Gestion des événements
- **Page visible** : Wake Lock actif
- **Page cachée** : Wake Lock libéré (économie de batterie)
- **Fermeture de l'app** : Wake Lock libéré automatiquement

### ⚠️ Gestion des erreurs
- Vérification de la compatibilité du navigateur
- Messages d'erreur informatifs dans la console
- Fallback gracieux si l'API n'est pas supportée

## Compatibilité

### ✅ Navigateurs supportés
- Chrome 84+
- Safari 15.4+
- Firefox 96+
- Edge 84+

### ❌ Navigateurs non supportés
- Internet Explorer
- Navigateurs plus anciens

## Messages de console

### Activation réussie
```
🔒 Wake Lock global activé - L'écran ne se mettra pas en veille
```

### Libération
```
🔓 Wake Lock global libéré
```

### Erreurs
```
⚠️ Wake Lock API non supportée par ce navigateur
❌ Erreur lors de l'activation du Wake Lock global: [erreur]
```

## Utilisation

Le Wake Lock est automatiquement activé pour toute l'application. Aucune action supplémentaire n'est requise de la part de l'utilisateur.

### Pour les développeurs

Si vous souhaitez utiliser le Wake Lock dans un composant spécifique :

```typescript
import { useWakeLock } from '../utils/useWakeLock';

const MonComposant = () => {
  const { releaseWakeLock } = useWakeLock(true);
  
  // Le Wake Lock sera actif tant que ce composant est monté
  // Vous pouvez appeler releaseWakeLock() pour le libérer manuellement
  
  return <div>Mon composant</div>;
};
```

## Notes importantes

1. **Batterie** : Le Wake Lock peut consommer plus de batterie
2. **Permissions** : L'utilisateur peut être invité à autoriser le Wake Lock
3. **Système** : Le système d'exploitation peut toujours forcer la mise en veille dans certains cas
4. **HTTPS** : L'API Wake Lock nécessite une connexion HTTPS en production

## Tests

Pour tester le Wake Lock :

1. Ouvrez l'application sur mobile
2. Laissez l'écran inactif
3. L'écran devrait rester allumé
4. Vérifiez les messages dans la console du navigateur 