/**
 * mobile-rail.js — script servito dal bundle e iniettato in testa all'index.
 *
 * Fa una cosa sola: siccome il CSS manda la rail a costo zero sotto i 1024px,
 * aggiunge un pulsante flottante per aprire e chiudere la sidebar, e un velo che
 * la chiude al tocco. La sidebar resta quella vera di DSH: il CSS le dà solo la
 * forma di un drawer.
 *
 * Non tocca React né lo stato dell'applicazione: si limita a inoltrare un click
 * al controllo di collapse che la shell già rende dentro la sidebar, e legge lo
 * stato dall'attributo `data-sidebar-collapsed` del frame. Il comportamento in
 * modalità stretta è già di DSH: sotto i 1024px il toggle espande la sidebar.
 */

(function () {
  /* Le classi del build sono hashaté da CSS modules (`pI_x6G_frame`), quindi il
     nome esatto non è un aggancio stabile: si cerca la parte stabile. Il frame è
     il primo elemento con "frame" nella classe e sta prima di questo script. */
  var FRAME = '[class*="frame"]'
  var SIDEBAR = '[data-slot="sidebar"]'
  var FAB_ID = 'dsh-mobile-rail-toggle'
  var VEIL_ID = 'dsh-mobile-rail-veil'

  function frame() {
    return document.querySelector(FRAME)
  }

  /** La sidebar è collassata? L'attributo è assente quando è espansa. */
  function collapsed() {
    var f = frame()
    return f === null || f.hasAttribute('data-sidebar-collapsed')
  }

  /**
   * Inoltra il click al controllo di collapse della shell.
   *
   * Il controllo va cercato, non indovinato: il PRIMO pulsante della sidebar è
   * "New session", non il toggle. Un click lì crea una sessione invece di
   * chiudere il drawer — è l'errore che aveva reso il pulsante inerte.
   *
   * Due agganci, in ordine di robustezza: la classe del controllo
   * (`*_toggle`, hashata ma con la parte stabile) e, se la classe cambiasse,
   * l'etichetta accessibile, che però è localizzata.
   */
  function toggleControl() {
    var sidebar = document.querySelector(SIDEBAR)
    if (sidebar === null) return null
    var buttons = Array.prototype.slice.call(sidebar.querySelectorAll('button'))
    for (var i = 0; i < buttons.length; i++) {
      if (/(^|\s)[A-Za-z0-9_-]*_toggle(\s|$)/.test(String(buttons[i].className))) return buttons[i]
    }
    for (var j = 0; j < buttons.length; j++) {
      var label = buttons[j].getAttribute('aria-label') || ''
      if (/collapse|open sidebar|sidebar/i.test(label)) return buttons[j]
    }
    return null
  }

  function forwardToggle() {
    var control = toggleControl()
    if (control === null) {
      console.error('[lan-mobile] controllo di collapse non trovato nella sidebar')
      return
    }
    control.click()
  }

  function veil() {
    var existing = document.getElementById(VEIL_ID)
    if (existing !== null) return existing
    var el = document.createElement('div')
    el.id = VEIL_ID
    el.setAttribute('aria-hidden', 'true')
    el.addEventListener('click', function () {
      if (!collapsed()) forwardToggle()
    })
    document.body.appendChild(el)
    return el
  }

  function fab() {
    var existing = document.getElementById(FAB_ID)
    if (existing !== null) return existing
    var el = document.createElement('button')
    el.id = FAB_ID
    el.type = 'button'
    el.setAttribute('aria-label', 'Mostra o nascondi la navigazione')
    el.addEventListener('click', function () {
      forwardToggle()
    })
    document.body.appendChild(el)
    return el
  }

  /** Tiene allineati velo e pulsante allo stato reale del frame. */
  function sync() {
    var el = fab()
    veil()
    var open = !collapsed()
    el.textContent = open ? '\u2715' : '\u2261'
    el.setAttribute('aria-expanded', String(open))
    document.body.setAttribute('data-dsh-mobile-rail-open', String(open))
  }

  function start() {
    sync()
    var f = frame()
    if (f === null) {
      // Il frame non è ancora montato: riprova finché non compare.
      window.setTimeout(start, 120)
      return
    }
    var observer = new MutationObserver(sync)
    observer.observe(f, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})();
