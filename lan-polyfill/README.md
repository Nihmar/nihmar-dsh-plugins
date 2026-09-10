# lan-polyfill — bundle locale per l'accesso dal telefono

Bundle del profilo `web` di DSH. Fa tre cose, tutte per l'uso da smartphone su
`http://<ip-privato>:3080` (HTTP semplice, VPN Tailscale):

1. **Polyfill di `crypto.randomUUID`.** Il browser espone quella funzione solo in un
   *secure context* (HTTPS oppure `localhost`). Su un IP privato in HTTP semplice non
   esiste, e il layer RPC del client DSH che la usa fallisce. Il polyfill costruisce un
   UUID v4 standard con `crypto.getRandomValues`, disponibile anche fuori da un secure
   context.
2. **Imbotto d'ingresso.** L'URL col token non redirige più subito: serve una pagina con
   un pulsante e, come ripiego, la URL in chiaro. Serve a non dover copiare l'URL a mano
   nel browser quando ad aprire il link è una webview di passaggio (fotocamera, Lens).
3. **Vestizione mobile.** Sotto i 1024px la sidebar di DSH diventa una rail da 56px che
   toglie spazio alla chat, e il toggle la riporta a 264–420px schiacciando il contenuto.
   Qui la rail costa zero e la sidebar espansa è un pannello sopra il contenuto, con un
   pulsante flottante per aprirla e chiuderla.

