# mrvnklm/claude-plugins

> A personal [Claude Code](https://code.claude.com) plugin marketplace — add it once, install any plugin, update them all with one command.

![License](https://img.shields.io/badge/license-MIT-blue)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin%20marketplace-6C4CF1)
![Plugins](https://img.shields.io/badge/plugins-1-brightgreen)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

## What is this?

A single Claude Code plugin marketplace maintained by [@mrvnklm](https://github.com/mrvnklm).
Point Claude Code at it once and every plugin listed here becomes installable by name —
no per-plugin clone, no manual wiring. Run `/plugin marketplace update` and everything
tracks the latest.

## Add the marketplace

```
/plugin marketplace add mrvnklm/claude-plugins
```

Then install any plugin from the table below.

## Plugins

| Plugin | What it does | Install |
| ------ | ------------ | ------- |
| [**pinpoint**](plugins/pinpoint) | Live in-browser UI annotation. Click an element in your dev app, type a note, and it streams into your running Claude Code session with a screenshot, the CSS selector, and the URL attached. | `/plugin install pinpoint@mrvnklm` |

> **Note** — pinpoint is a Claude Code **Channel** plugin. Channels are a research
> preview, so it needs a development-channels launch flag on top of `/plugin install`.
> See [its README](plugins/pinpoint/README.md) for the exact command and requirements.

## Repository layout

Each plugin is a self-contained directory under `plugins/`, and the marketplace
manifest lists them all:

```
.claude-plugin/
  marketplace.json          # the marketplace manifest — one entry per plugin
plugins/
  <name>/
    .claude-plugin/
      plugin.json           # the plugin manifest (name, version, author, …)
    README.md               # the plugin's own docs
    …                       # the plugin's files (skills, MCP servers, hooks, …)
```

### Adding a plugin

1. Create `plugins/<name>/` with a `.claude-plugin/plugin.json` manifest and a `README.md`.
2. Append an entry to the `plugins` array in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)
   pointing `source` at `./plugins/<name>`.
3. Validate with `claude plugin validate . --strict`, commit, and push. Users pick it up
   on their next `/plugin marketplace update`.

## License

[MIT](LICENSE) © Marvin von Spreckelsen
