/**
 * thelounge-plugin-emotes — Client-side emote renderer
 *
 * Watches for new IRC messages in The Lounge and replaces known emote codes
 * (7TV, BTTV, FFZ) with inline <img> elements.
 *
 * Served at /packages/thelounge-plugin-emotes/client.js
 * Loaded via server-side script injection (see index.js).
 */
(function () {
	"use strict";

	if (window.__TL_EMOTES_LOADED) return;
	window.__TL_EMOTES_LOADED = true;

	const DATA_URL = "/packages/thelounge-plugin-gsfemotes/emote-data.json";
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
			if (!res.ok) throw new Error("HTTP " + res.status);
			emoteMap = await res.json();
			emoteNames = Object.keys(emoteMap).sort(
				(a, b) => b.length - a.length
			);

			if (emoteNames.length === 0) return;

			// Build regex — match emote names as whole words.
			// Uses word-boundary approach instead of lookbehind for
			// broader browser compatibility.
			const escaped = emoteNames.map((n) =>
				n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			);
			emoteRegex = new RegExp(
				"(?:^|(?<=\\s))(" + escaped.join("|") + ")(?=\\s|$)", "g"
			);

			console.log("[Emotes] Loaded " + emoteNames.length + " emotes");
		} catch (err) {
			console.warn("[Emotes] Failed to load emote data:", err.message);
		}
	}

	// -------------------------------------------------------------------
	// Create an emote <img> element
	// -------------------------------------------------------------------

	function createEmoteImg(name) {
		var emote = emoteMap[name];
		if (!emote) return null;

		// Validate URLs are HTTPS before setting as img src
		if (!emote.u || !emote.u.startsWith("https://")) return null;
		var u2 = (emote.u2 && emote.u2.startsWith("https://")) ? emote.u2 : emote.u;

		var img = document.createElement("img");
		img.className = "tl-emote";
		img.src = u2;
		img.srcset = emote.u + " 1x, " + u2 + " 2x";
		img.alt = name;
		img.title = name + " (" + emote.p.toUpperCase() + ")";
		img.loading = "lazy";
		img.setAttribute("aria-label", name + " emote");

		return img;
	}

	// -------------------------------------------------------------------
	// Process a single text node — split on emote matches, replace with
	// a mix of text nodes and <img> elements
	// -------------------------------------------------------------------

	function processTextNode(textNode) {
		if (!emoteRegex || !textNode.textContent) return;

		var text = textNode.textContent;
		emoteRegex.lastIndex = 0;

		// Quick check — any match at all?
		if (!emoteRegex.test(text)) return;
		emoteRegex.lastIndex = 0;

		var frag = document.createDocumentFragment();
		var lastIndex = 0;
		var match;

		while ((match = emoteRegex.exec(text)) !== null) {
			var emoteName = match[1];
			var matchStart = match.index;

			// Text before the match
			if (matchStart > lastIndex) {
				frag.appendChild(
					document.createTextNode(text.slice(lastIndex, matchStart))
				);
			}

			var img = createEmoteImg(emoteName);
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

		var content = msgEl.querySelector(".content");
		if (!content) return;

		// Collect text nodes (skip nodes inside links, code, pre, emotes)
		var walker = document.createTreeWalker(
			content,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: function (node) {
					var parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					if (parent.closest("a, code, pre, .tl-emote")) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_ACCEPT;
				},
			}
		);

		var textNodes = [];
		while (walker.nextNode()) {
			textNodes.push(walker.currentNode);
		}

		for (var i = 0; i < textNodes.length; i++) {
			processTextNode(textNodes[i]);
		}

		// Detect emote-only messages (up to 3 emotes, no other content)
		var emotes = content.querySelectorAll(".tl-emote");
		if (emotes.length > 0 && emotes.length <= 3) {
			var hasText = false;
			var checkWalker = document.createTreeWalker(
				content, NodeFilter.SHOW_TEXT
			);
			while (checkWalker.nextNode()) {
				if (checkWalker.currentNode.textContent.trim()) {
					hasText = true;
					break;
				}
			}
			// No other elements besides emotes and whitespace text nodes
			if (!hasText && !content.querySelector("a, code, pre, img:not(.tl-emote)")) {
				content.classList.add("emote-only");
			}
		}
	}

	// -------------------------------------------------------------------
	// Process all existing messages on the page
	// -------------------------------------------------------------------

	function processAllMessages() {
		var msgs = document.querySelectorAll(".msg:not([" + PROCESSED_ATTR + "])");
		for (var i = 0; i < msgs.length; i++) {
			processMessage(msgs[i]);
		}
	}

	// -------------------------------------------------------------------
	// MutationObserver — watch for new messages added to the DOM
	// -------------------------------------------------------------------

	function startObserver() {
		var chat = document.getElementById("chat");
		if (!chat) {
			setTimeout(startObserver, 500);
			return;
		}

		var observer = new MutationObserver(function (mutations) {
			for (var m = 0; m < mutations.length; m++) {
				var added = mutations[m].addedNodes;
				for (var n = 0; n < added.length; n++) {
					var node = added[n];
					if (node.nodeType !== Node.ELEMENT_NODE) continue;

					if (node.classList && node.classList.contains("msg")) {
						processMessage(node);
					}

					var msgs = node.querySelectorAll
						? node.querySelectorAll(".msg:not([" + PROCESSED_ATTR + "])")
						: [];
					for (var i = 0; i < msgs.length; i++) {
						processMessage(msgs[i]);
					}
				}
			}
		});

		observer.observe(chat, { childList: true, subtree: true });
		console.log("[Emotes] Observer active");
	}

	// -------------------------------------------------------------------
	// Tooltip on hover
	// -------------------------------------------------------------------

	function setupTooltip() {
		var tooltip = document.createElement("div");
		tooltip.className = "tl-emote-tooltip";
		tooltip.style.display = "none";
		document.body.appendChild(tooltip);

		document.addEventListener("mouseover", function (e) {
			var img = e.target.closest ? e.target.closest(".tl-emote") : null;
			if (!img) return;

			var name = img.alt;
			var emote = emoteMap[name];
			if (!emote) return;

			tooltip.textContent = name + " — " + emote.p.toUpperCase();
			tooltip.style.display = "block";

			var rect = img.getBoundingClientRect();
			tooltip.style.left = (rect.left + rect.width / 2) + "px";
			tooltip.style.top = (rect.top - 6) + "px";
		});

		document.addEventListener("mouseout", function (e) {
			if (e.target.closest && e.target.closest(".tl-emote")) {
				tooltip.style.display = "none";
			}
		});
	}

	// -------------------------------------------------------------------
	// Emote picker — button in chat bar + popup grid
	// -------------------------------------------------------------------

	function setupEmotePicker() {
		var form = document.getElementById("form");
		var input = document.getElementById("input");
		if (!form || !input) {
			// Form not in DOM yet (Vue SPA) — retry until it appears
			setTimeout(setupEmotePicker, 500);
			return;
		}
		// Already injected?
		if (document.getElementById("emote-picker-btn")) return;

		// Create picker button
		var btnWrap = document.createElement("span");
		btnWrap.id = "emote-picker-tooltip";
		btnWrap.className = "tooltipped tooltipped-w tooltipped-no-touch";
		btnWrap.setAttribute("aria-label", "Emote picker");

		var btn = document.createElement("button");
		btn.id = "emote-picker-btn";
		btn.type = "button";
		btn.setAttribute("aria-label", "Emote picker");
		btn.textContent = "\u263A";
		btnWrap.appendChild(btn);

		// Insert before the submit button
		var submitTooltip = document.getElementById("submit-tooltip");
		if (submitTooltip) {
			form.insertBefore(btnWrap, submitTooltip);
		} else {
			form.appendChild(btnWrap);
		}

		// Create picker panel
		var panel = document.createElement("div");
		panel.id = "emote-picker-panel";
		panel.style.display = "none";

		var search = document.createElement("input");
		search.type = "text";
		search.id = "emote-picker-search";
		search.placeholder = "Search emotes...";
		search.setAttribute("aria-label", "Search emotes");
		panel.appendChild(search);

		// Tab bar for providers
		var tabBar = document.createElement("div");
		tabBar.className = "emote-picker-tabs";
		var tabs = ["All", "GSF", "7TV", "BTTV", "FFZ"];
		var tabMap = { "All": null, "GSF": "gsf", "7TV": "7tv", "BTTV": "bttv", "FFZ": "ffz" };
		var activeTab = null;

		tabs.forEach(function (label) {
			var tab = document.createElement("button");
			tab.type = "button";
			tab.className = "emote-picker-tab" + (label === "All" ? " active" : "");
			tab.textContent = label;
			tab.setAttribute("data-provider", tabMap[label] || "");
			tab.addEventListener("click", function () {
				activeTab = tabMap[label];
				tabBar.querySelectorAll(".emote-picker-tab").forEach(function (t) {
					t.classList.remove("active");
				});
				tab.classList.add("active");
				renderGrid();
			});
			tabBar.appendChild(tab);
		});
		panel.appendChild(tabBar);

		var grid = document.createElement("div");
		grid.id = "emote-picker-grid";
		panel.appendChild(grid);

		document.body.appendChild(panel);

		function renderGrid() {
			var term = search.value.toLowerCase();
			grid.innerHTML = "";

			var names = emoteNames.filter(function (n) {
				if (term && n.toLowerCase().indexOf(term) === -1) return false;
				if (activeTab && emoteMap[n].p !== activeTab) return false;
				return true;
			});

			// Cap at 200 to keep it snappy
			names.slice(0, 200).forEach(function (name) {
				var emote = emoteMap[name];
				if (!emote || !emote.u || !emote.u.startsWith("https://")) return;
				var u2 = (emote.u2 && emote.u2.startsWith("https://")) ? emote.u2 : emote.u;

				var cell = document.createElement("button");
				cell.type = "button";
				cell.className = "emote-picker-cell";
				cell.title = name + " (" + emote.p.toUpperCase() + ")";

				var img = document.createElement("img");
				img.src = u2;
				img.alt = name;
				img.loading = "lazy";
				cell.appendChild(img);

				cell.addEventListener("click", function () {
					insertEmote(name);
				});

				grid.appendChild(cell);
			});

			if (names.length === 0) {
				var empty = document.createElement("div");
				empty.className = "emote-picker-empty";
				empty.textContent = "No emotes found";
				grid.appendChild(empty);
			}
		}

		function insertEmote(name) {
			if (!input) return;
			var val = input.value;
			var start = input.selectionStart || val.length;
			var before = val.slice(0, start);
			var after = val.slice(start);

			// Add space before if needed
			if (before.length > 0 && before[before.length - 1] !== " ") {
				before += " ";
			}

			input.value = before + name + " " + after;
			input.focus();

			// Trigger input event so The Lounge picks up the change
			input.dispatchEvent(new Event("input", { bubbles: true }));

			var pos = before.length + name.length + 1;
			input.setSelectionRange(pos, pos);
		}

		// Toggle panel
		var isOpen = false;

		btn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			isOpen = !isOpen;

			if (isOpen) {
				// Position panel above the button
				var rect = btnWrap.getBoundingClientRect();
				panel.style.bottom = (window.innerHeight - rect.top + 4) + "px";
				panel.style.right = (window.innerWidth - rect.right) + "px";
				panel.style.display = "flex";
				renderGrid();
				search.value = "";
				search.focus();
			} else {
				panel.style.display = "none";
			}
		});

		// Close on outside click
		document.addEventListener("click", function (e) {
			if (isOpen && !panel.contains(e.target) && !btnWrap.contains(e.target)) {
				isOpen = false;
				panel.style.display = "none";
			}
		});

		// Live search
		search.addEventListener("input", renderGrid);

		// Close on Escape
		panel.addEventListener("keydown", function (e) {
			if (e.key === "Escape") {
				isOpen = false;
				panel.style.display = "none";
				input.focus();
			}
		});

		// --- Settings view inside picker ---
		var settingsView = document.createElement("div");
		settingsView.id = "emote-picker-settings";
		settingsView.style.display = "none";
		panel.appendChild(settingsView);

		// Header bar with gear toggle
		var header = document.createElement("div");
		header.className = "emote-picker-header";

		var headerTitle = document.createElement("span");
		headerTitle.className = "emote-picker-title";
		headerTitle.textContent = "Emotes";
		header.appendChild(headerTitle);

		var gearBtn = document.createElement("button");
		gearBtn.type = "button";
		gearBtn.className = "emote-picker-gear";
		gearBtn.textContent = "\u2699";
		gearBtn.title = "Emote Settings";
		gearBtn.setAttribute("aria-label", "Emote settings");
		header.appendChild(gearBtn);

		// Insert header at the top of the panel (before search)
		panel.insertBefore(header, search);

		var showingSettings = false;

		gearBtn.addEventListener("click", function () {
			showingSettings = !showingSettings;
			if (showingSettings) {
				headerTitle.textContent = "Settings";
				search.style.display = "none";
				tabBar.style.display = "none";
				grid.style.display = "none";
				settingsView.style.display = "block";
				renderSettings();
			} else {
				headerTitle.textContent = "Emotes";
				search.style.display = "";
				tabBar.style.display = "";
				grid.style.display = "";
				settingsView.style.display = "none";
			}
		});

		var channelList = [];
		var CHANNELS_URL = "/packages/thelounge-plugin-gsfemotes/emote-channels.json";

		function loadChannelList() {
			return fetch(CHANNELS_URL)
				.then(function (r) { return r.json(); })
				.then(function (data) { channelList = data || []; })
				.catch(function () {});
		}

		function renderSettingsStatus(msg) {
			var status = settingsView.querySelector(".emote-settings-status");
			if (status) {
				status.textContent = msg;
				setTimeout(function () { status.textContent = ""; }, 3000);
			}
		}

		// Send /emotes command via The Lounge's input
		function sendEmotesCommand(cmd) {
			var chatInput = document.getElementById("input");
			if (!chatInput) return;
			chatInput.value = "/emotes " + cmd;
			chatInput.dispatchEvent(new Event("input", { bubbles: true }));
			// Submit the form
			var form = document.getElementById("form");
			if (form) {
				form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			}
		}

		function renderSettings() {
			loadChannelList().then(function () {
				settingsView.innerHTML = "";

				// --- Channel Emotes Section ---
				var chSection = document.createElement("div");
				chSection.className = "emote-settings-section";

				var chTitle = document.createElement("h3");
				chTitle.textContent = "Channel Emotes";
				chSection.appendChild(chTitle);

				var chDesc = document.createElement("p");
				chDesc.className = "emote-settings-desc";
				chDesc.textContent = "Add a Twitch channel name to load their 7TV, BTTV, and FFZ emotes automatically.";
				chSection.appendChild(chDesc);

				// Existing channels
				var chListEl = document.createElement("div");
				chListEl.className = "emote-settings-channels";

				function renderChannels() {
					chListEl.innerHTML = "";
					if (channelList.length === 0) {
						var empty = document.createElement("div");
						empty.className = "emote-settings-desc";
						empty.textContent = "No channels added yet.";
						chListEl.appendChild(empty);
						return;
					}
					channelList.forEach(function (chName) {
						var row = document.createElement("div");
						row.className = "emote-settings-channel-row";

						var label = document.createElement("span");
						label.className = "emote-settings-channel-name";
						label.textContent = chName;
						row.appendChild(label);

						var removeBtn = document.createElement("button");
						removeBtn.type = "button";
						removeBtn.className = "emote-settings-remove";
						removeBtn.textContent = "\u00D7";
						removeBtn.title = "Remove channel";
						removeBtn.addEventListener("click", function () {
							sendEmotesCommand("channel remove " + chName);
							channelList = channelList.filter(function (c) { return c !== chName; });
							renderChannels();
							renderSettingsStatus("Removing " + chName + "...");
						});
						row.appendChild(removeBtn);

						chListEl.appendChild(row);
					});
				}
				renderChannels();
				chSection.appendChild(chListEl);

				// Add channel form
				var addForm = document.createElement("div");
				addForm.className = "emote-settings-add";

				var chInput = document.createElement("input");
				chInput.type = "text";
				chInput.placeholder = "Twitch channel name (e.g. xqc)";
				chInput.className = "emote-settings-input";
				addForm.appendChild(chInput);

				var addBtn = document.createElement("button");
				addBtn.type = "button";
				addBtn.className = "emote-settings-btn";
				addBtn.textContent = "Add Channel";
				addBtn.addEventListener("click", function () {
					var name = chInput.value.trim().toLowerCase();
					if (!name || !/^[a-zA-Z0-9_]{1,25}$/.test(name)) {
						renderSettingsStatus("Invalid channel name");
						return;
					}
					if (channelList.indexOf(name) !== -1) {
						renderSettingsStatus("Channel already added");
						return;
					}
					sendEmotesCommand("channel add " + name);
					channelList.push(name);
					chInput.value = "";
					renderChannels();
					renderSettingsStatus("Adding " + name + " — fetching emotes...");
					// Reload emote data after server finishes fetching
					setTimeout(function () {
						loadEmotes().then(function () {
							renderSettingsStatus(name + " added — " + emoteNames.length + " emotes total");
							if (!showingSettings) renderGrid();
						});
					}, 5000);
				});
				addForm.appendChild(addBtn);
				chSection.appendChild(addForm);

				settingsView.appendChild(chSection);

				// Status message
				var status = document.createElement("div");
				status.className = "emote-settings-status";
				settingsView.appendChild(status);
			});
		}

		console.log("[Emotes] Emote picker ready");
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
		setupEmotePicker();
		processAllMessages();
		startObserver();

		// Periodic refresh
		setInterval(async function () {
			await loadEmotes();
			// Clear processed flags and re-process
			var processed = document.querySelectorAll("[" + PROCESSED_ATTR + "]");
			for (var i = 0; i < processed.length; i++) {
				processed[i].removeAttribute(PROCESSED_ATTR);
			}
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
