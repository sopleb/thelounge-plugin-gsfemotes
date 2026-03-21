"use strict";

const https = require("https");
const path = require("path");
const fs = require("fs");

let thelounge = null;
let emoteCache = { emotes: {}, lastFetch: 0 };
let channelConfig = { channels: [] }; // list of Twitch usernames
let settingsDir = null;
const CACHE_TTL = 3600000; // 1 hour
const FETCH_TIMEOUT = 10000;
const PKG_NAME = "thelounge-plugin-emotes";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsGet(url, _depth) {
	const depth = _depth || 0;
	if (depth > 3) {
		return Promise.reject(new Error(`Too many redirects for ${url}`));
	}
	return new Promise((resolve, reject) => {
		let parsed;
		try {
			parsed = new URL(url);
		} catch (e) {
			return reject(new Error(`Invalid URL: ${url}`));
		}
		if (parsed.protocol !== "https:") {
			return reject(new Error(`Refusing non-HTTPS URL: ${url}`));
		}

		const req = https.get(url, { timeout: FETCH_TIMEOUT }, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				return httpsGet(res.headers.location, depth + 1).then(resolve, reject);
			}
			if (res.statusCode !== 200) {
				res.resume();
				return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
			}
			const chunks = [];
			let totalBytes = 0;
			const MAX_RESPONSE = 5 * 1024 * 1024;

			res.on("data", (chunk) => {
				totalBytes += chunk.length;
				if (totalBytes > MAX_RESPONSE) {
					req.destroy();
					return reject(new Error(`Response too large for ${url}`));
				}
				chunks.push(chunk);
			});
			res.on("end", () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
				} catch (e) {
					reject(e);
				}
			});
		});
		req.on("error", reject);
		req.on("timeout", () => {
			req.destroy();
			reject(new Error(`Timeout fetching ${url}`));
		});
	});
}

// ---------------------------------------------------------------------------
// Emote validation helpers
// ---------------------------------------------------------------------------

function isValidEmoteUrl(url) {
	if (!url || typeof url !== "string") return false;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:";
	} catch (e) {
		return false;
	}
}

const EMOTE_NAME_RE = /^[\w\-:()!]+$/;
const MAX_EMOTE_NAME = 50;

function isValidEmoteName(name) {
	return (
		typeof name === "string" &&
		name.length > 0 &&
		name.length <= MAX_EMOTE_NAME &&
		EMOTE_NAME_RE.test(name)
	);
}

// ---------------------------------------------------------------------------
// 7TV emote parsing (shared between global and channel)
// ---------------------------------------------------------------------------

function parse7TVEmotes(data) {
	const emotes = {};
	for (const emote of data.emotes || []) {
		const emoteData = emote.data;
		const host = emoteData && emoteData.host;
		if (!host) continue;

		const baseUrl = `https:${host.url}`;
		const hostFiles = host.files || [];

		const pick = (scale) => {
			const f =
				hostFiles.find((x) => x.name === `${scale}.webp`) ||
				hostFiles.find((x) => x.name === `${scale}.gif`) ||
				hostFiles.find((x) => x.name === `${scale}.png`);
			return f ? `${baseUrl}/${f.name}` : null;
		};

		const url1x = pick("1x");
		if (url1x && isValidEmoteName(emote.name) && isValidEmoteUrl(url1x)) {
			const url2x = pick("2x") || url1x;
			emotes[emote.name] = {
				u: url1x,
				u2: isValidEmoteUrl(url2x) ? url2x : url1x,
				p: "7tv",
			};
		}
	}
	return emotes;
}

// ---------------------------------------------------------------------------
// Global emote providers
// ---------------------------------------------------------------------------

async function fetch7TV() {
	const data = await httpsGet("https://7tv.io/v3/emote-sets/global");
	return parse7TVEmotes(data);
}

async function fetchBTTV() {
	const data = await httpsGet("https://api.betterttv.net/3/cached/emotes/global");
	const emotes = {};
	for (const emote of data || []) {
		if (!isValidEmoteName(emote.code)) continue;
		const u1 = `https://cdn.betterttv.net/emote/${encodeURIComponent(emote.id)}/1x`;
		const u2 = `https://cdn.betterttv.net/emote/${encodeURIComponent(emote.id)}/2x`;
		emotes[emote.code] = { u: u1, u2: u2, p: "bttv" };
	}
	return emotes;
}

async function fetchFFZ() {
	const data = await httpsGet("https://api.frankerfacez.com/v1/set/global");
	return parseFFZSets(data.sets);
}

