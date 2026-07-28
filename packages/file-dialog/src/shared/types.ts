export interface FileDialogFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

export interface ReadFileOptions {
  readonly title?: string
  readonly filters?: readonly FileDialogFilter[]
}

export interface WriteFileOptions {
  readonly title?: string
  readonly defaultName?: string
  readonly filters?: readonly FileDialogFilter[]
}

export interface SelectedFile<T> {
  readonly name: string
  readonly data: T
}

export interface FileDialog {
  readBinary(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null>
  readText(options?: ReadFileOptions): Promise<SelectedFile<string> | null>
  writeBinary(data: Uint8Array, options?: WriteFileOptions): Promise<boolean>
  writeText(data: string, options?: WriteFileOptions): Promise<boolean>
}

export interface FileDialogBridge {
  read(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null>
  write(data: Uint8Array, options?: WriteFileOptions): Promise<boolean>
}
