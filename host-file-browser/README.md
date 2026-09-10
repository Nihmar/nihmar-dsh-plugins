# Host file browser — plugin DSH per accedere all'host dal telefono

Due pezzi, indipendenti fra loro.

## 1. `start-web.sh` — accesso dal telefono

Installato in `~/.dsh/start-web.sh`. Avvia `dsh web` e rende utilizzabile la GUI da un
device sulla VPN.

Cosa risolve: il server ascolta già su `0.0.0.0:3080` (il profilo `web` monta il bundle
`dsh-lan-access`, che patcha la riga `webserver` con `host: 0.0.0.0`), ma DSH genera un
*token di lancio* casuale a ogni avvio e lo stampa solo nel terminale. Senza quel token
la GUI risponde `401 Unauthorized`. Lo script cattura l'URL autenticato, lo riscrive per
l'indirizzo raggiungibile dal telefono, ne fa un QR code e lo copia negli appunti.

```bash
~/.dsh/start-web.sh                    # avvio normale
~/.dsh/start-web.sh --port 3099        # porta alternativa
~/.dsh/start-web.sh --no-qr --no-clip  # output minimale
```

Al primo accesso apri l'URL col token dal telefono: DSH risponde `303` e deposita un
cookie firmato legato all'authority, valido **30 giorni**. Da quel momento il telefono
entra su `http://<ip-tailscale>:3080/` senza token. Il token invece cambia a ogni
riavvio del server: se il cookie scade o cambi device, riapri l'URL nuovo.

`dsh web --host 0.0.0.0` è rifiutato di proposito dal CLI ("would expose remote code
execution to the network"): è il motivo per cui il binding passa dal patch del profilo e
non dalla riga di comando.

## 2. `host.js` + `client.js` — browser file dell'host nella GUI

Plugin Cordis **dinamico**: vive nel processo DSH e muore quando il processo si chiude o
il server viene riavviato. È il comportamento voluto per un accesso occasionale da fuori;
per averlo permanente va promosso a composizione su disco (vedi in fondo).

### Cosa fa

- **Icona** "File host" nella lista pannelli della sidebar; apre un pannello centrale
  accanto a Conversation, senza sostituire nulla (`sidebar.panellist` + `main` sono slot
  additive).
- **Navigazione** con breadcrumb, filtro per nome e anteprima dei file di testo.
- **Modifica con interruttore**: il pannello apre sempre in sola lettura. Si preme
  `Modifica` per entrare in editor e `Salva` per pubblicare; l'editor è un buffer locale
  finché non si salva.
- **Salvataggio con guard di versione**: al salvataggio il client rimanda la versione
  letta e l'host scrive in modo atomico con `replaceIfVersion`. Se il file è cambiato nel
  frattempo il salvataggio è rifiutato con `STALE` e la UI offre `Ricarica` oppure
  `Sovrascrivi comunque`.

### Radice e contenimento

Radice predefinita: `/home/alessandro` (in `CONFIG.root` in `host.js`).

Ogni percorso passa da `fs.resolve()` — che canonicalizza e segue i symlink — e poi da
`fs.contains(rootTarget, target)`. Il contenimento è quindi deciso sul target canonico:
un symlink che punta fuori radice viene rifiutato, e i percorsi assoluti sono respinti
esplicitamente con `INVALID_PATH` invece di essere degradati a relativi.

Limiti dichiarati:

- il contenimento è **applicativo**, non una sandbox di sistema: il plugin gira nel
  processo DSH e la radice è l'unica barriera;
- dentro la home restano raggiungibili in scrittura `~/.ssh`, `~/.config`,
  `~/.dsh/credentials.yaml`, `~/.dsh/settings.yaml`;
- chi ha il cookie di sessione della GUI (30 giorni) può usare il pannello. Sopra una
  VPN il rischio è contenuto, ma il pannello non aggiunge autenticazione propria.

### Metodi RPC (client → host)

| metodo | argomenti | esito |
| --- | --- | --- |
| `list` | `{ path }` | `{ ok, home, path, entries[], truncated }` |
| `read` | `{ path }` | `{ ok, path, text, version, bytes, editable }` |
| `write` | `{ path, text, version? }` | `{ ok, version, operation }` oppure `STALE` |
| `search` | `{ path, query }` | `{ ok, entries[], truncated }` |

Errori strutturati: `OUTSIDE_ROOT`, `INVALID_PATH`, `NOT_FOUND`, `NOT_A_FILE`,
`NOT_A_DIRECTORY`, `TOO_LARGE`, `NOT_TEXT`, `BINARY_CONTENT`, `STALE`.

### Attivazione nella sessione

Il Package è già definito in questa sessione come `hostfs-2` / `pkg-6` ed è in attesa di
approvazione. Un plugin con metà client richiede un consenso esplicito nel browser:
apri la GUI, trova la scheda `cordis_run` e dai il consenso (una spunta autorizza questo
Package, due spunte le versioni future dello stesso plugin).

## Promuoverlo a plugin permanente

Il plugin dinamico non sopravvive al riavvio. Per renderlo stabile, il profilo `web`
(`~/.dsh/profiles/web/`) accetta bundle esterni in `package.json` → `dsh.profile.bundles`,
come già fa con `dsh-lan-access`: il pacchetto espone `lib/index.js` (host) e un export
`./client` (browser) più il suo `cordis.patch.yml` con la riga da montare. Va scritto
come pacchetto npm installabile, non come corpo di funzione.

```bash
# riattivare il plugin nella sessione corrente, dopo l'approvazione:
#   cordis_run hostfs-2 pkg-6  (mode: run)
```
