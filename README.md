# thelounge-plugin-emotes

Twitch-style emotes for [The Lounge](https://thelounge.chat) IRC client. Renders global emotes from **7TV**, **BetterTTV**, and **FrankerFaceZ** inline in chat messages.

![7TV](https://img.shields.io/badge/7TV-global-blueviolet)
![BTTV](https://img.shields.io/badge/BTTV-global-red)
![FFZ](https://img.shields.io/badge/FFZ-global-orange)

## Features

- 🎭 Renders 130+ global emotes from 7TV, BTTV, and FFZ
- ⚡ Auto-refreshes emote data every hour
- 🔍 `/emotes search <term>` — find emotes by name
- 🔄 `/emotes refresh` — manually reload emote data
- 💬 Hover tooltips showing emote name and provider
- 📏 Larger emotes when a message contains only emotes
- 🖼️ Retina support via `srcset` (2x images)
- ♿ Accessible — `alt` text and `aria-label` on all emote images

## Installation

### Step 1: Install the plugin

```bash
thelounge install thelounge-plugin-emotes
```

This installs the server-side component which fetches and caches emote data, registers the `/emotes` command, and serves the client script.

### Step 2: Load the client script

The Lounge's plugin API doesn't support injecting client-side JavaScript directly. You need to load the client script using one of these methods:

#### Option A: Custom CSS trick (recommended)

In The Lounge, go to **Settings → General** and paste this into the **Custom CSS** field:

```css
@import url("/packages/thelounge-plugin-emotes/emotes-loader.css");
```

Then create a file called `emotes-loader.css` in the plugin directory with a CSS-based script loader. *(This method is experimental — see Option B if it doesn't work.)*

#### Option B: Browser userscript (most reliable)

Install a userscript manager like [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/), then create a new script:

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

Replace `https://your-lounge-url/*` with your The Lounge instance URL.

#### Option C: Browser console (temporary)

Open your browser's developer console (F12) and paste:

```javascript
const s = document.createElement("script");
s.src = "/packages/thelounge-plugin-emotes/client.js";
document.head.appendChild(s);
```

This only lasts until you refresh the page.

## Commands

| Command | Description |
|---------|-------------|
| `/emotes` | Show emote count and usage info |
| `/emotes search <term>` | Search for emotes by name (max 25 results) |
| `/emotes refresh` | Force reload emote data from all providers |

## How it works

1. **Server side** (`index.js`): On startup, fetches global emotes from 7TV, BTTV, and FFZ APIs. Caches them in memory and writes `emote-data.json` to the package directory. Refreshes every hour.

2. **Client side** (`client.js`): Fetches the emote data JSON, builds a regex from all emote names, and uses a `MutationObserver` to watch for new messages. When a message appears, it walks the text nodes and replaces emote codes with `<img>` elements.

3. **Styles** (`emotes.css`): Auto-injected by The Lounge's `Stylesheets.addFile()` API. Sizes emotes to match line height, with larger rendering for emote-only messages.

## Emote providers

| Provider | API | CDN | Emotes |
|----------|-----|-----|--------|
| [7TV](https://7tv.app) | `7tv.io/v3/emote-sets/global` | `cdn.7tv.app` | ~44 |
| [BetterTTV](https://betterttv.com) | `api.betterttv.net/3/cached/emotes/global` | `cdn.betterttv.net` | ~65 |
| [FrankerFaceZ](https://frankerfacez.com) | `api.frankerfacez.com/v1/set/global` | `cdn.frankerfacez.com` | ~23 |

Emote priority: if the same name exists in multiple providers, the first one loaded wins (7TV → BTTV → FFZ).

## Requirements

- The Lounge `^4.0.0`
- Node.js `>=18.0.0`

## License

[MIT](LICENSE)
