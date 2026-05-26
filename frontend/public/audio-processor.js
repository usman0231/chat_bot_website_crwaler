/*
 * AudioWorklet that accumulates microphone samples and posts fixed-size
 * 1600-sample frames (100 ms @ 16 kHz) back to the main thread.
 *
 * Each posted frame includes per-chunk RMS energy and a dynamic threshold
 * derived from the first ~1 s of ambient audio. The main thread uses
 * is_speech to detect interruptions (multiple consecutive speech frames
 * mean the user is talking over the bot — barge in).
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 1600; // 100 ms @ 16 kHz
    this._baselineRms = 0;
    this._calibrationFrames = 0;
    this._calibrationFramesNeeded = 10; // ~1 s
    this._isCalibrated = false;
  }

  _rms(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i];
      sum += v * v;
    }
    return Math.sqrt(sum / buffer.length);
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this._buffer.push(input[i]);
    }

    while (this._buffer.length >= this._bufferSize) {
      const chunk = new Float32Array(
        this._buffer.splice(0, this._bufferSize),
      );
      const rms = this._rms(chunk);

      // Calibrate ambient noise floor for the first ~1 s of the call.
      if (!this._isCalibrated) {
        this._calibrationFrames++;
        this._baselineRms =
          (this._baselineRms * (this._calibrationFrames - 1) + rms) /
          this._calibrationFrames;
        if (this._calibrationFrames >= this._calibrationFramesNeeded) {
          this._isCalibrated = true;
        }
      }

      // Dynamic threshold: 3x ambient, floor at 0.008.
      const threshold = Math.max(this._baselineRms * 3, 0.008);
      const is_speech = this._isCalibrated && rms > threshold;

      this.port.postMessage(
        {
          type: "audio_chunk",
          data: chunk.buffer,
          rms,
          threshold,
          is_speech,
          calibrated: this._isCalibrated,
        },
        [chunk.buffer],
      );
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
