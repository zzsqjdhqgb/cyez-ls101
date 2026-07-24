/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/tts/ptts_wasm.d.ts

export class Model {
  constructor(model_weights: Uint8Array, quant: string)

  /**
   * Add a voice embedding, returns the voice index.
   */
  add_voice(voice_weights: Uint8Array): number

  /**
   * Performs one generation step.
   * Returns a Float32Array of audio samples, or undefined if generation finished.
   */
  generation_step(): Float32Array | undefined

  /**
   * Prepare text for generation.
   * Returns [processed_text, frames_after_eos].
   */
  prepare_text(text: string): [string, number]

  /**
   * Start generation with the given token ids.
   */
  start_generation(
    voice_index: number,
    token_ids: Uint32Array,
    frames_after_eos: number,
    temperature: number
  ): void

  /**
   * Get the sample rate of the model.
   */
  sample_rate(): number

  free(): void
}

/**
 * Initialize the WASM module synchronously.
 * @param module_or_path - A WebAssembly.Module, Buffer, or path.
 */
export function initSync(module_or_path: BufferSource | WebAssembly.Module): void

/**
 * Returns an object describing CPU features used by the WASM build.
 */
export function cpu_features(): Record<string, boolean>
