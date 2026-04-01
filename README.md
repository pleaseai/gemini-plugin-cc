# Gemini CLI plugin for Claude Code

Use Gemini CLI from inside Claude Code for code reviews or to delegate tasks to Gemini CLI.

This plugin is for Claude Code users who want an easy way to start using Gemini CLI from the workflow
they already have.

<video src="./docs/plugin-demo.webm" controls muted playsinline autoplay></video>

## What You Get

- `/gemini:review` for a normal read-only Gemini review
- `/gemini:adversarial-review` for a steerable challenge review
- `/gemini:rescue`, `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to delegate work and manage background jobs

## Requirements

- **Google account or Gemini API key.**
  - Usage will contribute to your Gemini CLI usage limits. [Learn more](https://geminicli.com/docs).
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add pleaseai/gemini-plugin-cc
```

Install the plugin:

```bash
/plugin install gemini@pleaseai-gemini
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/gemini:setup
```

`/gemini:setup` will tell you whether Gemini CLI is ready. If Gemini CLI is missing and npm is available, it can offer to install Gemini CLI for you.

If you prefer to install Gemini CLI yourself, use:

```bash
npm install -g @google/gemini-cli
```

If Gemini CLI is installed but not logged in yet, run:

```bash
!gemini auth login
```

After install, you should see:

- the slash commands listed below
- the `gemini:gemini-rescue` subagent in `/agents`

One simple first run is:

```bash
/gemini:review --background
/gemini:status
/gemini:result
```

## Usage

### `/gemini:review`

Runs a normal Gemini review on your current work. It gives you the same quality of code review as running `/review` inside Gemini CLI directly.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/gemini:adversarial-review`](#geminiadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/gemini:review
/gemini:review --base main
/gemini:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/gemini:status`](#geministatus) to check on the progress and [`/gemini:cancel`](#geminicancel) to cancel the ongoing task.

### `/gemini:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/gemini:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/gemini:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/gemini:adversarial-review
/gemini:adversarial-review --base main challenge whether this was the right caching and retry design
/gemini:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/gemini:rescue`

Hands a task to Gemini CLI through the `gemini:gemini-rescue` subagent.

Use it when you want Gemini CLI to:

- investigate a bug
- try a fix
- continue a previous Gemini task
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

Examples:

```bash
/gemini:rescue investigate why the tests started failing
/gemini:rescue fix the failing test with the smallest safe patch
/gemini:rescue --resume apply the top fix from the last run
/gemini:rescue --model flash --effort medium investigate the flaky integration test
/gemini:rescue --model pro fix the issue thoroughly
/gemini:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Gemini CLI:

```text
Ask Gemini CLI to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model` or `--effort`, Gemini CLI chooses its own defaults.
- `flash` maps to `gemini-3-flash-preview`; `pro` maps to `gemini-3-pro-preview`
- follow-up rescue requests can continue the latest Gemini task in the repo

### `/gemini:status`

Shows running and recent Gemini CLI jobs for the current repository.

Examples:

```bash
/gemini:status
/gemini:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/gemini:result`

Shows the final stored Gemini CLI output for a finished job.
When available, it also includes the Gemini CLI session ID so you can reopen that run directly in Gemini CLI with `gemini resume <session-id>`.

Examples:

```bash
/gemini:result
/gemini:result task-abc123
```

### `/gemini:cancel`

Cancels an active background Gemini CLI job.

Examples:

```bash
/gemini:cancel
/gemini:cancel task-abc123
```

### `/gemini:setup`

Checks whether Gemini CLI is installed and authenticated.
If Gemini CLI is missing and npm is available, it can offer to install Gemini CLI for you.

You can also use `/gemini:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Gemini review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Gemini CLI loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/gemini:review
```

### Hand A Problem To Gemini CLI

```bash
/gemini:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/gemini:adversarial-review --background
/gemini:rescue --background investigate the flaky test
```

Then check in with:

```bash
/gemini:status
/gemini:result
```

## Gemini CLI Integration

The Gemini CLI plugin wraps the [Gemini CLI app server](https://developers.geminicli.com/docs/app-server). It uses the global `gemini` binary installed in your environment and [applies the same configuration](https://developers.geminicli.com/docs/config-basic).

### Common Configurations

If you want to change the default reasoning effort or the default model that gets used by the plugin, you can define that inside your user-level or project-level `config.toml`. For example to always use `gemini-3-flash-preview` on `high` for a specific project you can add the following to a `.gemini/settings.json` file at the root of the directory you started Claude in:

```toml
model = "gemini-3-flash-preview"
model_reasoning_effort = "xhigh"
```

Your configuration will be picked up based on:

- user-level config in `~/.gemini/settings.json`
- project-level overrides in `.gemini/settings.json`
- project-level overrides only load when the [project is trusted](https://developers.geminicli.com/docs/config-advanced#project-config-files)

Check out the Gemini CLI docs for more [configuration options](https://developers.geminicli.com/docs/config-reference).

### Moving The Work Over To Gemini CLI

Delegated tasks and any [stop gate](#what-does-the-review-gate-do) run can also be directly resumed inside Gemini CLI by running `gemini resume` either with the specific session ID you received from running `/gemini:result` or `/gemini:status` or by selecting it from the list.

This way you can review the Gemini CLI work or continue the work there.

## FAQ

### Do I need a separate Gemini CLI account for this plugin?

If you are already signed into Gemini CLI on this machine, that account should work immediately here too. This plugin uses your local Gemini CLI authentication.

If you only use Claude Code today and have not used Gemini CLI yet, you will also need to sign in to Gemini CLI with a Google account or API key. Run `/gemini:setup` to check whether Gemini CLI is ready, and use `!gemini auth login` if it is not.

### Does the plugin use a separate Gemini runtime?

No. This plugin delegates through your local [Gemini CLI](https://developers.geminicli.com/docs/cli/) and [Gemini CLI app server](https://developers.geminicli.com/docs/app-server/) on the same machine.

That means:

- it uses the same Gemini CLI install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Will it use the same Gemini CLI config I already have?

Yes. If you already use Gemini CLI, the plugin picks up the same [configuration](#common-configurations).

### Can I keep using my current API key or base URL setup?

Yes. Because the plugin uses your local Gemini CLI, your existing sign-in method and config still apply.

If you need to use a custom API endpoint, configure it in your [Gemini CLI settings](https://geminicli.com/docs).
