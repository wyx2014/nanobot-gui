/**
 * sandbox.ts
 * Client for interacting with the Mini-Agent Sandbox Server for secure code execution and AI file generation.
 */

export interface SlideData {
  title: string;
  content: string;
}

export interface PptxGenerationRequest {
  topic: string;
  slides?: SlideData[];
}

export type PptxProgressEvent =
  | { event: 'status';       data: { message: string; step?: string } }
  | { event: 'heartbeat';    data: { ts: number } }
  | { event: 'slide_written'; data: { filename: string } }
  | { event: 'done';         data: { message: string; download_url: string } }
  | { event: 'error';        data: { message: string } };

export type PptxProgressCallback = (evt: PptxProgressEvent) => void;

export class SandboxService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  // ─────────────────────────────────────────────────────────────
  // New streaming API
  // ─────────────────────────────────────────────────────────────

  /**
   * Start an async PPTX generation job.
   * Returns immediately with a job_id.
   */
  async startPptxJob(request: PptxGenerationRequest): Promise<{ job_id: string }> {
    const response = await fetch(`${this.baseUrl}/api/generate-pptx/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: request.topic }),
    });

    if (!response.ok) {
      throw new Error(`Failed to start PPTX job: ${statusText(response)}`);
    }

    return response.json() as Promise<{ job_id: string }>;
  }

  /**
   * Subscribe to SSE progress events for a job.
   * Calls `onProgress` for every event received.
   * Returns the EventSource so the caller can close it if needed.
   *
   * Resolves the returned Promise once a `done` or `error` event is received.
   */
  streamPptxProgress(
    jobId: string,
    onProgress: PptxProgressCallback,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const es = new EventSource(`${this.baseUrl}/api/generate-pptx/progress/${jobId}`);

      const handleEvent = (rawEvent: string, rawData: string) => {
        try {
          const data = JSON.parse(rawData);
          const evt = { event: rawEvent, data } as PptxProgressEvent;
          onProgress(evt);

          if (rawEvent === 'done') {
            es.close();
            resolve();
          } else if (rawEvent === 'error') {
            es.close();
            reject(new Error(data.message || 'PPTX generation failed'));
          }
        } catch (e) {
          console.warn('[sandbox] SSE parse error:', e);
        }
      };

      // EventSource fires named events via addEventListener
      for (const evtName of ['status', 'heartbeat', 'slide_written', 'done', 'error']) {
        es.addEventListener(evtName, (e: Event) => {
          handleEvent(evtName, (e as MessageEvent).data);
        });
      }

      es.onerror = (err) => {
        console.error('[sandbox] SSE connection error:', err);
        es.close();
        reject(new Error('SSE connection failed'));
      };
    });
  }

  /**
   * Download the completed PPTX file for a finished job and trigger a browser download.
   */
  async downloadPptxFile(jobId: string, filename: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/generate-pptx/download/${jobId}`);

    if (!response.ok) {
      throw new Error(`Failed to download PPTX: ${statusText(response)}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  // ─────────────────────────────────────────────────────────────
  // Legacy (blocking) API — kept for backward compatibility
  // ─────────────────────────────────────────────────────────────

  /**
   * @deprecated Use startPptxJob + streamPptxProgress + downloadPptxFile instead.
   * Generates a PPTX from a topic and triggers a browser download (blocking).
   */
  async generateAndDownloadPptx(request: PptxGenerationRequest): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate-pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate PPTX: ${statusText(response)}`);
      }

      const blob = await response.blob();

      let filename = `${request.topic.replace(/\s+/g, '_')}.pptx`;
      const contentDisposition = response.headers.get('Content-Disposition');
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error in generateAndDownloadPptx:', error);
      throw error;
    }
  }
}

// Global singleton instance
export const sandboxService = new SandboxService();

function statusText(res: Response): string {
  return res.statusText || `HTTP ${res.status}`;
}
