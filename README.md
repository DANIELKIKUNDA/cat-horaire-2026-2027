# Portail sécurisé CAT 2026-2027

Interface officielle de consultation de l’horaire du Collège des Aumôniers du Travail.

## Confidentialité

- un visiteur non connecté voit uniquement l’écran de connexion ;
- un enseignant reçoit uniquement son propre horaire ;
- la direction consulte toutes les classes, tous les enseignants et les PDF ;
- aucune donnée complète ni aucun PDF n’est enregistré dans ce dossier public ;
- Supabase applique les autorisations côté serveur avec Row Level Security.

## Configuration

Le fichier `config.js` contient seulement l’URL Supabase et la clé `publishable`. La clé `secret` ne doit jamais entrer dans ce dépôt.

Les instructions de création du projet et de provisionnement sont dans `../secure_setup/README.md` dans le dossier de travail privé.

## Publication

Le workflow `.github/workflows/pages.yml` publie automatiquement ce dossier sur GitHub Pages après une mise à jour de la branche `main`.
