import { uint8ArrayToBase64 } from '@/utils/base64';

const TARGET_SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;

export interface VoiceRecordingResult {
  dataUrl: string;
  durationMs: number;
  byteLength: number;
}

export interface VoiceAudioChunk {
  pcm16: ArrayBuffer;
  sequence: number;
  durationMs: number;
  sampleRate: number;
}

export interface PcmVoiceRecorderOptions {
  chunkMs?: number;
  onChunk?: (chunk: VoiceAudioChunk) => void;
}

export interface PcmVoiceRecorder {
  stop: () => Promise<VoiceRecordingResult>;
  cancel: () => Promise<void>;
}

type WorkletMessage =
  | {
      type: 'pcm16';
      pcm16: ArrayBuffer;
      sequence: number;
      durationMs: number;
      sampleRate: number;
    }
  | { type: 'flushed'; flushId: number };

export function resampleMonoPcm(
  input: Float32Array,
  sourceRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (!input.length || sourceRate <= 0 || targetRate <= 0) return new Float32Array();
  if (sourceRate === targetRate) return input.slice();
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = outputIndex * ratio;
    const end = Math.min(input.length, (outputIndex + 1) * ratio);
    const first = Math.floor(start);
    const last = Math.max(first + 1, Math.ceil(end));
    let sum = 0;
    let weight = 0;
    for (let inputIndex = first; inputIndex < last && inputIndex < input.length; inputIndex += 1) {
      const sampleStart = Math.max(start, inputIndex);
      const sampleEnd = Math.min(end, inputIndex + 1);
      const sampleWeight = Math.max(0, sampleEnd - sampleStart);
      sum += input[inputIndex] * sampleWeight;
      weight += sampleWeight;
    }
    output[outputIndex] = weight > 0 ? sum / weight : input[Math.min(first, input.length - 1)];
  }
  return output;
}

export function encodePcm16Wav(
  input: Float32Array,
  sourceRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Uint8Array {
  const samples = resampleMonoPcm(input, sourceRate, targetRate);
  const bytes = new Uint8Array(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + index * 2, Math.round(pcm), true);
  }
  return bytes;
}

export function encodePcm16ChunksWav(
  chunks: Uint8Array[],
  sampleRate: number = TARGET_SAMPLE_RATE,
): Uint8Array {
  const pcmLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(WAV_HEADER_BYTES + pcmLength);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmLength, true);
  let offset = WAV_HEADER_BYTES;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function startPcmVoiceRecorder(
  options: PcmVoiceRecorderOptions = {},
): Promise<PcmVoiceRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('microphone_not_supported');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const AudioContextCtor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('audio_context_not_supported');
  }

  const context = new AudioContextCtor();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  const pcmChunks: Uint8Array[] = [];
  let finished = false;
  const startedAt = performance.now();
  let worklet: AudioWorkletNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  const chunkMs = options.chunkMs ?? 40;
  const fallbackPending: number[] = [];
  let fallbackSequence = 0;

  const emitFallbackFrame = (frame: number[]) => {
    if (frame.length === 0) return;
    const pcm = new Int16Array(frame.length);
    for (let index = 0; index < frame.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, frame[index]));
      pcm[index] = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    }
    const stored = new Uint8Array(pcm.buffer.slice(0));
    pcmChunks.push(stored);
    options.onChunk?.({
      pcm16: pcm.buffer,
      sequence: fallbackSequence,
      durationMs: pcm.length / TARGET_SAMPLE_RATE * 1000,
      sampleRate: TARGET_SAMPLE_RATE,
    });
    fallbackSequence += 1;
  };

  try {
    await context.audioWorklet.addModule(
      new URL('./pcm16-worklet.js', import.meta.url).href,
    );
    worklet = new AudioWorkletNode(context, 'nanobot-pcm16-worklet', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      if (event.data.type !== 'pcm16' || finished) return;
      const stored = new Uint8Array(event.data.pcm16.slice(0));
      pcmChunks.push(stored);
      options.onChunk?.({
        pcm16: event.data.pcm16,
        sequence: event.data.sequence,
        durationMs: event.data.durationMs,
        sampleRate: event.data.sampleRate,
      });
    };
    worklet.port.postMessage({
      type: 'config',
      targetSampleRate: TARGET_SAMPLE_RATE,
      chunkMs,
    });
    source.connect(worklet);
    worklet.connect(silentGain);
  } catch {
    processor = context.createScriptProcessor(1024, 1, 1);
    processor.onaudioprocess = (event) => {
      if (finished) return;
      const input = event.inputBuffer.getChannelData(0).slice();
      const resampled = resampleMonoPcm(input, event.inputBuffer.sampleRate);
      for (const sample of resampled) fallbackPending.push(sample);
      const chunkSamples = Math.max(
        160,
        Math.round(TARGET_SAMPLE_RATE * chunkMs / 1000),
      );
      while (fallbackPending.length >= chunkSamples) {
        emitFallbackFrame(fallbackPending.splice(0, chunkSamples));
      }
    };
    source.connect(processor);
    processor.connect(silentGain);
  }
  silentGain.connect(context.destination);

  const flushWorklet = async () => {
    if (!worklet) {
      emitFallbackFrame(fallbackPending.splice(0));
      return;
    }
    const flushId = Date.now() + Math.random();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worklet?.port.removeEventListener('message', handleMessage);
        resolve();
      };
      const handleMessage = (event: MessageEvent<WorkletMessage>) => {
        if (event.data.type === 'flushed' && event.data.flushId === flushId) {
          finish();
        }
      };
      const timer = setTimeout(finish, 250);
      worklet.port.addEventListener('message', handleMessage);
      worklet.port.postMessage({ type: 'flush', flushId });
    });
  };

  const cleanup = async () => {
    if (finished) return;
    finished = true;
    if (processor) processor.onaudioprocess = null;
    if (worklet) worklet.port.onmessage = null;
    source.disconnect();
    processor?.disconnect();
    worklet?.disconnect();
    silentGain.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
  };

  return {
    stop: async () => {
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      await flushWorklet();
      const wav = encodePcm16ChunksWav(pcmChunks);
      await cleanup();
      if (wav.byteLength <= WAV_HEADER_BYTES) throw new Error('empty_recording');
      return {
        dataUrl: `data:audio/wav;base64,${uint8ArrayToBase64(wav)}`,
        durationMs,
        byteLength: wav.byteLength,
      };
    },
    cancel: cleanup,
  };
}
