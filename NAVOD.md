# Domácí finance – návod na nasazení (GitHub Pages)

Appka je čistě statická. **Všechna finanční data zůstávají uložená jen
v prohlížeči/telefonu (localStorage) a nikam se neposílají.**

## 1) Vytvoř repozitář

1. Na github.com klikni na **New repository**
2. Název: přesně **`domaci-finance`** (musí sedět s nastavením `base` ve `vite.config.js`)
3. Viditelnost: **Public** (GitHub Pages zdarma funguje jen u veřejných repozitářů;
   v kódu nejsou žádná tvoje data, jen aplikace samotná*)
4. Nic dalšího nezaškrtávej, **Create repository**

*Poznámka: v souboru `src/App.jsx` jsou předvyplněné červnové výpisy pro první
import. Pokud nechceš, aby byly ve veřejném repozitáři, smaž před nahráním obsah
pole `IMPORT_BATCHES` (nahraď `const IMPORT_BATCHES = [...]` za
`const IMPORT_BATCHES = [];`) – data už máš stejně naimportovaná v appce v Claude
a do nové appky je můžeš zadat ručně, nebo mi řekni a připravím ti verzi
s exportem/importem záloh.

## 2) Nahraj soubory

**Varianta A – přes git (doporučeno):**
```bash
cd domaci-finance
git init
git add .
git commit -m "Domácí finance v1"
git branch -M main
git remote add origin https://github.com/TVOJE-JMENO/domaci-finance.git
git push -u origin main
```

**Varianta B – přes web:** na stránce repozitáře klikni na
**uploading an existing file** a přetáhni tam celý obsah složky
(včetně skryté složky `.github` – bez ní nebude fungovat automatické nasazení).

## 3) Zapni GitHub Pages

1. V repozitáři: **Settings → Pages**
2. **Source: GitHub Actions** (ne "Deploy from a branch"!)
3. Hotovo – workflow se spustí automaticky po každém pushi

## 4) Počkej na nasazení

V záložce **Actions** uvidíš běžící workflow „Nasazení na GitHub Pages".
Za 1–2 minuty bude appka na adrese:

**https://TVOJE-JMENO.github.io/domaci-finance/**

## 5) Přidej na plochu telefonu (PWA)

- **iPhone (Safari):** otevři adresu → tlačítko Sdílet → **Přidat na plochu**
- **Android (Chrome):** otevři adresu → Chrome sám nabídne instalaci,
  případně menu ⋮ → **Přidat na plochu / Instalovat aplikaci**

Appka pak funguje jako nativní – vlastní ikona, celá obrazovka, běží i offline.

## Lokální vývoj (volitelné)

```bash
npm install
npm run dev      # vývojový server na http://localhost:5173
npm run build    # produkční build do složky dist/
```

## Poznámky

- Data jsou vázaná na konkrétní zařízení a prohlížeč. Appka na telefonu
  a na počítači má každá svá data.
- Pozor na mazání dat prohlížeče – smazalo by i záznamy. Export/import
  zálohy můžeme doplnit jako další funkci.
- Změny v kódu: stačí upravit soubor, commitnout a pushnout – GitHub Actions
  nasadí novou verzi automaticky.
