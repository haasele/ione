import type { Essential, Folder, Space, Tab } from './model'

export type SpacePatch = Partial<Pick<Space, 'name' | 'icon' | 'theme' | 'order'>> & {
  /** `null` clears the partition. */
  partitionId?: string | null
}

export type FolderPatch = Partial<Pick<Folder, 'name' | 'collapsed' | 'order'>> & {
  /** `null` clears the RSS feed URL. */
  feedUrl?: string | null
}

export type TabPatch = Partial<
  Pick<Tab, 'url' | 'title' | 'favicon' | 'lastActive' | 'scrollY' | 'sleeping' | 'order'>
> & {
  /** `null` clears the pinned URL. */
  pinnedUrl?: string | null
}

export type EssentialPatch = Partial<Pick<Essential, 'url' | 'title' | 'favicon' | 'order'>>

export type BrowserAction =
  | { type: 'space.add'; space: Space }
  | { type: 'space.update'; id: string; patch: SpacePatch }
  | { type: 'space.remove'; id: string }
  | { type: 'space.activate'; id: string }
  | { type: 'tab.add'; tab: Tab }
  | { type: 'tab.update'; id: string; patch: TabPatch }
  | { type: 'tab.remove'; id: string }
  | { type: 'tab.activate'; id: string; at: number }
  | { type: 'tab.pin'; id: string }
  | { type: 'tab.unpin'; id: string }
  | { type: 'tab.resetToPinned'; id: string }
  | { type: 'tab.move'; id: string; spaceId: string; folderId: string | null; order: string }
  | { type: 'folder.add'; folder: Folder }
  | { type: 'folder.update'; id: string; patch: FolderPatch }
  | { type: 'folder.move'; id: string; parentId: string | null; order: string }
  | { type: 'folder.remove'; id: string }
  | { type: 'essential.add'; essential: Essential }
  | { type: 'essential.update'; id: string; patch: EssentialPatch }
  | { type: 'essential.remove'; id: string }