function parseFFZSets(sets) {
	const emotes = {};
	for (const set of Object.values(sets || {})) {
		for (const emote of set.emoticons || []) {
			if (!isValidEmoteName(emote.name)) continue;
			const urls = emote.urls || {};
			const raw1 = urls["1"] || "";
			const raw2 = urls["2"] || "";
			const url1 = raw1.startsWith("https:") ? raw1 : raw1.startsWith("//") ? `https:${raw1}` : null;
			const url2 = raw2 ? (raw2.startsWith("https:") ? raw2 : raw2.startsWith("//") ? `https:${raw2}` : url1) : url1;
			if (url1 && isValidEmoteUrl(url1)) {
				emotes[emote.name] = {
					u: url1,
					u2: isValidEmoteUrl(url2) ? url2 : url1,
					p: "ffz",
				};
			}
		}
	}
	return emotes;
}

// ---------------------------------------------------------------------------
// Channel-specific emote fetching (by Twitch username)
//
// Resolves username → Twitch ID via ivr.fi, then fetches from each provider.
// ---------------------------------------------------------------------------

async function resolveTwitchId(username) {
	const data = await httpsGet(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(username)}`);
	if (!Array.isArray(data) || !data.length || !data[0].id) {
		throw new Error(`Could not resolve Twitch user: ${username}`);
	}
	const id = String(data[0].id);
	// Twitch IDs are always numeric
	if (!/^\d+$/.test(id)) {
		throw new Error(`Invalid Twitch ID received for ${username}: ${id}`);
	}
	return id;
}

async function fetchChannel7TV(twitchId) {
	try {
		const data = await httpsGet(`https://7tv.io/v3/users/twitch/${twitchId}`);
		const emoteSet = data.emote_set;
		if (!emoteSet || !emoteSet.emotes) return {};
		return parse7TVEmotes(emoteSet);
	} catch (e) {
		return {};
	}
}

async function fetchChannelBTTV(twitchId) {
	try {
		const data = await httpsGet(`https://api.betterttv.net/3/cached/users/twitch/${twitchId}`);
		const emotes = {};
		const allEmotes = [].concat(data.channelEmotes || [], data.sharedEmotes || []);
		for (const emote of allEmotes) {
			if (!isValidEmoteName(emote.code)) continue;
			const u1 = `https://cdn.betterttv.net/emote/${encodeURIComponent(emote.id)}/1x`;
			const u2 = `https://cdn.betterttv.net/emote/${encodeURIComponent(emote.id)}/2x`;
			emotes[emote.code] = { u: u1, u2: u2, p: "bttv" };
		}
		return emotes;
	} catch (e) {
		return {};
	}
}

