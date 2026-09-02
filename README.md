# Zirkel

Euer privates Beziehungsnetzwerk: Namen sofort finden, Personen miteinander
verbinden und Kategorien zuordnen. Als installierbare Web-App (PWA) mit
eigenem Login fuer genau zwei Konten — gedacht fuer euch zwei.

**Backend: reines PHP** (kein Node.js, keine Datenbank noetig) — laeuft
damit ohne Sonderfreigabe auf jedem Standard-Webhosting mit PHP, inklusive
Metanet METAhost.

## Was drinsteckt

- **Login mit echtem Passwort** (bcrypt-gehasht), maximal zwei Konten.
  Sobald beide Konten angelegt sind, schliesst sich die Registrierung.
- **Bleibt angemeldet** (bis zu 180 Tage) ueber ein eigenes Login-Token
  (unabhaengig von PHP-Session-Timeouts des Hosters) — fuer schnellen
  Zugriff in der installierten App.
- **Graph-Ansicht** (D3.js, lokal eingebunden — keine externen CDN- oder
  Google-Fonts-Aufrufe) mit Zoom, Pan und frei verschiebbaren Personen.
- **Sofortsuche** nach Namen (auch nach Geburtstag), mit Hervorhebung.
- **Kategorien** mit eigener Farbe, frei anlegbar/umbenennbar/loeschbar.
- **Verbindungen** zwischen Personen mit optionaler Beziehungsbezeichnung
  (z. B. "verheiratet", "Kollege").
- **Geburtstag und Notizen** je Person hinterlegbar (Alter wird automatisch
  angezeigt).
- **Installierbar als App** (PWA) mit Icon auf dem Homescreen.
- **Aktuell beim Oeffnen**: Die Ansicht laedt frische Daten beim Start und
  jedes Mal, wenn ihr zur App zurueckwechselt (kein staendiges Polling im
  Hintergrund). Neue App-Versionen zeigt ein Update-Banner an.
- **Export/Import** als JSON-Datei fuer eigene Backups.
- Daten liegen in einfachen JSON-Dateien (kein MySQL/MariaDB noetig).

## Voraussetzungen

- PHP 8.0 oder neuer (Standard bei praktisch jedem Webhosting, auch bei
  Metanet METAhost)
- Schreibrechte fuer den PHP-Prozess auf dem Projektordner (Standard bei
  eigenem Hosting-Account)
- Fuer die Installation als App (PWA): HTTPS (nur `localhost` ist davon
  ausgenommen)

Keine Kommandozeile, kein `npm install`, kein Build-Schritt — die Dateien
hochladen reicht.

## Lokal testen

```bash
php -S localhost:8000 -t public
```

