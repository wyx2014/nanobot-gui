import { BrowserWindow } from 'electron';
import crypto from 'crypto';
import http from 'http';
import { renderMarkdownHtml, renderMarkdownPdf } from './markdownPdf';

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

  get pdfUrl(): string {
    return `http://127.0.0.1:${this.port}/render-pdf`;
  }

  get htmlUrl(): string {
    return `http://127.0.0.1:${this.port}/render-html`;
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (request, response) => {
      if (
        request.method !== 'POST'
        || !['/render-mermaid', '/render-pdf', '/render-html'].includes(request.url || '')
        || request.headers.authorization !== `Bearer ${this.secret}`
      ) {
        response.writeHead(404).end();
        return;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 5_000_000) throw new Error('Render source is too large');
      }
      try {
        const payload = JSON.parse(body);
        if (request.url === '/render-pdf' || request.url === '/render-html') {
          if (typeof payload.markdown !== 'string') throw new Error('markdown is required');
          const title = typeof payload.title === 'string' && payload.title.trim()
            ? payload.title.trim()
            : 'Document';
          const sourcePath = typeof payload.source_path === 'string' ? payload.source_path : undefined;
          const template = payload.template === 'research_report' ? 'research_report' : 'simple';
          if (request.url === '/render-html') {
            const html = await renderMarkdownHtml(
              payload.markdown,
              title,
              (code) => this.render(code),
              sourcePath,
              template,
            );
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ html }));
          } else {
            const pdf = await renderMarkdownPdf(payload.markdown, title, (code) => this.render(code), sourcePath, template);
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
              pdf: pdf.toString('base64'),
            }));
          }
        } else {
          if (typeof payload.code !== 'string') throw new Error('code is required');
          const image = await this.render(payload.code);
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(image));
        }
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
