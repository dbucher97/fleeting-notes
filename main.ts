import { App, TFile, TFolder, Notice, FuzzySuggestModal, Plugin, PluginSettingTab, Setting, Vault, Modal } from 'obsidian';

interface FleetingNotesSettings {
    path: string;
    len: number;
    maxDays: number;
}

const DEFAULT_SETTINGS: FleetingNotesSettings = {
    path: 'fleeting',
    len: 6,
    maxDays: 30,
}

interface CmdType {
  title: string;
  cmd: () => void;
}

export default class FleetingNotes extends Plugin {
    settings: FleetingNotesSettings;

    async onload() {
        await this.loadSettings();

        const ribbonIconEl = this.addRibbonIcon('paper-plane', 'Fleeting Notes', () => {
            new FleetingModal(this, [
              {title: "New Fleeting Note", cmd: () => {this.createNewFleeting(); }},
              {title: "Clean Fleeting Notes", cmd: () => {this.cleanFleetings(); }},
            ]).open();
        });
        ribbonIconEl.addClass('fleeting-note-ribbon-class');

        this.addCommand({
            id: 'new-fleeting-note',
            name: 'New fleeting note',
            callback: () => {
                this.createNewFleeting();
            }
        });

        this.addCommand({
            id: 'list-fleeting-notes',
            name: 'List fleeting notes',
            callback: () => {
                new FleetingModal(this).open();
            }
        });

        this.addCommand({
            id: 'clean-fleeting-notes',
            name: 'Clean fleeting notes',
            callback: () => {
                this.cleanFleetings();
            }
        });

        this.addSettingTab(new FleetingNotesSettingsTab(this.app, this));
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    newID(): string {
        return Math.random().toString(36).substr(2, this.settings.len);
    }

    async createNewFleeting(): Promise<void> {
        let name = this.newID();
        const fileName = `${this.settings.path}/${name}.md`;
        try {
            while (await this.app.vault.adapter.exists(fileName)) {
                name = this.newID();
            }
            const file = await this.app.vault.create(fileName, "# Untitled");
            this.app.workspace.activeLeaf.openFile(file);
        } catch (error) {
            new Notice(error.toString());
        }
    }

    getFleetingNotes(): TFile[] {
      const folder = this.app.vault.getAbstractFileByPath(this.settings.path) as TFolder;
      let fleets = folder.children.filter(afile => afile instanceof TFile) as TFile[];
      fleets = fleets.filter(file => {
          const cache = this.app.metadataCache.getFileCache(file);
          if(cache && 'tags' in cache) {
              return !cache.tags.map(({tag}) => tag).contains('#processed');
          } else {
              return true;
          }
      });
      fleets.sort(file => file.stat.mtime);
      return fleets;
    }

    cleanFleetings(): void {
        const folder = this.app.vault.getAbstractFileByPath(this.settings.path) as TFolder;
        const todelete = folder.children.filter(file => {
            // rigourously delete folders, fleeting dir should be flat.
            if (file instanceof TFolder) {
                return true;
            }
            const tfile = file as TFile;
            const dms = new Date().getTime() - tfile.stat.mtime
            if (dms > this.settings.maxDays * 24 * 3600 * 1000) {
                return true;
            }
            const cache = this.app.metadataCache.getFileCache(tfile);
            if (!cache) return false;
            if ('tags' in cache) {
                return cache.tags.map(({tag}) => tag).contains("#processed");
            }
            console.log(file)
            console.log(cache)
            if ('headings' in cache) {
              return cache.headings[0].heading === "Untitled";
            }
            return true;
        });
        if(todelete.length == 0) return;
        new ConfirmModal(this.app, () => {
            todelete.forEach(element => {
                this.app.vault.delete(element, true);
            });
        }, todelete.length).open();
    }
}

class ConfirmModal extends Modal {
    files: number;
    onSubmit: () => void;

    constructor(app: App, onSubmit: () => void, files: number) {
        super(app);
        this.onSubmit = onSubmit;
        this.files = files;
    }

    onOpen() {
        let { contentEl } = this;
        contentEl.setText(`Do you whish to delete ${this.files} fleeting notes?`); 
        new Setting(contentEl).addButton(button => button
            .setButtonText("Yes").setCta().onClick(() => {
            this.close();
            this.onSubmit();
        }));
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

class FleetingModal extends FuzzySuggestModal<TFile|CmdType> {
    fleets: (TFile|CmdType)[];
    plugin: FleetingNotes;

    constructor(plugin: FleetingNotes, commands: CmdType[] = []) {
        super(plugin.app);
        this.plugin = plugin;
        this.fleets = commands;
        this.init();
    }

    init() {
        try {
          this.fleets.push(...this.plugin.getFleetingNotes());
        } catch (error) {
            new Notice(error.toString());
        }
    }

    getItems(): (TFile|CmdType)[] {
        return this.fleets;
    }

  getItemText(item: TFile|CmdType): string {
      if(item instanceof TFile) {
        const cache  = this.app.metadataCache.getFileCache(item);
        if(cache && 'headings' in cache) {
          try {
              return cache.headings.filter(({level}) => level == 1)[0].heading;
          } catch (_) { }
        }
        return item.name;
      } else {
        return "👾 " + item.title;
      }
    }

    onChooseItem(item: TFile|CmdType): void {
      if(item instanceof TFile) {
        this.app.workspace.activeLeaf.openFile(item);
      } else {
        item.cmd();
      }
    }

}


class FleetingNotesSettingsTab extends PluginSettingTab {
    plugin: FleetingNotes;

    constructor(app: App, plugin: FleetingNotes) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Fleeting Notes Directory')
            .setDesc('Path to the Directory for fleeting notes')
            .addText(text => text
                .setPlaceholder('dir')
                .setValue(this.plugin.settings.path)
                .onChange(async (value) => {
                    this.plugin.settings.path = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('ID Lenght')
            .setDesc('Lenght of random ID')
            .addSlider(slider => slider
                .setLimits(4, 11, 1)
                .setValue(this.plugin.settings.len)
                .onChange(async (value) => {
                    this.plugin.settings.len = value;
                    await this.plugin.saveSettings();
                }).setDynamicTooltip());

        new Setting(containerEl)
            .setName('Fleeting Notes Lifetime')
            .setDesc('Number of days a fleeting note should not be deleted')
            .addText(text => text
                .setPlaceholder('days')
                .setValue(`${this.plugin.settings.maxDays}`)
                .onChange(async (value) => {
                    const val = parseInt(value);
                    if(!isNaN(val) && val > 0) {
                        this.plugin.settings.maxDays = val;
                    }
                    await this.plugin.saveSettings();
                }));

	}
}
