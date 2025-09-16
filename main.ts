import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    TAbstractFile,
    TFile,
    TFolder
} from "obsidian";

interface FolderWordRateSettings {
    folderPath: string;             // e.g., "Writing" or "Projects/Book"
    startDateISO: string;           // e.g., "2025-01-01"
    includeExtensions: string;      // comma-separated extensions: "md,txt"
    decimals: number;               // number of decimals for rate display
    refreshMs: number;              // periodic refresh (ms)
    showWordCount: boolean;         // optionally show total words too
    badgePrefix: string;            // text before the number, e.g., "⚡"
    badgeSuffix: string;            // text after the number, e.g., " w/d"
}

const DEFAULT_SETTINGS: FolderWordRateSettings = {
    folderPath: "Novel/Chapters",
    startDateISO: "2025-01-01",
    includeExtensions: "md,txt",
    decimals: 1,
    refreshMs: 30000,
    showWordCount: false,
    badgePrefix: "⚡",
    badgeSuffix: " w/d"
};

export default class FolderWordRatePlugin extends Plugin {
    settings: FolderWordRateSettings = DEFAULT_SETTINGS;
    private lastComputeAbort?: AbortController;

    async onload() {
        await this.loadSettings();

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
    }

    onunload() {
        this.detachAllBadges();
    }

    private attachVaultListeners() {
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

    private isEligibleFile(file: TFile): boolean {
        const exts = this.settings.includeExtensions
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);

        const fileExt = file.extension?.toLowerCase() ?? "";
        return exts.length === 0 || exts.includes(fileExt);
    }

    private async computeWordStats(item: TAbstractFile, wcmap: Map<string, number>,
        stats: Map<string, string>,
        abortSignal?: AbortSignal): Promise<number> {
        let wc = 0
        if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (item instanceof TFolder) {
            for (const c of item?.children) {
                wc += await this.computeWordStats(c, wcmap, stats, abortSignal)
            }
            wcmap.set(item.path, wc)
            console.log(item)
        }
        if (item instanceof TFile) {
            item.stat.mtime
            if (this.isEligibleFile(item)) {
                try {
                    const content = await this.app.vault.cachedRead(item);
                    wc = countWords(content);
                    wcmap.set(item.path, wc)
                } catch (_) {
                    // Ignore unreadable files
                }
            }
        }
        return wc;
    }

    private computeDaysSinceStart(): number {
        const start = new Date(this.settings.startDateISO);
        if (isNaN(start.getTime())) return 0;
        const now = new Date();
        const ms = now.getTime() - start.getTime();
        if (ms <= 0) return 0;
        // Use exact day fraction to avoid jumpiness and division by zero
        return ms / (1000 * 60 * 60 * 24);
    }

    private async safeComputeAndRender() {
        this.lastComputeAbort?.abort();
        const controller = new AbortController();
        this.lastComputeAbort = controller;
        let wcmap = new Map<string, number>();
        let stats = new Map<string, string>();
        const root = this.app.vault.getFolderByPath(this.settings.folderPath)
        if (root === null) {
            console.log("Failed to find root file: ", this.settings.folderPath)
            return
        }
        const [total, days] = await Promise.all([
            this.computeWordStats(root, wcmap, stats, controller.signal),
            Promise.resolve(this.computeDaysSinceStart())
        ]);
        this.renderBadges(wcmap)
        this.renderMeters()
    }
    private addElement(parent: HTMLElement, elemtype: string, text: string): HTMLElement {
        const elem = document.createElement(elemtype);
        elem.setText(text)
        parent.appendChild(elem)
        return elem
    }
    private renderMeter(meters: HTMLElement, name: string, value: number, max: number) {
        const meter = this.addElement(meters, "div", "")
        meter.classList.add("fwr-meter");
        this.addElement(meter, "p", `${name}: `)
        const bar = this.addElement(meter, "meter", `${value}%`) as HTMLMeterElement
        bar.min = 0;
        bar.max = max;
        bar.value = value;
        this.addElement(meter, "p", `${value}/${max}`)
    }
    private renderMeters() {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        const container = this.getFileExplorerContainer();
        if (!container) return
        const meters = document.createElement("div");
        meters.classList.add("fwr-meters");
        meters.textContent = "Progress";
        container.appendChild(meters);
        this.renderMeter(meters, "Book Length", 75, 100)
        this.renderMeter(meters, "Chapter Length", 75, 200)
    }

