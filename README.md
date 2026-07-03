# pinpoint

**Live in-browser UI annotation for Claude Code.** Click an element in your running dev
app, type a note, hit send — and it streams straight into your active Claude Code session
with a screenshot, the element's CSS selector, and the page URL attached.

## The problem

The usual "point Claude at some UI" loop is copy-paste drudgery: you screenshot the
browser, describe *where* the thing is in prose ("the second card in the pricing grid,
the one with the misaligned badge"), paste it into the terminal, and hope Claude can map
your words back onto the DOM. Every round trip loses context.

pinpoint closes the loop. You annotate **on the live page** — the element you clicked *is*
the reference. No manual screenshots, no "which button did you mean", no describing
coordinates. The note lands in Claude with the selector and a cropped screenshot already
attached, so Claude knows exactly what you're looking at.

## Architecture

```
browser overlay  ──POST──▶  localhost bridge  ──channel event──▶  Claude Code
(in your dev app)          (127.0.0.1, token)   (notifications/claude/channel)
```

The overlay is a tiny dev-only script injected into your app. It talks to a localhost-only
bridge (bundled as an MCP server), which emits a Claude Code **channel** event into your
running session.

## ⚠️ Requirements

> - **Claude Code v2.1.80 or newer.**
> - **Anthropic login** (the direct Anthropic API). Bedrock and Vertex are **not** supported —
>   channels are an Anthropic-first-party feature.
> - **During the research preview you must launch Claude with the development-channels flag:**
>
>   ```
>   claude --dangerously-load-development-channels plugin:pinpoint@pinpoint
>   ```
>
>   Why: `/plugin install` registers the plugin and its MCP bridge, but it does **not** by
>   itself activate a custom channel. A marketplace listing likewise does **not** put the
>   channel on the Anthropic allowlist. Until pinpoint's channel is allowlisted, the
>   `--dangerously-load-development-channels` flag is the only way to load it.

## Install & run

```
/plugin marketplace add mrvnklm/pinpoint
/plugin install pinpoint@pinpoint
```

Then **relaunch** Claude Code with the development-channels flag so the channel actually
activates:

```
claude --dangerously-load-development-channels plugin:pinpoint@pinpoint
```

## Set up the overlay

The overlay ships as source and is built once:

```
npm install && npm run build
```

Then inject it **into your dev app in development only** — never in production. See
[`docs/injection.md`](docs/injection.md) for the framework-agnostic instructions.

For Nuxt, drop in a client plugin: copy [`docs/nuxt-inject-template.ts`](docs/nuxt-inject-template.ts)
to `plugins/pinpoint.client.ts`. It reads the port and per-project token from
`.pinpoint/config.json` (written when the bridge first runs) and only mounts the overlay
outside production builds.

> **Dev-only, always.** The overlay opens a channel to a localhost bridge and must never
> ship in a production bundle. Gate the injection behind your dev/prod flag.

## Usage

1. Open your dev app in the browser.
2. Click the floating pinpoint button (or press **Cmd/Ctrl + Shift + K**).
3. Hover and click the element you want to talk about — pinpoint highlights it and grabs
   its selector + a screenshot.
4. Type your note and send.
5. It shows up in your running Claude Code session, with the screenshot, CSS selector, and
   page URL attached.

## Privacy & security

- **Localhost only.** The bridge binds to `127.0.0.1` — nothing is exposed on your network.
- **Token-gated.** The POST endpoint requires a per-project token (stored in
  `.pinpoint/config.json`). The overlay reads that same token so only your app can post.
- **Nothing leaves the machine.** Screenshots and notes travel browser → localhost bridge →
  your local Claude Code session. No external service, no telemetry.

## How it works

pinpoint is built on **Claude Code Channels**. The bundled MCP bridge
(`bridge/server.mjs`, registered via [`.mcp.json`](.mcp.json) using `${CLAUDE_PLUGIN_ROOT}`)
receives each annotation from the overlay over localhost and emits a
`notifications/claude/channel` event into your active session. Claude Code surfaces that
event inline — which is why the custom channel has to be loaded (hence the
`--dangerously-load-development-channels` flag during the preview).

## Roadmap (v2)

- **Live status back into the overlay** — show *queued / working / done* on each annotation,
  via a reply tool plus a WebSocket from the bridge back to the browser.
- **Permission relay** — surface Claude Code permission prompts in the overlay so you can
  approve actions without switching back to the terminal.
