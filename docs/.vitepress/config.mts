import { defineConfig } from 'vitepress';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'sidelink';
const docsBase = process.env.GITHUB_ACTIONS === 'true' ? `/${repoName}/` : '/';

export default defineConfig({
  title: 'SideLink Docs',
  description: 'Setup, helper, source, release, and troubleshooting documentation for SideLink.',
  lang: 'en-US',
  base: docsBase,
  cleanUrls: true,
  head: [
    ['meta', { name: 'theme-color', content: '#0f766e' }],
    ['meta', { property: 'og:title', content: 'SideLink Docs' }],
    ['meta', { property: 'og:description', content: 'Complete SideLink docs for setup, installs, helper pairing, source downloads, and release operations.' }],
    ['meta', { property: 'og:type', content: 'website' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/getting-started' },
      { text: 'Source', link: '/official-source' },
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
          { text: 'Official Source', link: '/official-source' },
        ],
      },
      {
        text: 'Release & Distribution',
        items: [
          { text: 'Official Source', link: '/official-source' },
          { text: 'Release Notes', link: '/release-notes' },
          { text: 'CLI Commands', link: '/cli-reference' },
          { text: 'Development Guide', link: '/contributing' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api-reference' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Security', link: '/security' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'FAQ', link: '/faq' },
        ],
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
      message: 'Local-first sideloading docs for desktop, source, and helper workflows.',
      copyright: 'MIT Licensed',
    },
  },
});