async function fetchChannelFFZ(username) {
	try {
		const data = await httpsGet(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(username)}`);
		return parseFFZSets(data.sets);
	} catch (e) {
		return {};
	}
}

async function fetchChannelEmotes(username) {
	const log = thelounge ? thelounge.Logger : console;
	log.info(`Fetching channel emotes for: ${username}`);

	// Resolve username to Twitch ID
	let twitchId;
	try {
		twitchId = await resolveTwitchId(username);
		log.info(`Resolved ${username} → Twitch ID ${twitchId}`);
	} catch (e) {
		log.warn(`Could not resolve Twitch ID for ${username}: ${e.message}`);
		return {};
	}

	const results = await Promise.allSettled([
		fetchChannel7TV(twitchId),
		fetchChannelBTTV(twitchId),
		fetchChannelFFZ(username), // FFZ uses username directly
	]);

	const merged = {};
	const counts = { "7tv": 0, bttv: 0, ffz: 0 };

	for (const result of results) {
		if (result.status === "fulfilled") {
			for (const [name, emote] of Object.entries(result.value)) {
				if (!merged[name]) {
					merged[name] = emote;
					counts[emote.p]++;
				}
			}
		}
	}

	const total = Object.keys(merged).length;
	log.info(`Channel ${username}: ${total} emotes (7TV: ${counts["7tv"]}, BTTV: ${counts.bttv}, FFZ: ${counts.ffz})`);
	return merged;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

async function refreshEmotes() {
	const log = thelounge ? thelounge.Logger : console;
	log.info("Fetching global emotes from 7TV, BTTV, FFZ...");

	const results = await Promise.allSettled([fetch7TV(), fetchBTTV(), fetchFFZ()]);

	const merged = {};
	const counts = { "7tv": 0, bttv: 0, ffz: 0 };

	for (const result of results) {
		if (result.status === "fulfilled") {
			for (const [name, emote] of Object.entries(result.value)) {
				if (!merged[name]) {
					merged[name] = emote;
					counts[emote.p]++;
				}
			}
		} else {
			log.warn(`Provider fetch failed: ${result.reason.message}`);
		}
	}

	// Fetch channel-specific emotes
	const channels = channelConfig.channels || [];
	for (const username of channels) {
		try {
			const channelEmotes = await fetchChannelEmotes(username);
			for (const [name, emote] of Object.entries(channelEmotes)) {
				if (!merged[name]) {
					merged[name] = emote;
					counts[emote.p]++;
				}
			}
		} catch (e) {
			log.warn(`Channel ${username} fetch failed: ${e.message}`);
		}
	}

	emoteCache = { emotes: merged, lastFetch: Date.now() };
	log.info(
		`Loaded ${Object.keys(merged).length} emotes ` +
		`(7TV: ${counts["7tv"]}, BTTV: ${counts.bttv}, FFZ: ${counts.ffz})` +
		(channels.length ? ` — channels: ${channels.join(", ")}` : "")
	);

	return merged;
}

function writeEmoteData() {
	const jsonPath = path.join(__dirname, "emote-data.json");
	fs.writeFileSync(jsonPath, JSON.stringify(emoteCache.emotes), "utf-8");
	thelounge.Logger.info(
		`Wrote ${Object.keys(emoteCache.emotes).length} emotes to emote-data.json`
	);
}

// ---------------------------------------------------------------------------
// Channel config persistence
// ---------------------------------------------------------------------------

function loadChannelConfig() {
	if (!settingsDir) return;
	const configPath = path.join(settingsDir, "channels.json");
	try {
		if (fs.existsSync(configPath)) {
			channelConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		}
	} catch (e) {
		thelounge.Logger.warn(`Failed to load channel config: ${e.message}`);
	}
}

function saveChannelConfig() {
	if (!settingsDir) return;
	const configPath = path.join(settingsDir, "channels.json");
	try {
		fs.writeFileSync(configPath, JSON.stringify(channelConfig, null, 2), "utf-8");
	} catch (e) {
		thelounge.Logger.warn(`Failed to save channel config: ${e.message}`);
	}
}

// Write channel list as a public JSON for the client to read
function writeChannelList() {
	const publicPath = path.join(__dirname, "emote-channels.json");
	fs.writeFileSync(publicPath, JSON.stringify(channelConfig.channels || []), "utf-8");
}

// ---------------------------------------------------------------------------
// Client script injection
// ---------------------------------------------------------------------------

function injectClientScript() {
	const scriptTag = `<script src="/packages/${PKG_NAME}/client.js" defer></script>`;
	const log = thelounge ? thelounge.Logger : console;
	const emoteCdns = "https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com";

	try {
		const http = require("http");
		const origEnd = http.ServerResponse.prototype.end;
		const origSetHeader = http.ServerResponse.prototype.setHeader;

		http.ServerResponse.prototype.setHeader = function (name, value) {
			if (
				name.toLowerCase() === "content-security-policy" &&
				typeof value === "string" &&
				this.req && this.req.url === "/"
			) {
				value = value.replace(/img-src\s([^;]+)/, "img-src $1 " + emoteCdns);
			}
			return origSetHeader.call(this, name, value);
		};

		http.ServerResponse.prototype.end = function (chunk, encoding, callback) {
			if (
				this.req &&
				this.req.method === "GET" &&
				this.req.url === "/" &&
				(this.getHeader("content-type") || "").includes("text/html")
			) {
				const csp = this.getHeader("content-security-policy");
				if (csp && typeof csp === "string" && !csp.includes("cdn.7tv.app")) {
					origSetHeader.call(
						this, "content-security-policy",
						csp.replace(/img-src\s([^;]+)/, "img-src $1 " + emoteCdns)
					);
				}

				if (typeof encoding === "function") {
					callback = encoding;
					encoding = undefined;
				}

				let body = "";
				if (chunk) {
					body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
				}

				if (body.includes("</body>")) {
					body = body.replace("</body>", scriptTag + "\n\t</body>");
					this.removeHeader("content-length");
					this.setHeader("content-length", Buffer.byteLength(body, "utf8"));
					return origEnd.call(this, body, "utf8", callback);
				}
			}
			return origEnd.call(this, chunk, encoding, callback);
		};

		log.info("Client script injection installed (prototype patch)");
		return true;
	} catch (e) {
		log.warn(`Script injection failed: ${e.message}`);
	}
	return false;
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

// Validate channel name input (alphanumeric, underscores, 1-25 chars)
const CHANNEL_NAME_RE = /^[a-zA-Z0-9_]{1,25}$/;
const MAX_CHANNELS = 10;

module.exports = {
	onServerStart(api) {
		thelounge = api;

		// --- Static assets ---
		thelounge.Stylesheets.addFile("emotes.css");
		thelounge.PublicFiles.add("client.js");
		thelounge.PublicFiles.add("emote-data.json");
		thelounge.PublicFiles.add("emote-channels.json");

		// --- Client script injection ---
		injectClientScript();

		// --- Channel config ---
		settingsDir = thelounge.Config.getPersistentStorageDir();
		loadChannelConfig();

		const channelsJsonPath = path.join(__dirname, "emote-channels.json");
		if (!fs.existsSync(channelsJsonPath)) {
			fs.writeFileSync(channelsJsonPath, "[]", "utf-8");
		}
		writeChannelList();

		// --- Commands ---
		thelounge.Commands.add("emotes", {
			input(client, target, _command, args) {
				const emotes = emoteCache.emotes;
				const count = Object.keys(emotes).length;

				if (args.length === 0) {
					const chList = (channelConfig.channels || []).join(", ") || "none";
					client.sendMessage(
						`Emotes: ${count} loaded (7TV, BTTV, FFZ). ` +
						`Channels: ${chList}. ` +
						`Commands: /emotes search <term> | refresh | channel add/remove <name> | channels`,
						target.chan
					);
				} else if (args[0] === "search" && args[1]) {
					const term = args.slice(1).join(" ").toLowerCase();
					const matches = Object.keys(emotes)
						.filter((n) => n.toLowerCase().includes(term))
						.slice(0, 25);
					client.sendMessage(
						matches.length
							? `Found ${matches.length}: ${matches.join(", ")}`
							: `No emotes matching "${term}"`,
						target.chan
					);
				} else if (args[0] === "refresh") {
					refreshEmotes()
						.then((e) => {
							writeEmoteData();
							client.sendMessage(`Refreshed: ${Object.keys(e).length} emotes loaded.`, target.chan);
						})
						.catch((err) => client.sendMessage(`Refresh failed: ${err.message}`, target.chan));
				} else if (args[0] === "channel" && args[1] === "add" && args[2]) {
					const name = args[2].toLowerCase();
					if (!CHANNEL_NAME_RE.test(name)) {
						client.sendMessage(`Invalid channel name: ${args[2]}`, target.chan);
						return;
					}
					if (!channelConfig.channels) channelConfig.channels = [];
					if (channelConfig.channels.length >= MAX_CHANNELS) {
						client.sendMessage(`Maximum ${MAX_CHANNELS} channels allowed. Remove one first.`, target.chan);
						return;
					}
					if (channelConfig.channels.includes(name)) {
						client.sendMessage(`Channel "${name}" already added.`, target.chan);
						return;
					}
					channelConfig.channels.push(name);
					saveChannelConfig();
					writeChannelList();
					client.sendMessage(`Adding channel "${name}" — fetching emotes...`, target.chan);
					refreshEmotes()
						.then((e) => {
							writeEmoteData();
							client.sendMessage(`Done! ${Object.keys(e).length} total emotes loaded.`, target.chan);
						})
						.catch((err) => client.sendMessage(`Fetch failed: ${err.message}`, target.chan));
				} else if (args[0] === "channel" && args[1] === "remove" && args[2]) {
					const name = args[2].toLowerCase();
					if (!channelConfig.channels || !channelConfig.channels.includes(name)) {
						client.sendMessage(`Channel "${name}" not found.`, target.chan);
						return;
					}
					channelConfig.channels = channelConfig.channels.filter((c) => c !== name);
					saveChannelConfig();
					writeChannelList();
					client.sendMessage(`Removed channel "${name}" — refreshing emotes...`, target.chan);
					refreshEmotes()
						.then((e) => {
							writeEmoteData();
							client.sendMessage(`Done! ${Object.keys(e).length} total emotes loaded.`, target.chan);
						})
						.catch((err) => client.sendMessage(`Refresh failed: ${err.message}`, target.chan));
				} else if (args[0] === "channels") {
					const chList = (channelConfig.channels || []).join(", ") || "none";
					client.sendMessage(`Channel emote sources: ${chList}`, target.chan);
				} else {
					client.sendMessage(
						"Usage: /emotes | /emotes search <term> | /emotes refresh | " +
						"/emotes channel add <name> | /emotes channel remove <name> | /emotes channels",
						target.chan
					);
				}
			},
			allowDisconnected: true,
		});

		// --- Bootstrap ---
		const jsonPath = path.join(__dirname, "emote-data.json");
		if (!fs.existsSync(jsonPath)) {
			fs.writeFileSync(jsonPath, "{}", "utf-8");
		}

		refreshEmotes()
			.then(() => writeEmoteData())
			.catch((err) => {
				thelounge.Logger.warn(`Initial emote fetch failed: ${err.message}`);
			});

		setInterval(() => {
			refreshEmotes()
				.then(() => writeEmoteData())
				.catch(() => {});
		}, CACHE_TTL);
	},
};
