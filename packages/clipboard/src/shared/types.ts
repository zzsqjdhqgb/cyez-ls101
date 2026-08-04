export interface ClipboardBridge {
  readImage(): Promise<Uint8Array | null>
  writeText(text: string): Promise<void>
}

export interface ImageClipboard {
  readImage(): Promise<Uint8Array | null>
  writeText(text: string): Promise<void>
}