    private getFileExplorerContainer(): HTMLElement | null {
        const leaves = this.app.workspace.getLeavesOfType("file-explorer");
        if (!leaves?.length) return null;
        // @ts-ignore - Obsidian internal
        const view = (leaves[0] as any).view;
        return view?.containerEl ?? null;
    }

    private renderBadges(wcmap: Map<string, number>) {
        const container = this.getFileExplorerContainer();
        if (!container) return;
        const items = container.querySelectorAll<HTMLElement>(`.tree-item-self`)
        items.forEach(
            item => {
                const path = item.dataset?.path
                if (path !== undefined) {
                    if (wcmap.has(path)) {
                        this.renderWCBadge(item as HTMLElement, wcmap.get(path) ?? 0)
                    }
                }
            }
        )
    }

    private renderWCBadge(titleEl: HTMLElement, totalWords: number) {
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

    private detachAllBadges() {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        document.querySelectorAll(".fwr-badge").forEach((el) => el.detach());
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // this.startPeriodicRefresh();
        this.safeComputeAndRender();
    }
}

/* ---------- Settings Tab ---------- */

class FolderWordRateSettingTab extends PluginSettingTab {
    plugin: FolderWordRatePlugin;

    constructor(app: App, plugin: FolderWordRatePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private addSetting(parent: HTMLElement,
        name: string,
        desc: string,
        placeholder: string,
        setting: any
    ) {
        new Setting(parent)
            .setName(name)
            .setDesc(desc)
            .addText((t) =>
                t
                    .setPlaceholder(placeholder)
                    .setValue(setting)
                    .onChange(async (v) => {
                        setting = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Folder Word Rate" });

        this.addSetting(containerEl,
            "Folder path",
            "Path in your vault, e.g., \"Writing\" or \"Projects/Book\".",
            "Writing",
            this.plugin.settings.folderPath)

        this.addSetting(containerEl,
            "Start date (ISO)",
            "Words-per-day is measured since this date (YYYY-MM-DD).",
            "2025-01-01",
            this.plugin.settings.startDateISO)

        this.addSetting(containerEl,
            "Included file extensions",
            "Comma-separated list, e.g., md,txt",
            "md,txt",
            this.plugin.settings.includeExtensions)
    }
}

/* ---------- Helpers ---------- */

// Count “words” in a plain-text string. This treats sequences of letters/numbers as words.
// It skips code fences/inline code lightly by not doing heavy markdown parsing for speed.
function countWords(s: string): number {
    if (!s) return 0;

    // Fast strip of YAML frontmatter
    if (s.startsWith("---")) {
        const end = s.indexOf("\n---", 3);
        if (end !== -1) s = s.slice(end + 4);
    }

    // Remove code fences to avoid inflating counts with code
    s = s.replace(/```[\s\S]*?```/g, " ");

    // A fairly standard tokenization on word characters & apostrophes/hyphens between letters
    const tokens = s.match(/\b[^\s\W_][\w'-]*\b/gu);
    return tokens ? tokens.length : 0;
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function formatNumber(n: number): string {
    try {
        return new Intl.NumberFormat().format(n);
    } catch {
        return String(n);
    }
}

// CSS.escape polyfill wrapper (Obsidian runs on Electron/Chromium; CSS.escape exists but guard anyway)
function cssEscape(s: string): string {
    // @ts-ignore
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_\-]/g, (c) => `\\${c}`);
}
