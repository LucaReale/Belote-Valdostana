Belote alla valdostana

Come avviare:
1. Apri un terminale in questa cartella.
2. Esegui: node server.js
3. Il terminale stampa uno o più indirizzi.
4. Chi ospita apre http://127.0.0.1:4173
5. Gli altri giocatori, se sono sulla stessa rete, aprono l'indirizzo tipo:
   http://192.168.x.x:4173

Come giocare online:
1. Tutti aprono la stessa app.
2. Un giocatore sceglie posto/squadra e preme "Crea stanza".
3. Comunica agli altri il codice stanza.
4. Gli altri scelgono posto/squadra, scrivono il codice nell'app e premono "Entra".

Per condividere l'app:
- Manda agli amici il file belote-valdostana-online.zip.
- Uno solo deve fare da host e avviare node server.js.
- Tutti devono aprire l'indirizzo dell'host e usare il codice stanza.

Nota: se non siete sulla stessa rete locale, l'host deve pubblicare il server Node
su Internet oppure usare un servizio di tunnel/hosting. Il codice stanza funziona
solo dopo che tutti riescono ad aprire la stessa app servita dall'host.
