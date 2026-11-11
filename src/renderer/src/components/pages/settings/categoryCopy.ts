import type { InternalPageSection } from '@shared/internalPages'

/**
 * What a category says on its card (the Settings home): one line under the title and the few
 * groups a reader finds inside. The labels are the sections' own words, not a second menu with
 * its own names, so search and the card lead to the same groups.
 */
interface CategoryCopy {
  description: string
  items: readonly string[]
}

const COPY: Readonly<Record<string, CategoryCopy>> = {
  look: {
    description: 'Theme, toolbar and how pages look.',
    items: ['Theme', 'Toolbar', 'Layout', 'Fonts']
  },
  compact: {
    description: 'The hover-revealed sidebar.',
    items: ['Reveal on hover', 'Sidebar width']
  },
  newtab: {
    description: 'What a new tab opens with.',
    items: ['Shortcuts', 'Background', 'Greeting']
  },
  tabs: {
    description: 'Pinned tabs, Essentials and unloading.',
    items: ['Pinned tabs', 'Essentials', 'Session', 'Unloading']
  },
  performance: {
    description: 'Memory and battery savings.',
    items: ['Memory Saver', 'Energy Saver']
  },
  downloads: {
    description: 'Where downloads go and when they open.',
    items: ['Location', 'Save behaviour']
  },
  resources: {
    description: 'The browser’s process profile.',
    items: ['Memory limit', 'Startup switches', 'Log']
  },
  search: {
    description: 'Engines, suggestions and keywords.',
    items: ['Default engine', 'Suggestions', 'Keywords']
  },
  autofill: {
    description: 'Addresses, cards and saved logins.',
    items: ['Addresses', 'Payment methods', 'Passkeys']
  },
  languages: {
    description: 'Translation and spellcheck.',
    items: ['Preferred languages', 'Translation', 'Spellcheck']
  },
  privacy: {
    description: 'Blocking, cookies and site data.',
    items: ['Tracking protection', 'Cookies', 'Site data', 'HTTPS']
  },
  spaces: {
    description: 'Send sites to the right space.',
    items: ['Space rules', 'Domains']
  },
  containers: {
    description: 'Isolate accounts and cookies.',
    items: ['Containers', 'Sites']
  },
  boosts: {
    description: 'Restyle individual sites.',
    items: ['Saved boosts', 'Style editor']
  },
  mods: {
    description: 'Customize the browser chrome.',
    items: ['Installed mods', 'CSS']
  },
  extensions: {
    description: 'Installed extensions and the store.',
    items: ['Installed', 'Store', 'Developer']
  },
  apps: {
    description: 'Installed web apps.',
    items: ['Manage apps']
  },
  agents: {
    description: 'AI agent access and tokens.',
    items: ['Server', 'Tokens', 'Permissions']
  },
  passwords: {
    description: 'The password vault and generator.',
    items: ['Saved passwords', 'Checkup', 'Generator']
  },
  security: {
    description: 'Certificates, pop-ups and permissions.',
    items: ['Permissions', 'Certificates', 'Protocols']
  },
  account: {
    description: 'Your Ione account and devices.',
    items: ['Sign in', 'Devices']
  },
  sync: {
    description: 'Encrypted sync between devices.',
    items: ['What you sync', 'This device', 'Sync now']
  },
  import: {
    description: 'Bring data from another browser.',
    items: ['Bookmarks', 'Passwords', 'History']
  },
  accessibility: {
    description: 'Screen readers, caret browsing and read aloud.',
    items: ['Screen reader', 'Caret browsing', 'Read aloud']
  },
  shortcuts: {
    description: 'Keyboard shortcuts and mouse gestures.',
    items: ['Preset', 'Bindings']
  },
  'default-browser': {
    description: 'Make Ione your default browser.',
    items: ['Default apps', 'Registration']
  },
  updates: {
    description: 'Version, channel and update checks.',
    items: ['Channel', 'Check now', 'Release notes']
  },
  system: {
    description: 'Proxy and system integration.',
    items: ['Proxy', 'System']
  },
  reset: {
    description: 'Restore settings to their defaults.',
    items: ['Reset settings']
  },
  about: {
    description: 'Version, credits and legal.',
    items: ['Version', 'Credits', 'Legal']
  }
}

export function categoryDescription(section: InternalPageSection): string {
  return COPY[section.id]?.description ?? 'Settings for this part of Ione.'
}

export function categoryItems(section: InternalPageSection): readonly string[] {
  return COPY[section.id]?.items ?? []
}

