export interface ClipboardBridge {
  readImage(): Promise<Uint8Array | null>
}

export interface ImageClipboard {
  readImage(): Promise<Uint8Array | null>
}
