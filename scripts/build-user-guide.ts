import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const source = await readFile('docs/USER_GUIDE.zh-TW.md', 'utf8')
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
const chapters = [...source.matchAll(/^## (.+)$/gm)].map((m) => m[1])
const components: Components = {
  h2: ({ children }) => createElement('h2', { id: slug(String(children)) }, children),
}
const body = renderToStaticMarkup(
  createElement(Markdown, { children: source, remarkPlugins: [remarkGfm], components }),
)
const nav = renderToStaticMarkup(
  createElement(
    'nav',
    { 'aria-label': '章節' },
    chapters.map((title) => createElement('a', { key: title, href: '#' + slug(title) }, title)),
  ),
)
const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'"><title>AgentHub 使用手冊</title><style>
:root{color-scheme:light dark;--bg:#fafaf8;--ink:#252923;--muted:#686f65;--line:#dce0d6;--soft:#f0f2ec;--accent:#365d3c}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.9 system-ui,"Microsoft JhengHei",sans-serif}nav{position:fixed;inset:0 auto 0 0;width:265px;overflow:auto;border-right:1px solid var(--line);padding:28px 22px}nav:before{content:"AgentHub · 使用手冊";display:block;font-weight:700;margin-bottom:18px}nav a{display:block;font-size:12px;padding:6px 0;text-decoration:none}main{max-width:1140px;margin-left:265px;padding:45px 55px 100px}h1{font-size:32px;letter-spacing:-.5px}h2{font-size:23px;margin-top:50px;border-top:1px solid var(--line);padding-top:26px}p,li{overflow-wrap:anywhere}a{color:var(--accent)}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}code{background:var(--soft);padding:2px 5px;border-radius:4px;font:12px/1.7 Consolas,monospace}pre{overflow:auto;background:var(--soft);padding:18px;border:1px solid var(--line);border-radius:9px}pre code{padding:0}table{display:block;overflow:auto;border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:10px 14px;text-align:left;vertical-align:top;min-width:125px}th{background:var(--soft)}li{margin-block:7px}blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:18px;color:var(--muted)}@media(prefers-color-scheme:dark){:root{--bg:#151813;--ink:#e3e8df;--muted:#a8b2a1;--line:#3a4434;--soft:#232a1f;--accent:#add3a7}}@media(max-width:900px){nav{position:static;width:auto;max-height:260px;border-right:0;border-bottom:1px solid var(--line)}main{margin:0;padding:22px 22px 70px}}@media print{nav{display:none}main{margin:0;padding:0;max-width:none}h2{break-after:avoid}pre,table{overflow:visible}a{color:inherit}body{font-size:11pt}}
</style></head><body>${nav}<main>${body}</main></body></html>`
await writeFile('docs/USER_GUIDE.html', html)
const release = join('release', version)
await mkdir(release, { recursive: true })
await writeFile(join(release, `AgentHub-${version}-UserGuide.html`), html)
console.log(`Built offline handbook: ${chapters.length} chapters, version ${version}`)
