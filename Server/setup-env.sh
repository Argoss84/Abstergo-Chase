#!/bin/bash
# Script Bash pour créer le fichier .env depuis le template
# Usage: ./setup-env.sh

ENV_FILE=".env"
TEMPLATE_FILE="env.template"

if [ -f "$ENV_FILE" ]; then
    echo "⚠️  Le fichier .env existe déjà !"
    read -p "Voulez-vous le remplacer ? (o/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Oo]$ ]]; then
        echo "❌ Opération annulée"
        exit 0
    fi
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "❌ Le fichier template '$TEMPLATE_FILE' n'existe pas !"
    exit 1
fi

cp "$TEMPLATE_FILE" "$ENV_FILE"
echo "✅ Fichier .env créé avec succès !"
echo ""
echo "📝 Vous pouvez maintenant éditer le fichier .env pour configurer :"
echo "   - Le port du serveur (SIGNALING_PORT)"
echo "   - Le mot de passe (mdp)"
echo ""
echo "💡 Pour désactiver l'authentification, commentez ou supprimez la ligne 'mdp=...' dans .env"
