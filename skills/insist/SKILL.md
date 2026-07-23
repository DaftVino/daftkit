---
name: insist
description: Toggle a hard stop on unanswered questions. While on, no question is ever auto-decided or skipped, regardless of auto-approve or permission settings. Use when the user says "/insist", "insist", "stop auto-deciding", "ask me properly", or "/insist off".
allowed-tools:
  - Bash
  - Read
  - Write
---

# insist

A hard gate. While this is on, a question put to the user is answered **by the
user** — never by a preference, never by an auto-approve setting, never by
inferring what they would probably say.

## Toggle

```
node -e "require('fs').mkdirSync(require('path').join(require('os').homedir(),'.daftplate'),{recursive:true})"
```

Then write `on` or `off` to `~/.daftplate/insist`. Confirm the new state in one
line and nothing more.

The companion `PreToolUse` hook at `.claude/question-gate.mjs` enforces it.
Without the hook this skill is only a preference, and a preference is exactly
what auto-decide overrides — so if the hook is not registered in
`.claude/settings.json`, say so rather than claiming the gate is active.

## What the hook can and cannot do

The hook fires on `AskUserQuestion` and forces the harness to put the question
to the user, defeating an auto-approve rule that would have resolved it
unseen. That is the one path where machinery can be beaten by machinery.

It cannot fire on a question you never asked. Deciding something silently
produces no tool call and therefore no hook, so the rest of this skill is the
only thing standing between a judgement call and a silent default. Treat the
sections below as the substance of `/insist`, not as commentary on the hook.

## While on

When you reach a point where you would ask something and something else would
normally resolve it for you:

1. **Stop.** Do not proceed, do not pick, do not assume the obvious answer.
2. **State the question in full** — the actual question, not a summary of it.
3. **State every option** you were considering, each with its trade-off. Do not
   silently drop one because it seemed weak.
4. **State your recommendation and why**, in one line.
5. **Stop again.** End the turn. The next thing in this conversation is the
   user's answer.

Do not begin adjacent work while waiting. Do not offer to proceed with a
default. Do not re-ask a different, easier question instead.

## What it does not do

It does not make you ask *more* questions — that is `/curious`. It changes what
happens to the questions you were already going to ask. The two are independent
and compose.

It does not override safety gates. A refusal is still a refusal.
