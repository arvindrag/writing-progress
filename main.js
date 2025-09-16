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

class FolderWordRateSettings {
    constructor() {
        this.folderPath = "Novel/Chapters"; // e.g., "Writing" or "Projects/Book"
        this.breakPoints = new Map();
    }
    toObject() {
        return {
            "folderPath": this.folderPath,
            "breakPoints": [...this.breakPoints]
        };
    }
}
const METRICS = [
    {
        label: "Chapter Length",
        name: "latest_chapter_wc",
        calculate: (wcmap, root) => {
            let latest_chapter_wc = 0;
            let maxMtime = -Infinity;
            for (const stats of wcmap.values()) {
                if (stats.mtime > maxMtime) {
                    maxMtime = stats.mtime;
                    latest_chapter_wc = stats.wc;
                }
            }
            return latest_chapter_wc;
        },
    },
    {
        label: "Chapters",
        name: "num_chapters",
        calculate: (wcmap, root) => (([...wcmap.values()].filter(c => c.ischapter)).length)
    },
    {
        label: "Book Length",
        name: "total_wc",
        calculate: (wcmap, root) => { var _a, _b; return ((_b = (_a = wcmap.get(root)) === null || _a === void 0 ? void 0 : _a.wc) !== null && _b !== void 0 ? _b : 0); }
    },
];
class FolderWordRatePlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.settings = new FolderWordRateSettings();
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
    // private isEligibleFile(file: TFile): boolean {
    //     const exts = this.settings.includeExtensions
    //         .split(",")
    //         .map(s => s.trim().toLowerCase())
    //         .filter(Boolean);
    //     const fileExt = file.extension?.toLowerCase() ?? "";
    //     return exts.length === 0 || exts.includes(fileExt);
    // }
    aggregateStats(wcmap, abortSignal) {
        return __awaiter(this, void 0, void 0, function* () {
            const aggregateStats = new Map();
            for (const metric of METRICS) {
                aggregateStats.set(metric.name, metric.calculate(wcmap, this.settings.folderPath));
            }
            return aggregateStats;
        });
    }
    computeStats(item, wcmap, abortSignal) {
        return __awaiter(this, void 0, void 0, function* () {
            const stats = { wc: 0, ctime: 0, mtime: 0, ischapter: false };
            if (abortSignal === null || abortSignal === void 0 ? void 0 : abortSignal.aborted)
                throw new DOMException("Aborted", "AbortError");
            if (item instanceof obsidian.TFolder) {
                for (const c of item === null || item === void 0 ? void 0 : item.children) {
                    const cstats = yield this.computeStats(c, wcmap, abortSignal);
                    stats.wc += cstats.wc;
                    if (stats.ctime == 0 || stats.ctime > cstats.ctime) {
                        stats.ctime = cstats.ctime;
                    }
                    if (stats.mtime == 0 || stats.mtime < cstats.mtime) {
                        stats.mtime = cstats.mtime;
                    }
                }
                wcmap.set(item.path, stats);
            }
            if (item instanceof obsidian.TFile) {
                item.stat.mtime;
                try {
                    const content = yield this.app.vault.cachedRead(item);
                    stats.ischapter = true;
                    stats.wc = countWords(content);
                    stats.ctime = item.stat.ctime;
                    stats.mtime = item.stat.mtime;
                    wcmap.set(item.path, stats);
                }
                catch (_) {
                    // Ignore unreadable files
                }
            }
            return stats;
        });
    }
    computeDaysSinceStart() {
        // const start = new Date(this.settings.startDateISO);
        // if (isNaN(start.getTime())) return 0;
        // const now = new Date();
        // const ms = now.getTime() - start.getTime();
        // if (ms <= 0) return 0;
        // // Use exact day fraction to avoid jumpiness and division by zero
        // return ms / (1000 * 60 * 60 * 24);
        return 0;
    }
    safeComputeAndRender() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            (_a = this.lastComputeAbort) === null || _a === void 0 ? void 0 : _a.abort();
            const controller = new AbortController();
            this.lastComputeAbort = controller;
            let wcmap = new Map();
            const root = this.app.vault.getFolderByPath(this.settings.folderPath);
            if (root === null) {
                console.log("Failed to find root file: ", this.settings.folderPath);
                return;
            }
            yield Promise.all([
                this.computeStats(root, wcmap, controller.signal),
                Promise.resolve(this.computeDaysSinceStart())
            ]);
            const stats = yield this.aggregateStats(wcmap, controller.signal);
            this.renderBadges(wcmap);
            this.renderMeters(stats);
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
        this.addElement(meter, "p", `${formatCompact(value)}/${formatCompact(max)}`);
    }
    renderMeters(stats) {
        var _a, _b, _c;
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        const container = this.getFileExplorerContainer();
        if (!container)
            return;
        const meters = document.createElement("div");
        meters.classList.add("fwr-meters");
        meters.textContent = "Progress";
        container.appendChild(meters);
        for (const metric of METRICS) {
            const value = (_a = stats.get(metric.name)) !== null && _a !== void 0 ? _a : 0;
            const bp = (((_b = this.settings.breakPoints.get(metric.name)) !== null && _b !== void 0 ? _b : [100]).filter(b => b >= value));
            this.renderMeter(meters, metric.label, value, (_c = Math.min(...bp)) !== null && _c !== void 0 ? _c : 100);
        }
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
            var _a, _b, _c;
            const path = (_a = item.dataset) === null || _a === void 0 ? void 0 : _a.path;
            if (path !== undefined) {
                if (wcmap.has(path)) {
                    this.renderWCBadge(item, (_c = (_b = wcmap.get(path)) === null || _b === void 0 ? void 0 : _b.wc) !== null && _c !== void 0 ? _c : 0);
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
        const text = `${totalWords} words`;
        badge.textContent = text;
        titleEl.appendChild(badge);
    }
    detachAllBadges() {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        document.querySelectorAll(".fwr-badge").forEach((el) => el.detach());
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            if (!data)
                return;
            if (data.folderPath !== null) {
                this.settings.folderPath = data.folderPath;
            }
            if (data.breakPoints !== null) {
                this.settings.breakPoints = new Map(data.breakPoints);
            }
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings.toObject());
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
            .setName("Root Folder Path")
            .setDesc("Path in your vault, e.g., \"Writing\" or \"Projects/Book\".")
            .addText((t) => t
            .setPlaceholder("Book/Chapters")
            .setValue(this.plugin.settings.folderPath)
            .onChange((v) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.folderPath = v.trim();
            yield this.plugin.saveSettings();
        })));
        containerEl.createEl("h2", { text: "Breakpoints:" });
        for (const metric of METRICS) {
            new obsidian.Setting(containerEl)
                .setName(metric.label)
                .setDesc(`Breakpoints for ${metric.label}`)
                .addText((t) => {
                var _a, _b;
                const values = (_b = (_a = this.plugin.settings.breakPoints.get(metric.name)) === null || _a === void 0 ? void 0 : _a.map(v => formatCompact(v))) === null || _b === void 0 ? void 0 : _b.join(", ");
                t.setPlaceholder("100, 1K")
                    .setValue(values !== null && values !== void 0 ? values : "100,1K")
                    .onChange((v) => __awaiter(this, void 0, void 0, function* () {
                    const prsd = v.trim().split(",").map(b => parseCompact(b.trim()));
                    this.plugin.settings.breakPoints.set(metric.name, prsd !== null && prsd !== void 0 ? prsd : 0);
                    yield this.plugin.saveSettings();
                }));
            });
        }
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
function formatCompact(num, locale = "en-US") {
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        compactDisplay: "short",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2, // allows 1.2K
    }).format(num);
}
function parseCompact(str) {
    const multipliers = {
        k: 1e3,
        m: 1e6,
        b: 1e9,
        t: 1e12,
    };
    const match = str.trim().toLowerCase().match(/^([\d,.]+)([kmbt])?$/);
    if (!match)
        return Number(str);
    const value = parseFloat(match[1].replace(/,/g, ""));
    const suffix = match[2];
    return suffix ? value * multipliers[suffix] : value;
}

module.exports = FolderWordRatePlugin;
