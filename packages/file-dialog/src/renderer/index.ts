import type { FileDialog } from '../shared/types'
import { FileDialogImpl } from './FileDialog'

export type {
  FileDialog,
  FileDialogFilter,
  ReadFileOptions,
  SelectedFile,
  WriteFileOptions
} from '../shared/types'

export const fileDialog: FileDialog = new FileDialogImpl()
