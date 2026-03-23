import { defineConfig } from 'vitepress'
import react from '@vitejs/plugin-react'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  title: 'sndbrd',
  description: 'Real-time voice API engine with OpenAI-compatible WebSocket protocol',
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  
  // Logo configuration
  head: [
    ['link', { rel: 'icon', href: '/logo.svg' }]
  ],
  
  vite: {
    plugins: [
      react()
    ]
  },
  
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },
  
  // Mermaid configuration
  mermaid: {
    theme: 'default',
    startOnLoad: true,
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis'
    }
  },
  
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API', link: '/api/websocket' },
      { text: 'Providers', link: '/providers/stt' },
      { text: 'Deployment', link: '/deployment/cloudflare' }
    ],
    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/getting-started' },
            { text: 'Tutorials', link: '/tutorials/voice-agent' },
            { text: 'Troubleshooting', link: '/troubleshooting' }
          ]
        }
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Request Flow', link: '/architecture/request-flow' },
            { text: 'Components', link: '/architecture/components' },
            { text: 'Connection Paradigms', link: '/architecture/connection-paradigms' }
          ]
        }
      ],
      '/guides/': [
        {
          text: 'Guides',
          collapsed: false,
          items: [
            { text: 'Error Handling', link: '/guides/error-handling' },
            { text: 'Performance', link: '/guides/performance' },
            { text: 'Security', link: '/guides/security' }
          ]
        }
      ],
      '/examples/': [
        {
          text: 'Examples',
          collapsed: false,
          items: [
            { text: 'Mermaid Diagrams', link: '/examples/mermaid-example' },
            { text: 'Vue Components', link: '/examples/vue-components' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          collapsed: false,
          items: [
            { text: 'WebSocket Protocol', link: '/api/websocket' },
            { text: 'Authentication', link: '/api/authentication' },
            { text: 'Events Reference', link: '/api/events' }
          ]
        }
      ],
      '/providers/': [
        {
          text: 'Providers',
          collapsed: false,
          items: [
            { text: 'Speech-to-Text', link: '/providers/stt' },
            { text: 'Text-to-Speech', link: '/providers/tts' },
            { text: 'LLM', link: '/providers/llm' },
            { text: 'VAD', link: '/providers/vad' }
          ]
        }
      ],
      '/deployment/': [
        {
          text: 'Deployment',
          collapsed: false,
          items: [
            { text: 'Cloudflare Workers', link: '/deployment/cloudflare' },
            { text: 'Environment Variables', link: '/deployment/env-vars' },
            { text: 'Local Development', link: '/deployment/local-dev' }
          ]
        }
      ]
    },
    outline: {
      label: 'On This Page',
      level: [2, 3]
    },
    search: {
      provider: 'local'
    },
    docFooter: {
      prev: 'Previous',
      next: 'Next'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com' }
    ],
    footer: {
      message: 'Built with ❤️ for the voice AI community',
      copyright: 'Copyright © 2024-present'
    }
  }
})
