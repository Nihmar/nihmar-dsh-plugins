/**
 * Client half — icona nella lista pannelli + browser file nel pannello centrale.
 *
 * Questo file è il corpo `code.client` di un Package Cordis. Gira nella pagina
 * del browser: i simboli disponibili sono `ctx`, `React`, `host`, `styles`,
 * `console`. Non ci sono `import`/`require` e non c'è trasformazione JSX: ogni
 * elemento si costruisce con `React.createElement`.
 *
 * Aggancio alla GUI
 *   `sidebar.panellist` è una slot `list`: ogni `id` indirizza il pannello
 *   centrale omonimo. La slot `main` è `keyed` e viene dispatchata con
 *   `usePanelInfo().activePanelId`, quindi registrare `hostfiles` in entrambe
 *   aggiunge un pannello accanto a `conversation` senza sostituire nulla.
 */

const PANEL_ID = 'hostfiles'
/** Segno mostrato per la radice; il percorso reale arriva dal primo `list`. */
const ROOT_MARK = '~'

/** Dimensione leggibile; la scelta dell'unità è cosmetica. */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || bytes < 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/** Percorso genitore, o null alla radice configurata. */
function parentOf(path) {
  const at = path.lastIndexOf('/')
  if (at <= 0) return null
  return path.slice(0, at)
}

/** Segmenti di breadcrumb dal percorso relativo alla radice. */
function crumbsOf(path) {
  if (path === '') return []
  const parts = path.split('/')
  const out = []
  let acc = ''
  for (const part of parts) {
    acc = acc === '' ? part : acc + '/' + part
    out.push({ name: part, path: acc })
  }
  return out
}

function errorText(error) {
  const message = error && error.message ? String(error.message) : String(error)
  return message.replace(/^Error:\s*/, '')
}

const CSS = `
.dshhf-root{display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;padding:10px 12px;overflow:hidden}
.dshhf-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dshhf-btn{appearance:none;border:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.35));background:var(--dsw-color-surface-raised,transparent);color:inherit;border-radius:6px;padding:4px 8px;font-size:12px;line-height:1.5;cursor:pointer;min-height:28px}
.dshhf-btn:disabled{opacity:.45;cursor:default}
.dshhf-btn.dshhf-on{background:var(--dsw-color-accent-weak,rgba(64,128,255,.18));border-color:var(--dsw-color-accent,rgba(64,128,255,.6))}
.dshhf-crumbs{display:flex;align-items:center;gap:2px;flex-wrap:wrap;font-size:12px;min-width:0}
.dshhf-crumb{appearance:none;border:0;background:transparent;color:var(--dsw-color-text-link,inherit);cursor:pointer;padding:2px 3px;border-radius:4px;font-size:12px}
.dshhf-crumb:hover{background:var(--dsw-color-surface-hover,rgba(127,127,127,.12))}
.dshhf-sep{opacity:.5;font-size:11px}
.dshhf-filter{flex:1 1 140px;min-width:120px;padding:5px 8px;font-size:12px;border-radius:6px;border:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.35));background:transparent;color:inherit}
.dshhf-list{flex:1 1 auto;min-height:0;overflow-y:auto;border:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.25));border-radius:8px}
.dshhf-row{display:flex;align-items:center;gap:8px;width:100%;appearance:none;border:0;background:transparent;color:inherit;text-align:left;padding:7px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.14))}
.dshhf-row:hover{background:var(--dsw-color-surface-hover,rgba(127,127,127,.12))}
.dshhf-row.dshhf-sel{background:var(--dsw-color-accent-weak,rgba(64,128,255,.16))}
.dshhf-icon{width:16px;flex:none;text-align:center}
.dshhf-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshhf-meta{flex:none;font-size:11px;opacity:.6}
.dshhf-empty{padding:14px;font-size:12px;opacity:.7}
.dshhf-note{font-size:11px;opacity:.65}
.dshhf-err{font-size:12px;color:var(--dsw-color-text-danger,#d9534f);word-break:break-word}
.dshhf-preview{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.25));padding-top:8px}
.dshhf-pv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.dshhf-path{font-family:var(--dsw-font-mono,monospace);font-size:11px;opacity:.75;word-break:break-all;flex:1 1 160px;min-width:0}
.dshhf-pre{flex:1 1 auto;min-height:120px;overflow:auto;margin:0;padding:8px;border:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.25));border-radius:8px;font-family:var(--dsw-font-mono,monospace);font-size:11.5px;white-space:pre;tab-size:2}
.dshhf-editor{flex:1 1 auto;min-height:160px;width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--dsw-color-border-weak,rgba(127,127,127,.35));border-radius:8px;font-family:var(--dsw-font-mono,monospace);font-size:12.5px;background:transparent;color:inherit;resize:vertical;tab-size:2}
.dshhf-warn{padding:8px;border-radius:7px;font-size:12px;background:var(--dsw-color-warning-weak,rgba(255,180,0,.14));border:1px solid var(--dsw-color-warning,rgba(255,180,0,.5))}
.dshhf-dirty{font-size:11px;color:var(--dsw-color-text-warning,#c98a00)}
@media (max-width:820px){.dshhf-root{padding:8px}.dshhf-row{padding:9px 8px;min-height:38px}.dshhf-btn{min-height:32px;padding:5px 10px}}
`

