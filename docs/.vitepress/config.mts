import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Sidelink Docs',
  description: 'Self-hosted iOS sideload manager documentation',
  lang: 'en-US',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/cli-reference' },
      { text: 'API', link: '/api-reference' },
      { text: 'GitHub', link: 'https://github.com/gabrielvuksani/sidelink' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Desktop App', link: '/desktop-app' },
          { text: 'iOS Helper', link: '/ios-helper' },
          { text: 'Configuration', link: '/configuration' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI Commands', link: '/cli-reference' },
          { text: 'API Reference', link: '/api-reference' },
          { text: 'Architecture', link: '/architecture' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'FAQ', link: '/faq' },
          { text: 'Security', link: '/security' },
        ],
      },
      {
        text: 'Contributing',
        items: [{ text: 'Development Guide', link: '/contributing' }],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/gabrielvuksani/sidelink' }],
    search: { provider: 'local' },
  },
});
