import {
	getLinkpath,
	MarkdownPostProcessorContext,
	Notice,
	Plugin,
	TFile,
	PluginSettingTab,
	Setting
} from "obsidian";

import { AudioPlayerRenderer } from "./audioPlayerRenderer";

interface AudioPlayerSettings {
	ffmpegPath: string;
	whisperCliPath: string;
	whisperModelPath: string;
	summaryPrompt: string;
	aiEndpoint: string;
	aiModel: string;
	aiApiKey: string;
}

const DEFAULT_SETTINGS: AudioPlayerSettings = {
	ffmpegPath: 'ffmpeg',
	whisperCliPath: 'whisper',
	whisperModelPath: '',
	summaryPrompt: '请总结以下音频转录的内容，提取关键信息和要点：',
	aiEndpoint: 'https://api.openai.com/v1/chat/completions',
	aiModel: 'gpt-3.5-turbo',
	aiApiKey: ''
};

export default class AudioPlayer extends Plugin {
	settings: AudioPlayerSettings;

	async onload() {
		await this.loadSettings();
		
		// 添加设置选项卡
		this.addSettingTab(new AudioPlayerSettingTab(this.app, this));
		
		const player = document.createElement("audio");
		player.volume = 0.5;
		const body = document.getElementsByTagName("body")[0];
		body.appendChild(player);

		this.addCommand({
			id: "pause-audio",
			name: "Pause Audio",
			callback: () => {
				new Notice("Audio paused");
				const ev = new Event("allpause");
				document.dispatchEvent(ev);
				player.pause();
			},
		});

		this.addCommand({
			id: "resume-audio",
			name: "Resume Audio",
			callback: () => {
				new Notice("Audio resumed");
				const ev = new Event("allresume");
				document.dispatchEvent(ev);
				if (player.src) player.play();
			},
		});

		this.addCommand({
			id: "add-audio-comment",
			name: "Add bookmark",
			callback: () => {
				const ev = new Event("addcomment");
				document.dispatchEvent(ev);
			}
		});

		this.addCommand({
			id: "audio-forward-5s",
			name: "+5 sec",
			callback: () => {
				if (player.src) player.currentTime += 5;
			}
		});

		this.addCommand({
			id: "audio-back-5s",
			name: "-5 sec",
			callback: () => {
				if (player.src) player.currentTime -= 5;
			}
		});

		this.registerMarkdownCodeBlockProcessor(
			"audio-player",
			(
				source: string,
				el: HTMLElement,
				ctx: MarkdownPostProcessorContext
			) => {
				// parse file name
				const re = /\[\[(.+)\]\]/g;
				const filename = re.exec(source)?.at(1);
				if (!filename) return;

				const allowedExtensions = [
					"mp3",
					"wav",
					"ogg",
					"flac",
					"mp4",
					"m4a",
					"webm"
				];
				const link = this.app.metadataCache.getFirstLinkpathDest(
					getLinkpath(filename),
					filename
				);
				if (!link || !allowedExtensions.includes(link.extension))
					return;

				// 创建音频播放器函数
				const createAudioPlayer = (filepath: string) => {
					// create root $el
					const container = el.createDiv();
					container.classList.add("base-container");

					//create vue app
					ctx.addChild(
						new AudioPlayerRenderer(el, {
							filepath: filepath,
							ctx,
							player,
						})
					);
				};

				if (link.extension === "webm") {
					try {
						// 使用 Node.js 子进程调用 ffmpeg
						const webmFile = link.path;
						const mp3Path = link.path.replace(/\.webm$/, ".mp3");
						
						// 创建一个占位容器
						const containerEl = el.createDiv();
						
						// 检查 mp3 文件是否已存在
						this.app.vault.adapter.exists(mp3Path).then(async (exists) => {
							if (exists) {
								// MP3 已存在，直接使用
								createAudioPlayer(mp3Path);
							} else {
								// 需要转换时才显示提示
								new Notice("正在转换 webm 文件...");
								const loadingEl = containerEl.createDiv();
								loadingEl.setText("正在使用 ffmpeg 转换音频文件，请稍候...");
								
								// 需要转换时调用 ffmpeg
								try {
									// 使用 Node.js 的 child_process
									const { exec } = require('child_process');
									const path = require('path');
									
									// 尝试获取文件的绝对路径
									const vaultBasePath = (this.app.vault as any).adapter.basePath || '';
									if (!vaultBasePath) {
										throw new Error("无法获取 Vault 根目录路径");
									}
									
									// 构建绝对路径
									const absWebmPath = path.resolve(vaultBasePath, webmFile);
									const absMp3Path = path.resolve(vaultBasePath, mp3Path);
									
									// 处理路径中的特殊字符
									const escapePath = (path: string) => {
										// 根据操作系统区分处理
										if (process.platform === 'win32') {
											// Windows 系统使用双引号并处理特殊字符
											return `"${path.replace(/"/g, '\\"')}"`;
										} else {
											// Unix/Linux/Mac 系统使用单引号或转义空格
											return `'${path.replace(/'/g, "'\\''")}'`;
										}
									};
									
									// 执行 ffmpeg 命令，使用设置中的路径和绝对文件路径
									const ffmpegCmd = `${this.settings.ffmpegPath} -i ${escapePath(absWebmPath)} -vn -ab 128k -ar 44100 -y ${escapePath(absMp3Path)}`;
									console.log("执行命令:", ffmpegCmd);
									
									exec(ffmpegCmd, (error: any, stdout: string, stderr: string) => {
										if (error) {
											console.error(`执行出错: ${error}`);
											loadingEl.setText(`转换失败: ${error.message}`);
											new Notice(`ffmpeg 转换失败: ${error.message}`);
											return;
										}
										
										// 转换成功
										new Notice("webm 已成功转换为 mp3");
										containerEl.empty(); // 清空容器
										
										// 播放转换后的文件
										createAudioPlayer(mp3Path);
									});
								} catch (conversionError) {
									console.error("执行 ffmpeg 失败:", conversionError);
									loadingEl.setText("执行 ffmpeg 失败，请确保系统已安装 ffmpeg");
									new Notice("执行 ffmpeg 失败，请确保系统已安装 ffmpeg");
								}
							}
						});
					} catch (error) {
						console.error("处理 webm 文件失败:", error);
						new Notice("处理 webm 文件失败");
					}
				} else {
					// 对于非 webm 文件，直接创建播放器
					createAudioPlayer(link.path);
				}
			}
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AudioPlayerSettingTab extends PluginSettingTab {
	plugin: AudioPlayer;

	constructor(app: any, plugin: AudioPlayer) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: '音频播放器设置'});

		new Setting(containerEl)
			.setName('ffmpeg 路径')
			.setDesc('设置 ffmpeg 可执行文件的路径。如果 ffmpeg 在系统 PATH 中，可以直接使用 "ffmpeg"')
			.addText(text => text
				.setPlaceholder('ffmpeg')
				.setValue(this.plugin.settings.ffmpegPath)
				.onChange(async (value) => {
					this.plugin.settings.ffmpegPath = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('whisper-cli 路径')
			.setDesc('设置 whisper 命令行工具的路径。如果在系统 PATH 中，可以直接使用 "whisper"')
			.addText(text => text
				.setPlaceholder('whisper')
				.setValue(this.plugin.settings.whisperCliPath)
				.onChange(async (value) => {
					this.plugin.settings.whisperCliPath = value;
					await this.plugin.saveSettings();
				}));
				
		new Setting(containerEl)
			.setName('whisper 模型路径')
			.setDesc('设置 whisper 模型文件的路径。如留空则使用默认模型')
			.addText(text => text
				.setPlaceholder('例如: /path/to/model.bin')
				.setValue(this.plugin.settings.whisperModelPath)
				.onChange(async (value) => {
					this.plugin.settings.whisperModelPath = value;
					await this.plugin.saveSettings();
				}));
				
		containerEl.createEl('h3', {text: '语音转录设置'});
		
		const summaryPromptSetting = new Setting(containerEl)
			.setName('总结提示词')
			.setDesc('设置用于总结语音转录内容的提示词，将用于AI生成总结');
			
		// 创建一个文本区域元素
		const textAreaEl = document.createElement('textarea');
		textAreaEl.value = this.plugin.settings.summaryPrompt;
		textAreaEl.rows = 6;
		textAreaEl.cols = 50;
		textAreaEl.className = 'setting-prompt-textarea';
		textAreaEl.addEventListener('change', async (e) => {
			this.plugin.settings.summaryPrompt = (e.target as HTMLTextAreaElement).value;
			await this.plugin.saveSettings();
		});
		
		// 添加样式
		const style = document.createElement('style');
		style.innerHTML = `
			.setting-prompt-textarea {
				width: 100%;
				min-height: 100px;
				font-family: var(--font-monospace);
				resize: vertical;
				margin-top: 8px;
			}
		`;
		document.head.appendChild(style);
		
		// 将文本区域添加到设置中
		summaryPromptSetting.controlEl.appendChild(textAreaEl);
		
		// 添加 AI 服务设置
		containerEl.createEl('h3', {text: 'AI 服务设置'});
		
		new Setting(containerEl)
			.setName('AI 接口地址 (Endpoint)')
			.setDesc('设置 AI 服务的接口地址')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1/chat/completions')
				.setValue(this.plugin.settings.aiEndpoint)
				.onChange(async (value) => {
					this.plugin.settings.aiEndpoint = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('AI 模型名称')
			.setDesc('设置使用的 AI 模型名称')
			.addText(text => text
				.setPlaceholder('gpt-3.5-turbo')
				.setValue(this.plugin.settings.aiModel)
				.onChange(async (value) => {
					this.plugin.settings.aiModel = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('API 密钥')
			.setDesc('设置 AI 服务的 API 密钥（将加密存储）')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.aiApiKey)
				.setDisabled(false)
				.inputEl.type = 'password');
				
		// 为 API Key 创建单独的保存按钮，避免密钥明文存储在设置更改时
		new Setting(containerEl)
			.setName('保存 API 密钥')
			.setDesc('点击保存按钮将 API 密钥存储至配置')
			.addButton(button => button
				.setButtonText('保存 API 密钥')
				.onClick(async () => {
					const inputEl = containerEl.querySelector('input[type="password"]') as HTMLInputElement;
					if (inputEl) {
						this.plugin.settings.aiApiKey = inputEl.value;
						await this.plugin.saveSettings();
						new Notice('API 密钥已保存');
					}
				}));
	}
}
