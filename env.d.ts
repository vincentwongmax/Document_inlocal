/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'spark-md5' {
  const SparkMD5: any
  export default SparkMD5
}

/** 由 vite.config.ts 的 define 注入（＝ package.json 的 version） */
declare const __APP_VERSION__: string
