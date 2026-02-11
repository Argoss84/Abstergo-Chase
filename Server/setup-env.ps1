# Script PowerShell pour creer le fichier .env depuis le template
# Usage: .\setup-env.ps1

$envFile = ".env"
$templateFile = "env.template"

if (Test-Path $envFile) {
    Write-Host "Le fichier .env existe deja !" -ForegroundColor Yellow
    $response = Read-Host "Voulez-vous le remplacer ? (o/n)"
    if ($response -ne "o" -and $response -ne "O") {
        Write-Host "Operation annulee" -ForegroundColor Red
        exit
    }
}

if (-not (Test-Path $templateFile)) {
    Write-Host "Le fichier template '$templateFile' n'existe pas !" -ForegroundColor Red
    exit 1
}

Copy-Item $templateFile $envFile
Write-Host "Fichier .env cree avec succes !" -ForegroundColor Green
Write-Host ""
Write-Host "Vous pouvez maintenant editer le fichier .env pour configurer :" -ForegroundColor Cyan
Write-Host "   - Le port du serveur (SIGNALING_PORT)" -ForegroundColor Gray
Write-Host "   - Le mot de passe (mdp)" -ForegroundColor Gray
Write-Host ""
Write-Host "Pour desactiver l'authentification, commentez ou supprimez la ligne mdp dans .env" -ForegroundColor Yellow
