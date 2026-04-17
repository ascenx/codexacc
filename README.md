# codexacc

`codexacc` is a small CLI for managing multiple Codex CLI accounts.

It creates one isolated `CODEX_HOME` per account, so each account keeps its own
Codex login state, config, sessions, and cached limit information.

## Quick Start

Install from npm:

```bash
npm install -g @ascenx/codexacc
codexacc help
```

Or install from this repo:

```bash
pnpm install
pnpm build
npm link
```

Then add accounts:

```bash
codexacc add personal
codexacc add work
```

Run Codex with a specific account:

```bash
codexacc run work
codexacc run work exec "fix tests"
```

If you omit the account name, `codexacc` prompts you to choose one:

```bash
codexacc run
# Select account for codexacc run:
#   1) personal  5h 25%      weekly 58%      Plus
#   2) work      5h unknown  weekly unknown
```

Install the shell hook once, then switch the default account:

```bash
codexacc install-shell
source ~/.zshrc
codexacc use work
codex
```

You can also run `codexacc use` and choose from the saved account list with cached 5h and weekly limits.

## Commands

```bash
codexacc add work
codexacc remove work
codexacc run work
codexacc run
codexacc run work exec "fix tests"
codexacc use work
codexacc use
codexacc current-home
codexacc install-shell
codexacc list
codexacc limits
codexacc limits --refresh
```

For the full usage guide, see [docs/usage.md](docs/usage.md).

## Storage

Accounts live under:

```text
~/.codexacc/accounts/<name>/home
```

Each account home can contain Codex auth files such as `auth.json`. Treat the account directory like a secret.

## Limits

`codexacc limits` reads last-known `rate_limits` data from local Codex session logs. It is cached and experimental. It is not an official real-time quota API and cannot provide exact remaining message counts.

Use `codexacc limits --refresh` to run a tiny Codex prompt for each account before reading the cached limits. This consumes a small amount of quota per account, prints progress while refreshing, and times out each account after 120 seconds by default.

Override the per-account refresh timeout with `CODEXACC_REFRESH_TIMEOUT_MS`:

```bash
CODEXACC_REFRESH_TIMEOUT_MS=30000 codexacc limits --refresh
```
