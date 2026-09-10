# nihmar-dsh-plugins

Plugin personali per [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

| plugin | a cosa serve | stato |
| --- | --- | --- |
| [`lan-polyfill/`](lan-polyfill/) | Bundle del profilo `web`: polyfill di `crypto.randomUUID`, pagina d'ingresso al posto del redirect col token, e vestizione mobile della GUI (rail a costo zero, sidebar a drawer, bersagli tattili). È quello che rende usabile DSH da telefono su HTTP semplice in VPN. | in uso, verificato |
| [`host-file-browser/`](host-file-browser/) | Pannello nella GUI per navigare, leggere e modificare i file **dell'host** da qualsiasi dispositivo. Metà host (RPC sul servizio `fs`, con radice confinata e scrittura versionata) e metà client (icona in sidebar + pannello). | sorgente pronto, mai attivato |

Ognuno ha il suo README con i dettagli, le scelte di progetto e le trappole già pagate.

## Perché `lan-polyfill` è un bundle e non una riga di patch

Il profilo `web` ha `patchReload: "live"`: ogni modifica al `cordis.patch.yml` dell'utente
fa ricomporre e riapplicare tutto l'albero Cordis su un processo già vivo, e in quella
ricomposizione a caldo un `insert` di quel modulo faceva fallire la preparazione delle
estensioni DeepSeek — la chat rispondeva
`DeepSeek request extension preparation failed (REQUEST_EXTENSION)`. Un bundle viene
composto all'avvio e il watcher non lo tocca. Dettagli in
[`lan-polyfill/README.md`](lan-polyfill/README.md).

## Installazione

`lan-polyfill` si monta come bundle del profilo, con un symlink dentro il profilo così i
file del repo sono quelli caricati:

```bash
ln -s "$PWD/lan-polyfill" ~/.dsh/profiles/web/node_modules/lan-polyfill
# e in ~/.dsh/profiles/web/package.json:
#   "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lan-polyfill"]
```

Gli asset sono letti **una volta all'avvio**: dopo ogni modifica serve riavviare il server.

## Licenza

MIT — vedi [LICENSE](LICENSE).
