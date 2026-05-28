class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputSampleRate = sampleRate;
    this.outputSampleRate = 16000;
    this.cache = [];
    this.chunkSize = Math.floor(this.inputSampleRate * 0.08); // ~80ms
  }

  process(inputs) {
    const input = inputs[0];

    if (!input || !input[0]) {
      return true;
    }

    const channelData = input[0];

    for (let i = 0; i < channelData.length; i += 1) {
      this.cache.push(channelData[i]);
    }

    while (this.cache.length >= this.chunkSize) {
      const chunk = this.cache.splice(0, this.chunkSize);
      const resampled = this.resample(Float32Array.from(chunk));
      const pcm16 = this.floatToPCM16(resampled);

      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }

  resample(input) {
    if (this.inputSampleRate === this.outputSampleRate) {
      return input;
    }

    const ratio = this.inputSampleRate / this.outputSampleRate;
    const outputLength = Math.round(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const sourceIndex = i * ratio;
      const before = Math.floor(sourceIndex);
      const after = Math.min(before + 1, input.length - 1);
      const weight = sourceIndex - before;

      output[i] = input[before] * (1 - weight) + input[after] * weight;
    }

    return output;
  }

  floatToPCM16(input) {
    const output = new Int16Array(input.length);

    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return output;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
