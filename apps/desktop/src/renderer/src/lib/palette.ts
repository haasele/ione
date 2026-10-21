export interface PaletteCommand {
  id: string
  label: string
  detail?: string
  keywords?: string
  run: () => void
}
