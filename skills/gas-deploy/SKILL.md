---
name: gas-deploy
description: Deploy a Google Apps Script web app with clasp — deployment-ID hygiene, /exec versus /dev, archiving stale deployments, and the auth traps. Use when the user says "deploy", "push to Apps Script", "clasp deploy", or names a gas-webapp project.
allowed-tools:
  - Bash
  - Read
  - Grep
---

# gas-deploy

Apps Script deployment is a recurring source of lost time, almost always for
one of four reasons below rather than anything to do with the code.

Read the repo's `docs/deploy-runbook.md` first — it holds this project's
deployment IDs, script ID, and any project-specific steps. This skill is the
procedure and the traps; the runbook is the specifics. Where they disagree, the
runbook wins.

## Never deploy unasked

`~/.claude/CLAUDE.md` and every scaffolded `CLAUDE.md` say it: run verify before
every push, never deploy without being asked. Deployment is outward-facing.
Confirm before the first `clasp deploy` of a session, every session.

## 1. Pre-flight

```
clasp --version
clasp push --watch=false
```

If `clasp` is not on `PATH`, stop and report the install command. Never
`npm install -g` on the user's behalf.

Confirm `.clasp.json` exists and is gitignored, and that `.clasp.json.example`
is committed with the script ID redacted (repo-standards §2.1 layer 3). A real
script ID in a tracked file is the same class of mistake as a committed key.

## 2. The four traps, in the order they bite

1. **`/exec` versus `/dev`.** `/dev` serves the current saved code to the
   owner and nobody else. `/exec` serves a *specific numbered deployment* to
   everyone. Testing on `/dev` and announcing on `/exec` is the single most
   common false "it works". Always verify on the `/exec` URL you are about to
   hand over.
2. **Deployment-ID drift.** `clasp deploy` without `-i` creates a *new*
   deployment with a *new* ID and a new `/exec` URL. Every previously shared
   link keeps serving the old code. Redeploy the existing ID:

   ```
   clasp deployments
   clasp deploy -i <deployment-id> -d "<what changed>"
   ```

   Record the ID in `docs/deploy-runbook.md` and never create a second
   long-lived one.
3. **Stale deployments accumulate.** Apps Script caps deployments per project.
   Archive with `clasp undeploy <id>` — but read `clasp deployments` first and
   confirm the ID is not the live one. Undeploying the live deployment takes
   the app down, and it is not undoable from the CLI.
4. **Auth and caching.** A logged-in Google account that is not the script
   owner sees a stale or permission-denied page that looks like a deploy
   failure. Verify in an incognito window, signed in as the intended audience.
   `clasp login --status` confirms which account clasp itself is using; it is
   frequently not the one in the browser.

## 3. Verify

Open the `/exec` URL in incognito. Confirm the change is visible and the
version string, if the app has one, matches what was just deployed. Do not
report success from a `clasp deploy` exit code alone — it reports that the
deployment was created, not that the app works.

## 4. Record

Append to `CHANGELOG.md` under Unreleased if the deployment carries a
user-visible change, and update `docs/deploy-runbook.md` if any ID changed.
