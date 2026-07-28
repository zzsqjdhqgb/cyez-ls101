import type { FileDialog, ReadFileOptions, SelectedFile, WriteFileOptions } from '../shared/types'
import { validateReadFileOptions, validateWriteFileOptions } from '../shared/validation'
import { getFileDialogBridge } from './bridge'

export class FileDialogImpl implements FileDialog {
  readBinary(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null> {
    validateReadFileOptions(options)
    return getFileDialogBridge().read(options)
  }

  async readText(options?: ReadFileOptions): Promise<SelectedFile<string> | null> {
    const file = await this.readBinary(options)
    if (!file) return null

    return {
      name: file.name,
      data: new TextDecoder('utf-8', { fatal: true }).decode(file.data)
    }
  }

  writeBinary(data: Uint8Array, options?: WriteFileOptions): Promise<boolean> {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError('File-dialog data must be a Uint8Array')
    }
    validateWriteFileOptions(options)
    return getFileDialogBridge().write(data, options)
  }

  writeText(data: string, options?: WriteFileOptions): Promise<boolean> {
    if (typeof data !== 'string') throw new TypeError('File-dialog text must be a string')
    return this.writeBinary(new TextEncoder().encode(data), options)
  }
}
