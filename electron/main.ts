import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import fs from 'fs/promises'
import { exec, spawn, ChildProcess } from 'child_process'
import os from 'os'
import Anthropic from '@anthropic-ai/sdk'
import { MemoryStorage } from './memoryStorage'
import { localEmbeddingService } from './localEmbedding'

import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const isDev = typeof app !== 'undefined' ? !app.isPackaged : (process.env.NODE_ENV === 'development')

// Hide noisy Chromium GPU logs and disable hardware acceleration warning
process.env.ELECTRON_DISABLE_GPU = '1';
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let memoryStorage: MemoryStorage | null = null;
let isQuitting = false;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.webContents.send('event:close-requested');
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  console.log('[Main] app.whenReady fired');
  
  app.on('before-quit', () => {
    isQuitting = true;
  });
  const userData = app.getPath('userData');
  console.log('[Main] UserData Path:', userData);
  
  try {
    const memoryDbPath = join(userData, 'taiziruyi_memory.sqlite');
    console.log('[Main] Initializing MemoryStorage at:', memoryDbPath);
    memoryStorage = new MemoryStorage(memoryDbPath);
    console.log('[Main] MemoryStorage initialized successfully');
  } catch (e: any) {
    console.error('[Main] Failed to initialize MemoryStorage:', e);
  }

  // Ensure models directory exists
  const modelsDirPath = join(userData, 'models');
  fs.mkdir(modelsDirPath, { recursive: true }).then(async () => {
    console.log('[Main] Models directory verified at:', modelsDirPath);
    
    // Pre-warm local embedding engine if default model exists
    const defaultModelPath = join(modelsDirPath, 'embeddinggemma-300m-qat-Q4_0.gguf');
    try {
      await fs.access(defaultModelPath);
      console.log('[Main] Default embedding model found, pre-warming engine...');
      localEmbeddingService.init(defaultModelPath).catch(err => {
        console.warn('[Main] Failed to pre-warm local embedding engine:', err.message);
      });
    } catch {
      console.log('[Main] Default embedding model not found, skipping pre-warm.');
    }
  }).catch(err => {
    console.error('[Main] Failed to create or access models directory:', err);
  });

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.taiziruyi.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  console.log('[Main] Registering LLM handlers...')
  function convertMessages(messages: any[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'user') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (typeof msg.content === 'string') {
          content.push({ type: 'text', text: msg.content || ' ' });
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text') {
              content.push({ type: 'text', text: block.text || ' ' });
            } else if (block.type === 'image') {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: block.source.media_type,
                  data: block.source.data,
                },
              });
            }
          }
        }
        result.push({ role: 'user', content: content.length > 0 ? content : ' ' });
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.thinking) {
          content.push({ type: 'thinking', thinking: msg.thinking } as any);
        }
        if (typeof msg.content === 'string') {
          if (msg.content) content.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              content.push({ type: 'text', text: block.text });
            }
          }
        }
        const toolCallsSource = msg.toolCallsForContext || msg.toolCalls;
        if (toolCallsSource && toolCallsSource.length > 0) {
          const toolUseBlocks: Anthropic.ToolUseBlockParam[] = [];
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
          for (const tc of toolCallsSource) {
            toolUseBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });
            if (tc.result !== undefined) {
              let resContent: Anthropic.ToolResultBlockParam['content'];
              if (Array.isArray(tc.resultContent) && tc.resultContent.length > 0) {
                resContent = tc.resultContent.map((block: any) => {
                  if (block.type === 'image') {
                    return {
                      type: 'image' as const,
                      source: {
                        type: 'base64' as const,
                        media_type: block.source.media_type,
                        data: block.source.data,
                      },
                    };
                  }
                  return { type: 'text' as const, text: block.text || ' ' };
                });
              } else {
                resContent = tc.result || ' ';
              }
              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: tc.id,
                content: resContent,
                is_error: tc.isError,
              });
            }
          }
          content.push(...toolUseBlocks);
          result.push({ role: 'assistant', content: content.length > 0 ? content : ' ' });
          if (toolResultBlocks.length > 0) {
            result.push({ role: 'user', content: toolResultBlocks });
          }
        } else {
          result.push({ role: 'assistant', content: content.length > 0 ? content : ' ' });
        }
      }
    }
    return result;
  }

  function formatLogData(data: any): string {
    if (data === undefined || data === null) return '';
    if (Array.isArray(data)) {
      if (data.length === 0) return '';
      if (data.length > 10) {
        return `[${data.slice(0, 5).map(v => typeof v === 'number' ? v.toFixed(4) : JSON.stringify(v)).join(', ')}, ... ${data.length} items]`;
      }
      return JSON.stringify(data);
    }
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return '';
      if (keys.length > 20) return `{ ... ${keys.length} keys }`;
      const result: any = {};
      for (const key of keys) {
        const val = data[key];
        if (typeof val === 'string' && val.length > 200) {
          result[key] = val.substring(0, 100) + '... (truncated)';
        } else if (Array.isArray(val) && val.length > 10) {
          result[key] = `[Array(${val.length})]`;
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          result[key] = '{...}';
        } else {
          result[key] = val;
        }
      }
      return JSON.stringify(result);
    }
    if (typeof data === 'string' && data.length > 500) {
      return data.substring(0, 200) + '... (truncated)';
    }
    return JSON.stringify(data);
  }

  const SILENT_CHANNELS = new Set(['os:homeDir', 'os:resolve', 'fs:exists']);

  const safeInvoke = (channel: string, handler: (args: any) => Promise<any>) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, data: any) => {
      const formattedData = formatLogData(data);
      if (!SILENT_CHANNELS.has(channel)) {
        console.log(`[IPC] ${channel}${formattedData ? ' called with: ' + formattedData : ''}`);
      }
      try {
        return await handler(data);
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          console.warn(`[IPC] NOT FOUND: ${data?.path || data}`);
        } else {
          console.error(`[IPC] Error in ${channel}:`, error);
        }
        throw error;
      }
    });
  };

  safeInvoke('fs:readDir', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) throw new Error('fs:readDir failed: path is missing');
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
      isSymbolicLink: e.isSymbolicLink()
    }));
  });

  safeInvoke('fs:readTextFile', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) throw new Error('fs:readTextFile failed: path is missing');
    return await fs.readFile(path, 'utf-8');
  });

  safeInvoke('fs:writeTextFile', async (data) => {
    const { path, content } = typeof data === 'string' ? { path: data, content: '' } : data;
    if (!path) throw new Error('fs:writeTextFile failed: path is missing');
    const { dirname } = await import('path');
    await fs.mkdir(dirname(path), { recursive: true });
    return await fs.writeFile(path, content);
  });

  safeInvoke('fs:mkdir', async (data) => {
    const { path, options } = typeof data === 'string' ? { path: data, options: undefined } : data;
    if (!path) throw new Error('fs:mkdir failed: path is missing');
    return await fs.mkdir(path, options);
  });

  safeInvoke('fs:remove', async (data) => {
    const { path, options } = typeof data === 'string' ? { path: data, options: undefined } : data;
    if (!path) throw new Error('fs:remove failed: path is missing');
    if (options?.recursive) {
      return await fs.rm(path, { recursive: true, force: true });
    }
    return await fs.unlink(path);
  });

  safeInvoke('fs:exists', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) return false;
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  });

  safeInvoke('fs:readFile', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) throw new Error('fs:readFile failed: path is missing');
    const buffer = await fs.readFile(path);
    return new Uint8Array(buffer);
  });

  ipcMain.handle('llm:chat', async (event, { messages, options }) => {
    const { apiKey, model, maxTokens, systemPrompt, temperature, topP, stream } = options;
    const client = new Anthropic({
      apiKey: apiKey,
      baseURL: options.baseUrl || undefined,
    });
    const anthropicMessages = convertMessages(messages);
    try {
      if (stream) {
        const streamResponse = await client.messages.create({
          model,
          max_tokens: maxTokens || 4096,
          messages: anthropicMessages,
          system: systemPrompt,
          temperature,
          top_p: topP,
          tools: options.tools,
          tool_choice: options.tool_choice,
          stream: true,
        });
        for await (const chunk of streamResponse) {
          event.sender.send('llm:stream-chunk', { type: 'chunk', data: chunk });
        }
        event.sender.send('llm:stream-chunk', { type: 'done' });
        return;
      } else {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens || 4096,
          messages: anthropicMessages,
          system: systemPrompt,
          temperature,
          top_p: topP,
          tools: options.tools,
          tool_choice: options.tool_choice,
          stream: false,
        });
        return response;
      }
    } catch (error: any) {
      console.error('LLM Main Process Error:', error);
      throw error;
    }
  });

  ipcMain.handle('shell:open', async (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('shell:reveal', async (_, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('notification:send', async (_, options: string | { title: string; body?: string }) => {
    const { Notification } = await import('electron')
    const title = typeof options === 'string' ? options : options.title
    const body = typeof options === 'object' ? options.body : undefined
    new Notification({ title, body }).show()
  })

  ipcMain.handle('clipboard:writeText', async (_, text: string) => {
    const { clipboard } = await import('electron')
    clipboard.writeText(text)
  })

  ipcMain.handle('clipboard:readText', async () => {
    const { clipboard } = await import('electron')
    return clipboard.readText()
  })

  ipcMain.handle('dialog:open', async (event, options: any) => {
    const { dialog } = await import('electron')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const electronOptions: any = {
      title: options.title,
      defaultPath: options.defaultPath,
      buttonLabel: options.buttonLabel,
      filters: options.filters,
      properties: options.properties || []
    }
    if (options.directory && !electronOptions.properties.includes('openDirectory')) {
      electronOptions.properties.push('openDirectory')
    }
    if (options.multiple && !electronOptions.properties.includes('multiSelections')) {
      electronOptions.properties.push('multiSelections')
    }
    if (electronOptions.properties.length === 0) {
      electronOptions.properties.push('openFile')
    }
    const result = await dialog.showOpenDialog(win, electronOptions)
    if (result.canceled) return null
    return options.multiple ? result.filePaths : result.filePaths[0]
  })

  safeInvoke('os:homeDir', async () => os.homedir());
  safeInvoke('os:platform', async () => process.platform);
  safeInvoke('os:appDataDir', async () => app.getPath('userData'));
  safeInvoke('os:desktopDir', async () => app.getPath('desktop'));
  safeInvoke('os:documentDir', async () => app.getPath('documents'));
  safeInvoke('os:downloadDir', async () => app.getPath('downloads'));
  safeInvoke('get_env_vars', async (data) => {
    const names = data?.names || []
    const result: Record<string, string> = {}
    for (const name of names) {
      if (process.env[name]) result[name] = process.env[name]!
    }
    return result
  });

  safeInvoke('log_to_main', async (data) => {
    const { level, message } = data || {};
    const label = level ? level.toUpperCase() : 'INFO';
    console.log(`[Bridge:${label}] ${message}`);
    return true;
  });

  safeInvoke('memory:insert', async (data) => {
    if (!memoryStorage) throw new Error('Memory storage not initialized');
    return memoryStorage.insertDocument(data);
  });
  safeInvoke('memory:delete', async (data) => {
    if (!memoryStorage) throw new Error('Memory storage not initialized');
    const docId = typeof data === 'string' ? data : data?.docId;
    return memoryStorage.deleteDocument(docId);
  });
  safeInvoke('memory:searchVector', async (data) => {
    if (!memoryStorage) throw new Error('Memory storage not initialized');
    const { queryVector, vector, limit } = data || {};
    return memoryStorage.searchVector(queryVector || vector, limit);
  });
  safeInvoke('memory:searchKeyword', async (data) => {
    if (!memoryStorage) throw new Error('Memory storage not initialized');
    const { queryText, query, limit } = data || {};
    return memoryStorage.searchKeyword(queryText || query, limit);
  });
  safeInvoke('memory:reinit', async (data) => {
    const { dimensions } = data || {};
    if (!dimensions) throw new Error('memory:reinit failed: dimensions is missing');
    const userDataPath = app.getPath('userData');
    const memoryDbPath = join(userDataPath, 'taiziruyi_memory.sqlite');
    console.log(`[Main:Memory] Re-initializing with dimensions: ${dimensions}`);
    memoryStorage = new MemoryStorage(memoryDbPath, dimensions, true);
    if (dimensions === 768) {
      const modelPath = join(userDataPath, 'models', 'embeddinggemma-300m-qat-Q4_0.gguf');
      console.log(`[Main:Memory] Pre-warming local embedding engine at: ${modelPath}`);
      localEmbeddingService.init(modelPath).catch(err => {
        console.warn('[Main] Failed to pre-warm local embedding engine:', err.message);
      });
    }
    return { success: true, dimensions: memoryStorage.getDimensions() };
  });

  safeInvoke('memory:getEmbedding', async (data) => {
    const { text, modelPath } = data || {};
    if (!text) throw new Error('memory:getEmbedding failed: text is missing');
    console.log(`[Main:Memory] Generating embedding for text: "${text.substring(0, 50)}..."`);
    if (modelPath) {
      console.log(`[Main:Memory] Using local model at: ${modelPath}`);
      await localEmbeddingService.init(modelPath);
    }
    const vector = await localEmbeddingService.embed(text);
    console.log(`[Main:Memory] Successfully generated vector of length: ${vector.length}`);
    return vector;
  });

  safeInvoke('memory:getStatus', async () => {
    return {
      status: localEmbeddingService.getStatus(),
      dimensions: memoryStorage?.getDimensions() || 0,
      totalCount: memoryStorage?.getTotalCount() || 0,
      modelPath: localEmbeddingService.getModelPath()
    };
  });

  safeInvoke('memory:list', async (data) => {
    const { limit } = data || {};
    return memoryStorage?.listDocuments(limit) || [];
  });

  safeInvoke('app:fetch', async (data) => {
    const { url, options } = data || {}
    if (!url) throw new Error('app:fetch failed: URL is missing')
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body
    };
  });

  ipcMain.handle('window:setTitle', (event, title: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.setTitle(title)
  })

  ipcMain.handle('app_exit', () => app.quit())
  ipcMain.handle('window_hide', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.hide()
  })

  safeInvoke('os:resolve', async (data) => {
    const p = typeof data === 'string' ? data : data?.path;
    if (!p) throw new Error('os:resolve failed: path is missing');
    const pathMod = await import('path')
    const osMod = await import('os')
    if (pathMod.isAbsolute(p)) return p
    return pathMod.resolve(osMod.homedir(), p)
  });

  safeInvoke('os:resolveResource', async (data) => {
    const p = typeof data === 'string' ? data : data?.path;
    if (!p) throw new Error('os:resolveResource failed: path is missing');
    const pathMod = await import('path')
    const rPath = app.isPackaged 
      ? process.resourcesPath 
      : join(__dirname, '../../resources')
    return join(rPath, p)
  });

  safeInvoke('fs:lstat', async (data) => {
    const pathStr = typeof data === 'string' ? data : data?.path;
    if (!pathStr) throw new Error('fs:lstat failed: path is missing');
    const fsNode = await import('fs/promises');
    const stats = await fsNode.lstat(pathStr);
    return {
      isSymbolicLink: stats.isSymbolicLink(),
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    }
  });

  ipcMain.handle('window_show', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.show()
  })

  ipcMain.on('ping', () => console.log('pong'))

  const mcpProcesses = new Map<string, ChildProcess>()

  safeInvoke('run_shell_command', async (data) => {
    const { command, cwd, background, timeout } = data || {}
    return new Promise((resolve) => {
      console.log(`[Main] Executing shell command: ${command}`)
      if (!command) return resolve({ stdout: '', stderr: 'Command missing', code: 1 });
      if (background) {
        const child = spawn(command, { shell: true, cwd: cwd || os.homedir(), detached: true, stdio: 'pipe' });
        let stdout = '';
        child.stdout?.on('data', (d) => { stdout += d.toString() });
        setTimeout(() => resolve({ stdout: stdout || 'Started', stderr: '', code: 0 }), 2000);
        child.unref();
        return;
      }
      exec(command, { cwd: cwd || os.homedir(), timeout: (timeout || 30) * 1000 }, (error: any, stdout: string, stderr: string) => {
        resolve({ stdout, stderr: stderr || (error ? error.message : ''), code: error ? (error.code || 1) : 0 });
      });
    })
  });

  safeInvoke('mcp_spawn', async (data) => {
    const { id, command, args, env } = data;
    try {
      console.log(`[Main] Spawning MCP server ${id}: ${command} ${args?.join(' ')}`)
      const child = spawn(command, args || [], { env: { ...process.env, ...env }, shell: true });
      mcpProcesses.set(id, child)
      child.stdout?.on('data', (data) => {
        const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
        webContents?.send(`event:mcp-msg-${id}`, data?.toString() || '')
      })
      child.stderr?.on('data', (data) => {
        const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
        webContents?.send(`event:mcp-err-${id}`, data?.toString() || '')
      })
      child.on('close', (code) => {
        const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
        webContents?.send(`event:mcp-close-${id}`, code)
        mcpProcesses.delete(id)
      })
      return true
    } catch (error) {
      console.error(`[Main] Failed to spawn MCP server ${id}:`, error)
      throw error
    }
  });

  ipcMain.handle('mcp_write', async (_, { id, message }) => {
    const child = mcpProcesses.get(id)
    if (!child) throw new Error(`MCP process ${id} not found`)
    return new Promise((resolve, reject) => {
      child.stdin?.write(message + '\n', (err) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
  })

  ipcMain.handle('mcp_kill', async (_, { id }) => {
    const child = mcpProcesses.get(id)
    if (child) {
      child.kill('SIGKILL')
      mcpProcesses.delete(id)
    }
    return true
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
