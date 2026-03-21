"use strict";

const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

let thelounge = null;
let emoteCache = { emotes: {}, lastFetch: 0 };
const CACHE_TTL = 3600000; // 1 hour
const FETCH_TIMEOUT = 10000;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsGet(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { timeout: FETCH_TIMEOUT }, (res) => {
			if (res.statusCode !== 200) {
				res.resume();
				return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
			}
			let data = "";
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
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
// Emote providers
// ---------------------------------------------------------------------------

async function fetch7TV() {
	const data = await httpsGet("https://7tv.io/v3/emote-sets/global");
	const emotes = {};

	for (const emote of data.emotes || []) {
		const host = emote.data?.host;
		if (!host) continue;

		const baseUrl = `https:${host.url}`;
		const files = host.files || [];

		const pick = (scale) => {
			const f =
				files.find((x) => x.name === `${scale}.webp`) ||
				files.find((x) => x.name === `${scale}.gif`) ||
				files.find((x) => x.name === `${scale}.png`);
			return f ? `${baseUrl}/${f.name}` : null;
		};

		const url1x = pick("1x");
		if (url1x) {
			emotes[emote.name] = {
				u: url1x,
				u2: pick("2x") || url1x,
				p: "7tv",
			};
		}
	}

	return emotes;
}

async function fetchBTTV() {
	const data = await httpsGet(
		"https://api.betterttv.net/3/cached/emotes/global"
	);
	const emotes = {};

	for (const emote of data || []) {
		emotes[emote.code] = {
			u: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
			u2: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
			p: "bttv",
		};
	}

	return emotes;
}

async function fetchFFZ() {
	const data = await httpsGet(
		"https://api.frankerfacez.com/v1/set/global"
	);
	const emotes = {};

	for (const set of Object.values(data.sets || {})) {
		for (const emote of set.emoticons || []) {
			const urls = emote.urls || {};
			const url1 = urls["1"] ? `https:${urls["1"]}` : null;
			const url2 = urls["2"] ? `https:${urls["2"]}` : url1;
			if (url1) {
				emotes[emote.name] = { u: url1, u2: url2, p: "ffz" };
			}
		}
	}

	return emotes;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

async function refreshEmotes() {
	const log = thelounge ? thelounge.Logger : console;
	log.info("Fetching emotes from 7TV, BTTV, FFZ...");

	const results = await Promise.allSettled([
		fetch7TV(),
		fetchBTTV(),
		fetchFFZ(),
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
		} else {
			log.warn(`Provider fetch failed: ${result.reason.message}`);
		}
	}

	emoteCache = { emotes: merged, lastFetch: Date.now() };
	log.info(
		`Loaded ${Object.keys(merged).length} emotes ` +
			`(7TV: ${counts["7tv"]}, BTTV: ${counts.bttv}, FFZ: ${counts.ffz})`
	);

	return merged;
}

// ---------------------------------------------------------------------------
// Write emote data JSON to the package directory so PublicFiles can serve it.
// PublicFiles.add() registers files relative to __dirname — writing here
// means the Express static route at /packages/<name>/ will serve the file.
// ---------------------------------------------------------------------------

function writeEmoteData() {
	const jsonPath = path.join(__dirname, "emote-data.json");

	fs.writeFileSync(
		jsonPath,
		JSON.stringify(emoteCache.emotes),
		"utf-8"
	);
	thelounge.Logger.info(
		`Wrote ${Object.keys(emoteCache.emotes).length} emotes to emote-data.json`
	);
}

// ---------------------------------------------------------------------------
// Script injection — The Lounge's plugin API only supports CSS injection via
// Stylesheets.addFile(). To load client.js we intercept the HTTP server's
// request handler and inject a <script> tag into the HTML response.
// ---------------------------------------------------------------------------

function injectClientScript(packageName) {
	const scriptTag = `<script src="/packages/${packageName}/client.js" defer></script>`;
	const log = thelounge ? thelounge.Logger : console;

	try {
		const handles = process._getActiveHandles();

		for (const handle of handles) {
			if (!(handle instanceof http.Server)) continue;

			const listeners = handle.listeners("request");
			if (listeners.length === 0) continue;

			const originalHandler = listeners[0];

			handle.removeAllListeners("request");
			handle.on("request", (req, res) => {
				// Only intercept the root HTML page
				if (req.url === "/" && (req.headers.accept || "").includes("text/html")) {
					const origEnd = res.end;

					res.end = function (chunk, encoding, callback) {
						// res.send() calls res.end() with the body
						if (chunk && typeof chunk === "string" && chunk.includes("</body>")) {
							// Remove stale content-length since we're modifying the body
							res.removeHeader("content-length");
							chunk = chunk.replace("</body>", scriptTag + "\n\t</body>");
						} else if (Buffer.isBuffer(chunk)) {
							const str = chunk.toString("utf8");
							if (str.includes("</body>")) {
								res.removeHeader("content-length");
								chunk = str.replace("</body>", scriptTag + "\n\t</body>");
								encoding = "utf8";
							}
						}

						return origEnd.call(res, chunk, encoding, callback);
					};
				}

				originalHandler(req, res);
			});

			log.info("Client script injection installed");
			return true;
		}
	} catch (e) {
		log.warn(`Script injection failed: ${e.message}`);
	}

	log.warn("Could not find HTTP server — client.js must be loaded manually");
	return false;
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

module.exports = {
	onServerStart(api) {
		thelounge = api;

		// Serve CSS — auto-injected as <link> in the HTML template
		thelounge.Stylesheets.addFile("emotes.css");

		// Serve client script and emote data as downloadable public files
		// Accessible at /packages/thelounge-plugin-emotes/<filename>
		thelounge.PublicFiles.add("client.js");
		thelounge.PublicFiles.add("emote-data.json");

		// Inject <script> tag into the HTML page
		// Delay slightly — onServerStart fires synchronously during loadPackages(),
		// but the HTTP server is already listening at this point
		setTimeout(() => injectClientScript("thelounge-plugin-emotes"), 100);

		// Register /emotes command
		thelounge.Commands.add("emotes", {
			input(client, target, _command, args) {
				const emotes = emoteCache.emotes;
				const count = Object.keys(emotes).length;

				if (args.length === 0) {
					client.sendMessage(
						`Emotes plugin: ${count} emotes loaded from 7TV, BTTV, FFZ. ` +
							`Use /emotes search <term> to find emotes, ` +
							`or /emotes refresh to reload.`,
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
							client.sendMessage(
								`Refreshed: ${Object.keys(e).length} emotes loaded.`,
								target.chan
							);
						})
						.catch((err) =>
							client.sendMessage(
								`Refresh failed: ${err.message}`,
								target.chan
							)
						);
				} else {
					client.sendMessage(
						"Usage: /emotes | /emotes search <term> | /emotes refresh",
						target.chan
					);
				}
			},
			allowDisconnected: true,
		});

		// Write an empty emote-data.json so PublicFiles.add() doesn't fail
		// if the file doesn't exist yet at startup
		if (!fs.existsSync(path.join(__dirname, "emote-data.json"))) {
			fs.writeFileSync(
				path.join(__dirname, "emote-data.json"),
				"{}",
				"utf-8"
			);
		}

		// Initial fetch
		refreshEmotes()
			.then(() => writeEmoteData())
			.catch((err) => {
				thelounge.Logger.warn(`Initial emote fetch failed: ${err.message}`);
			});

		// Periodic refresh
		setInterval(() => {
			refreshEmotes()
				.then(() => writeEmoteData())
				.catch(() => {});
		}, CACHE_TTL);
	},
};
