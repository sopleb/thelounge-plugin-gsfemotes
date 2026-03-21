/**
 * thelounge-plugin-emotes — Client-side emote renderer
 *
 * Watches for new IRC messages in The Lounge and replaces known emote codes
 * (7TV, BTTV, FFZ) with inline <img> elements.
 *
 * This script is served at /packages/thelounge-plugin-emotes/client.js
 * and must be loaded client-side. See README for loading instructions.
 */
(function () {
	"use strict";

	if (window.__TL_EMOTES_LOADED) return;
	window.__TL_EMOTES_LOADED = true;

	const DATA_URL = "/packages/thelounge-plugin-emotes/emote-data.json";
	const REFRESH_INTERVAL = 3600000; // 1 hour
	const PROCESSED_ATTR = "data-emotes-processed";

	let emoteMap = {};
	let emoteNames = [];
	let emoteRegex = null;

	// -------------------------------------------------------------------
	// Fetch emote data from the server
	// -------------------------------------------------------------------

	async function loadEmotes() {
		try {
			const res = await fetch(DATA_URL);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			emoteMap = await res.json();
			emoteNames = Object.keys(emoteMap).sort(
				(a, b) => b.length - a.length
			);

			if (emoteNames.length === 0) return;

			// Build regex — match emote names as whole words
			const escaped = emoteNames.map((n) =>
				n.replace(/[.*+?^${}()|[\]\\]/g, (ch) => "\\" + ch)
			);
			emoteRegex = new RegExp(
				`(?<=^|\\s)(${escaped.join("|")})(?=\\s|$)`, "g"
			);

			console.log(
				`[Emotes] Loaded ${emoteNames.length} emotes`
			);
		} catch (err) {
			console.warn("[Emotes] Failed to load emote data:", err.message);
		}
	}

	// -------------------------------------------------------------------
	// Create an emote <img> element
	// -------------------------------------------------------------------

	function createEmoteImg(name) {
		const emote = emoteMap[name];
		if (!emote) return null;

		const img = document.createElement("img");
		img.className = "tl-emote";
		img.src = emote.u;
		img.srcset = `${emote.u} 1x, ${emote.u2} 2x`;
		img.alt = name;
		img.title = `${name} (${emote.p.toUpperCase()})`;
		img.loading = "lazy";
		img.setAttribute("aria-label", `${name} emote`);
		return img;
	}

	// -------------------------------------------------------------------
	// Process a single text node — split on emote matches, replace with
	// a mix of text nodes and <img> elements
	// -------------------------------------------------------------------

	function processTextNode(textNode) {
		if (!emoteRegex || !textNode.textContent) return;

		const text = textNode.textContent;
		emoteRegex.lastIndex = 0;

		// Quick check — any match at all?
		if (!emoteRegex.test(text)) return;
		emoteRegex.lastIndex = 0;

		const frag = document.createDocumentFragment();
		let lastIndex = 0;
		let match;

		while ((match = emoteRegex.exec(text)) !== null) {
			const emoteName = match[1];
			const matchStart = match.index;

			// Text before the match (including the leading whitespace captured by lookbehind)
			if (matchStart > lastIndex) {
				frag.appendChild(
					document.createTextNode(text.slice(lastIndex, matchStart))
				);
			}

			const img = createEmoteImg(emoteName);
			if (img) {
				frag.appendChild(img);
			} else {
				frag.appendChild(document.createTextNode(emoteName));
			}

			lastIndex = emoteRegex.lastIndex;
		}

		// Remaining text after last match
		if (lastIndex < text.length) {
			frag.appendChild(document.createTextNode(text.slice(lastIndex)));
		}

		// Only replace if we actually created emote images
		if (frag.querySelector(".tl-emote")) {
			textNode.parentNode.replaceChild(frag, textNode);
		}
	}

	// -------------------------------------------------------------------
	// Process a message element — walk its .content text nodes
	// -------------------------------------------------------------------

	function processMessage(msgEl) {
		if (msgEl.getAttribute(PROCESSED_ATTR)) return;
		msgEl.setAttribute(PROCESSED_ATTR, "1");

		const content = msgEl.querySelector(".content");
		if (!content) return;

		// Collect text nodes (skip nodes inside links, code, and already-processed emotes)
		const walker = document.createTreeWalker(
			content,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode(node) {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					if (parent.closest("a, code, pre, .tl-emote")) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_ACCEPT;
				},
			}
		);

		const textNodes = [];
		while (walker.nextNode()) {
			textNodes.push(walker.currentNode);
		}

		for (const node of textNodes) {
			processTextNode(node);
		}
	}

	// -------------------------------------------------------------------
	// Process all existing messages on the page
	// -------------------------------------------------------------------

	function processAllMessages() {
		document
			.querySelectorAll(`.msg:not([${PROCESSED_ATTR}])`)
			.forEach(processMessage);
	}

	// -------------------------------------------------------------------
	// MutationObserver — watch for new messages added to the DOM
	// -------------------------------------------------------------------

	function startObserver() {
		const chat = document.getElementById("chat");
		if (!chat) {
			// The Lounge hasn't rendered yet — retry
			setTimeout(startObserver, 500);
			return;
		}

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType !== Node.ELEMENT_NODE) continue;

					// Direct .msg element added
					if (node.classList?.contains("msg")) {
						processMessage(node);
					}

					// Container with .msg children (e.g. channel switch loads history)
					const msgs = node.querySelectorAll?.(
						`.msg:not([${PROCESSED_ATTR}])`
					);
					if (msgs) {
						msgs.forEach(processMessage);
					}
				}
			}
		});

		observer.observe(chat, { childList: true, subtree: true });
		console.log("[Emotes] Observer active");
	}

	// -------------------------------------------------------------------
	// Tooltip on hover (shows emote name + provider)
	// -------------------------------------------------------------------

	function setupTooltip() {
		const tooltip = document.createElement("div");
		tooltip.className = "tl-emote-tooltip";
		tooltip.style.display = "none";
		document.body.appendChild(tooltip);

		document.addEventListener("mouseover", (e) => {
			const img = e.target.closest?.(".tl-emote");
			if (!img) return;

			const name = img.alt;
			const emote = emoteMap[name];
			if (!emote) return;

			tooltip.textContent = `${name} — ${emote.p.toUpperCase()}`;
			tooltip.style.display = "block";

			const rect = img.getBoundingClientRect();
			tooltip.style.left = `${rect.left + rect.width / 2}px`;
			tooltip.style.top = `${rect.top - 6}px`;
		});

		document.addEventListener("mouseout", (e) => {
			if (e.target.closest?.(".tl-emote")) {
				tooltip.style.display = "none";
			}
		});
	}

	// -------------------------------------------------------------------
	// Init
	// -------------------------------------------------------------------

	async function init() {
		await loadEmotes();
		if (emoteNames.length === 0) {
			console.warn("[Emotes] No emotes loaded, retrying in 10s...");
			setTimeout(init, 10000);
			return;
		}

		setupTooltip();
		processAllMessages();
		startObserver();

		// Periodic refresh
		setInterval(async () => {
			await loadEmotes();
			// Re-process visible messages after refresh (clear processed flags)
			document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => {
				el.removeAttribute(PROCESSED_ATTR);
			});
			processAllMessages();
		}, REFRESH_INTERVAL);
	}

	// Wait for DOM ready
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
