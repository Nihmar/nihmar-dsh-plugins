/**
 * Host half — Host file browser per DSH (plugin Cordis dinamico).
 *
 * Questo file è il corpo `code.host` di un Package Cordis: il runner dinamico lo
 * valuta come corpo di funzione e si aspetta che restituisca un oggetto Plugin.
 * Non ci sono `import`/`require`: i simboli disponibili nel sandbox sono `ctx`,
 * `harness`, `console`, `btoa`/`atob`, `TextEncoder`/`TextDecoder`.
 *
 * Responsabilità
 *   Espone quattro metodi RPC Package-privati (`list`, `read`, `write`, `search`)
 *   sopra il servizio `fs` composto dall'host, confinati a una sola radice.
 *
 * Sicurezza
 *   Ogni percorso passa da `fs.resolve()` (che canonicalizza e segue i symlink) e
 *   poi da `fs.contains(root, target)`: un symlink che punta fuori radice viene
 *   quindi rifiutato, perché il confronto avviene sul target canonico e non sulla
 *   stringa del percorso. I percorsi assoluti sono rifiutati esplicitamente.
 *   La scrittura usa `replaceIfVersion` quando il client presenta la versione
 *   letta: se il file è cambiato sotto l'editor la scrittura è rifiutata con
 *   STALE invece di sovrascrivere.
 *
 * Nota di onestà: questo è un contenimento applicativo, non una sandbox di
 * sistema. Il plugin gira nel processo DSH e la radice è l'unica barriera.
 */

const CONFIG = {
  /** La sola directory che questo browser può toccare. */
  root: '/home/alessandro',
  /** Il file di testo più grande che l'anteprima/editor carica. */
  maxReadBytes: 512 * 1024,
  /** Il buffer più grande che un salvataggio può scrivere. */
  maxWriteBytes: 2 * 1024 * 1024,
  /** Voci restituite per una singola listDir. */
  maxEntries: 4000,
  /** Budget della ricerca per nome. */
  search: { maxDepth: 4, maxVisits: 4000, maxResults: 150 },
  /** Directory in cui la ricerca non scende mai. */
  skipDirs: ['node_modules', '.git', '.cache', '.local/share/Trash', 'target', 'dist', 'build', '.venv', 'venv', '__pycache__'],
}

/** Un fallimento su cui il client può ramificare. */
function fail(code, message) {
  return { ok: false, code: code, message: message }
}

/**
 * Normalizza un percorso client in uno relativo alla radice. '' e '~' indicano
 * la radice; un percorso assoluto è rifiutato subito invece di essere
 * silenziosamente trattato come relativo, così il chiamante riceve una risposta
 * chiara invece di un'assenza confusa.
 */
function normalize(path) {
  let value = typeof path === 'string' ? path.trim() : ''
  if (value === '' || value === '~' || value === './') return ''
  if (value.startsWith('/')) return null
  while (value.endsWith('/')) value = value.slice(0, -1)
  return value
}

function joinRelative(base, name) {
  return base === '' ? name : base + '/' + name
}

function formatError(error) {
  if (error === null || error === undefined) return 'errore sconosciuto'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message !== '') return error.message
  return String(error)
}

/** Gli errori tipizzati di `fs` portano un codice: esponilo perché il client reagisca. */
function codeOf(error) {
  if (error !== null && typeof error === 'object') {
    if (typeof error.code === 'string' && error.code !== '') return error.code
    if (typeof error.fsCode === 'string' && error.fsCode !== '') return error.fsCode
  }
  return 'ERROR'
}

function isHidden(name) {
  return name.startsWith('.')
}

function skipDir(name) {
  return CONFIG.skipDirs.indexOf(name) !== -1
}

