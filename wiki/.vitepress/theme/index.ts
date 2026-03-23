/**
 * VitePress Custom Theme for sndbrd Wiki
 * Extends the default theme with enhanced styling and React support
 */

import DefaultTheme from 'vitepress/theme'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // Register any global Vue components here if needed
    // React components can be used via @vitejs/plugin-react
  }
}
