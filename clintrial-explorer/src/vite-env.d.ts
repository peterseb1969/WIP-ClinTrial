/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WIP_HOST: string
  readonly VITE_WIP_API_KEY: string
  readonly VITE_BASE_PATH: string
  readonly VITE_APP_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
