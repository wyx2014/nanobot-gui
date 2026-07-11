import { BrowserWindow } from 'electron';
import crypto from 'crypto';
import http from 'http';

type Image = { png: string; width: number; height: number };
type Pending = { resolve: (image: Image) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class MermaidBridge {
  private readonly secret = crypto.randomBytes(32).toString('hex');
  private readonly pending = new Map<string, Pending>();
  private server: http.Server | null = null;
  private port = 0;

  get url(): string {
    return `http://127.0.0.1:${this.port}/render-mermaid`;
  }

  get token(): string {
    return this.secret;
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/render-mermaid' || request.headers.authorization !== `Bearer ${this.secret}`) {
        response.writeHead(404).end();
        return;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1_000_000) throw new Error('Mermaid source is too large');
      }
      try {
        const code = JSON.parse(body).code;
        if (typeof code !== 'string') throw new Error('code is required');
        const image = await this.render(code);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(image));
      } catch (error) {
        response.writeHead(422, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(error) }));
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as { port: number }).port;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  complete(id: string, result: { image?: Image; error?: string }): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (result.image) {
      pending.resolve(result.image);
    } else {
      pending.reject(new Error(result.error || 'Mermaid render failed'));
    }
  }

  private render(code: string): Promise<Image> {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return Promise.reject(new Error('Renderer is unavailable'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Mermaid render timed out'));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      window.webContents.send('mermaid:render', { id, code });
    });
  }
}
