# What's Cooking — POC

Post-it flottant (extension GNOME Shell, Wayland natif) listant les tâches « sur le feu ».

## Principe

Tout passe par un journal append-only : `~/.local/share/whats-cooking/journal.jsonl`.
L'extension, la CLI et les hooks Claude y ajoutent des événements (`add`, `set`, `move`) ;
l'extension surveille le fichier et se redessine. Pas de démon, l'historique sert de base aux timesheets.

## Installation

```bash
./install.sh                # copie extension + CLI (~/.local/bin/cook), active l'extension
./install.sh --dev          # liens symboliques vers le repo : modifs prises au redémarrage du shell
./install.sh --hooks        # + hooks Claude Code (sauvegarde settings.json avant)
./install.sh --dev --hooks  # combinable
```

Puis redémarrer GNOME Shell — X11 : `Alt+F2` → `r`. Wayland : déconnexion/reconnexion.

## Désinstallation

```bash
./uninstall.sh          # retire extension, CLI, hooks Claude ; garde ~/.local/share/whats-cooking
./uninstall.sh --purge  # supprime aussi tâches et historique
```

## Utilisation

| Action | Comment |
|---|---|
| Ajouter | champ de saisie ou `cook add "Titre #tag /w 20"` |
| État | clic sur la pastille : à faire ⇄ en cours (une tâche en attente repasse en cours) |
| Attendre | clic sur l'horloge = +10 min, molette = ±5 min, clic droit = annuler |
| Terminer | coche (ou `cook done <n°>`) |
| Réordonner | glisser la poignée ⠿ |
| Déplacer / réduire / masquer | glisser l'en-tête, `^`, `×` ; l'icône de la barre du haut réaffiche |
| Journal du jour | `cook log` / `cook log yesterday` / `cook log 2026-11-18` |

## Sessions Claude (hooks)

- `UserPromptSubmit` : crée la tâche de la session (titre = 1re ligne du prompt, tag = nom du dossier sans `odoo-`) ou la rouvre si elle était terminée → « Claude travaille… ».
- `Stop` / `Notification` : la tâche clignote → « à relire ».
- Clic sur la pastille → en cours, le clignotement s'arrête.

## Test

`test/run-headless.sh` lance un GNOME Shell headless Wayland isolé (dossiers XDG temporaires),
injecte des tâches, simule clics/saisie/glisser et dépose des captures dans `test/out/`.

## Licence

[GPL-3.0](LICENSE)
