/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class DictationPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchSize = Math.floor(sampleRate / 10);
    this.samples = new Float32Array(this.batchSize);
    this.length = 0;
    this.flushed = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type !== "flush" || this.flushed) return;
      this.flushed = true;
      if (this.length) this.sendSamples(this.samples.slice(0, this.length));
      this.port.postMessage({ type: "flushed" });
    };
  }

  sendSamples(samples) {
    this.port.postMessage({ type: "audio", samples }, [samples.buffer]);
  }

  process(inputs) {
    if (this.flushed) return false;
    const mono = inputs[0]?.[0];
    if (!mono) return true;
    let read = 0;
    while (read < mono.length) {
      const count = Math.min(this.batchSize - this.length, mono.length - read);
      this.samples.set(mono.subarray(read, read + count), this.length);
      this.length += count;
      read += count;
      if (this.length === this.batchSize) {
        this.sendSamples(this.samples);
        this.samples = new Float32Array(this.batchSize);
        this.length = 0;
      }
    }
    // Outputs remain zero-filled: this keeps the worklet active without playback.
    return true;
  }
}

registerProcessor("dictation-pcm", DictationPcmProcessor);
