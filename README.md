# What's Cooking

Liste flottante, toujours au premier plan, des sujets « sur le feu ». Une Card par-dessus les fenêtres, des Timers qui préviennent quand une attente est finie, et l'historique de la journée pour remplir ses timesheets.

- **App Tauri 2** (`app/`) : la Card, en HTML/CSS/JS.
- **CLI `cook`** (`bin/cook`) : la même liste depuis le terminal, et le point d'entrée des hooks Claude Code.
- **Extension GNOME `whats-cooking-pin`** (`gnome-helper/`) : sous GNOME (Wayland compris), garde la Card au premier plan sur tous les espaces de travail, mémorise sa position, la retire d'Alt+Tab et du dock, et ajoute le raccourci `Super+Shift+C`.

Tout passe par un journal append-only partagé : `~/.local/share/whats-cooking/journal.jsonl`.

## Installation

Prérequis : Rust (rustup), Node.js, WebKitGTK 4.1 (Ubuntu : `libwebkit2gtk-4.1-dev`), `jq`.

```bash
./install.sh                # build release, installe app + CLI + lanceur + autostart + extension
./install.sh --dev          # build debug, liens symboliques vers le repo (CLI, extension)
./install.sh --hooks        # + hooks Claude Code (settings.json sauvegardé avant)
```

Puis redémarrer GNOME Shell (X11 : `Alt+F2` → `r` ; Wayland : déconnexion) et lancer `whats-cooking &`. L'app démarre ensuite seule à chaque login.

## Désinstallation

```bash
./uninstall.sh          # retire tout, garde les Dishes et l'historique
./uninstall.sh --purge  # supprime aussi les données
```

## Utilisation

| Action | Card | CLI |
|---|---|---|
| Ajouter | Quick entry : `Titre #tag /w 20` (`#` propose les Tags existants) | `cook add "Titre #tag /w 20"` (`--start` = Cooking) |
| Queued ⇄ Cooking | clic sur la pastille | `cook queue <n>` / `cook start <n>` |
| Timer (Waiting → Ready) | horloge : clic +5 min, molette ±1 min, clic droit annule | `cook wait <n> <min>` |
| Terminer | coche (le Dish part au Dishwasher) | `cook done <n>` |
| Renommer | double-clic sur le titre | `cook rename <n> nouveau titre` |
| Tag | clic sur le badge : choisir, créer, retirer, changer la couleur (8 couleurs) | `cook tag <n> nom` |
| Supprimer un Tag | × sur le Tag dans la liste (deux clics) | `cook tags --rm nom` (`cook tags` = liste) |
| Supprimer | × deux fois | `cook rm <n>` |
| Réordonner | glisser la poignée | — |
| Dishwasher | section du bas : Dishes Done depuis 4 h, clic = ressortir | `cook wash` (vider) |
| Journée | — | `cook log` / `cook log yesterday` / `cook log 2026-11-18` |

États : **Queued** · **Cooking** · **Waiting** · **Ready** · **Done**. La Card se redimensionne par le coin bas-droit, bascule entre taille compacte et élargie avec le bouton ⤢, se masque avec `×` (icône de la barre système, qui affiche aussi le nombre de Dishes, ou `Super+Shift+C` pour la ré-afficher).

## Sessions Claude

Avec `--hooks`, chaque session Claude Code devient un Dish (Tag = dossier du projet) :

- prompt envoyé → **Waiting** « Claude working… » ;
- fin de tour ou demande de permission → **Ready** ;
- pas de Timer pendant que Claude travaille ; une fois Ready, le Timer sert de rappel (Waiting N min, puis Ready) ;
- titre = titre de la session Claude Desktop quand il est connu, sinon la 1re ligne du prompt ; un Dish renommé à la main garde son titre.

## Tests

`test/run-v1-headless.sh [steps]` lance un GNOME Shell headless Wayland isolé avec l'app et des données d'exemple, joue éventuellement un scénario (`test/steps-v1*.sh`) et dépose captures et journal dans `test/out-v1/`.

## Licence

[GPL-3.0](LICENSE)
