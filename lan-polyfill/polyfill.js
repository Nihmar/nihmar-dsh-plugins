/**
 * polyfill.js — installa `crypto.randomUUID` dove il browser non lo espone.
 *
 * Il browser fornisce quella funzione solo in un *secure context* (HTTPS oppure
 * localhost). Su `http://<ip-privato>:3080` — cioè il telefono in VPN — non
 * esiste, e il layer RPC del client DSH che la usa fallisce. Qui la costruiamo
 * con `crypto.getRandomValues`, disponibile anche fuori da un secure context.
 *
 * È servito come script classico da una route del bundle e iniettato in testa
 * all'index: uno script con `src` è bloccante, quindi è già installato prima che
 * qualunque codice DSH possa chiamare `randomUUID`. Non dipende dall'ordine con
 * cui il kernel cliente importa i suoi moduli.
 */

export const SCRIPT_PATH = '/__lan-polyfill.js'

/** Script servito: idempotente, non sovrascrive un'implementazione nativa. */
export const SCRIPT_BODY = `(function () {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID === 'function') return;
  function uuidV4Fallback() {
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) {
      return x.toString(16).padStart(2, '0');
    }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  crypto.randomUUID = uuidV4Fallback;
})();
`
