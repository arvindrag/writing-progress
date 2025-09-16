'use strict';

var obsidian = require('obsidian');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const DEFAULT_SETTINGS = {
    folderPath: "Novel/Chapters",
    startDateISO: "2025-01-01",
    includeExtensions: "md,txt",
    decimals: 1,
    refreshMs: 30000,
    showWordCount: false,
    badgePrefix: "⚡",
    badgeSuffix: " w/d"
};
class FolderWordRatePlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadSettings();
            this.addSettingTab(new FolderWordRateSettingTab(this.app, this));
            // Recompute on layout ready + periodically
            this.app.workspace.onLayoutReady(() => {
                this.safeComputeAndRender();
                this.attachVaultListeners();
            });
            // Manual command
            this.addCommand({
                id: "recompute-folder-word-rate",
                name: "Recompute folder word rate",
                callback: () => this.safeComputeAndRender()
            });
        });
    }
    onunload() {
        this.detachAllBadges();
    }
    attachVaultListeners() {
        // Recompute for any file changes that might affect the folder
        const retrigger = () => this.safeComputeAndRender();
        this.registerEvent(this.app.vault.on("create", retrigger));
        this.registerEvent(this.app.vault.on("modify", retrigger));
        this.registerEvent(this.app.vault.on("delete", retrigger));
        this.registerEvent(this.app.vault.on("rename", retrigger));
        // Also when the file explorer re-renders (e.g. collapse/expand)
        this.registerEvent(this.app.workspace.on("file-open", retrigger));
        this.registerEvent(this.app.workspace.on("layout-change", retrigger));
    }
    isEligibleFile(file) {
        var _a, _b;
        const exts = this.settings.includeExtensions
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        const fileExt = (_b = (_a = file.extension) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : "";
        return exts.length === 0 || exts.includes(fileExt);
    }
    computeWordStats(item, wcmap, stats, abortSignal) {
        return __awaiter(this, void 0, void 0, function* () {
            let wc = 0;
            if (abortSignal === null || abortSignal === void 0 ? void 0 : abortSignal.aborted)
                throw new DOMException("Aborted", "AbortError");
            if (item instanceof obsidian.TFolder) {
                for (const c of item === null || item === void 0 ? void 0 : item.children) {
                    wc += yield this.computeWordStats(c, wcmap, stats, abortSignal);
                }
                wcmap.set(item.path, wc);
                console.log(item);
            }
            if (item instanceof obsidian.TFile) {
                item.stat.mtime;
                if (this.isEligibleFile(item)) {
                    try {
                        const content = yield this.app.vault.cachedRead(item);
                        wc = countWords(content);
                        wcmap.set(item.path, wc);
                    }
                    catch (_) {
                        // Ignore unreadable files
                    }
                }
            }
            return wc;
        });
    }
    computeDaysSinceStart() {
        const start = new Date(this.settings.startDateISO);
        if (isNaN(start.getTime()))
            return 0;
        const now = new Date();
        const ms = now.getTime() - start.getTime();
        if (ms <= 0)
            return 0;
        // Use exact day fraction to avoid jumpiness and division by zero
        return ms / (1000 * 60 * 60 * 24);
    }
    safeComputeAndRender() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            (_a = this.lastComputeAbort) === null || _a === void 0 ? void 0 : _a.abort();
            const controller = new AbortController();
            this.lastComputeAbort = controller;
            let wcmap = new Map();
            let stats = new Map();
            const root = this.app.vault.getFolderByPath(this.settings.folderPath);
            if (root === null) {
                console.log("Failed to find root file: ", this.settings.folderPath);
                return;
            }
            const [total, days] = yield Promise.all([
                this.computeWordStats(root, wcmap, stats, controller.signal),
                Promise.resolve(this.computeDaysSinceStart())
            ]);
            this.renderBadges(wcmap);
            this.renderMeters();
        });
    }
    addElement(parent, elemtype, text) {
        const elem = document.createElement(elemtype);
        elem.setText(text);
        parent.appendChild(elem);
        return elem;
    }
    renderMeter(meters, name, value, max) {
        const meter = this.addElement(meters, "div", "");
        meter.classList.add("fwr-meter");
        this.addElement(meter, "p", `${name}: `);
        const bar = this.addElement(meter, "meter", `${value}%`);
        bar.min = 0;
        bar.max = max;
        bar.value = value;
        this.addElement(meter, "p", `${value}/${max}`);
    }
    renderMeters() {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        const container = this.getFileExplorerContainer();
        if (!container)
            return;
        const meters = document.createElement("div");
        meters.classList.add("fwr-meters");
        meters.textContent = "Progress";
        container.appendChild(meters);
        this.renderMeter(meters, "Book Length", 75, 100);
        this.renderMeter(meters, "Chapter Length", 75, 200);
    }
    getFileExplorerContainer() {
        var _a;
        const leaves = this.app.workspace.getLeavesOfType("file-explorer");
        if (!(leaves === null || leaves === void 0 ? void 0 : leaves.length))
            return null;
        // @ts-ignore - Obsidian internal
        const view = leaves[0].view;
        return (_a = view === null || view === void 0 ? void 0 : view.containerEl) !== null && _a !== void 0 ? _a : null;
    }
    renderBadges(wcmap) {
        const container = this.getFileExplorerContainer();
        if (!container)
            return;
        const items = container.querySelectorAll(`.tree-item-self`);
        items.forEach(item => {
            var _a, _b;
            const path = (_a = item.dataset) === null || _a === void 0 ? void 0 : _a.path;
            if (path !== undefined) {
                if (wcmap.has(path)) {
                    this.renderWCBadge(item, (_b = wcmap.get(path)) !== null && _b !== void 0 ? _b : 0);
                }
            }
        });
    }
    renderWCBadge(titleEl, totalWords) {
        //detach earlier badge
        titleEl
            .querySelectorAll(`.fwr-badge`)
            .forEach((el) => el.detach());
        // create new one
        const badge = document.createElement("span");
        badge.classList.add("fwr-badge");
        const text = `${formatNumber(totalWords)} words`;
        badge.textContent = text;
        titleEl.appendChild(badge);
    }
    detachAllBadges() {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        document.querySelectorAll(".fwr-badge").forEach((el) => el.detach());
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings);
            // this.startPeriodicRefresh();
            this.safeComputeAndRender();
        });
    }
}
/* ---------- Settings Tab ---------- */
class FolderWordRateSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Folder Word Rate" });
        new obsidian.Setting(containerEl)
            .setName("Folder path")
            .setDesc("Path in your vault, e.g., \"Writing\" or \"Projects/Book\".")
            .addText((t) => t
            .setPlaceholder("Writing")
            .setValue(this.plugin.settings.folderPath)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.folderPath = v.trim();
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Start date (ISO)")
            .setDesc("Words-per-day is measured since this date (YYYY-MM-DD).")
            .addText((t) => t
            .setPlaceholder("2025-01-01")
            .setValue(this.plugin.settings.startDateISO)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.startDateISO = v.trim();
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Included file extensions")
            .setDesc("Comma-separated list, e.g., md,txt")
            .addText((t) => t
            .setPlaceholder("md,txt")
            .setValue(this.plugin.settings.includeExtensions)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.includeExtensions = v;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Decimals")
            .setDesc("Decimal places for the rate (0–6).")
            .addSlider((s) => s
            .setLimits(0, 6, 1)
            .setValue(this.plugin.settings.decimals)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.decimals = v;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Show total word count")
            .setDesc("Append total words after the rate.")
            .addToggle((t) => t
            .setValue(this.plugin.settings.showWordCount)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showWordCount = v;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Badge prefix")
            .setDesc("Text before the number (e.g., ⚡).")
            .addText((t) => t
            .setPlaceholder("⚡")
            .setValue(this.plugin.settings.badgePrefix)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.badgePrefix = v;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Badge suffix")
            .setDesc("Text after the number (e.g., \" w/d\").")
            .addText((t) => t
            .setPlaceholder(" w/d")
            .setValue(this.plugin.settings.badgeSuffix)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.badgeSuffix = v;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Refresh interval (ms)")
            .setDesc("How often to recalc automatically. Set 0 to disable.")
            .addText((t) => t
            .setPlaceholder("30000")
            .setValue(String(this.plugin.settings.refreshMs))
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            const n = Number(v);
            this.plugin.settings.refreshMs = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 30000;
            yield this.plugin.saveSettings();
        })));
    }
}
/* ---------- Helpers ---------- */
// Count “words” in a plain-text string. This treats sequences of letters/numbers as words.
// It skips code fences/inline code lightly by not doing heavy markdown parsing for speed.
function countWords(s) {
    if (!s)
        return 0;
    // Fast strip of YAML frontmatter
    if (s.startsWith("---")) {
        const end = s.indexOf("\n---", 3);
        if (end !== -1)
            s = s.slice(end + 4);
    }
    // Remove code fences to avoid inflating counts with code
    s = s.replace(/```[\s\S]*?```/g, " ");
    // A fairly standard tokenization on word characters & apostrophes/hyphens between letters
    const tokens = s.match(/\b[^\s\W_][\w'-]*\b/gu);
    return tokens ? tokens.length : 0;
}
function formatNumber(n) {
    try {
        return new Intl.NumberFormat().format(n);
    }
    catch (_a) {
        return String(n);
    }
}

module.exports = FolderWordRatePlugin;
