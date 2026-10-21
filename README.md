# Portail Horaire Pro

PWA de consultation multi-écoles. Le compte utilisateur est global ; ses droits sont définis pour chaque école par Supabase. Les enseignants consultent leurs propres cours, les responsables autorisés disposent des vues de suivi, et seuls les administrateurs de plateforme voient le centre de gestion commerciale.

Le répertoire publié contient des ressources publiques uniquement. `config.js` fournit l’URL Supabase et la clé publiable ; aucune clé de service, mot de passe ou base complète ne doit être placé sur GitHub Pages.

Le déploiement du portail suit la migration Supabase et la recette des rôles. Le script `scripts/publish-web.ps1` copie les ressources vers le dépôt GitHub Pages existant en préservant sa configuration publique. La mise en ligne se fait ensuite par GitHub Pages après validation du commit.
