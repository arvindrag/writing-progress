import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    TAbstractFile,
    TFile,
    TFolder,
    Notice
} from "obsidian";
import bell from "./assets/bell.mp3";

class FolderWordRateSettings {
    folderPath: string = "Novel/Chapters"
    notify: boolean = true
    notificationMS: number = 3000
    breakPoints: Map<string, number[]> = new Map()
    toObject() {
        return {
            "folderPath": this.folderPath,
            "breakPoints": [...this.breakPoints]
        }
    }
}
const MS_PER_DAY = 1000.0 * 60 * 60 * 24
const MS_PER_WEEK = MS_PER_DAY * 7
let STAT_STATE = new Map<string, number>
interface ChapterStats {
    wc: number
    ctime: number
    mtime: number
    ischapter: boolean
}

type aggregation = ((wcmap: Map<string, ChapterStats>, root: string) => number)
interface Metric {
    label: string
    name: string
    unit: string
    default: number[]
    calculate: aggregation
}

const METRICS: Metric[] = [
    {
        label: "Chapter",
        name: "latest_chapter_wc",
        unit: "words",
        default: [300, 500],
        calculate: (wcmap, root) => {
            let latest_chapter_wc: number = 0;
            let maxMtime = -Infinity;
            for (const stats of wcmap.values()) {
                if (stats.mtime > maxMtime) {
                    maxMtime = stats.mtime;
                    latest_chapter_wc = stats.wc;
                }
            }
            return latest_chapter_wc
        },
    },
    {
        label: "Pace",
        name: "wc_weekly_pace",
        unit: "words/week",
        default: [500, 1000],
        calculate: (wcmap, root) => {
            const MS_PER_DAY = 1000 * 60 * 60 * 24;
            const rootcs = wcmap.get(root);
            const wc = Number(rootcs?.wc) || 0;
            let interval = Number(rootcs?.mtime ?? 0) - Number(rootcs?.ctime ?? 0);
            if (!Number.isFinite(interval) || interval <= 0) interval = MS_PER_DAY; // avoid 0/NaN
            const pace = Math.round((wc * MS_PER_WEEK) / interval);
            return Number.isFinite(pace) ? pace : 0; // belt & suspenders
        }
    },
    {
        label: "Chapters",
        name: "num_chapters",
        unit: "chapters",
        default: [1, 10],
        calculate: (wcmap, root) => (([...wcmap.values()].filter(c => c.ischapter)).length)
    },
    {
        label: "Words",
        name: "total_wc",
        unit: "words",
        default: [1000, 5000],
        calculate: (wcmap, root) => (wcmap.get(root)?.wc ?? 0)
    },
];

export default class FolderWordRatePlugin extends Plugin {
    settings = new FolderWordRateSettings();
    alert = new Audio(bell)

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
            id: "recompute-progress-metrics",
            name: "Recompute Progress Metrics",
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

    private notify(msg: string) {
        if (this.settings.notify) {
            new Notice(msg, this.settings.notificationMS)
            this.alert.play().catch(err => console.error("Sound play failed", err));
        }
    }

    private async aggregateStats(wcmap: Map<string, ChapterStats>, abortSignal?: AbortSignal) {

        const aggregateStats = new Map<string, number>();
        for (const metric of METRICS) {
            aggregateStats.set(metric.name, metric.calculate(wcmap, this.settings.folderPath))
        }
        return aggregateStats
    }

    private async computeStats(item: TAbstractFile, wcmap: Map<string, ChapterStats>, abortSignal?: AbortSignal): Promise<ChapterStats> {
        const stats: ChapterStats = { wc: 0, ctime: 0, mtime: 0, ischapter: false }
        if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (item instanceof TFolder) {
            for (const c of item?.children) {
                const cstats = await this.computeStats(c, wcmap, abortSignal)
                stats.wc += cstats.wc
                if (stats.ctime == 0 || stats.ctime > cstats.ctime) {
                    stats.ctime = cstats.ctime
                }
                if (stats.mtime == 0 || stats.mtime < cstats.mtime) {
                    stats.mtime = cstats.mtime
                }
            }
            wcmap.set(item.path, stats)
        }
        if (item instanceof TFile) {
            item.stat.mtime
            try {
                const content = await this.app.vault.cachedRead(item);
                stats.ischapter = true
                stats.wc = countWords(content);
                stats.ctime = item.stat.ctime
                stats.mtime = item.stat.mtime
                wcmap.set(item.path, stats)
            } catch (_) {
                // Ignore unreadable files
            }
        }
        return stats;
    }

    private computeDaysSinceStart(): number {
        // const start = new Date(this.settings.startDateISO);
        // if (isNaN(start.getTime())) return 0;
        // const now = new Date();
        // const ms = now.getTime() - start.getTime();
        // if (ms <= 0) return 0;
        // // Use exact day fraction to avoid jumpiness and division by zero
        // return ms / (1000 * 60 * 60 * 24);
        return 0
    }