Contesto esterno sul problema del polyfill:
[discussione deepseek-harness #3443](https://github.com/deepseek-ai/deepseek-harness/discussions/3443?sort=top#1),
[spiegazione su StackOverflow](https://stackoverflow.com/questions/74911304/crypto-module-not-loading-randomuuid-when-viewing-a-local-network-ip-address/77528782#77528782).

## Perché un bundle e non una riga nel `cordis.patch.yml` del profilo

Questa è la parte importante, ed è costata un guasto reale.

Il profilo ha `patchReload: "live"`. In quella modalità ogni modifica al patch dell'utente
fa ricomporre e riapplicare **tutto** l'albero Cordis sopra un processo già vivo:

```js
const composeLive = () => structuredClone([
  ...composed.bundlePatches,
  ...loadOptionalPatches(NAME, composed.profile.patchPath),   // il patch dell'utente
  ...loadOptionalPatches(NAME, homePatchPath()),
  ...composed.overlays
]);
await watchUserPatches(ctx, { filename: composed.profile.patchPath, compose: composeLive });
```

Montando il polyfill con un `insert` in quel file, la ricomposizione a caldo faceva fallire
la preparazione delle estensioni DeepSeek e la chat rispondeva:

```
This turn failed — DeepSeek request extension preparation failed (REQUEST_EXTENSION)
```

Il provider che fallisce è registrato in `prepare` da `dsh-session-log-deepseek`
(`dsh_session_log`) e `dsh-plugin-package-inventory-deepseek` (`dsh_plugin_packages`), e
legge lo stato dei plugin montati nella fibra del loader: se quella fibra viene
rimaterializzata a caldo e qualcosa non si chiude in modo pulito, la richiesta successiva
muore con quell'errore.

Un **bundle** invece entra in `composed.bundlePatches`, viene composto all'avvio e non è
sorvegliato dal watcher.

### Un test che NON basta

Un boot pulito in un `DSH_HOME` isolato **non** riproduce quel guasto: la composizione
avviene una volta sola, prima che il server accetti richieste. La condizione che rompe è la
riapplicazione a caldo su un processo vivo. Se ci torni, riproduci quella.

## Come è montato

`~/.dsh/profiles/web/package.json`:

```json
"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lan-polyfill"]
```

`~/.dsh/profiles/web/node_modules/lan-polyfill` è un **symlink** a questa directory:
modificare i file qui cambia direttamente ciò che il profilo carica.

Gli asset sono letti **una volta all'avvio**. Dopo ogni modifica serve un riavvio del
server, altrimenti si continua a servire la versione vecchia — è un errore che ho fatto
durante lo sviluppo e che fa perdere tempo in diagnosi fantasma.

## File

| file | ruolo |
| --- | --- |
| `cordis.patch.yml` | due righe `insert`: `index.js` (asset) e `interstitial.js` (imbotto) |
| `index.js` | serve i tre asset e ne inietta i tag in testa all'index |
| `polyfill.js` | il testo del polyfill servito come script bloccante |
| `interstitial.js` | route esatta su `/`: pagina d'ingresso al posto del 303 |
| `mobile.css` | vestizione mobile, servita e iniettata |
| `mobile-rail.js` | pulsante flottante e velo, script iniettato |

## Tecnica dell'imbotto

Il token di lancio non è spendibile altrove: `authorizeIndex` lo accetta solo su `GET /`.
L'imbotto quindi anticipa quella risposta:

1. chiama `connection.authorizeIndex` con una risposta **fittizia**, che non tocca il
   socket, solo per far generare header e `Set-Cookie`;
2. ricopia status e header sulla risposta vera;
3. al posto del body dell'index serve la pagina col pulsante, che punta a `/` e quindi
   ripete la richiesta con il cookie ormai presente.

Niente `inject: ['connection']` sulla riga: verificato sul runtime che quella
dichiarazione **lascia la riga in attesa e non la monta**, mentre `ctx.get('connection')`
restituisce il servizio già pronto in `apply`. Le richieste su `/` senza token proseguono
verso il gestore di fallback di sempre.

## Selettori CSS: perché non si usano le classi

Le classi del build sono hashaté da CSS modules (`pI_x6G_frame`, `pI_x6G_sidebarCol`),
quindi non sono un aggancio stabile. Si usano:

- l'attributo `data-sidebar-collapsed` che il frame dichiara esplicitamente;
- selettori a sottostringa sulla parte stabile del nome (`[class*="sidebarCol"]`);
- gli attributi `data-slot` che la shell dichiara per contratto.

### Cinque trappole già pagate, da non ripetere

**1. `[data-slot="sidebar"]` non è il pannello.** È un guscio con
`display: contents` e larghezza 0. Applicargli `position: fixed` non mostra nulla: il
drawer resta invisibile e l'unico effetto visibile è lo schermo scurito dal velo. Il menu
vero è il figlio con classe `*_root` (largo 280), ed è quello da posizionare.

**2. Il controllo di collapse non è il primo pulsante della sidebar.** In ordine nel DOM
ci sono `New session`, poi `Collapse sidebar`: un `querySelector('button')` prende il
primo e **crea una sessione** invece di chiudere il drawer. Il controllo si riconosce
dalla classe `*_toggle`, con l'etichetta accessibile come ripiego.

**3. I token di superficie di DSH non esistono.** `--dsw-color-surface`,
`--dsw-color-surface-raised`, `--dsw-color-bg` non sono definiti: i token reali sono
`--dsw-alias-bg-*`, `--dsw-alias-interactive-*`, `--dsw-static-neutral-*`. Una
dichiarazione come `background: var(--dsw-color-surface, #16181d) !important` vince
sempre, perché il ripiego è un colore letterale: il drawer restava scuro **anche con
tema chiaro**. La sidebar non è scura per scelta, sul desktop ha
`background-color: rgb(249, 250, 251)`; era il CSS a imporlo. Per ereditare il tema
giusto: `background-color: transparent !important`, così resta il fondo che la
sidebar ha già.

**4. Ancorare un elemento flottante alla base è fragile.** La zona del composer cambia
altezza (riga del modello, riga di invio, testo che cresce): qualunque quota dal basso
finisce prima o poi sopra il composer, e un pulsante a metà schermo sembra un difetto.
L'header invece ha altezza stabile: il pulsante sta in alto a destra, appena sotto,
con la quota in `--dsh-mobile-fab-top` (default `92px`).

**5. Il drawer deve essere opaco, e la sidebar non ha un fondo proprio.** È il contenitore
a dipingere il fondo; il menu stesso misura `rgba(0, 0, 0, 0)`. Un drawer `transparent`
quindi **lascia vedere la chat sotto**, e con contenuti scuri il risultato è una mescolanza
illeggibile — riprodotto: un blocco di prova iniettato si vedeva attraverso, a piena
intensità. Serve un fondo opaco, e il tema va letto dall'attributo giusto:
`data-ds-dark-theme` sulla radice, non la preferenza di sistema. `light-dark()` sarebbe
sbagliato, perché segue l'OS e darebbe il colore scuro a chi sceglie tema chiaro in DSH su
un sistema scuro.

## Quando vale il comportamento "telefono"

Non basta la larghezza. Sotto i 1024px DSH passa in modalità rail anche in una
**finestra desktop stretta**, che però ha ancora mouse e hover: lì la rail resta utile e un
drawer con velo è di troppo. La condizione è quindi doppia:

```css
@media (max-width: 1023px) and (hover: none) { … }
```

`hover: none` significa "nessun puntatore che possa passare sopra gli elementi": telefono o
tablet. Un desktop col mouse riporta `hover: hover` e tiene rail e pannelli normali, a
qualunque larghezza.

Nota tecnica: le custom property **non funzionano dentro una media query**
(`@media (--flag: 1)` è sempre falsa, verificato sul browser), quindi la condizione è
ripetuta per intero in ogni blocco invece di essere centralizzata in una variabile.

## Cosa è verificato e cosa no

Verificato in isolamento (profilo reale in un `DSH_HOME` separato, Chromium headless a
390×844):

| verifica | esito |
| --- | --- |
| URL col token → pagina d'ingresso | `200`, `<h1>Sessione pronta</h1>`, `Set-Cookie` presente |
| pulsante → app con il cookie | `200`, app montata, tag del bundle presenti |
| radice senza cookie | `401`, come prima |
| asset serviti | `200` con i content-type giusti |
| griglia con rail collassata | `0px 390px 0px` (da `56px minmax(0,1fr) 0px`) |
| menu in rail | visibile ma largo 20px: non ruba spazio |
| FAB → drawer | menu `335×844`, `position: fixed`, `x=0` |
| FAB di nuovo → chiuso | torna a 20px, velo a `0`, glifo `≡` |
| velo → chiuso | torna a 20px, velo a `0` |
| griglia con drawer aperto | `0px 390px 0px`: la chat non viene schiacciata |
| velo | opacità `1`, `pointer-events: auto` |
| opacità del drawer | fondo `rgb(255,255,255)` opaco: un blocco iniettato dietro non si vede più |
| pulsante flottante | `46×46`, `position: fixed`, glifo `≡` ↔ `✕` |
| errori nel log | nessuno |

Ciclo completo verificato in Chromium headless a 390×844: apertura dal pulsante, chiusura
dal pulsante, chiusura dal velo.

**Limite dell'ambiente di test:** Chromium headless non ha periferiche di puntatore e
riporta `hover: none` **a qualunque larghezza**, anche a 1200px. Perciò la ramificazione
`hover: none` / `hover: hover` non è verificabile lì: va provata su un dispositivo reale.
La correttezza delle condizioni è invece verificata ispezionando le regole come le ha
analizzate il browser: quattro blocchi `(max-width: 1023px) and (hover: none)` e un blocco
di esclusione `(min-width: 1024px), (hover: hover) and (pointer: fine)`.

## Verifica rapida

```bash
# composizione
cd ~/.dsh/profiles/web && npx @deepseek-ai/dsh --dump-config --profile web | grep -A3 "id: lan-"
# atteso: due righe, file:///…/node_modules/lan-polyfill/index.js e …/interstitial.js

# runtime su porta di servizio
cd ~/.dsh/profiles/web && npx @deepseek-ai/dsh web --port 3092 --no-open
# poi: la URL col token deve mostrare "Sessione pronta", non un redirect
```

## Nota su una riga morta nel patch del profilo

`cordis.patch.yml` conteneva `- id: tool-str-replace-editor` e quell'entry non esiste in
nessun bundle: ad ogni composizione il loader avvisava

```
dsh: [cordis.patch.yml] patch: entry "tool-str-replace-editor" not found
```

Nel file `cordis.patch.yml.new` preparato accanto è già tolta. Gli avvisi di composizione
passano da 1 a 0.
