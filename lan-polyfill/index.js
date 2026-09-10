/**
 * index.js — metà host del bundle `lan-polyfill`.
 *
 * Serve tre file statici del bundle e ne inietta i tag in testa all'index:
 *
 *   /__lan-polyfill.js   polyfill di crypto.randomUUID, script bloccante
 *   /__lan-mobile.css    vestizione per smartphone
 *   /__lan-mobile.js     pulsante flottante + velo per la sidebar a drawer
 *
 * Perché uno `<script src>` e non l'iniezione diretta del codice: uno script con
 * `src` è uno script classico bloccante, quindi viene eseguito prima che il resto
 * del documento prosegua. Il polyfill è installato prima che qualunque codice DSH
 * possa chiamare `randomUUID`, senza dipendere dall'ordine con cui il kernel
 * cliente importa i suoi moduli.
 *
 * Gli asset sono letti una volta all'avvio. Se uno manca, la riga si degrada in
 * modo visibile: logga e continua a servire ciò che può, invece di impedire il boot.
 */

import { readFileSync } from 'node:fs'
import { SCRIPT_BODY, SCRIPT_PATH } from './polyfill.js'

export const inject = ['webServer']

export const name = 'lan-polyfill'

const CSS_PATH = '/__lan-mobile.css'
const SCRIPT_MOBILE_PATH = '/__lan-mobile.js'

function readAsset(name) {
  const url = new URL(name, import.meta.url)
  try {
    return readFileSync(url, 'utf8')
  } catch (error) {
    console.error('[lan-polyfill] asset NON leggibile:', name, '->', url.href, '|', error && error.message ? error.message : error)
    return ''
  }
}

const MOBILE_CSS = readAsset('./mobile.css')
const MOBILE_SCRIPT = readAsset('./mobile-rail.js')

/** Tag da mettere in testa, nell'ordine: polyfill, stile, script. */
function headMarkup() {
  const parts = ['<script src="' + SCRIPT_PATH + '"></script>']
  if (MOBILE_CSS !== '') parts.push('<link rel="stylesheet" href="' + CSS_PATH + '">')
  if (MOBILE_SCRIPT !== '') parts.push('<script src="' + SCRIPT_MOBILE_PATH + '" defer></script>')
  return parts.join('')
}

/**
 * Inietta i tag in testa all'index servito, in modo idempotente.
 * @param html - l'index.html grezzo.
 */
function injectHead(html) {
  if (html.includes(SCRIPT_PATH)) return html
  return html.replace('</head>', headMarkup() + '</head>')
}

/**
 * @param ctx - contesto del plugin; con `inject: ['webServer']` il servizio è pronto.
 */
export function apply(ctx) {
  const routes = [
    { path: SCRIPT_PATH, type: 'text/javascript; charset=utf-8', body: SCRIPT_BODY },
    { path: CSS_PATH, type: 'text/css; charset=utf-8', body: MOBILE_CSS },
    { path: SCRIPT_MOBILE_PATH, type: 'text/javascript; charset=utf-8', body: MOBILE_SCRIPT },
  ]

  for (const route of routes) {
    if (route.body === '') continue
    ctx.webServer.register({
      kind: 'exact',
      path: route.path,
      handler: (req, res) => {
        res.writeHead(200, {
          'content-type': route.type,
          'cache-control': 'no-cache',
          'content-length': String(Buffer.byteLength(route.body, 'utf8')),
        })
        res.end(route.body)
      },
    })
  }

  ctx.webServer.tapIndex(injectHead)

  console.log('[lan-polyfill] attivo:', routes.filter((route) => route.body !== '').map((route) => route.path).join(' '))
}