    private async safeComputeAndRender() {
        this.lastComputeAbort?.abort();
        const controller = new AbortController();
        this.lastComputeAbort = controller;
        let wcmap = new Map<string, ChapterStats>();
        const root = this.app.vault.getFolderByPath(this.settings.folderPath)
        if (root === null) {
            console.log("Failed to find root file: ", this.settings.folderPath)
            return
        }
        await Promise.all([
            this.computeStats(root, wcmap, controller.signal),
            Promise.resolve(this.computeDaysSinceStart())
        ]);
        const stats = await this.aggregateStats(wcmap, controller.signal)
        this.renderBadges(wcmap)
        this.renderMeters(stats)
    }
    private addElement(parent: HTMLElement, elemtype: string, text: string): HTMLElement {
        const elem = document.createElement(elemtype);
        elem.setText(text)
        parent.appendChild(elem)
        return elem
    }
    private renderMeter(meters: HTMLElement, name: string, value: number, max: number, unit: string) {
        const meter = this.addElement(meters, "div", "")
        meter.classList.add("fwr-meter");
        this.addElement(meter, "p", `${name}: `)
        const bar = this.addElement(meter, "meter", `${value}%`) as HTMLMeterElement
        bar.min = 0;
        bar.max = max;
        bar.value = value;
        this.addElement(meter, "p", `${formatCompact(value)}/${formatCompact(max)} ${unit}`)
    }
    private renderMeters(stats: Map<string, number>) {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        const container = this.getFileExplorerContainer();
        if (!container) return
        const meters = document.createElement("div");
        meters.classList.add("fwr-meters");
        meters.textContent = "Progress";
        container.appendChild(meters);
        for (const metric of METRICS) {
            const value = stats.get(metric.name) ?? 0
            const breakpoints = (this.settings.breakPoints.get(metric.name) ?? metric.default)
            breakpoints.sort((a, b) => a - b)
            const limit = (
                breakpoints.filter(l => l >= value)[0] ??
                breakpoints[(breakpoints.length - 1)] ?? 0
            )
            if (value > (STAT_STATE.get(metric.name) ?? Infinity)) {
                this.notify(`🥳Nice🎉!\n Hit breakpoint on ${metric.label} with ${value}/${STAT_STATE.get(metric.name)}! Good job!`)
            }
            STAT_STATE.set(metric.name, limit)
            this.renderMeter(meters, metric.label, value, limit, metric.unit)
        }
    }

    private getFileExplorerContainer(): HTMLElement | null {
        const leaves = this.app.workspace.getLeavesOfType("file-explorer");
        if (!leaves?.length) return null;
        // @ts-ignore - Obsidian internal
        const view = (leaves[0] as any).view;
        return view?.containerEl ?? null;
    }

    private renderBadges(wcmap: Map<string, ChapterStats>) {
        const container = this.getFileExplorerContainer();
        if (!container) return;
        const items = container.querySelectorAll<HTMLElement>(`.tree-item-self`)
        items.forEach(
            item => {
                const path = item.dataset?.path
                if (path !== undefined) {
                    if (wcmap.has(path)) {
                        this.renderWCBadge(item as HTMLElement, wcmap.get(path)?.wc ?? 0)
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
        const text = `${totalWords} words`;
        badge.textContent = text;
        titleEl.appendChild(badge);
    }

    private detachAllBadges() {
        document.querySelectorAll(".fwr-meters").forEach((el) => el.detach());
        document.querySelectorAll(".fwr-badge").forEach((el) => el.detach());
    }

    async loadSettings() {
        const data = await this.loadData();
        if (!data) return
        if (data.folderPath !== null) {
            this.settings.folderPath = data.folderPath
        }
        if (data.breakPoints !== null) {
            this.settings.breakPoints = new Map(data.breakPoints)
        }
    }

    async saveSettings() {
        await this.saveData(this.settings.toObject());
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

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Folder Word Rate" });
        new Setting(containerEl)
            .setName("Root Folder Path")
            .setDesc("Path in your vault, e.g. \"Novel/Chapters\".",)
            .addText((t) =>
                t
                    .setPlaceholder("Book/Chapters")
                    .setValue(this.plugin.settings.folderPath)
                    .onChange(async (v) => {
                        this.plugin.settings.folderPath = v.trim();
                        await this.plugin.saveSettings();
                    })
            );
        new Setting(containerEl)
            .setName("Notify")
            .setDesc("Notify me when I hit a breakpoint",)
            .addToggle((t) =>
                t
                    .setValue(this.plugin.settings.notify)
                    .onChange(async (v) => {
                        this.plugin.settings.notify = v
                        await this.plugin.saveSettings()
                    })
            )
        new Setting(containerEl)
            .setName("Notification hover (seconds)")
            .setDesc("Seconds for notification to hover before disappearing",)
            .addText((t) =>
                t
                    .setPlaceholder("3")
                    .setValue((this.plugin.settings.notificationMS / 1000).toString())
                    .onChange(async (v) => {
                        this.plugin.settings.notificationMS = parseFloat(v.trim()) * 1000;
                        await this.plugin.saveSettings();
                    })
            );
        containerEl.createEl("h2", { text: "Breakpoints:" });
        for (const metric of METRICS) {
            new Setting(containerEl)
                .setName(metric.label)
                .setDesc(`Breakpoints for ${metric.label} in (${metric.unit})`)
                .addText((t) => {
                    const breakpoints = (this
                        .plugin
                        .settings
                        .breakPoints
                        .get(metric.name))
                    breakpoints?.sort((a, b) => a - b)
                        ;
                    t.setPlaceholder("0")
                        .setValue((breakpoints?.map(v => formatCompact(v))?.join(", ")) ?? "0")
                        .onChange(async (v) => {
                            const prsd = v.trim().split(",").map(b => parseCompact(b.trim()))
                            this.plugin.settings.breakPoints.set(metric.name, prsd ?? metric.default)
                            await this.plugin.saveSettings();
                        })
                }
                );
        }

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
function formatCompact(num: number, locale: string = "en-US"): string {
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        compactDisplay: "short",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2, // allows 1.2K
    }).format(num);
}
function parseCompact(str: string): number {
    const multipliers: Record<string, number> = {
        k: 1e3,
        m: 1e6,
        b: 1e9,
        t: 1e12,
    };
    const match = str.trim().toLowerCase().match(/^([\d,.]+)([kmbt])?$/);
    if (!match) return Number(str);

    const value = parseFloat(match[1].replace(/,/g, ""));
    const suffix = match[2];

    return suffix ? value * multipliers[suffix] : value;
}
