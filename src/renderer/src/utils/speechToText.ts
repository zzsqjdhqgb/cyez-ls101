/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

export async function speechToText(rid: string, recordIndex: number): Promise<string> {
  return window.electronAPI.grading.speechToText(rid, recordIndex)
}
