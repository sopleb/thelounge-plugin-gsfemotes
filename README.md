# thelounge-plugin-emotes

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![The Lounge](https://img.shields.io/badge/The%20Lounge-%5E4.0.0-brightgreen)](https://thelounge.chat)
[![Node](https://img.shields.io/badge/Node-%3E%3D14.0.0-green)](https://nodejs.org)

Twitch-style emotes for [The Lounge](https://thelounge.chat) IRC client. Renders emotes from **7TV**, **BetterTTV**, and **FrankerFaceZ** inline in chat messages — both global and per-channel.

<!-- Screenshot placeholder: replace with actual screenshot -->
<!-- ![Screenshot](docs/screenshot.png) -->

## Features

- **Global emotes** from 7TV, BTTV, and FrankerFaceZ (130+ emotes)
- **Channel emotes** — add any Twitch channel name to load their 7TV, BTTV, and FFZ emotes (800+ per channel)
- **Emote picker** — ☺ button in the chat bar opens a searchable emote palette with provider tabs
- **Settings panel** — gear icon in the picker to manage channel emote sources
- **Auto-refresh** — emote data refreshes every hour
- **Hover tooltips** — shows emote name and provider on hover
- **Emote-only messages** — messages with only emotes (up to 3) render at natural size
- **Retina support** — `srcset` with 2x images for high-DPI displays
- **Natural sizing** — emotes render at their native size with 128px max safeguards
- **Accessible** — `alt` text and `aria-label` on all emote images

## Installation

```bash
thelounge install thelounge-plugin-emotes
```

Restart The Lounge after installing. The plugin works out of the box — no configuration required.

### What happens on install

1. Fetches global emotes from 7TV, BTTV, and FFZ
2. Injects the client-side script into The Lounge's HTML
3. Starts rendering emotes in chat messages immediately

### Manual script loading (fallback)

The plugin injects `client.js` by intercepting The Lounge's HTTP responses. If emotes don't appear after install, you can load the script manually:

<details>
<summary>Option A: Browser userscript (persistent)</summary>

Install [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/), then create a new script:

```javascript
// ==UserScript==
// @name        The Lounge Emotes
// @match       https://your-lounge-url/*
// @grant       none
// @run-at      document-idle
// ==/UserScript==
const s = document.createElement("script");
s.src = "/packages/thelounge-plugin-emotes/client.js";
document.head.appendChild(s);
```

Replace `https://your-lounge-url/*` with your instance URL.
</details>

<details>
<summary>Option B: Browser console (temporary)</summary>

Open developer tools (F12) and run:

```javascript
const s = document.createElement("script");
s.src = "/packages/thelounge-plugin-emotes/client.js";
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
- **Provider tabs** — filter by All, 7TV, BTTV, or FFZ
- **Click to insert** — clicking an emote inserts its name into the chat input
- **Settings** — click the ⚙ gear icon to manage channel emote sources

### Channel Emotes

Add any Twitch channel to load their third-party emotes:

1. Open the emote picker → click ⚙ → enter a channel name (e.g. `xqc`)
2. Or use the command: `/emotes channel add xqc`

The plugin resolves the Twitch username to an ID via [ivr.fi](https://api.ivr.fi), then fetches channel-specific emotes from all three providers. Up to 10 channels can be added.

### Emote Priority

When emote names collide across providers or channels, the first one loaded wins:

1. Global emotes: 7TV → BTTV → FFZ
2. Channel emotes are added after globals (per channel, same provider order)

## How It Works

### Server (`index.js`)

- Fetches emotes from 7TV, BTTV, and FFZ APIs on startup
- Resolves Twitch usernames → IDs via `api.ivr.fi` for channel emotes
- Caches emote data in memory and writes `emote-data.json` to the package directory
- Injects a `<script>` tag into The Lounge's HTML response via `http.ServerResponse` prototype patch
- Modifies Content-Security-Policy headers to allow emote CDN image sources
- Refreshes emote data every hour
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

## Emote Providers

| Provider | Global API | Channel API | CDN |
|----------|-----------|-------------|-----|
| [7TV](https://7tv.app) | `/v3/emote-sets/global` | `/v3/users/twitch/{id}` | `cdn.7tv.app` |
| [BetterTTV](https://betterttv.com) | `/v3/cached/emotes/global` | `/v3/cached/users/twitch/{id}` | `cdn.betterttv.net` |
| [FrankerFaceZ](https://frankerfacez.com) | `/v1/set/global` | `/v1/room/{username}` | `cdn.frankerfacez.com` |

## Security

- All emote URLs are validated as HTTPS before rendering
- Emote names are validated against a strict allowlist pattern (`/^[\w\-:()!]+$/`)
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

[MIT](LICENSE) © Zendorea
