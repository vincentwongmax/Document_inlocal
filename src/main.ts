import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
// 註冊 Service Worker（副作用）
import './lib/pwa'
// iOS 捲動基準護欄（副作用；0.1.25 修「點過輸入框後連點空白處頁面會往上滑」）
import { installIosScrollGuard } from './lib/iosScrollGuard'

installIosScrollGuard()

createApp(App).use(createPinia()).use(router).mount('#app')
