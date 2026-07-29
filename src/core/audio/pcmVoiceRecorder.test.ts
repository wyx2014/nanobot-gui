import { describe, expect, it } from 'vitest';

import {
  encodePcm16ChunksWav,
  encodePcm16Wav,
  resampleMonoPcm,
} from './pcmVoiceRecorder';

describe('PCM voice recorder encoding', () => {
  it('downsamples mono audio to the requested rate', () => {
    const input = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 10));
    const output = resampleMonoPcm(input, 48_000, 16_000);

    expect(output).toHaveLength(16_000);
  });

  it('writes a 16 kHz mono PCM16 WAV accepted by the ASR service', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16_000);
    const view = new DataView(wav.buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...wav.slice(offset, offset + length));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
  });

  it('wraps streamed PCM16 chunks without changing their bytes', () => {
    const first = new Uint8Array([1, 2, 3, 4]);
    const second = new Uint8Array([5, 6]);
    const wav = encodePcm16ChunksWav([first, second]);
    const view = new DataView(wav.buffer);

    expect(view.getUint32(40, true)).toBe(6);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
