# thelounge-plugin-gsfemotes

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![The Lounge](https://img.shields.io/badge/The%20Lounge-%5E4.0.0-brightgreen)](https://thelounge.chat)
[![Node](https://img.shields.io/badge/Node-%3E%3D14.0.0-green)](https://nodejs.org)

Inline emotes for [The Lounge](https://thelounge.chat) IRC client. Bundles **1300+ GSF emotes** and adds Twitch-style **7TV**, **BetterTTV**, and **FrankerFaceZ** emotes — both global and per-channel.

## Credits

This plugin is a fork of [thelounge-plugin-emotes](https://github.com/zendorea/thelounge-plugin-emotes) by **[Zendorea](https://github.com/zendorea)**, which provides the 7TV/BTTV/FFZ rendering, emote picker, channel-emote support, and CSP/script-injection scaffolding. All credit for that work goes to the original author. This fork adds the bundled GSF emote set and integrates it as a first-class provider.

## Features

- **GSF emotes** — 1332 emotes bundled with the plugin, served at their original URLs (`:emoteName:` syntax)
- **GSF priority** — GSF emote names take priority over any 7TV/BTTV/FFZ name collisions
- **Global Twitch emotes** from 7TV, BTTV, and FrankerFaceZ
- **Channel emotes** — add any Twitch channel name to load their 7TV, BTTV, and FFZ emotes
- **Emote picker** — ☺ button in the chat bar opens a searchable palette with provider tabs (All / GSF / 7TV / BTTV / FFZ)
- **Settings panel** — gear icon in the picker to manage channel emote sources
- **Auto-refresh** — global/channel emote data refreshes every hour; GSF emotes are loaded from the bundled file
- **Hover tooltips** — shows emote name and provider on hover
- **Emote-only messages** — messages with only emotes (up to 3) render at natural size
- **Retina support** — `srcset` with 2x images for high-DPI displays
- **Accessible** — `alt` text and `aria-label` on all emote images

## Installation

```bash
thelounge install thelounge-plugin-gsfemotes
```

Restart The Lounge after installing. The plugin works out of the box — no configuration required.

### What happens on install

1. Loads bundled GSF emotes from `gsf-emotes.json`
2. Fetches global emotes from 7TV, BTTV, and FFZ
3. Injects the client-side script into The Lounge's HTML
4. Starts rendering emotes in chat messages immediately

### Manual script loading (fallback)

The plugin injects `client.js` by intercepting The Lounge's HTTP responses. If emotes don't appear after install, you can load the script manually:

<details>
<summary>Option A: Browser userscript (persistent)</summary>

Install [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/), then create a new script:

```javascript
// ==UserScript==
// @name        The Lounge GSF Emotes
// @match       https://your-lounge-url/*
// @grant       none
// @run-at      document-idle
// ==/UserScript==
const s = document.createElement("script");
s.src = "/packages/thelounge-plugin-gsfemotes/client.js";
document.head.appendChild(s);
```

Replace `https://your-lounge-url/*` with your instance URL.
</details>

<details>
<summary>Option B: Browser console (temporary)</summary>

Open developer tools (F12) and run:

```javascript
const s = document.createElement("script");
s.src = "/packages/thelounge-plugin-gsfemotes/client.js";
document.head.appendChild(s);
```

This only lasts until page refresh.
</details>

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/emotes` | Show emote count, active channels, and usage info |
| `/emotes search <term>` | Search emotes by name (max 25 results) |
| `/emotes refresh` | Force reload emote data from all providers |
| `/emotes channel add <name>` | Add a Twitch channel's emotes |
| `/emotes channel remove <name>` | Remove a channel's emotes |
| `/emotes channels` | List active channel emote sources |

### Emote Picker

Click the ☺ button in the chat input bar to open the emote picker:

- **Search** — filter emotes by name in real time
- **Provider tabs** — filter by All, GSF, 7TV, BTTV, or FFZ
- **Click to insert** — clicking an emote inserts its name into the chat input
- **Settings** — click the ⚙ gear icon to manage channel emote sources

### Channel Emotes

Add any Twitch channel to load their third-party emotes:

1. Open the emote picker → click ⚙ → enter a channel name (e.g. `xqc`)
2. Or use the command: `/emotes channel add xqc`

The plugin resolves the Twitch username to an ID via [ivr.fi](https://api.ivr.fi), then fetches channel-specific emotes from all three providers. Up to 10 channels can be added.

### Emote Priority

When emote names collide across sources, the first one loaded wins:

1. **GSF emotes** (bundled, highest priority)
2. Global emotes: 7TV → BTTV → FFZ
3. Channel emotes (per channel, same provider order)

## How It Works

### Server (`index.js`)

- Loads bundled GSF emotes from `gsf-emotes.json` on startup (URLs pinned to `s3.us-central-1.wasabisys.com`)
- Fetches global emotes from 7TV, BTTV, and FFZ APIs
- Resolves Twitch usernames → IDs via `api.ivr.fi` for channel emotes
- Caches the merged emote map and writes `emote-data.json` to the package directory
- Injects a `<script>` tag into The Lounge's HTML response via `http.ServerResponse` prototype patch
- Modifies Content-Security-Policy headers to allow the GSF and Twitch emote CDN image sources
- Refreshes API-sourced emote data every hour
- Persists channel configuration in The Lounge's persistent storage directory

### Client (`client.js`)

- Fetches `emote-data.json` and builds a regex from all emote names
- Uses a `MutationObserver` to watch for new chat messages
- Walks text nodes in message content and replaces emote codes with `<img>` elements
- Provides the emote picker UI, settings panel, and hover tooltips

### Styles (`emotes.css`)

- Auto-injected via The Lounge's `Stylesheets.addFile()` API
- Emotes render at natural size with `max-height: 128px` / `max-width: 128px` safeguards
- Picker panel uses The Lounge's CSS custom properties for theme consistency

## Emote Sources

| Source | Format | URL pattern |
|--------|--------|-------------|
| **GSF** | bundled JSON | `s3.us-central-1.wasabisys.com/gsf-emotes/<name>.{gif,png}` |
| [7TV](https://7tv.app) | API | `cdn.7tv.app` |
| [BetterTTV](https://betterttv.com) | API | `cdn.betterttv.net` |
| [FrankerFaceZ](https://frankerfacez.com) | API | `cdn.frankerfacez.com` |

## Security

- All emote URLs are validated as HTTPS before rendering
- GSF emote URLs are additionally pinned to the `s3.us-central-1.wasabisys.com` host
- Emote names are validated against a strict allowlist pattern (`/^[\w\-:()!.]+$/`)
- Twitch IDs are validated as numeric before use in API calls
- HTTP responses are capped at 5MB to prevent memory exhaustion
- Redirect chains are limited to 3 hops
- Channel names are validated (`/^[a-zA-Z0-9_]{1,25}$/`)
- Maximum of 10 channel emote sources
- All external API calls use HTTPS with timeouts
- No user credentials or tokens are stored server-side

## Requirements

- [The Lounge](https://thelounge.chat) `^4.0.0`
- Node.js `>=14.0.0`

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)

- Original plugin © 2026 Zendorea — [thelounge-plugin-emotes](https://github.com/zendorea/thelounge-plugin-emotes)
- GSF fork © 2026 sopleb
