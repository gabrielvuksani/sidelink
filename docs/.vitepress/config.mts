import { defineConfig } from 'vitepress';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'sidelink';
const docsBase = process.env.GITHUB_ACTIONS === 'true' ? `/${repoName}/` : '/';

export default defineConfig({
  title: 'Sidelink Docs',
  description: 'Self-hosted iOS sideload manager documentation',
  lang: 'en-US',
  base: docsBase,
  cleanUrls: true,
  head: [
    ['meta', { name: 'theme-color', content: '#0f766e' }],
    ['meta', { property: 'og:title', content: 'Sidelink Docs' }],
    ['meta', { property: 'og:description', content: 'Release, desktop, helper, and operational docs for Sidelink.' }],
    ['meta', { property: 'og:type', content: 'website' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/cli-reference' },
      { text: 'Release Notes', link: '/release-notes' },
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
          { text: 'Release Notes', link: '/release-notes' },
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
    outline: { label: 'On this page' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/gabrielvuksani/sidelink' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/gabrielvuksani/sidelink/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Local-first sideloading docs for desktop, web, and helper workflows.',
      copyright: 'MIT Licensed',
    },
  },
});
