# Working notes for Claude

## Horarium: Bartosz checks every change on his Mac, without commands

- A launchd watcher on Bartosz's Mac (`apps/horarium/preview/install.sh`) checks GitHub every 2 minutes and rebuilds the local preview at http://127.0.0.1:8791 from the **most recently updated open pull request** (or `main` when none is open). Demo data only, its own database, its own clone in `.preview/src`; it never touches his working copy.
- A Horarium task is finished only when he can check it there. After pushing, read `/Users/bartosz/Projects/opus-magnum/.preview/status.json` with the device folder tools (the folder is approved). Wait until it shows `"state":"ok"` with your PR's head `sha`. On `"failed"`, read `.preview/watch.log`, fix and push again.
- Then tell him the change is live at http://127.0.0.1:8791. Never ask him to pull, check out a branch or run a command to see it.
- Only one PR is shown at a time: the one pushed last. If another thread pushed after you, say which PR the preview shows.
- The public tunnel is off by default. He starts it himself when he wants to show the app to others: `apps/horarium/preview/share.sh` (and `share.sh stop`).