/** Mantiene totale e case-insensitive il confronto di ordinamento. */
function byName(a, b) {
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Risolve un percorso client, poi dimostra che è la radice o un suo discendente.
 * `resolve` segue i symlink, quindi il contenimento è deciso sul target canonico
 * e un symlink che punta fuori radice viene rifiutato qui.
 */
async function resolveInside(fs, path) {
  const relative = normalize(path)
  if (relative === null) {
    return { error: fail('INVALID_PATH', 'usa un percorso relativo alla radice; i percorsi assoluti non sono accettati') }
  }
  const rootTarget = await fs.resolve(CONFIG.root)
  const target = relative === '' ? rootTarget : await fs.resolve(relative, { cwd: CONFIG.root })
  if (!fs.contains(rootTarget, target)) {
    return { error: fail('OUTSIDE_ROOT', 'percorso fuori dalla radice consentita (' + CONFIG.root + ')') }
  }
  return { relative: relative, target: target }
}

/** Identità della radice più i suoi figli diretti. */
async function listDir(fs, path) {
  const resolved = await resolveInside(fs, path)
  if (resolved.error !== undefined) return resolved.error
  const info = await fs.stat(resolved.target)
  if (info === undefined) return fail('NOT_FOUND', 'percorso inesistente: ' + resolved.relative)
  if (info.type !== 'directory') return fail('NOT_A_DIRECTORY', 'non \u00e8 una cartella: ' + resolved.relative)

  const children = await fs.listDir(resolved.target)
  const entries = []
  for (const child of children) {
    if (entries.length >= CONFIG.maxEntries) break
    entries.push({
      name: child.name,
      type: child.type,
      size: typeof child.size === 'number' ? child.size : undefined,
      path: joinRelative(resolved.relative, child.name),
      hidden: isHidden(child.name),
      editable: child.type === 'file',
    })
  }
  entries.sort(byName)
  return {
    ok: true,
    root: CONFIG.root,
    home: CONFIG.root,
    path: resolved.relative,
    entries: entries,
    truncated: children.length > entries.length,
    maxReadBytes: CONFIG.maxReadBytes,
  }
}

/** Legge un file di testo, con limite, più la versione che il client deve rimandare per salvare. */
async function readFile(fs, path) {
  const resolved = await resolveInside(fs, path)
  if (resolved.error !== undefined) return resolved.error
  if (resolved.relative === '') return fail('NOT_A_FILE', 'la radice non \u00e8 un file')

  const info = await fs.stat(resolved.target)
  if (info === undefined) return fail('NOT_FOUND', 'file inesistente: ' + resolved.relative)
  if (info.type !== 'file') return fail('NOT_A_FILE', 'non \u00e8 un file: ' + resolved.relative)
  if (typeof info.size === 'number' && info.size > CONFIG.maxReadBytes) {
    return fail('TOO_LARGE', 'file troppo grande per l\u2019anteprima (' + info.size + ' byte, limite ' + CONFIG.maxReadBytes + ')')
  }

  try {
    const text = await fs.readText(resolved.target)
    return {
      ok: true,
      path: resolved.relative,
      name: resolved.relative.split('/').pop(),
      text: text,
      version: info.version,
      bytes: typeof info.size === 'number' ? info.size : text.length,
      editable: true,
    }
  } catch (error) {
    const code = codeOf(error)
    if (code === 'FS_TOO_LARGE') return fail('TOO_LARGE', 'file troppo grande per l\u2019anteprima')
    return fail('NOT_TEXT', 'file non testuale (o non leggibile): ' + formatError(error))
  }
}

/**
 * Crea o sostituisce un file UTF-8. Una versione fornita è un guard rigido di
 * staleness: quando il file è cambiato sotto l'editor la scrittura è rifiutata e
 * il client decide se forzarla.
 */
async function writeFile(fs, path, text, version) {
  const resolved = await resolveInside(fs, path)
  if (resolved.error !== undefined) return resolved.error
  if (resolved.relative === '') return fail('INVALID_PATH', 'serve il percorso di un file')
  if (typeof text !== 'string') return fail('INVALID_BODY', 'contenuto mancante o non testuale')
  if (text.length > CONFIG.maxWriteBytes) {
    return fail('TOO_LARGE', 'contenuto troppo grande (' + text.length + ' caratteri, limite ' + CONFIG.maxWriteBytes + ')')
  }
  if (text.indexOf('\u0000') !== -1) return fail('BINARY_CONTENT', 'contenuto binario non scrivibile da questo editor')

  const existing = await fs.stat(resolved.target)
  if (existing !== undefined && existing.type !== 'file') {
    return fail('NOT_A_FILE', 'non \u00e8 un file: ' + resolved.relative)
  }
  if (typeof version === 'string' && version !== '' && existing !== undefined && existing.version !== version) {
    return fail('STALE', 'il file \u00e8 cambiato sull\u2019host dopo la lettura; ricaricalo o forza la sovrascrittura')
  }

  const expected = typeof version === 'string' && version !== '' && existing !== undefined
    ? { kind: 'replaceIfVersion', version: version }
    : undefined

  try {
    const outcome = await fs.writeText(
      resolved.target,
      text,
      expected,
      undefined,
      { mode: 'danger-full-access', workspaceRoot: CONFIG.root },
    )
    return {
      ok: true,
      path: resolved.relative,
      version: outcome.version,
      operation: outcome.operation,
      bytes: text.length,
    }
  } catch (error) {
    const code = codeOf(error)
    if (code === 'FS_STALE_VERSION') {
      return fail('STALE', 'il file \u00e8 cambiato sull\u2019host durante il salvataggio; ricaricalo o forza la sovrascrittura')
    }
    return fail(code, 'salvataggio non riuscito: ' + formatError(error))
  }
}

/** Ricerca per nome in ampiezza, con budget. */
async function searchFiles(fs, path, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle === '') return fail('INVALID_QUERY', 'serve un testo da cercare')
  const resolved = await resolveInside(fs, path)
  if (resolved.error !== undefined) return resolved.error

  const results = []
  const queue = [{ target: resolved.target, relative: resolved.relative, depth: 0 }]
  let visits = 0
  let truncated = false

  while (queue.length > 0) {
    const current = queue.shift()
    visits += 1
    if (visits > CONFIG.search.maxVisits) { truncated = true; break }

    let children
    try {
      children = await fs.listDir(current.target)
    } catch (error) {
      continue
    }

    for (const child of children) {
      const relative = joinRelative(current.relative, child.name)
      if (child.name.toLowerCase().indexOf(needle) !== -1) {
        results.push({
          name: child.name,
          type: child.type,
          size: typeof child.size === 'number' ? child.size : undefined,
          path: relative,
          editable: child.type === 'file',
        })
        if (results.length >= CONFIG.search.maxResults) { truncated = true; break }
      }
      if (child.type === 'directory' && current.depth < CONFIG.search.maxDepth && !skipDir(child.name)) {
        queue.push({ target: child.target, relative: relative, depth: current.depth + 1 })
      }
    }
    if (results.length >= CONFIG.search.maxResults) break
  }

  results.sort(byName)
  return { ok: true, path: resolved.relative, query: needle, entries: results, truncated: truncated }
}

/** Avvolge un handler perché un throw imprevisto diventi un errore strutturato, mai una rejection. */
function guarded(name, handler) {
  return async function (args) {
    try {
      return await handler(args)
    } catch (error) {
      console.error('[' + name + ']', formatError(error))
      return fail(codeOf(error), formatError(error))
    }
  }
}

return {
  inject: ['fs'],
  apply(ctx) {
    const fs = ctx.fs

    ctx.effect(() => harness.handle('list', guarded('list', (args) => listDir(fs, args && args.path))))
    ctx.effect(() => harness.handle('read', guarded('read', (args) => readFile(fs, args && args.path))))
    ctx.effect(() => harness.handle('write', guarded('write', (args) =>
      writeFile(fs, args && args.path, args && args.text, args && args.version))))
    ctx.effect(() => harness.handle('search', guarded('search', (args) =>
      searchFiles(fs, args && args.path, args && args.query))))

    console.log('host file browser ready on', CONFIG.root)
  },
}