Danach [http://localhost:8000](http://localhost:8000) oeffnen. Beim ersten
Aufruf legt ihr Konto 1 an, danach Konto 2. Ab dann ist nur noch "Anmelden"
verfuegbar.

Alle Daten landen automatisch in einem `data`-Ordner **neben** `public/`
(`users.json`, `network.json`, `tokens.json`, `login_attempts.json`) — er
wird beim ersten Request selbst angelegt. Diesen Ordner sichern = Backup.

## Deployment bei Metanet (marcini.ch → zirkel.marcini.ch)

1. **Subdomain anlegen** (falls noch nicht geschehen) — Plesk:
   *Websites & Domains → Subdomain hinzufuegen* → `zirkel`.
2. **Dateien hochladen** per SFTP/Dateimanager/Git:
   - der Ordner `public/` wird der **Dokumentenstamm (Document Root)**
     der Subdomain
   - der Ordner `data/` kommt **eine Ebene daneben** (also **nicht**
     im Dokumentenstamm) — dadurch ist er von aussen nie erreichbar.
     Typische Struktur auf dem Server:
     ```
     zirkel.marcini.ch/          <- Application Root der Subdomain
       public/                    <- als Document Root in Plesk eintragen
         index.html, app.js, api/, ...
       data/                      <- entsteht automatisch, privat
     ```
   - Falls Plesk fuer diese Subdomain zwingend `httpdocs` als
     Dokumentenstamm-Name vorgibt: einfach den Inhalt von `public/` direkt
     in `httpdocs/` hochladen, und den `data`-Ordner eine Ebene darueber
     legen (Geschwisterordner von `httpdocs/`).
3. **Dokumentenstamm setzen** — bei der Subdomain unter *Hosting-Einstellungen*
   den Dokumentenstamm auf den Ordner mit `index.html` zeigen lassen (also
   `public` bzw. wie oben beschrieben).
4. **SSL aktivieren** — Reiter *SSL/TLS-Zertifikate* der Subdomain →
   "Kostenloses Let's-Encrypt-Zertifikat holen" (ein Klick, erneuert sich
   automatisch). Fuer die Installation als PWA ist HTTPS Pflicht.
5. Fertig — `https://zirkel.marcini.ch` aufrufen und die zwei Konten
   anlegen.

Kein Node.js-Feature, kein Docker, keine Umgebungsvariablen noetig — PHP
ist auf METAhost-Plaenen standardmaessig aktiv.

**Rechte pruefen, falls beim ersten Aufruf ein Fehler kommt:** Der
PHP-Prozess muss den `data`-Ordner (bzw. dessen Elternverzeichnis, um ihn
anzulegen) beschreiben duerfen. Auf Plesk/METAhost gehoert das
Verzeichnis standardmaessig demselben Systembenutzer wie der PHP-Prozess,
das sollte also automatisch funktionieren.

## Updates ausliefern

Wenn ihr Dateien aendert und neu hochladet, erkennt eine bereits
installierte App das nicht automatisch — Browser vergleichen dafuer die
Service-Worker-Datei selbst. Erhoeht deshalb bei jedem Deploy die
Versionsnummer ganz oben in `public/sw.js`:

```js
const APP_VERSION = 'v2'; // bei jedem Deploy hochzaehlen
```

Offene Zirkel-Fenster zeigen dann automatisch das Banner "Es gibt eine neue
Version" mit einem "Neu laden"-Button.

## Suchmaschinen & Privatsphaere

Zirkel ist bewusst nirgends auffindbar und verraet nichts ueber seinen Inhalt,
solange man nicht angemeldet ist:

- `public/robots.txt` verbietet allen Crawlern den ganzen Auftritt.
- `<meta name="robots" content="noindex, nofollow, ...">` in `index.html`
  sowie ein `X-Robots-Tag`-Header (gesetzt in `public/.htaccess` fuer
  statische Dateien und in `public/api/_lib.php` fuer die API) weisen auch
  Suchmaschinen ab, die `robots.txt` ignorieren.
- Titel, Beschreibung und der Login-Screen nennen weder Zweck noch Inhalt
  der App ("Zirkel" statt "privates Beziehungsnetzwerk") — wer die Seite
  ungefragt sieht, erfaehrt nichts ausser dem Namen.
- `public/.htaccess` braucht Apaches `mod_headers` (bei Metanet/Plesk
  standardmaessig aktiv). Fehlt es, greift trotzdem der `<meta>`-Tag.

## Sicherheits-Hinweise

- Maximal zwei Konten — die Registrierung schliesst sich danach von selbst.
- Login-Versuche sind pro IP/Benutzername begrenzt (10 pro 15 Minuten).
- Passwoerter brauchen mindestens 8 Zeichen und werden mit bcrypt (PHPs
  `password_hash`) gehasht gespeichert, nie im Klartext.
- Das eigene Login-Token (statt PHP-Session) liegt als httpOnly-Cookie
  vor, ist also per JavaScript nicht auslesbar; serverseitig wird nur sein
  Hash gespeichert.
- Das ist ein Werkzeug fuer zwei vertraute Personen, kein Mehrbenutzer-System
  mit Rollen/Rechten — beide Konten sehen und bearbeiten dasselbe
  gemeinsame Netzwerk.
- Sichert regelmaessig entweder den `data`-Ordner oder nutzt "Als JSON
  exportieren" im Menue.

## Projektstruktur

```
public/                 <- Dokumentenstamm (Document Root)
  index.html             App-Geruest (Login-Screen + Haupt-App)
  app.js                 Gesamte Frontend-Logik
  styles.css             Design (hell/dunkel automatisch)
  manifest.webmanifest    PWA-Manifest
  sw.js                   Service Worker (Offline-Huelle + Update-Check)
  vendor/d3.min.js         Lokal eingebundenes D3.js (kein externes CDN)
  icons/                   App-Icons
  robots.txt               Verbietet Crawlern den ganzen Auftritt
  .htaccess                X-Robots-Tag-Header (mod_headers)
  api/                     PHP-Endpunkte (Login, Konto, Netzwerk-Daten)
    _lib.php               gemeinsame Hilfsfunktionen (Speichern, Auth)
    setup.php, register.php, login.php, logout.php,
    me.php, password.php, network.php
data/                   <- ausserhalb des Dokumentenstamms, entsteht
                           automatisch, enthaelt users.json/network.json/…
```
