interface AppConfig {
  wipApiUrl: string
  basePath: string
}

let _config: AppConfig | null = null

export function getConfig(): AppConfig {
  if (!_config) {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    _config = {
      wipApiUrl: `${origin}${base}`, // e.g. "https://wip-kubi.local/apps/clintrial"
      basePath: import.meta.env.BASE_URL || '/',
    }
  }
  return _config
}

// Legacy export for existing imports
export const config = new Proxy({} as AppConfig, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof AppConfig]
  },
})
