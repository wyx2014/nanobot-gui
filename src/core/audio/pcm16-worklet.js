/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class NanobotPcm16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.chunkSamples = 640;
    this.pending = [];
    this.carry = 0;
    this.sequence = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'config') {
        this.targetSampleRate = event.data.targetSampleRate || 16000;
        this.chunkSamples = Math.max(
          160,
          Math.round(this.targetSampleRate * ((event.data.chunkMs || 40) / 1000)),
        );
        return;
      }
      if (event.data?.type === 'flush') {
        if (this.pending.length > 0) {
          this.emit(this.pending.splice(0));
        }
        this.port.postMessage({ type: 'flushed', flushId: event.data.flushId });
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const converted = this.resample(input, sampleRate, this.targetSampleRate);
    for (const sample of converted) this.pending.push(sample);
    while (this.pending.length >= this.chunkSamples) {
      this.emit(this.pending.splice(0, this.chunkSamples));
    }
    return true;
  }

  emit(samples) {
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[index]));
      pcm[index] = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    }
    this.port.postMessage(
      {
        type: 'pcm16',
        pcm16: pcm.buffer,
        sequence: this.sequence,
        durationMs: pcm.length / this.targetSampleRate * 1000,
        sampleRate: this.targetSampleRate,
      },
      [pcm.buffer],
    );
    this.sequence += 1;
  }

  resample(input, fromRate, toRate) {
    if (fromRate === toRate) return Array.from(input);
    const ratio = fromRate / toRate;
    const output = [];
    let sourceIndex = this.carry;
    while (sourceIndex < input.length - 1) {
      const left = Math.floor(sourceIndex);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = sourceIndex - left;
      output.push(input[left] + (input[right] - input[left]) * fraction);
      sourceIndex += ratio;
    }
    this.carry = sourceIndex - input.length;
    return output;
  }
}

registerProcessor('nanobot-pcm16-worklet', NanobotPcm16Worklet);
