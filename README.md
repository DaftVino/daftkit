# daftkit

Portable agent skills for [Claude Code](https://claude.ai/code) — small, focused task playbooks you install once and use in any repository.

> This is a curated export of a private working repo (`daftplate`). It is published one-directionally: fixes made here are not upstreamed. daftkit is the portable-skills half of that system; the scaffolding engine and repo templates live in the companion [`daftplate`](https://github.com/DaftVino/daftplate) repo.

## Skills

| Skill | What it does |
|---|---|
| `/orient` | A session-start brief for a repo — reads its `CLAUDE.md`, code map, changelog, git state, and open issues, then emits a short working brief so a session starts oriented instead of reading its way in. |
| `/handoff` | Writes a durable session handoff before a planned `/clear` or at the end of a phase, so the next session resumes without rediscovery. |
| `/brief` | Toggles terse output for the session. |
| `/curious` | Toggles a moderately higher tendency to ask clarifying questions. |
| `/insist` | A stop on unanswered questions. Preference-level on its own; pair it with the enforcement hook from `daftplate` for a hard gate. |
| `/gas-deploy` | Deploys a Google Apps Script web app with `clasp` — deployment-ID hygiene, `/exec` vs `/dev`, and the auth traps handled. |

## Install

Each skill is a directory containing a `SKILL.md`. Copy the ones you want into your Claude Code skills directory:

```
cp -r skills/orient ~/.claude/skills/
```

Repeat per skill, or copy them all. They load automatically the next session — no build step, no dependencies.

## License

MIT — see [LICENSE](LICENSE).
