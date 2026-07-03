# mrvnklm/claude-plugins

A [Claude Code](https://code.claude.com) plugin marketplace by
[@mrvnklm](https://github.com/mrvnklm). Add it once, install any plugin from it,
and get updates with a single `/plugin marketplace update`.

## Add the marketplace

```
/plugin marketplace add mrvnklm/claude-plugins
```

## Plugins

| Plugin | What it does | Install |
| ------ | ------------ | ------- |
| [**pinpoint**](plugins/pinpoint) | Live in-browser UI annotation → Claude Code. Click an element in your dev app, type a note, and it streams into your running session with screenshot + CSS selector + URL. | `/plugin install pinpoint@mrvnklm` |

See each plugin's own README for setup and requirements. (pinpoint is a Claude
Code **Channel** plugin and needs the development-channels launch flag during the
research preview — details in [its README](plugins/pinpoint/README.md).)

## Repository layout

```
.claude-plugin/marketplace.json   # the marketplace manifest (lists every plugin)
plugins/<name>/                    # one directory per plugin
  .claude-plugin/plugin.json       #   the plugin manifest
  …                                #   the plugin's own files
```

## License

[MIT](LICENSE) © Marvin von Spreckelsen