/**
 * Registra l'icona nella lista pannelli e il browser stesso. Entrambi sono
 * effetti di proprietà del Package: fermare il Run li rimuove con il fiber client.
 */
function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  styles.insert(CSS)

  // La scrittura è spenta finché non si preme "Modifica": l'editor è un buffer
  // locale e solo "Salva" tocca l'host, sempre con il guard di versione.
  const layout = ctx.get('layout')

  function FileBrowser(props) {
    const panelInfo = props && props.usePanelInfo
    const activePanelId = panelInfo ? panelInfo(function (info) { return info.activePanelId }) : undefined
    const [cwd, setCwd] = React.useState('')
    const [home, setHome] = React.useState(ROOT_MARK)
    const [entries, setEntries] = React.useState([])
    const [listedPath, setListedPath] = React.useState('')
    const [filter, setFilter] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [open, setOpen] = React.useState(null)
    const [draft, setDraft] = React.useState('')
    const [editing, setEditing] = React.useState(false)
    const [stale, setStale] = React.useState(false)
    const [saveError, setSaveError] = React.useState('')

    /** Carica una directory; `path === ''` significa la radice configurata. */
    const load = React.useCallback(function (path, keepOpen) {
      setBusy(true)
      setError('')
      return host.call('list', { path: path })
        .then(function (result) {
          const list = result && Array.isArray(result.entries) ? result.entries : []
          setEntries(list)
          setListedPath(result && typeof result.path === 'string' ? result.path : path)
          if (result && typeof result.home === 'string') setHome(result.home)
          setCwd(path)
          if (!keepOpen) { setOpen(null); setEditing(false); setStale(false); setSaveError('') }
        })
        .catch(function (failure) { setError(errorText(failure)) })
        .then(function () { setBusy(false) })
    }, [])

    React.useEffect(function () { load('', false) }, [])

    /** Legge un file nell'anteprima o nel buffer dell'editor. */
    const openFile = React.useCallback(function (entry, forEdit) {
      setBusy(true)
      setError('')
      setSaveError('')
      setStale(false)
      return host.call('read', { path: entry.path })
        .then(function (result) {
          setOpen(result)
          setDraft(typeof result.text === 'string' ? result.text : '')
          setEditing(forEdit === true)
        })
        .catch(function (failure) { setError(errorText(failure)) })
        .then(function () { setBusy(false) })
    }, [])

    /** Salva il buffer; un conflitto di versione emerge invece di sovrascrivere. */
    const save = React.useCallback(function (force) {
      if (open === null) return Promise.resolve()
      setBusy(true)
      setSaveError('')
      return host.call('write', { path: open.path, text: draft, version: force === true ? undefined : open.version })
        .then(function (result) {
          setOpen({ path: open.path, name: open.name, version: result.version, text: draft, bytes: result.bytes, editable: true })
          setStale(false)
          setEditing(false)
          return load(cwd, true)
        })
        .catch(function (failure) {
          const code = failure && failure.code ? String(failure.code) : ''
          if (code === 'STALE') setStale(true)
          setSaveError(errorText(failure))
        })
        .then(function () { setBusy(false) })
    }, [open, draft, cwd])

    const visible = entries.filter(function (entry) {
      if (filter === '') return true
      return entry.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1
    })
    const dirty = open !== null && editing && draft !== open.text
    const listLabel = listedPath === '' ? home : home + '/' + listedPath

    const bar = React.createElement('div', { className: 'dshhf-bar' },
      React.createElement('button', {
        className: 'dshhf-btn', type: 'button', disabled: cwd === '',
        onClick: function () { const up = parentOf(cwd); if (up !== null) load(up, false) },
      }, '\u2191 Su'),
      React.createElement('button', {
        className: 'dshhf-btn', type: 'button', disabled: busy,
        onClick: function () { load(cwd, true) },
      }, '\u21bb Aggiorna'),
      React.createElement('button', {
        className: 'dshhf-btn', type: 'button',
        onClick: function () {
          if (layout === undefined || layout === null) return
          if (typeof layout.selectPanel === 'function') layout.selectPanel(activePanelId === PANEL_ID ? null : PANEL_ID)
          if (typeof layout.toggleSidebar === 'function') layout.toggleSidebar()
        },
      }, 'Chat'),
      React.createElement('input', {
        className: 'dshhf-filter', value: filter, placeholder: 'filtra per nome\u2026',
        onChange: function (event) { setFilter(event.target.value) },
      }),
    )

    const crumbNodes = []
    crumbNodes.push(React.createElement('button', {
      key: 'root', className: 'dshhf-crumb', type: 'button',
      onClick: function () { load('', false) },
    }, home))
    for (const crumb of crumbsOf(cwd)) {
      crumbNodes.push(React.createElement('span', { key: 'sep-' + crumb.path, className: 'dshhf-sep' }, '/'))
      crumbNodes.push(React.createElement('button', {
        key: crumb.path, className: 'dshhf-crumb', type: 'button',
        onClick: function () { load(crumb.path, false) },
      }, crumb.name))
    }
    const crumbs = React.createElement('div', { className: 'dshhf-crumbs' }, crumbNodes)

    const rows = visible.map(function (entry) {
      const isOpen = open !== null && open.path === entry.path
      const icon = entry.type === 'directory' ? '\u25b8' : (entry.editable ? '\u25a4' : '\u25a1')
      return React.createElement('button', {
        key: entry.path, type: 'button',
        className: 'dshhf-row' + (isOpen ? ' dshhf-sel' : ''),
        onClick: function () {
          if (entry.type === 'directory') load(entry.path, false)
          else openFile(entry, false)
        },
      },
        React.createElement('span', { className: 'dshhf-icon' }, icon),
        React.createElement('span', { className: 'dshhf-name' }, entry.name),
        React.createElement('span', { className: 'dshhf-meta' },
          entry.type === 'directory' ? 'dir' : formatBytes(entry.size)),
      )
    })

    const list = React.createElement('div', { className: 'dshhf-list' },
      rows.length > 0 ? rows : React.createElement('div', { className: 'dshhf-empty' },
        busy ? 'carico\u2026' : (filter === '' ? 'cartella vuota' : 'nessun risultato per il filtro')),
    )

    let preview = null
    if (open !== null) {
      const head = React.createElement('div', { className: 'dshhf-pv-head' },
        React.createElement('span', { className: 'dshhf-path' }, open.path),
        React.createElement('span', { className: 'dshhf-meta' }, formatBytes(open.bytes)),
        dirty ? React.createElement('span', { className: 'dshhf-dirty' }, 'modificato') : null,
        open.editable
          ? React.createElement('button', {
              className: 'dshhf-btn' + (editing ? ' dshhf-on' : ''), type: 'button',
              onClick: function () {
                if (!editing) { setDraft(open.text); setEditing(true) } else { setEditing(false) }
              },
            }, editing ? 'Annulla' : '\u270e Modifica')
          : React.createElement('span', { className: 'dshhf-note' }, 'sola lettura'),
        editing
          ? React.createElement('button', {
              className: 'dshhf-btn', type: 'button', disabled: busy || !dirty,
              onClick: function () { save(false) },
            }, busy ? 'salvo\u2026' : '\u2713 Salva')
          : null,
        React.createElement('button', {
          className: 'dshhf-btn', type: 'button',
          onClick: function () { setOpen(null); setEditing(false) },
        }, 'Chiudi'),
      )

      const body = editing
        ? React.createElement('textarea', {
            className: 'dshhf-editor', value: draft, spellCheck: false,
            onChange: function (event) { setDraft(event.target.value) },
          })
        : React.createElement('pre', { className: 'dshhf-pre' }, open.text)

      preview = React.createElement('div', { className: 'dshhf-preview' },
        head,
        stale
          ? React.createElement('div', { className: 'dshhf-warn' },
              'Il file \u00e8 cambiato sull\u2019host dopo la lettura. ',
              React.createElement('button', {
                className: 'dshhf-btn', type: 'button',
                onClick: function () {
                  setStale(false); setSaveError('')
                  openFile({ path: open.path, name: open.name }, true)
                },
              }, 'Ricarica'),
              ' ',
              React.createElement('button', {
                className: 'dshhf-btn', type: 'button',
                onClick: function () { save(true) },
              }, 'Sovrascrivi comunque'))
          : null,
        saveError !== '' && !stale ? React.createElement('div', { className: 'dshhf-err' }, saveError) : null,
        body,
      )
    }

    return React.createElement('div', { className: 'dshhf-root' },
      bar,
      crumbs,
      React.createElement('div', { className: 'dshhf-note' },
        listLabel + (busy ? ' \u00b7 carico\u2026' : '')),
      error !== '' ? React.createElement('div', { className: 'dshhf-err' }, error) : null,
      list,
      preview,
    )
  }

  slots.inject('sidebar.panellist', function () {
    return slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: 'File host' },
      function (props) {
        const size = props && typeof props.size === 'number' ? props.size : 18
        return React.createElement('span', {
          style: { fontSize: Math.max(12, Math.round(size * 0.85)), lineHeight: 1 },
          title: 'File dell\u2019host',
        }, '\u25a4')
      },
    )
  })

  slots.inject('main', function () {
    return slots.register({ name: 'main', key: PANEL_ID }, FileBrowser)
  })
}

return { apply }
