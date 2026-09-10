/**
 * interstitial.js — imbotto d'ingresso per il primo accesso da un altro
 * dispositivo (telefono in VPN) su HTTP semplice.
 *
 * Il problema che risolve: l'URL col token risponde `303` e il browser viene
 * rimandato subito a `/`. Se ad aprire il link è una webview di passaggio
 * (fotocamera, Lens, anteprima di un'app di messaggistica) l'utente non atterra
 * in una pagina da cui capire cosa fare, e finisce a copiare l'URL a mano nel
 * browser.
 *
 * Qui la stessa URL serve invece una pagina minima con un pulsante e, come
 * ripiego sempre visibile, la URL in chiaro da copiare.
 *
 * Confine e tecnica: non modifichiamo il modulo di autenticazione di DSH. Il
 * token non è spendibile altrove — `authorizeIndex` lo accetta solo su `GET /` —
 * quindi l'imbotto si limita ad anticipare quella risposta:
 *
 *   1. chiama `connection.authorizeIndex` con una risposta *fittizia*, che non
 *      tocca il socket, solo per far generare header e `Set-Cookie`;
 *   2. ricopia status e header sulla risposta vera;
 *   3. al posto del body dell'index serve la pagina col pulsante, che punta a
 *      `/` e quindi ripete la richiesta con il cookie ormai presente.
 *
 * Niente `inject: ['connection']`: verificato sul runtime che quella
 * dichiarazione lascia la riga in attesa e non la monta, mentre
 * `ctx.get('connection')` restituisce il servizio già pronto al momento di
 * `apply`.
 */

export const inject = ['webServer']

export const name = 'lan-interstitial'

/** Raccoglie header e status di una risposta senza scrivere sul socket. */
function captureResponse() {
  const headers = {}
  return {
    headers,
    status: 200,
    headersSent: false,
    setHeader(name, value) { headers[String(name).toLowerCase()] = value },
    getHeader(name) { return headers[String(name).toLowerCase()] },
    writeHead(status, values) {
      this.status = status
      this.headersSent = true
      if (values !== null && typeof values === 'object') {
        for (const [key, value] of Object.entries(values)) headers[key.toLowerCase()] = value
      }
      return this
    },
    write() { return true },
    end() { this.headersSent = true },
  }
}

/**
 * Pagina d'ingresso.
 * @param href - percorso a cui punta il pulsante (la radice, senza token).
 * @param prettyUrl - la URL in forma leggibile, per il ripiego manuale.
 */
function page(href, prettyUrl) {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Apri la sessione</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom));
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #101216;
    color: #e8eaed;
  }
  main { width: 100%; max-width: 34rem; }
  h1 { margin: 0 0 8px; font-size: 1.35rem; }
  p { margin: 0 0 24px; color: #a9b0b8; font-size: 0.95rem; }
  a.open {
    display: block;
    padding: 18px 20px;
    border-radius: 14px;
    background: #3b6ef5;
    color: #fff;
    font-size: 1.15rem;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
  }
  a.open:active { background: #2f59cc; }
  details { margin-top: 24px; }
  summary { cursor: pointer; color: #a9b0b8; font-size: 0.9rem; }
  code {
    display: block;
    margin-top: 10px;
    padding: 12px;
    border-radius: 10px;
    background: #1b1f26;
    font-size: 0.8rem;
    word-break: break-all;
    user-select: all;
  }
</style>
</head>
<body>
<main>
  <h1>Sessione pronta</h1>
  <p>Premi per aprire DeepSeek Harness su questo dispositivo. Il token è già stato scambiato con un cookie valido 30 giorni.</p>
  <a class="open" href="${href}">Apri la sessione</a>
  <details>
    <summary>Se il pulsante non funziona</summary>
    <code>${prettyUrl}</code>
  </details>
</main>
</body>
</html>
`
}

/**
 * @param ctx - contesto del plugin; `webServer` arriva da inject.
 */
export function apply(ctx) {
  // Facoltativo: al momento di apply è già presente, ma se mancasse la pagina
  // d'ingresso resterebbe utile lo stesso, quindi non ne facciamo una dipendenza dura.
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.authorizeIndex !== 'function') {
    console.error('[lan-interstitial] servizio connection non disponibile: la pagina d\'ingresso non autenticherà')
  }

  ctx.webServer.register({
    kind: 'exact',
    path: '/',
    handler: (req, res) => {
      const raw = typeof req.url === 'string' ? req.url : '/'
      const method = typeof req.method === 'string' ? req.method : 'GET'
      const search = raw.indexOf('?')
      const query = search === -1 ? '' : raw.slice(search + 1)

      // Interessa solo GET su "/" con un token: è l'unica forma che authorizeIndex
      // scambia con un cookie. Tutto il resto è richiesta ordinaria.
      if (method !== 'GET' || !/(^|&)token=/.test(query)) {
        forwardToFallback(ctx, req, res)
        return
      }

      const prettyUrl = 'http://' + String(req.headers.host ?? '') + raw

      if (connection === undefined || typeof connection.authorizeIndex !== 'function') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(page('/', prettyUrl))
        return
      }

      // 1) risposta fittizia: qui finiscono status e Set-Cookie, senza socket.
      const capture = captureResponse()
      let authorized = false
      try {
        authorized = connection.authorizeIndex(req, capture) === true
      } catch (error) {
        console.error('[lan-interstitial] authorizeIndex:', error && error.message ? error.message : error)
      }

      // 2) nessun cookie generato (token errato o scaduto): inoltro la risposta
      //    autentica così com'è, cioè il 401 di sempre.
      if (!authorized && capture.headers['set-cookie'] === undefined) {
        const headers = Object.assign({}, capture.headers)
        delete headers['content-length']
        res.writeHead(capture.status, headers)
        res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
        return
      }

      // 3) cookie generato: lo ricopiamo sulla risposta vera e serviamo l'imbotto.
      const headers = Object.assign({}, capture.headers)
      delete headers['content-length']
      res.writeHead(200, Object.assign(headers, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      }))
      res.end(page('/', prettyUrl))
    },
  })
}

/**
 * Inoltra una richiesta ordinaria su `/` al gestore di fallback di sempre.
 * `webServer.fallback` non è un'API pubblica, quindi la si legge in modo
 * difensivo: se un giorno sparisse rispondiamo 404, senza toccare altro.
 */
function forwardToFallback(ctx, req, res) {
  const server = ctx.webServer
  const fallback = server !== null && typeof server === 'object' ? server.fallback : undefined
  if (typeof fallback === 'function') {
    fallback(req, res)
    return
  }
  console.error('[lan-interstitial] fallback non accessibile: rispondo 404')
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}
