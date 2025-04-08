import {
	getLinkpath,
	MarkdownPostProcessorContext,
	Notice,
	Plugin,
	TFile,
	PluginSettingTab,
	Setting,
	RequestUrlParam,
	requestUrl
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

		this.addCommand({
			id: "summarize-audio",
			name: "总结当前音频",
			callback: async () => {
				// 获取当前活动文件
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice("没有打开的文件");
					return;
				}
				
				// 检查文件类型
				const audioExtensions = ["mp3", "wav", "ogg", "flac", "mp4", "m4a", "webm"];
				if (!audioExtensions.includes(activeFile.extension)) {
					new Notice("当前文件不是支持的音频文件");
					return;
				}
				
				// 开始处理
				await this.summarizeAudio(activeFile);
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
							plugin: this  // 传递插件实例给渲染器
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

	// 总结音频文件
	async summarizeAudio(file: TFile): Promise<string> {
		try {
			// 显示处理中提示
			new Notice(`开始处理音频文件: ${file.name}`);
			
			// 1. 先确保文件是支持的格式，如果是 webm 则先转换
			let audioFilePath = file.path;
			if (file.extension === "webm") {
				const mp3Path = file.path.replace(/\.webm$/, ".mp3");
				// 检查 mp3 文件是否已存在
				const mp3Exists = await this.app.vault.adapter.exists(mp3Path);
				
				if (!mp3Exists) {
					// 需要先转换
					new Notice("需要先将 webm 转换为 mp3");
					await this.convertWebmToMp3(file.path, mp3Path);
				}
				audioFilePath = mp3Path;
			}
			
			// 2. 检查转录文件是否已存在
			const transcriptionPath = audioFilePath.replace(/\.[^.]+$/, "-transcription.srt");
			const transcriptionExists = await this.app.vault.adapter.exists(transcriptionPath);
			
			let transcription = "";
			if (transcriptionExists) {
				// 如果转录文件已存在，直接读取
				new Notice("转录文件已存在，直接使用");
				const transcriptionFile = this.app.vault.getAbstractFileByPath(transcriptionPath) as TFile;
				transcription = await this.app.vault.read(transcriptionFile);
			} else {
				// 如果转录文件不存在，则使用 whisper 转换为文本
				transcription = await this.transcribeAudio(audioFilePath);
				if (!transcription) {
					new Notice("转录音频失败");
					return "";
				}
			}
			
			// 3. 调用 AI 接口进行总结
			const summary = await this.summarizeText(transcription);
			if (!summary) {
				new Notice("总结失败");
				return "";
			}
			
			// 4. 保存结果到文件
			const summaryPath = file.path.replace(/\.[^.]+$/, "-summary.md");
			await this.saveToFile(summaryPath, summary);
			
			new Notice(`总结完成，已保存到 ${summaryPath}`);
			return summary;
		} catch (error) {
			console.error("总结音频时出错:", error);
			new Notice(`总结失败: ${error.message || error}`);
			return "";
		}
	}
	
	// 转换 webm 到 mp3
	async convertWebmToMp3(webmPath: string, mp3Path: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			try {
				// 使用 Node.js 的 child_process
				const { exec } = require('child_process');
				const path = require('path');
				
				// 获取文件的绝对路径
				const vaultBasePath = (this.app.vault as any).adapter.basePath || '';
				if (!vaultBasePath) {
					throw new Error("无法获取 Vault 根目录路径");
				}
				
				// 构建绝对路径
				const absWebmPath = path.resolve(vaultBasePath, webmPath);
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
				
				// 执行 ffmpeg 命令
				const ffmpegCmd = `${this.settings.ffmpegPath} -i ${escapePath(absWebmPath)} -vn -ab 128k -ar 44100 -y ${escapePath(absMp3Path)}`;
				console.log("执行命令:", ffmpegCmd);
				
				exec(ffmpegCmd, (error: any, stdout: string, stderr: string) => {
					if (error) {
						console.error(`执行出错: ${error}`);
						reject(error);
						return;
					}
					
					// 转换成功
					console.log("webm 已成功转换为 mp3");
					resolve(true);
				});
			} catch (error) {
				console.error("执行 ffmpeg 失败:", error);
				reject(error);
			}
		});
	}
	
	// 使用 whisper 转录音频
	async transcribeAudio(audioPath: string): Promise<string> {
		return new Promise((resolve, reject) => {
			try {
				const { exec } = require('child_process');
				const path = require('path');
				const fs = require('fs');
				
				// 获取文件的绝对路径
				const vaultBasePath = (this.app.vault as any).adapter.basePath || '';
				if (!vaultBasePath) {
					throw new Error("无法获取 Vault 根目录路径");
				}
				
				// 构建绝对路径
				const absAudioPath = path.resolve(vaultBasePath, audioPath);
				const outputPath = path.resolve(vaultBasePath, audioPath.replace(/\.[^.]+$/, "-transcription"));
				const outputFormat = 'srt';
				const transcriptionFilePath = path.resolve(outputPath + "." + outputFormat);
				if (fs.existsSync(transcriptionFilePath)) {
					const transcription = fs.readFileSync(transcriptionFilePath, 'utf8');
					resolve(transcription);
					return;
				}
				
				// 构建 whisper 命令
				let whisperCmd = `${this.settings.whisperCliPath} -l zh --output-${outputFormat} --output-file "${outputPath}"`;
				
				// 如果有设置模型路径，添加模型参数
				if (this.settings.whisperModelPath) {
					whisperCmd += ` --model "${this.settings.whisperModelPath}" `;
				}

				whisperCmd += ` -f "${absAudioPath}"`;
				
				new Notice("正在使用 whisper 转录音频...");
				console.log("执行 whisper 命令:", whisperCmd);
				
				exec(whisperCmd, async (error: any, stdout: string, stderr: string) => {
					if (error) {
						console.error(`执行 whisper 出错: ${error}`);
						reject(error);
						return;
					}
					
					// 读取生成的转录文件
					if (fs.existsSync(transcriptionFilePath)) {
						const transcription = fs.readFileSync(transcriptionFilePath, 'utf8');
						resolve(transcription);
					} else {
						reject(new Error("找不到转录文件"));
					}
				});
			} catch (error) {
				console.error("执行 whisper 失败:", error);
				reject(error);
			}
		});
	}
	
	// 调用 AI 接口总结文本
	async summarizeText(text: string): Promise<string> {
		try {
			if (!this.settings.aiApiKey) {
				throw new Error("未配置 API 密钥");
			}
			
			// 分段处理文本（每次处理约 4000 字）
			const segments = this.splitTextIntoSegments(text, 4000);
			let summaries = [];
			
			for (let i = 0; i < segments.length; i++) {
				new Notice(`正在总结第 ${i+1}/${segments.length} 部分...`);

				console.log('summarize config', this.settings.aiEndpoint, this.settings.aiModel, this.settings.aiApiKey);
				
				// 构建请求参数
				const requestParams: RequestUrlParam = {
					url: this.settings.aiEndpoint,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": `Bearer ${this.settings.aiApiKey}`
					},
					body: JSON.stringify({
						model: this.settings.aiModel,
						messages: [
							{
								role: "system",
								content: "你是一个专业的音频内容分析助手。请按照时间戳格式总结音频内容，格式为'hh:mm:ss --- [小节内容]'，时间戳只需要保留开始时间，每小节的标题按实际内容进行分段，每个时间戳一行，如果有内容，加上冒号跟在标题后面，不要换行，不要有空行。请尽量将同一主题的讨论内容放在一个章节，不要太细碎"
							},
							{
								role: "user",
								content: `${this.settings.summaryPrompt}\n\n${segments[i]}`
							}
						],
						temperature: 0.3
					})
				};
				
				// 发送请求
				const response = await requestUrl(requestParams);
				const jsonResponse = response.json;
				
				if (jsonResponse.choices && jsonResponse.choices.length > 0) {
					const summaryContent = jsonResponse.choices[0].message.content;
					summaries.push(summaryContent);
				} else {
					throw new Error("API 响应格式不正确");
				}
			}
			
			// 合并所有总结
			return summaries.join("\n").trim();
			
		} catch (error) {
			console.error("调用 AI 接口失败:", error);
			throw error;
		}
	}
	
	// 将文本分割成适合处理的片段
	splitTextIntoSegments(text: string, maxChars: number): string[] {
		const segments = [];
		let currentSegment = "";
		
		// 按行分割
		const lines = text.split("\n");
		
		for (const line of lines) {
			// 如果添加当前行会超过最大字符数，就开始新的片段
			if (currentSegment.length + line.length > maxChars && currentSegment.length > 0) {
				segments.push(currentSegment);
				currentSegment = line;
			} else {
				if (currentSegment.length > 0) {
					currentSegment += "\n" + line;
				} else {
					currentSegment = line;
				}
			}
		}
		
		// 添加最后一个片段
		if (currentSegment.length > 0) {
			segments.push(currentSegment);
		}
		
		return segments;
	}
	
	// 保存结果到文件
	async saveToFile(filePath: string, content: string): Promise<void> {
		try {
			// 检查文件是否存在
			const exists = await this.app.vault.adapter.exists(filePath);
			
			if (exists) {
				// 更新现有文件
				const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
				await this.app.vault.modify(file, content);
			} else {
				// 创建新文件
				await this.app.vault.create(filePath, content);
			}
		} catch (error) {
			console.error("保存文件失败:", error);
			throw error;
		}
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
