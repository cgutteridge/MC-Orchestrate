# mc-orchestrate skill

`SKILL.md` in this directory is the **canonical** copy (versioned in git).

Cursor loads skills from `~/.cursor/skills/`. On a new machine, point Cursor at the repo file:

```bash
mkdir -p ~/.cursor/skills/mc-orchestrate
ln -sf "$(pwd)/skills/mc-orchestrate/SKILL.md" ~/.cursor/skills/mc-orchestrate/SKILL.md
```

Run the `ln` command from the repository root (adjust `$(pwd)` if you use an absolute path to the clone).

**Do not** replace `skills/mc-orchestrate/SKILL.md` inside the clone with a symlink (e.g. pointing at `~/.cursor/...`). The file in git must stay a regular file; only the copy under `~/.cursor/skills/` should link to this path.
