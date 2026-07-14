import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine,
  PieChart, Pie,
} from "recharts";

/* ── Design tokens ───────────────────────────────────────────── */
const T = {
  bg: "#F4F6F2", surface: "#FFFFFF", ink: "#1C2B27", inkSoft: "#5C6B66", line: "#E1E6E0",
  income: "#1F6F54", incomeSoft: "#E3F0EA",
  expense: "#B0413E", expenseSoft: "#F6E7E6",
  amber: "#D9A036", amberSoft: "#F8EFDC",
  transfer: "#5C7A8A", transferSoft: "#E8EFF2",
};

const TRANSFER_CAT = "Převod mezi účty";
const EXPENSE_CATS = [
  "Bydlení", "Potraviny", "Restaurace", "Doprava", "Zdraví", "Oblečení", "Drogerie a péče",
  "Elektronika", "Předplatné", "Rodina", "Mazlíčci", "Zahrada", "Zábava", "Dovolená",
  "Hotovost", "Poplatky a daně", "Ostatní",
];
const INCOME_CATS = ["Mzda", "Vedlejší příjem", "Úroky", "Vratky a příspěvky", "Ostatní příjem"];

const CAT_COLORS = {
  "Bydlení": "#3E5C76", "Potraviny": "#6E8B3D", "Restaurace": "#C97B4A", "Doprava": "#8A6FA8",
  "Zdraví": "#C25E5E", "Oblečení": "#A85D8A", "Drogerie a péče": "#7BA05B", "Elektronika": "#4A6FA5",
  "Předplatné": "#B58A3E", "Rodina": "#D9A036", "Mazlíčci": "#B07B4F", "Zahrada": "#4F9078",
  "Zábava": "#C97BA0", "Dovolená": "#4E97A8", "Hotovost": "#8C8C7A", "Poplatky a daně": "#9A8C94",
  "Ostatní": "#8C9A94", [TRANSFER_CAT]: "#5C7A8A",
};

const ACCOUNTS = {
  rodina: { label: "Rodina", num: "1112083044", kind: "current" },
  bezny: { label: "Běžný AB", num: "1112083036", kind: "current" },
  sporici: { label: "Spořicí AB", num: "1112083028", kind: "savings" },
  rbBezny: { label: "Běžný RB", num: "", kind: "current" },
  rbSporici: { label: "Spořicí RB", num: "", kind: "savings" },
};
const isSavings = (acc) => ACCOUNTS[acc]?.kind === "savings";

const STORAGE_KEY = "domaci-finance-v2";
const OLD_KEY = "domaci-finance-v1";
const LOCK_KEY = "domaci-finance-lock";

/* ── šifrování dat PIN kódem (PBKDF2 → AES-GCM) ──
   PIN se nikde neukládá; bez něj jsou data v úložišti nečitelná. */
const te = new TextEncoder(); const td = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pin, saltB64) {
  const base = await crypto.subtle.importKey("raw", te.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: 150000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
  return JSON.stringify({ __enc: true, iv: b64(iv), data: b64(data) });
}
async function decryptJSON(key, raw) {
  const p = JSON.parse(raw);
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p.iv) }, key, unb64(p.data));
  return JSON.parse(td.decode(buf));
}

/* ══ Import PDF výpisů Air Bank (pdf.js, vše lokálně v prohlížeči) ══ */
const AMOUNT_RE = /^-?\d{1,3}(?: \d{3})*,\d{2}$/;
const PDF_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const parseCzAmount = (s) => parseFloat(s.replace(/ /g, "").replace(",", "."));
const normTxt = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function joinItems(items) {
  let out = "", lastEnd = null;
  for (const it of items) {
    if (lastEnd !== null && it.x - lastEnd > 1.5) out += " ";
    out += it.str;
    lastEnd = it.x + (it.w ?? it.str.length * 4);
  }
  return out.replace(/\s+/g, " ").trim();
}

async function parseAirBankPdf(file) {
  // polyfill pro starší Safari (< 17.4)
  if (!Promise.withResolvers) {
    Promise.withResolvers = function () {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  // legacy build pdf.js – kompatibilní se staršími prohlížeči (Safari/WebKit)
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch (e) { /* fallback bez workeru */ }
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str.trim() && it.str !== " ") continue;
      const y = it.transform[5];
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2.5) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], w: it.width, str: it.str });
    }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0])
      .map(([y, items]) => ({ y, items: items.sort((a, b) => a.x - b.x) })));
  }

  const headerText = pages[0].map((l) => joinItems(l.items)).join("\n");
  const accountNum = normTxt(headerText).match(/cislo uctu:\s*(\d{6,10})\s*\/\s*3030/)?.[1] ?? null;
  const period = normTxt(headerText).match(/obdobi vypisu:\s*\d+\.\s*(\d+)\.\s*(\d{4})/);
  const month = period ? `${period[2]}-${String(period[1]).padStart(2, "0")}` : null;
  if (!accountNum || !month) throw new Error("Nepodařilo se přečíst hlavičku – je to výpis Air Bank?");

  let colName = 184, colDetail = 323, colAmount = 483;
  for (const line of pages.flat()) {
    const t = normTxt(line.items.map((i) => i.str).join(""));
    if (t.includes("detaily") && (t.includes("cislo uctu") || t.includes("kod transakce"))) {
      for (const it of line.items) {
        const n = normTxt(it.str);
        if (n.startsWith("detaily")) colDetail = it.x;
        if (n.includes("stka czk")) colAmount = it.x - 6;
        if (n.includes("islo u") || n.startsWith("nazev")) colName = it.x - 2;
      }
      break;
    }
  }

  const STOP = /(pokracovani na strane|vklad na tomto uctu|prehled sporeni|zakladni sazba|air bank a\.s\.)/;
  const txs = [];
  let current = null;
  for (const lines of pages) {
    for (const line of lines) {
      const first = line.items[0];
      if (STOP.test(normTxt(joinItems(line.items)))) { current = null; continue; }
      const isDateStart = PDF_DATE_RE.test((first?.str ?? "").trim());
      const amounts = line.items.filter((i) => AMOUNT_RE.test(i.str.trim()) && i.x > colAmount - 15);
      if (isDateStart && amounts.length >= 2) {
        const m = first.str.trim().match(PDF_DATE_RE);
        const fee = parseCzAmount(amounts[amounts.length - 1].str);
        const amount = parseCzAmount(amounts[amounts.length - 2].str);
        const amtX = amounts[amounts.length - 2].x;
        const nP = [], dP = [], tP = [];
        for (const it of line.items.slice(1)) {
          if (it.x >= amtX - 4 || PDF_DATE_RE.test(it.str.trim())) continue;
          if (it.x >= colDetail - 6) dP.push(it); else if (it.x >= colName - 6) nP.push(it); else tP.push(it);
        }
        current = { date: `${m[3]}-${m[2]}-${m[1]}`, type: joinItems(tP), name: joinItems(nP),
          detail: joinItems(dP), amount, fee, code: null };
        txs.push(current);
      } else if (current) {
        const dP = [], nP = [], tP = [];
        for (const it of line.items) {
          if (it.x >= colAmount - 15) continue;
          const s = it.str.trim();
          if (/^\d{12}$/.test(s)) { current.code = s; continue; }
          if (PDF_DATE_RE.test(s)) continue;
          if (it.x >= colDetail - 6) dP.push(it); else if (it.x >= colName - 6) nP.push(it); else tP.push(it);
        }
        if (dP.length) current.detail = (current.detail + " " + joinItems(dP)).replace(/\s+/g, " ").trim();
        if (nP.length) current.name = (current.name + " " + joinItems(nP)).replace(/\s+/g, " ").trim();
        if (tP.length) current.type = (current.type + " " + joinItems(tP)).replace(/\s+/g, " ").trim();
      }
    }
    current = null;
  }
  return { accountNum, month, txs };
}

/* slovník pravidel: podřetězec (bez diakritiky) → kategorie */
const BUILTIN_RULES = [
  { m: ["altepro"], cat: "Mzda", r: true },
  { m: ["kreditni urok"], cat: "Úroky", r: true },
  { m: ["dan z uroku", "mesicni poplatek", "poplatek"], cat: "Poplatky a daně", r: true },
  { m: ["vyber hotovosti", "bankomat"], cat: "Hotovost" },
  { m: ["19-17608231", "e.on", "eon energie"], cat: "Bydlení", r: true, label: "E.ON – elektřina" },
  { m: ["1801141 / 0100", "19-6728610247"], cat: "Bydlení", r: true, label: "Středočeské vodárny" },
  { m: ["2200959485"], cat: "Bydlení", r: true, label: "ForteNET – internet/TV" },
  { m: ["103709207"], cat: "Bydlení", r: true, label: "Úklid" },
  { m: ["5119748"], cat: "Bydlení", r: true, label: "RB hypo + živ. pojištění" },
  { m: ["ikea", "instalater", "elektrikar"], cat: "Bydlení" },
  { m: ["tesco", "lidl", "kaufland", "albert", "rohlik", "mily market", "billa", "penny", "globus", "kosik"], cat: "Potraviny" },
  { m: ["wolt", "bolt food", "mcdonald", "kfc", "burger", "restaur", "cafe", "coffee", "kavarn", "bistro",
      "qerko", "pizz", "sushi", "sapa food", "vending", "coca cola", "brunch"], cat: "Restaurace" },
  { m: ["easypark", "pidlitacka", "litacka", "regiojet", "studentagency", "shell", "mol ", "benzina",
      "orlen", "eurooil", "uber", "parkov", "stellplatz", "cd.cz", "leo express"], cat: "Doprava" },
  { m: ["lekarn", "dr max", "drmax", "benu"], cat: "Zdraví" },
  { m: ["dm drogerie", "rossmann", "teta drogerie", "kadernictv", "holic"], cat: "Drogerie a péče" },
  { m: ["alza", "datart", "czc.cz", "electro world", "istyle", "mobil pohotovost"], cat: "Elektronika" },
  { m: ["netflix", "spotify", "prime video", "netlify", "anthropic", "claude", "dobiti kreditu", "o2 vyuctovani",
      "o2 czech", "vodafone", "t-mobile", "apple.com", "google one", "youtube", "hbo", "disney", "icloud"], cat: "Předplatné", r: true },
  { m: ["reserved", "pepco", "primark", "ccc ", "deichmann", "h&m", "zara", "about you", "puma",
      "tommy hilfiger", "lovable", "nike", "adidas", "footshop", "sportisimo"], cat: "Oblečení" },
  { m: ["hornbach", "obi ", "bauhaus", "mountfield", "uni hobby", "zahradnictv"], cat: "Zahrada" },
  { m: ["luxor", "knihy dobrovsky", "knihydobrovsky", "kindle", "kino", "cinema", "fever", "ticketmaster",
      "goout", "steam", "playstation"], cat: "Zábava" },
];

function categorizeParsedTx(t, accountNums, learned) {
  const hay = normTxt(`${t.type} ${t.name} ${t.detail}`);
  const income = t.amount > 0;
  // převod mezi vlastními účty?
  for (const [num, key] of Object.entries(accountNums)) {
    if (!key) continue;
    if (hay.includes(num)) {
      return { cat: TRANSFER_CAT, recurring: false, unsure: false,
        dir: income ? "in" : "out", counter: key,
        label: income ? `Převod z účtu ${ACCOUNTS[key]?.label ?? ""}` : `Převod na účet ${ACCOUNTS[key]?.label ?? ""}` };
    }
  }
  // naučená pravidla mají přednost
  for (const [pat, rule] of Object.entries(learned)) {
    if (pat && hay.includes(pat)) return { cat: rule.cat, recurring: !!rule.recurring, unsure: false, dir: null, counter: null, label: null };
  }
  for (const rule of BUILTIN_RULES) {
    if (rule.m.some((p) => hay.includes(p))) {
      if (income && !INCOME_CATS.includes(rule.cat)) continue;
      if (!income && INCOME_CATS.includes(rule.cat)) continue;
      return { cat: rule.cat, recurring: !!rule.r, unsure: false, dir: null, counter: null, label: rule.label ?? null };
    }
  }
  return { cat: income ? "Ostatní příjem" : "Ostatní", recurring: false, unsure: true, dir: null, counter: null, label: null };
}

function buildUploadedBatch(parsed, accountKey, accountNums, learned) {
  const rows = parsed.txs.map((t, i) => {
    const c = categorizeParsedTx(t, accountNums, learned);
    const isCard = normTxt(t.type).includes("platba kartou");
    const merchant = isCard && t.detail ? t.detail.split(",")[0].trim() : null;
    const cleanName = (t.name || "").replace(/Zaid Al-Tamimi/gi, "").replace(/5168\d{2}\*+\d{4}/g, "").trim();
    const display = c.label ?? merchant ?? cleanName ?? t.type;
    const noteBits = [];
    if (merchant && t.detail !== merchant) noteBits.push(t.detail);
    else if (!merchant && t.detail) noteBits.push(t.detail);
    if (cleanName && display !== cleanName && !c.label) noteBits.push(cleanName);
    return {
      key: i, include: true,
      date: t.date,
      amount: t.amount + Math.min(t.fee, 0),
      name: display || t.type,
      note: noteBits.join(" · ").slice(0, 120),
      cat: c.cat, recurring: c.recurring, unsure: c.unsure,
      dir: c.dir, counter: c.counter,
      code: t.code, sugCat: c.cat,
    };
  }).filter((r) => r.amount !== 0);
  return {
    id: `pdf-${parsed.accountNum}-${parsed.month}`,
    account: accountKey,
    accountNum: parsed.accountNum,
    month: parsed.month,
    label: `Nahraný výpis · ${parsed.accountNum} · ${monthLabel(parsed.month)}`,
    rows,
    uploaded: true,
  };
}
const czk = (n) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(n || 0);
const czk2 = (n) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK" }).format(n || 0);
const MONTHS = ["leden","únor","březen","duben","květen","červen","červenec","srpen","září","říjen","listopad","prosinec"];
const MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => { const [y, m] = key.split("-"); return `${MONTHS[+m - 1]} ${y}`; };
const todayISO = () => new Date().toISOString().slice(0, 10);
const typeFromCat = (cat, positive) => cat === TRANSFER_CAT ? "transfer" : positive ? "income" : "expense";

/* ── Import: výpisy Air Bank, červen 2026 ────────────────────── */
/* r = [date(day), amount, name, note, cat, recurring, unsure, dir, counter] */
const B = (day, amount, name, note, cat, recurring = false, unsure = false, dir = null, counter = null) =>
  ({ date: `2026-06-${String(day).padStart(2, "0")}`, amount, name, note, cat, recurring, unsure, dir, counter });

const IMPORT_BATCHES = [
  {
    id: "airbank-rodina-2026-06",
    account: "rodina",
    label: "Účet Rodina (1112083044) · červen 2026",
    rows: [
      B(1,  -2000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(2,  -2000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(4,  -4000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(7,  -2500, "Úklid", "Úklid květen 26 · 103709207/0100", "Bydlení", true),
      B(7,  -2000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(9,  -1000, "Platba · 1879070003/5500 (RB)", "nedohledáno – nejspíš soukromý účet", "Ostatní", true, true),
      B(10, -2000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(11, 92772, "ALTEPRO SOLUTIONS a.s.", "Mzda · VS120", "Mzda", true),
      B(11, -10000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(11, -6000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(13, -15000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(15, -9585.51, "Sava Turizem d.d. (SVN)", "383,85 EUR · slovinské termály (vratka od Ivany 23. 6. na běžný)", "Dovolená"),
      B(15, -5456.24, "E.ON – elektřina", "VS6401370217 · 19-17608231/0100", "Bydlení", true),
      B(15, -7770, "Středočeské vodárny – voda", "VS2220445513 · 1801141/0100", "Bydlení", true),
      B(19, -21000, "RB hypo + živ. pojištění", "trvalý příkaz · 5119748/5500", "Bydlení", true),
      B(20, -2090, "Platba · 785853133/0800 (ČS)", "nedohledáno – nejspíš soukromý účet", "Ostatní", false, true),
      B(21, -3000, "Převod na běžný účet", "1112083036", TRANSFER_CAT, false, false, "out", "bezny"),
      B(22, -400, "ForteNET – internet/TV", "Platba 926536 · 2200959485/2010", "Bydlení", true),
    ],
  },
  {
    id: "airbank-bezny-2026-06",
    account: "bezny",
    label: "Běžný účet (1112083036) · červen 2026",
    rows: [
      B(1, 100, "Ferenčík Martin", "Ferda za kyslík 2026_06", "Ostatní příjem", true),
      B(1, -395.80, "Wolt", "Praha 7", "Restaurace"),
      B(1, 2000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(1, -60, "PID Lítačka – jízdné", "Praha", "Doprava"),
      B(1, -110, "La Forme", "Praha 7", "Zábava"),
      B(2, -36, "PID Lítačka – jízdné", "Praha", "Doprava"),
      B(2, 2000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(2, -590, "Kadeřnictví Klier", "Praha 9", "Drogerie a péče", true),
      B(2, -1523, "Reserved (LPP)", "Praha 9", "Oblečení"),
      B(2, -60, "Pepco", "Praha 20", "Oblečení"),
      B(2, -115, "dm drogerie", "Praha 9", "Drogerie a péče"),
      B(2, -2104, "Primark", "Václavské nám., Praha", "Oblečení"),
      B(2, -400, "Sapa Food", "Vodičkova, Praha", "Restaurace"),
      B(2, -1299, "Luxor – Palác knih", "Václavské nám.", "Zábava"),
      B(2, -499, "Luxor – Palác knih", "Václavské nám.", "Zábava"),
      B(2, -195, "McDonald's Muzeum", "Praha 1", "Restaurace"),
      B(2, -501.40, "EasyPark – parkování", "", "Doprava"),
      B(3, -1236.60, "Rohlik.cz", "", "Potraviny"),
      B(4, -193.53, "Netlify", "9 USD", "Předplatné", true),
      B(4, 4000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(4, -455.60, "Albert – QR platba", "", "Potraviny"),
      B(4, -1150, "Květiny expres", "Praha", "Ostatní"),
      B(4, -836.02, "Lékárna Kojetická", "Neratovice", "Zdraví"),
      B(4, -350, "Dobití kreditu O2", "+420 728 317 547", "Předplatné", true),
      B(5, -162.16, "Kindle", "7,54 USD", "Zábava"),
      B(5, -107.66, "Netlify", "5 USD", "Předplatné", true),
      B(5, -479, "Knihy Dobrovský", "", "Zábava"),
      B(7, 2000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(7, -420.70, "Albert – QR platba", "", "Potraviny"),
      B(8, -149, "Prime Video", "", "Předplatné", true),
      B(8, -650, "Jazz Art Restaurant", "Mikulov", "Restaurace"),
      B(8, -61, "EasyPark – parkování", "", "Doprava"),
      B(8, -650, "Jazz Art Restaurant", "Mikulov", "Restaurace"),
      B(8, -120, "Momo Cafe", "Mikulov", "Restaurace"),
      B(9, -31, "EasyPark – parkování", "", "Doprava"),
      B(9, -165, "Momo Stellplatz", "Praha", "Doprava"),
      B(9, -10, "Tedos Mikulov", "", "Ostatní"),
      B(9, -221, "Qerko", "Praha – Smíchov", "Restaurace"),
      B(9, -477, "McDonald's D1", "Fajtův kopec", "Restaurace"),
      B(9, -419, "Netflix", "", "Předplatné", true),
      B(9, -844.80, "Tesco", "Neratovice", "Potraviny"),
      B(9, -238.50, "Milý Market", "Neratovice", "Potraviny"),
      B(10, 2000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(10, -306.40, "Lidl", "Praha", "Potraviny"),
      B(11, -400, "QR platba", "670100-2222130475/6210 (mBank) – kapesné?", "Ostatní", true, true),
      B(11, 10000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(11, 6000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(11, -95, "o-mai coffee & brunch", "Praha", "Restaurace"),
      B(11, -69, "EasyPark – parkování", "", "Doprava"),
      B(11, -1037, "Wolt", "Praha", "Restaurace"),
      B(12, -544.37, "Anthropic – Claude", "21,78 EUR", "Předplatné", true),
      B(12, -25, "Mixa Vending", "", "Restaurace"),
      B(12, -13.98, "IKEA Černý Most", "", "Ostatní"),
      B(12, -368.60, "Tesco", "Neratovice", "Potraviny"),
      B(12, -2636, "Alza.cz", "", "Elektronika"),
      B(13, 300, "Odměna Unity – Air Bank", "za 05/2026", "Ostatní příjem", true),
      B(13, 15000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(15, -4774.90, "RegioJet (studentagency.cz)", "jízdenky", "Doprava"),
      B(15, -4035, "Výběr z bankomatu ČS", "Neratovice · vč. poplatku 35 Kč", "Hotovost"),
      B(15, -716, "Zásilkovna", "", "Ostatní"),
      B(16, -624.30, "Lovable", "25 EUR", "Oblečení"),
      B(16, -915, "Hornbach", "Praha 9", "Zahrada"),
      B(16, -969, "Puma Outlet", "Praha", "Oblečení"),
      B(16, -371.50, "Tesco", "Neratovice", "Potraviny"),
      B(16, -5303, "Tommy Hilfiger Outlet", "Praha", "Oblečení"),
      B(16, -87.90, "Shell", "Praha", "Doprava"),
      B(16, -6600.09, "Fever – vstupenky", "265 EUR · Barcelona (Cruïlla)", "Dovolená"),
      B(17, -698, "O2 – vyúčtování", "inkaso · VS5290878866", "Předplatné", true),
      B(18, -166.60, "Milý Market", "Neratovice", "Potraviny"),
      B(19, 35000, "Převod ze spořicího účtu", "1112083028", TRANSFER_CAT, false, false, "in", "sporici"),
      B(19, -250, "QR platba", "670100-2222130475/6210 (mBank) – kapesné?", "Ostatní", true, true),
      B(19, -200, "QR platba", "670100-2222130475/6210 (mBank) – kapesné?", "Ostatní", true, true),
      B(21, 3000, "Převod z účtu Rodina", "1112083044", TRANSFER_CAT, false, false, "in", "rodina"),
      B(22, -343.46, "Wolt", "Praha 7", "Restaurace"),
      B(22, 1500, "Jan Jakub Houštecký", "členské 22.6.–23.7.", "Ostatní příjem", true),
      B(22, -200, "CS retail stores s.r.o.", "Praha", "Ostatní", false, true),
      B(22, -250, "Flat Kodaňská", "Praha 10", "Restaurace"),
      B(22, -224.25, "Wild Cafe", "Praha", "Restaurace"),
      B(22, -139.80, "Albert – QR platba", "", "Potraviny"),
      B(22, -35068, "Alza.cz", "větší nákup", "Elektronika"),
      B(23, -1399.99, "Středočeské vodárny – doplatek", "VS2266230149 · 19-6728610247/0100", "Bydlení"),
      B(23, -172.50, "EasyPark – parkování", "", "Doprava"),
      B(23, -761.49, "Lidl", "Neratovice", "Potraviny"),
      B(23, 9585, "Ivana Al-Tamimi", "SLOVINSKO – vratka za termály", "Vratky a příspěvky"),
      B(23, -80, "Coca-Cola vending", "Praha", "Restaurace"),
      B(23, -29.80, "Kaufland", "Česká Lípa", "Potraviny"),
      B(23, -299, "Spotify", "", "Předplatné", true),
      B(23, -45.80, "Kaufland", "Česká Lípa", "Potraviny"),
      B(23, -318, "dm drogerie", "Praha 9", "Drogerie a péče"),
      B(23, -524.30, "CCC", "Praha 9", "Oblečení"),
      B(23, -79.80, "Milý Market", "Neratovice", "Potraviny"),
      B(23, -376.70, "MOL", "Neratovice", "Doprava"),
      B(24, -500, "Výběr z bankomatu MMB", "Česká Lípa", "Hotovost"),
      B(24, -1038.30, "Tesco", "Neratovice", "Potraviny"),
      B(24, -137.70, "Lidl", "Neratovice", "Potraviny"),
      B(24, -204.70, "Lidl", "Neratovice", "Potraviny"),
      B(24, -474.95, "EasyPark – parkování", "", "Doprava"),
      B(25, -200, "QR platba", "670100-2222130475/6210 (mBank) – kapesné?", "Ostatní", true, true),
      B(26, -34.90, "EasyPark – parkování", "", "Doprava"),
      B(29, -280.33, "Wolt", "Praha 7", "Restaurace"),
      B(29, -368, "EasyPark – parkování", "", "Doprava"),
      B(29, -1535, "Výběr z bankomatu ČS", "Neratovice · vč. poplatku 35 Kč", "Hotovost"),
      B(29, -590, "Kadeřnictví Klier", "Praha 9", "Drogerie a péče", true),
      B(30, -907, "Alza.cz", "", "Elektronika"),
      B(30, -209.30, "Milý Market", "Neratovice", "Potraviny"),
      B(30, -25, "Poplatek – SMS zprávy", "Air Bank", "Poplatky a daně", true),
    ],
  },
  {
    id: "airbank-sporici-2026-06",
    account: "sporici",
    label: "Spořicí účet (1112083028) · červen 2026",
    rows: [
      B(2, -3640, "Instalatérské práce – montáž", "VS26010140 · 19-3958570267/0100 · placeno ze spořicího!", "Bydlení"),
      B(3, -3950, "Platba · 2318356153/0800 (ČS)", "nedohledáno – nejspíš soukromý účet · placeno ze spořicího!", "Ostatní", false, true),
      B(19, -35000, "Převod na běžný účet", "1112083036 · dotace cashflow", TRANSFER_CAT, false, false, "out", "bezny"),
      B(30, 1068.49, "Kreditní úrok – Air Bank", "úročení 2,60 % do 500 tis., 0 % nad", "Úroky", true),
      B(30, -160.27, "Daň z úroku", "", "Poplatky a daně", true),
    ],
  },
];

/* ── App ─────────────────────────────────────────────────────── */
export default function DomaciFinance() {
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tx, setTx] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [savingsGoal, setSavingsGoal] = useState(null);
  // hypotéka: {balance, asOf 'YYYY-MM', rate % p.a., payment Kč/měs, original?}
  const [mortgage, setMortgage] = useState(null);
  const [editMortgage, setEditMortgage] = useState(false);
  // PIN zámek
  const [lockSalt, setLockSalt] = useState(null);      // string => zámek nastaven
  const [cryptoKey, setCryptoKey] = useState(null);    // odemčený klíč v paměti
  const [lockScreen, setLockScreen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinA, setPinA] = useState(""); const [pinB, setPinB] = useState("");
  const [secMsg, setSecMsg] = useState("");
  const [wipeArm, setWipeArm] = useState(false);
  // záloha / přenos dat
  const [pendingImport, setPendingImport] = useState(null); // {name, data}
  const [backupMsg, setBackupMsg] = useState("");
  // PDF import
  const [uploadedBatches, setUploadedBatches] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState("");
  const [accountNums, setAccountNums] = useState(() => {
    const m = {}; Object.entries(ACCOUNTS).forEach(([k, a]) => { if (a.num) m[a.num] = k; }); return m;
  });
  const [rulesLearned, setRulesLearned] = useState({});
  // frekvence plateb pro roční přepočet v reportu Bydlení (počet plateb za rok)
  const DEFAULT_FREQ = { "Středočeské vodárny – voda": 4 };
  const [freqOverrides, setFreqOverrides] = useState(DEFAULT_FREQ);
  const [importedBatches, setImportedBatches] = useState([]);
  const [month, setMonth] = useState("2026-06");
  const [tab, setTab] = useState("import");
  const [accFilter, setAccFilter] = useState("vse");
  const [editBudgets, setEditBudgets] = useState(false);
  const [customCats, setCustomCats] = useState({ expense: [], income: [] });
  const [catDraft, setCatDraft] = useState(null); // {batchId, key, kind, text}
  const [importState, setImportState] = useState(() => {
    const s = {};
    IMPORT_BATCHES.forEach((b) => { s[b.id] = b.rows.map((r, i) => ({ ...r, key: i, include: true })); });
    return s;
  });

  // form
  const [fType, setFType] = useState("expense");
  const [fAccount, setFAccount] = useState("bezny");
  const [fAmount, setFAmount] = useState("");
  const [fCat, setFCat] = useState("Potraviny");
  const [fNote, setFNote] = useState("");
  const [fDate, setFDate] = useState(todayISO());

  const applyLoaded = (d) => {
    setTx(d.transactions || []); setBudgets(d.budgets || {});
    setImportedBatches(d.importedBatches || []); setSavingsGoal(d.savingsGoal ?? null);
    setCustomCats(d.customCats || { expense: [], income: [] });
    setFreqOverrides({ ...DEFAULT_FREQ, ...(d.freqOverrides || {}) });
    setMortgage(d.mortgage || null);
    setAccountNums((prev) => ({ ...prev, ...(d.accountNums || {}) }));
    setRulesLearned(d.rulesLearned || {});
    if ((d.importedBatches || []).length >= 3) setTab("prehled");
  };

  const currentDataObj = (patch = {}) => ({
    transactions: patch.transactions ?? tx,
    budgets: patch.budgets ?? budgets,
    importedBatches: patch.importedBatches ?? importedBatches,
    savingsGoal: patch.savingsGoal !== undefined ? patch.savingsGoal : savingsGoal,
    customCats: patch.customCats ?? customCats,
    freqOverrides: patch.freqOverrides ?? freqOverrides,
    mortgage: patch.mortgage !== undefined ? patch.mortgage : mortgage,
    accountNums: patch.accountNums ?? accountNums,
    rulesLearned: patch.rulesLearned ?? rulesLearned,
  });

  /* load + migrace z v1 */
  useEffect(() => {
    (async () => {
      // 1) je nastavený zámek? -> zamknout a čekat na PIN
      try {
        const l = await window.storage.get(LOCK_KEY);
        if (l && l.value) {
          const conf = JSON.parse(l.value);
          if (conf && conf.salt) {
            setLockSalt(conf.salt); setLockScreen(true); setLoading(false); return;
          }
        }
      } catch (e) { /* zámek není */ }
      // 2) běžné načtení (nešifrovaná data)
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r && r.value) { applyLoaded(JSON.parse(r.value)); setLoading(false); return; }
      } catch (e) { /* v2 zatím neexistuje */ }
      try {
        const old = await window.storage.get(OLD_KEY);
        if (old && old.value) {
          const d = JSON.parse(old.value);
          const migrated = (d.transactions || []).map((t) => ({
            ...t, account: t.account || "rodina",
            dir: t.type === "transfer" ? "out" : null,
            counter: t.type === "transfer" ? "bezny" : null,
          }));
          applyLoaded({ ...d, transactions: migrated });
          await window.storage.set(STORAGE_KEY, JSON.stringify({
            transactions: migrated, budgets: d.budgets || {},
            importedBatches: d.importedBatches || [], savingsGoal: null,
          }));
        }
      } catch (e) { /* první spuštění */ }
      setLoading(false);
    })();
  }, []);

  const persist = async (patch = {}) => {
    try {
      setSaveError(false);
      const obj = currentDataObj(patch);
      const value = cryptoKey ? await encryptJSON(cryptoKey, obj) : JSON.stringify(obj);
      await window.storage.set(STORAGE_KEY, value);
    } catch (e) { setSaveError(true); }
  };

  /* ── PIN zámek: akce ── */
  const unlock = async () => {
    setPinError("");
    try {
      const key = await deriveKey(pinInput, lockSalt);
      const r = await window.storage.get(STORAGE_KEY);
      const d = await decryptJSON(key, r.value);
      applyLoaded(d);
      setCryptoKey(key); setLockScreen(false); setPinInput(""); setWipeArm(false);
    } catch (e) { setPinError("Nesprávný PIN, zkus to znovu."); }
  };

  const enableLock = async () => {
    setSecMsg("");
    if (pinA.length < 4) { setSecMsg("PIN musí mít aspoň 4 znaky."); return; }
    if (pinA !== pinB) { setSecMsg("Zadané PINy se neshodují."); return; }
    try {
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await deriveKey(pinA, salt);
      await window.storage.set(STORAGE_KEY, await encryptJSON(key, currentDataObj()));
      await window.storage.set(LOCK_KEY, JSON.stringify({ salt }));
      setLockSalt(salt); setCryptoKey(key); setPinA(""); setPinB("");
      setSecMsg("Zámek je aktivní. PIN si dobře zapamatuj – bez něj data nelze obnovit.");
    } catch (e) { setSecMsg("Aktivace zámku se nepovedla."); }
  };

  const disableLock = async () => {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(currentDataObj()));
      await window.storage.set(LOCK_KEY, JSON.stringify({ salt: null }));
      setLockSalt(null); setCryptoKey(null); setSecMsg("Zámek zrušen, data jsou uložena nešifrovaně.");
    } catch (e) { setSecMsg("Zrušení zámku se nepovedlo."); }
  };

  const resetStates = () => {
    setTx([]); setBudgets({}); setImportedBatches([]); setSavingsGoal(null);
    setCustomCats({ expense: [], income: [] }); setFreqOverrides(DEFAULT_FREQ);
    setMortgage(null); setMonth("2026-06"); setAccFilter("vse");
  };

  const lockNow = () => { resetStates(); setCryptoKey(null); setPinInput(""); setLockScreen(true); };

  const wipeAll = async () => {
    if (!wipeArm) { setWipeArm(true); return; }
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify({ transactions: [], budgets: {}, importedBatches: [] }));
      await window.storage.set(LOCK_KEY, JSON.stringify({ salt: null }));
      resetStates(); setLockSalt(null); setCryptoKey(null);
      setLockScreen(false); setWipeArm(false); setPinInput(""); setPinError("");
    } catch (e) { setPinError("Smazání se nepovedlo."); }
  };

  /* ── záloha a přenos dat mezi zařízeními ── */
  const exportData = () => {
    const blob = new Blob([JSON.stringify(currentDataObj(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `domaci-finance-zaloha-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setBackupMsg("Záloha stažena. Pozor: soubor je nešifrovaný – ulož ho na bezpečné místo.");
  };

  const pickBackupFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.__enc) { setBackupMsg("Tohle je šifrovaný blob, ne záloha – exportuj zálohu z odemčené aplikace."); return; }
        if (!Array.isArray(d.transactions)) { setBackupMsg("Soubor nevypadá jako záloha Domácích financí."); return; }
        setPendingImport({ name: file.name, data: d });
        setBackupMsg("");
      } catch (e) { setBackupMsg("Soubor se nepodařilo přečíst."); }
    };
    reader.readAsText(file);
  };

  const applyBackup = (mode) => {
    const d = pendingImport.data;
    if (mode === "replace") {
      applyLoaded(d);
      persist({
        transactions: d.transactions || [], budgets: d.budgets || {},
        importedBatches: d.importedBatches || [], savingsGoal: d.savingsGoal ?? null,
        customCats: d.customCats || { expense: [], income: [] },
        freqOverrides: d.freqOverrides || {}, mortgage: d.mortgage || null,
      });
      setBackupMsg(`Data nahrazena zálohou (${(d.transactions || []).length} záznamů).`);
    } else {
      // sloučení: doplní záznamy, které tu chybí (podle id); nastavení zůstává místní
      const known = new Set(tx.map((t) => t.id));
      const added = (d.transactions || []).filter((t) => !known.has(t.id));
      const nextTx = [...added, ...tx];
      const nextBatches = [...new Set([...importedBatches, ...(d.importedBatches || [])])];
      setTx(nextTx); setImportedBatches(nextBatches);
      persist({ transactions: nextTx, importedBatches: nextBatches });
      setBackupMsg(`Sloučeno: přidáno ${added.length} nových záznamů.`);
    }
    setPendingImport(null);
  };

  const handlePdfUpload = async (file) => {
    if (!file) return;
    setPdfBusy(true); setPdfMsg("");
    try {
      const parsed = await parseAirBankPdf(file);
      const accountKey = accountNums[parsed.accountNum] ?? null;
      const batch = buildUploadedBatch(parsed, accountKey, accountNums, rulesLearned);
      if (uploadedBatches.some((b) => b.id === batch.id)) {
        setPdfMsg("Tento výpis už je nahraný níže."); setPdfBusy(false); return;
      }
      setUploadedBatches([...uploadedBatches, batch]);
      setImportState((s) => ({ ...s, [batch.id]: batch.rows }));
      setPdfMsg(`Načteno ${batch.rows.length} transakcí (${monthLabel(parsed.month)}).`
        + (accountKey ? "" : " Neznámé číslo účtu – přiřaď ho níže."));
    } catch (e) {
      setPdfMsg(String(e?.message || "").includes("import")
        ? "PDF import funguje v nasazené verzi appky (v náhledu Claude není pdf.js k dispozici)."
        : `Výpis se nepodařilo zpracovat: ${e.message}`);
    }
    setPdfBusy(false);
  };

  const assignBatchAccount = (batchId, accountKey) => {
    const batch = uploadedBatches.find((b) => b.id === batchId);
    setUploadedBatches(uploadedBatches.map((b) => b.id === batchId ? { ...b, account: accountKey } : b));
    if (batch?.accountNum) {
      const next = { ...accountNums, [batch.accountNum]: accountKey };
      setAccountNums(next); persist({ accountNums: next });
    }
  };

  const confirmImport = (batch) => {
    const stamp = Date.now();
    const existing = new Set(tx.map((t) => t.id));
    const rows = importState[batch.id].filter((r) => r.include)
      .filter((r) => !r.code || !existing.has(`ab-${r.code}`));
    const newTx = rows.map((r, i) => ({
      id: r.code ? `ab-${r.code}` : `imp-${batch.id}-${stamp}-${i}`,
      account: batch.account,
      type: typeFromCat(r.cat, r.amount > 0),
      amount: Math.abs(r.amount),
      category: r.cat,
      note: `${r.name}${r.note ? " · " + r.note : ""}`,
      date: r.date, recurring: r.recurring,
      dir: r.dir, counter: r.counter, source: batch.id,
    }));
    const nextTx = [...newTx, ...tx];
    const nextBatches = [...new Set([...importedBatches, batch.id])];
    // učení: co jsi ručně překategorizoval, si appka zapamatuje pro příště
    const learnedNext = { ...rulesLearned };
    importState[batch.id].forEach((r) => {
      if (r.include && r.sugCat && r.cat !== r.sugCat && r.cat !== TRANSFER_CAT && r.name) {
        const key = normTxt(r.name).slice(0, 40);
        if (key.length >= 3) learnedNext[key] = { cat: r.cat, recurring: r.recurring };
      }
    });
    setRulesLearned(learnedNext);
    setTx(nextTx); setImportedBatches(nextBatches);
    persist({ transactions: nextTx, importedBatches: nextBatches, rulesLearned: learnedNext });
    setMonth(batch.month ?? "2026-06");
  };

  const addTx = () => {
    const amount = parseFloat(String(fAmount).replace(",", "."));
    if (!amount || amount <= 0) return;
    const t = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      account: fAccount, type: fType, amount, category: fCat, note: fNote.trim(),
      date: fDate, recurring: false, dir: null, counter: null,
    };
    const next = [t, ...tx];
    setTx(next); persist({ transactions: next });
    setFAmount(""); setFNote("");
  };

  const removeTx = (id) => { const next = tx.filter((t) => t.id !== id); setTx(next); persist({ transactions: next }); };
  const setBudget = (cat, val) => {
    const v = parseFloat(String(val).replace(",", "."));
    const next = { ...budgets, [cat]: isNaN(v) || v <= 0 ? undefined : v };
    Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
    setBudgets(next); persist({ budgets: next });
  };
  const updateTxCategory = (id, cat) => {
    const next = tx.map((t) => t.id === id ? { ...t, category: cat } : t);
    setTx(next); persist({ transactions: next });
  };
  const toggleTxRecurring = (id) => {
    const next = tx.map((t) => t.id === id ? { ...t, recurring: !t.recurring } : t);
    setTx(next); persist({ transactions: next });
  };
  const confirmCatDraft = () => {
    if (!catDraft) return;
    const name = catDraft.text.trim();
    if (!name) { setCatDraft(null); return; }
    const kind = catDraft.kind;
    const base = kind === "income" ? INCOME_CATS : EXPENSE_CATS;
    if (![...base, ...customCats[kind], TRANSFER_CAT].includes(name)) {
      const next = { ...customCats, [kind]: [...customCats[kind], name] };
      setCustomCats(next); persist({ customCats: next });
    }
    setImportState({
      ...importState,
      [catDraft.batchId]: importState[catDraft.batchId].map((x) =>
        x.key === catDraft.key ? { ...x, cat: name } : x),
    });
    setCatDraft(null);
  };

  const saveGoal = (val) => {
    const v = parseFloat(String(val).replace(",", "."));
    const g = isNaN(v) || v <= 0 ? null : v;
    setSavingsGoal(g); persist({ savingsGoal: g });
  };

  /* ── derived: přehled ── */
  const inMonthAll = useMemo(() => tx.filter((t) => t.date.slice(0, 7) === month), [tx, month]);
  const inMonth = useMemo(
    () => accFilter === "vse" ? inMonthAll : inMonthAll.filter((t) => t.account === accFilter),
    [inMonthAll, accFilter]
  );
  const income = inMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = inMonth.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  const byCat = useMemo(() => {
    const m = {};
    inMonth.filter((t) => t.type === "expense").forEach((t) => { m[t.category] = (m[t.category] || 0) + t.amount; });
    return m;
  }, [inMonth]);

  const trend = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const rows = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const k = monthKey(d);
      const mt = tx.filter((t) => t.date.slice(0, 7) === k && (accFilter === "vse" || t.account === accFilter));
      rows.push({
        name: MONTHS_SHORT[d.getMonth()],
        "Příjmy": mt.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0),
        "Výdaje": mt.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0),
      });
    }
    return rows;
  }, [tx, month, accFilter]);

  /* ── derived: spoření (přes všechny spořicí účty) ── */
  const savingsForMonth = (mKey) => {
    const mt = tx.filter((t) => t.date.slice(0, 7) === mKey);
    const spor = mt.filter((t) => isSavings(t.account));
    // přesun mezi dvěma spořicími účty (např. AB → RB) není vklad ani výběr
    const isExternal = (counter) => !isSavings(counter); // null/undefined = mimo spoření
    // vklady/výběry: max z obou stran výpisů, aby se nic nepočítalo dvakrát ani nechybělo
    const depA = spor.filter((t) => t.type === "transfer" && t.dir === "in" && isExternal(t.counter)).reduce((s, t) => s + t.amount, 0);
    const depB = mt.filter((t) => !isSavings(t.account) && t.type === "transfer" && t.dir === "out" && isSavings(t.counter)).reduce((s, t) => s + t.amount, 0);
    const wdTxA = spor.filter((t) => t.type === "transfer" && t.dir === "out" && isExternal(t.counter));
    const wdTxB = mt.filter((t) => !isSavings(t.account) && t.type === "transfer" && t.dir === "in" && isSavings(t.counter));
    const wdA = wdTxA.reduce((s, t) => s + t.amount, 0);
    const wdB = wdTxB.reduce((s, t) => s + t.amount, 0);
    const deposits = Math.max(depA, depB);
    const withdrawals = Math.max(wdA, wdB);
    const directSpendTx = spor.filter((t) => t.type === "expense" && t.category !== "Poplatky a daně");
    const directSpend = directSpendTx.reduce((s, t) => s + t.amount, 0);
    const interest = spor.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const fees = spor.filter((t) => t.type === "expense" && t.category === "Poplatky a daně").reduce((s, t) => s + t.amount, 0);
    const dotaceCount = Math.max(wdTxA.length, wdTxB.length) + directSpendTx.length;
    const net = deposits + interest - withdrawals - directSpend - fees;
    return { deposits, withdrawals, directSpend, interest, fees, dotaceCount, net };
  };

  const sav = useMemo(() => savingsForMonth(month), [tx, month]);

  /* ── derived: dashboard (napříč všemi účty) ── */
  const dash = useMemo(() => {
    const exp = inMonthAll.filter((t) => t.type === "expense");
    const total = exp.reduce((s, t) => s + t.amount, 0);
    const txCount = exp.length;
    // kategorie za měsíc
    const catMap = {};
    exp.forEach((t) => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
    const pie = Object.entries(catMap).map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
    // top příjemci za měsíc
    const payMap = {};
    exp.forEach((t) => {
      const key = (t.note || "").split(" · ")[0].trim() || t.category;
      payMap[key] = (payMap[key] || 0) + t.amount;
    });
    const topPayees = Object.entries(payMap).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 8);
    // podle účtů za měsíc
    const accMap = {};
    exp.forEach((t) => { accMap[t.account] = (accMap[t.account] || 0) + t.amount; });
    const byAccount = Object.entries(accMap)
      .map(([k, value]) => ({ name: ACCOUNTS[k]?.label ?? k, value }))
      .sort((a, b) => b.value - a.value);
    // skládaný trend 6 měsíců podle top kategorií
    const [y, m] = month.split("-").map(Number);
    const allCatTotals = {};
    const monthsKeys = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      monthsKeys.push(monthKey(d));
    }
    tx.filter((t) => t.type === "expense" && monthsKeys.includes(t.date.slice(0, 7)))
      .forEach((t) => { allCatTotals[t.category] = (allCatTotals[t.category] || 0) + t.amount; });
    const topCats = Object.entries(allCatTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
    const stack = monthsKeys.map((k) => {
      const row = { name: MONTHS_SHORT[Number(k.slice(5, 7)) - 1] };
      let other = 0;
      tx.filter((t) => t.type === "expense" && t.date.slice(0, 7) === k).forEach((t) => {
        if (topCats.includes(t.category)) row[t.category] = Math.round((row[t.category] || 0) + t.amount);
        else other += t.amount;
      });
      if (other > 0) row["Ostatní kategorie"] = Math.round(other);
      return row;
    });
    return { total, txCount, pie, topPayees, byAccount, stack, topCats };
  }, [inMonthAll, tx, month]);

  /* ── derived: hypotéka (amortizační odhad k vybranému měsíci) ── */
  const mortInfo = useMemo(() => {
    if (!mortgage || !mortgage.balance || !mortgage.rate || !mortgage.payment) return null;
    const r = mortgage.rate / 100 / 12;
    const diffMonths = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12
      + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
    let bal = mortgage.balance;
    const steps = Math.max(diffMonths(mortgage.asOf, month), 0);
    for (let i = 0; i < steps && bal > 0; i++) bal = bal * (1 + r) - mortgage.payment;
    bal = Math.max(bal, 0);
    const interestM = bal * r;
    const principalM = Math.max(mortgage.payment - interestM, 0);
    // odhad doplacení
    let b2 = bal, m2 = 0;
    while (b2 > 0 && m2 < 600) { b2 = b2 * (1 + r) - mortgage.payment; m2++; }
    const [y, m] = month.split("-").map(Number);
    const payoffDate = new Date(y, m - 1 + m2, 1);
    const payoff = m2 >= 600 ? null : `${MONTHS[payoffDate.getMonth()]} ${payoffDate.getFullYear()}`;
    const paidShare = mortgage.original ? 1 - bal / mortgage.original : null;
    return { bal, interestM, principalM, payoff, paidShare, behind: diffMonths(mortgage.asOf, month) < 0 };
  }, [mortgage, month]);

  const saveMortgage = (patch) => {
    const next = { ...(mortgage || { asOf: month }), ...patch };
    ["balance", "rate", "payment", "original"].forEach((k) => {
      if (typeof next[k] === "string") {
        const v = parseFloat(next[k].replace(",", "."));
        next[k] = isNaN(v) || v <= 0 ? null : v;
      }
    });
    setMortgage(next); persist({ mortgage: next });
  };

  /* ── derived: report bydlení (ze všech dat, ne jen z vybraného měsíce) ── */
  const bydleni = useMemo(() => {
    const rows = tx.filter((t) => t.type === "expense" && t.category === "Bydlení");
    const groups = {};
    rows.forEach((t) => {
      const key = (t.note || "").split(" · ")[0].trim() || "Ostatní bydlení";
      if (!groups[key]) groups[key] = { name: key, total: 0, months: new Set(), recurring: false, count: 0 };
      const g = groups[key];
      g.total += t.amount;
      g.months.add(t.date.slice(0, 7));
      g.count += 1;
      if (t.recurring) g.recurring = true;
    });
    const list = Object.values(groups).map((g) => {
      // frekvence: počet plateb za rok (12 měsíčně, 4 kvartálně, 1 ročně, 0 jednorázově)
      const perYear = freqOverrides[g.name] !== undefined
        ? freqOverrides[g.name]
        : (g.recurring ? 12 : 0);
      const perPayment = g.total / g.count;
      const yearly = perYear > 0 ? perPayment * perYear : g.total;
      return { ...g, perPayment, perYear, yearly };
    }).sort((a, b) => b.yearly - a.yearly);
    const yearTotal = list.reduce((s, g) => s + g.yearly, 0);
    // odhad měsíční mzdy pro podíl nákladů na příjmu
    const mzdy = tx.filter((t) => t.type === "income" && t.category === "Mzda");
    const mzdaMonths = new Set(mzdy.map((t) => t.date.slice(0, 7))).size;
    const mzdaMonthly = mzdaMonths > 0 ? mzdy.reduce((s, t) => s + t.amount, 0) / mzdaMonths : 0;
    const dataMonths = new Set(rows.map((t) => t.date.slice(0, 7))).size;
    return { list, yearTotal, mzdaMonthly, dataMonths };
  }, [tx, freqOverrides]);

  const setFreq = (name, val) => {
    const next = { ...freqOverrides, [name]: Number(val) };
    setFreqOverrides(next); persist({ freqOverrides: next });
  };

  const savTrend = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const rows = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      rows.push({ name: MONTHS_SHORT[d.getMonth()], "Čistý tok": Math.round(savingsForMonth(monthKey(d)).net) });
    }
    return rows;
  }, [tx, month]);

  const shiftMonth = (dir) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(monthKey(new Date(y, m - 1 + dir, 1)));
  };

  const expCats = useMemo(() => [...EXPENSE_CATS, ...customCats.expense], [customCats]);
  const incCats = useMemo(() => [...INCOME_CATS, ...customCats.income], [customCats]);
  const cats = fType === "expense" ? expCats : incCats;

  if (loading) {
    return <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center",
      justifyContent: "center", color: T.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif" }}>Načítám data…</div>;
  }

  if (lockScreen) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center",
        justifyContent: "center", padding: 16, fontFamily: "'IBM Plex Sans', sans-serif", color: T.ink }}>
        <div style={{ ...card, width: 340, maxWidth: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 34 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "6px 0 2px" }}>Domácí finance</h1>
          <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 0 }}>Data jsou zašifrovaná. Zadej PIN.</p>
          <input type="password" inputMode="numeric" autoFocus value={pinInput} placeholder="PIN"
            onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            style={{ ...input, textAlign: "center", fontSize: 18, letterSpacing: "0.3em", marginTop: 4 }} />
          {pinError && <div style={{ fontSize: 13, color: T.expense, marginTop: 8 }}>{pinError}</div>}
          <button onClick={unlock} style={{ ...primaryBtn, background: T.income, width: "100%", marginTop: 12 }}>
            Odemknout
          </button>
          <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
            <button onClick={wipeAll} style={{ ...ghostBtn, color: T.expense, borderColor: T.expenseSoft, fontSize: 12 }}>
              {wipeArm ? "Opravdu smazat všechna data? Klikni znovu." : "Zapomněl jsem PIN – smazat data a začít znovu"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const spentShare = income > 0 ? Math.min(expense / income, 1) : expense > 0 ? 1 : 0;

  const monthNav = (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 16 }}>
      <button onClick={() => shiftMonth(-1)} aria-label="Předchozí měsíc" style={navBtn}>‹</button>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, minWidth: 150, textAlign: "center" }}>{monthLabel(month)}</div>
      <button onClick={() => shiftMonth(1)} aria-label="Další měsíc" style={navBtn}>›</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        input, select, button { font-family: inherit; }
        input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid ${T.income}; outline-offset: 2px; }
        .mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 16px 64px" }}>

        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: T.inkSoft }}>Domácí účetní kniha</div>
            <h1 style={{ fontSize: 26, fontWeight: 600, margin: "2px 0 0" }}>Domácí finance</h1>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <TabBtn active={tab === "prehled"} onClick={() => setTab("prehled")}>Přehled</TabBtn>
            <TabBtn active={tab === "dashboard"} onClick={() => setTab("dashboard")}>Dashboard</TabBtn>
            <TabBtn active={tab === "sporeni"} onClick={() => setTab("sporeni")}>Spoření</TabBtn>
            <TabBtn active={tab === "bydleni"} onClick={() => setTab("bydleni")}>Bydlení</TabBtn>
            <TabBtn active={tab === "import"} onClick={() => setTab("import")}>
              Import výpisů{importedBatches.length > 0 ? ` ${importedBatches.length}/3` : ""}
            </TabBtn>
            {lockSalt && cryptoKey && (
              <button onClick={lockNow} aria-label="Zamknout aplikaci" title="Zamknout" style={navBtn}>🔒</button>
            )}
          </div>
        </header>

        {saveError && (
          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: T.expenseSoft, color: T.expense, fontSize: 13 }}>
            Uložení se nepovedlo. Poslední změna se nemusela zapsat – zkus akci zopakovat.
          </div>
        )}

        {/* ══ BYDLENÍ ══ */}
        {tab === "bydleni" && (
          <>
            <section style={{ ...card, marginTop: 20 }}>
              <h2 style={h2}>Roční náklady na bydlení</h2>
              {bydleni.list.length === 0 ? (
                <p style={{ fontSize: 13, color: T.inkSoft }}>
                  Zatím žádné výdaje v kategorii Bydlení. Naimportuj výpisy, nebo přidej záznamy v Přehledu.
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <Stat label="Ročně (odhad)" value={czk(bydleni.yearTotal)} color={CAT_COLORS["Bydlení"]} />
                    <Stat label="Měsíčně" value={czk(bydleni.yearTotal / 12)} color={T.ink} />
                    {bydleni.mzdaMonthly > 0 && (
                      <Stat label="Podíl na mzdě"
                        value={`${Math.round((bydleni.yearTotal / 12 / bydleni.mzdaMonthly) * 100)} %`}
                        color={T.inkSoft} />
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: T.inkSoft, marginTop: 10, marginBottom: 0 }}>
                    Odhad z {bydleni.dataMonths === 1 ? "1 měsíce dat" : `${bydleni.dataMonths} měsíců dat`}:
                    pravidelné platby jsou přepočtené na 12 měsíců, jednorázové započtené tak, jak proběhly.
                    S každým dalším importovaným měsícem se odhad zpřesní.
                  </p>
                </>
              )}
            </section>

            {bydleni.list.length > 0 && (
              <section style={{ ...card, marginTop: 16 }}>
                <h2 style={h2}>Za co a kolik</h2>
                {bydleni.list.map((g) => {
                  const share = bydleni.yearTotal > 0 ? g.yearly / bydleni.yearTotal : 0;
                  return (
                    <div key={g.name} style={{ marginTop: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        flexWrap: "wrap", gap: 6, fontSize: 13.5, marginBottom: 4 }}>
                        <span style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {g.name}
                          <select value={g.perYear} onChange={(e) => setFreq(g.name, e.target.value)}
                            aria-label="Frekvence platby"
                            style={{ ...input, width: "auto", padding: "2px 6px", fontSize: 12, color: T.inkSoft }}>
                            <option value={12}>měsíčně</option>
                            <option value={4}>kvartálně</option>
                            <option value={1}>ročně</option>
                            <option value={0}>jednorázově</option>
                          </select>
                        </span>
                        <span className="mono" style={{ color: T.inkSoft }}>
                          {g.perYear > 0 ? `${czk(g.perPayment)}${g.perYear === 12 ? " /měs" : g.perYear === 4 ? " /kvartál" : " /rok"} → ` : ""}
                          <span style={{ color: T.ink, fontWeight: 600 }}>{czk(g.yearly)} /rok</span>
                        </span>
                      </div>
                      <div style={{ height: 10, borderRadius: 5, background: "#EDF1EC", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.max(share * 100, 1.5)}%`,
                          background: CAT_COLORS["Bydlení"], opacity: 0.55 + share * 0.45,
                          transition: "width .4s ease" }} />
                      </div>
                      <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 2 }}>
                        {Math.round(share * 100)} % nákladů na bydlení
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}

        {/* ══ IMPORT ══ */}
        {tab === "import" && (
          <section style={{ ...card, marginTop: 20 }}>
            <h2 style={h2}>Nahrát výpis (PDF Air Bank)</h2>
            <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 0 }}>
              Stáhni měsíční výpis z internetbankingu Air Bank a nahraj ho sem – zpracuje se
              přímo v prohlížeči, nikam se neposílá. Kategorie se doplní automaticky; co změníš,
              si appka zapamatuje pro příští importy.
            </p>
            <label style={{ ...primaryBtn, background: T.ink, display: "inline-block", cursor: "pointer", opacity: pdfBusy ? 0.6 : 1 }}>
              {pdfBusy ? "Zpracovávám…" : "Vybrat PDF výpis"}
              <input type="file" accept="application/pdf,.pdf" disabled={pdfBusy} style={{ display: "none" }}
                onChange={(e) => { handlePdfUpload(e.target.files[0]); e.target.value = ""; }} />
            </label>
            {pdfMsg && <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 10 }}>{pdfMsg}</div>}
          </section>
        )}
        {tab === "import" && [...uploadedBatches, ...IMPORT_BATCHES].map((batch) => {
          const rows = importState[batch.id] || [];
          const included = rows.filter((r) => r.include);
          const done = importedBatches.includes(batch.id);
          const inc = included.filter((r) => r.amount > 0 && r.cat !== TRANSFER_CAT).reduce((s, r) => s + r.amount, 0);
          const exp = included.filter((r) => r.amount < 0 && r.cat !== TRANSFER_CAT).reduce((s, r) => s - r.amount, 0);
          const trn = included.filter((r) => r.cat === TRANSFER_CAT).reduce((s, r) => s + Math.abs(r.amount), 0);
          return (
            <section key={batch.id} style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <h2 style={{ ...h2, margin: 0 }}>{batch.label}{done ? " ✓" : ""}</h2>
                <div style={{ display: "flex", gap: 16, fontSize: 13 }} className="mono">
                  <span style={{ color: T.income }}>+{czk(inc)}</span>
                  <span style={{ color: T.expense }}>−{czk2(exp)}</span>
                  <span style={{ color: T.transfer }}>⇄ {czk(trn)}</span>
                </div>
              </div>
              {done && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: T.amberSoft, color: "#8A6414", fontSize: 13 }}>
                  Tento výpis už byl importován. Opakovaný import by vytvořil duplicitní záznamy.
                </div>
              )}
              {batch.uploaded && !batch.account && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: T.amberSoft, fontSize: 13,
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>Neznámé číslo účtu <strong>{batch.accountNum}</strong> – ke kterému účtu patří?</span>
                  <select defaultValue="" onChange={(e) => e.target.value && assignBatchAccount(batch.id, e.target.value)}
                    style={{ ...input, width: 160, padding: "5px 8px", fontSize: 13 }}>
                    <option value="" disabled>Vybrat účet…</option>
                    {Object.entries(ACCOUNTS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
                  </select>
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                {rows.map((r) => (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                    padding: "8px 0", borderBottom: `1px solid ${T.line}`, opacity: r.include ? 1 : 0.45 }}>
                    <input type="checkbox" checked={r.include} aria-label="Zahrnout do importu"
                      onChange={() => setImportState({ ...importState, [batch.id]: rows.map((x) => x.key === r.key ? { ...x, include: !x.include } : x) })}
                      style={{ width: 15, height: 15, accentColor: T.income, cursor: "pointer" }} />
                    <div style={{ flex: "1 1 230px", minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                        {r.name}{" "}
                        {r.cat !== TRANSFER_CAT && (
                          <RecurToggle value={r.recurring} disabled={!r.include}
                            onClick={() => setImportState({ ...importState,
                              [batch.id]: rows.map((x) => x.key === r.key ? { ...x, recurring: !x.recurring } : x) })} />
                        )}
                        {r.unsure && <Badge kind="unsure">ověřit</Badge>}
                      </div>
                      <div style={{ fontSize: 12, color: T.inkSoft }}>
                        {new Date(r.date + "T00:00").toLocaleDateString("cs-CZ")}{r.note ? ` · ${r.note}` : ""}
                      </div>
                    </div>
                    {catDraft && catDraft.batchId === batch.id && catDraft.key === r.key ? (
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input autoFocus value={catDraft.text} placeholder="název kategorie"
                          onChange={(e) => setCatDraft({ ...catDraft, text: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") confirmCatDraft(); if (e.key === "Escape") setCatDraft(null); }}
                          style={{ ...input, width: 120, padding: "5px 8px", fontSize: 13 }} />
                        <button onClick={confirmCatDraft} style={{ ...ghostBtn, padding: "4px 10px", borderColor: T.income, color: T.income }}>OK</button>
                        <button onClick={() => setCatDraft(null)} aria-label="Zrušit" style={{ ...ghostBtn, padding: "4px 8px", color: T.inkSoft }}>✕</button>
                      </span>
                    ) : (
                      <select value={r.cat} disabled={!r.include}
                        onChange={(e) => {
                          if (e.target.value === "__add__") {
                            setCatDraft({ batchId: batch.id, key: r.key, kind: r.amount > 0 ? "income" : "expense", text: "" });
                          } else {
                            setImportState({ ...importState, [batch.id]: rows.map((x) => x.key === r.key ? { ...x, cat: e.target.value } : x) });
                          }
                        }}
                        style={{ ...input, width: 168, padding: "5px 8px", fontSize: 13, borderColor: r.unsure ? T.amber : "#D4DBD4" }}>
                        {(r.amount > 0 ? [...incCats, TRANSFER_CAT] : [...expCats, TRANSFER_CAT]).map((c) => <option key={c}>{c}</option>)}
                        <option value="__add__">➕ Nová kategorie…</option>
                      </select>
                    )}
                    <div className="mono" style={{ width: 110, textAlign: "right", fontSize: 13.5, fontWeight: 600,
                      color: r.cat === TRANSFER_CAT ? T.transfer : r.amount > 0 ? T.income : T.ink }}>
                      {r.amount > 0 ? "+" : "−"}{czk2(Math.abs(r.amount))}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => confirmImport(batch)} disabled={included.length === 0 || done || (batch.uploaded && !batch.account)}
                style={{ ...primaryBtn, marginTop: 14, background: T.income, opacity: included.length === 0 || done ? 0.5 : 1 }}>
                {done ? "Importováno" : `Importovat ${included.length} záznamů`}
              </button>
            </section>
          );
        })}

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <>
            {monthNav}
            <section style={{ ...card, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                <Stat label="Výdaje celkem" value={czk(dash.total)} color={T.expense} />
                <Stat label="Největší kategorie" value={dash.pie[0]?.name ?? "–"} color={CAT_COLORS[dash.pie[0]?.name] ?? T.ink} />
                <Stat label="Transakcí" value={String(dash.txCount)} color={T.ink} />
                <Stat label="Průměr / den" value={czk(dash.total / 30)} color={T.inkSoft} />
              </div>
              <p style={{ fontSize: 12, color: T.inkSoft, margin: "10px 0 0" }}>
                Výdaje napříč všemi účty; převody mezi vlastními účty se nepočítají.
              </p>
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Výdaje podle kategorií — {monthLabel(month)}</h2>
              {dash.pie.length === 0 ? (
                <p style={{ fontSize: 13, color: T.inkSoft }}>Žádné výdaje v tomto měsíci.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                  <div style={{ width: 230, height: 230, flexShrink: 0 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={dash.pie} dataKey="value" nameKey="name" innerRadius={60} outerRadius={105}
                          paddingAngle={1} strokeWidth={1}>
                          {dash.pie.map((e) => <Cell key={e.name} fill={CAT_COLORS[e.name] ?? "#8C9A94"} />)}
                        </Pie>
                        <Tooltip formatter={(v) => czk(v)}
                          contentStyle={{ borderRadius: 10, border: `1px solid ${T.line}`, fontSize: 13 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    {dash.pie.slice(0, 9).map((e) => (
                      <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLORS[e.name] ?? "#8C9A94", flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                        <span className="mono" style={{ color: T.inkSoft }}>
                          {czk(e.value)} · {dash.total > 0 ? Math.round((e.value / dash.total) * 100) : 0} %
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Skladba výdajů — posledních 6 měsíců</h2>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={dash.stack} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: T.inkSoft }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: T.inkSoft }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={44} />
                    <Tooltip formatter={(v) => czk(v)} cursor={{ fill: "#EDF1EC" }}
                      contentStyle={{ borderRadius: 10, border: `1px solid ${T.line}`, fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {dash.topCats.map((c) => (
                      <Bar key={c} dataKey={c} stackId="v" fill={CAT_COLORS[c] ?? "#8C9A94"} />
                    ))}
                    <Bar dataKey="Ostatní kategorie" stackId="v" fill="#C9D2CC" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Největší příjemci — {monthLabel(month)}</h2>
              {dash.topPayees.map((p) => {
                const share = dash.topPayees[0] ? p.value / dash.topPayees[0].value : 0;
                return (
                  <div key={p.name} style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{p.name}</span>
                      <span className="mono" style={{ color: T.inkSoft }}>{czk(p.value)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "#EDF1EC", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(share * 100, 2)}%`, background: T.expense,
                        opacity: 0.45 + share * 0.55, transition: "width .4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Výdaje podle účtů — {monthLabel(month)}</h2>
              {dash.byAccount.map((a) => (
                <div key={a.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "7px 0",
                  borderBottom: `1px solid ${T.line}` }}>
                  <span>{a.name}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{czk(a.value)}</span>
                </div>
              ))}
            </section>
          </>
        )}

        {/* ══ SPOŘENÍ ══ */}
        {tab === "sporeni" && (
          <>
            {monthNav}
            <section style={{ ...card, marginTop: 12 }}>
              <h2 style={h2}>Spoření — {monthLabel(month)}</h2>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                <Stat label="Vloženo" value={czk(sav.deposits)} color={T.income} />
                <Stat label="Vybráno / utraceno" value={czk(sav.withdrawals + sav.directSpend)} color={T.expense} />
                <Stat label="Úroky (netto)" value={czk2(sav.interest - sav.fees)} color={T.inkSoft} />
                <Stat label="Čistý tok" value={czk(sav.net)} color={sav.net >= 0 ? T.income : T.expense} />
              </div>
            </section>

            <section style={{ ...card, marginTop: 16, borderLeft: `4px solid ${sav.dotaceCount === 0 ? T.income : T.expense}` }}>
              <h2 style={h2}>Dotace cashflow ze spoření</h2>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 40, fontWeight: 600, color: sav.dotaceCount === 0 ? T.income : T.expense }}>
                  {sav.dotaceCount}×
                </span>
                <span style={{ fontSize: 14, color: T.inkSoft }}>
                  {sav.dotaceCount === 0
                    ? "Skvělé! Tento měsíc jsi ze spoření nic nečerpal. Cíl splněn. 🎉"
                    : `Cíl je 0×. Tento měsíc odešlo ze spoření ${czk(sav.withdrawals + sav.directSpend)} (převody na běžný + platby přímo ze spořicího).`}
                </span>
              </div>
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <h2 style={{ ...h2, margin: 0 }}>Měsíční cíl spoření</h2>
                <label style={{ fontSize: 13, color: T.inkSoft, display: "flex", alignItems: "center", gap: 8 }}>
                  Cíl (Kč/měsíc):
                  <input defaultValue={savingsGoal || ""} placeholder="např. 5000" inputMode="decimal"
                    onBlur={(e) => saveGoal(e.target.value)} style={{ ...input, width: 110, padding: "5px 8px", fontSize: 13 }} />
                </label>
              </div>
              {savingsGoal ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ height: 12, borderRadius: 6, background: "#EDF1EC", overflow: "hidden" }}>
                    <div style={{ height: "100%", transition: "width .4s ease",
                      width: `${Math.min(Math.max(sav.net / savingsGoal, 0), 1) * 100}%`,
                      background: sav.net >= savingsGoal ? T.income : T.amber }} />
                  </div>
                  <div style={{ fontSize: 13, color: sav.net < 0 ? T.expense : T.inkSoft, marginTop: 6 }}>
                    {sav.net >= savingsGoal
                      ? `Cíl ${czk(savingsGoal)} splněn – čistý tok ${czk(sav.net)}. 👏`
                      : sav.net >= 0
                        ? `Zatím ${czk(sav.net)} z cíle ${czk(savingsGoal)}.`
                        : `Čistý tok je ${czk(sav.net)} – spoření tento měsíc kleslo, k cíli ${czk(savingsGoal)} chybí ${czk(savingsGoal - sav.net)}.`}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 10 }}>
                  Nastav si cíl – např. 5 000 Kč měsíčně – a uvidíš tady pokrok. Čistý tok = vklady + úroky − výběry − platby ze spořicího.
                </p>
              )}
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Čistý tok spoření – posledních 6 měsíců</h2>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={savTrend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: T.inkSoft }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: T.inkSoft }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={44} />
                    <Tooltip formatter={(v) => czk(v)} cursor={{ fill: "#EDF1EC" }}
                      contentStyle={{ borderRadius: 10, border: `1px solid ${T.line}`, fontSize: 13 }} />
                    <ReferenceLine y={0} stroke={T.inkSoft} />
                    {savingsGoal && <ReferenceLine y={savingsGoal} stroke={T.income} strokeDasharray="4 4"
                      label={{ value: "cíl", fontSize: 11, fill: T.income, position: "right" }} />}
                    <Bar dataKey="Čistý tok" radius={[4, 4, 0, 0]}>
                      {savTrend.map((r, i) => <Cell key={i} fill={r["Čistý tok"] >= 0 ? T.income : T.expense} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Pohyby spojené se spořením — {monthLabel(month)}</h2>
              {(() => {
                const moves = inMonthAll.filter((t) =>
                  isSavings(t.account) || (t.type === "transfer" && isSavings(t.counter)));
                if (moves.length === 0) return <p style={{ fontSize: 13, color: T.inkSoft }}>Žádné pohyby v tomto měsíci.</p>;
                return [...moves].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                  <TxRow key={t.id} t={t} onDelete={removeTx} onCat={updateTxCategory} onRecur={toggleTxRecurring} showAccount expCats={expCats} incCats={incCats} />
                ));
              })()}
            </section>
          </>
        )}

        {/* ══ PŘEHLED ══ */}
        {tab === "prehled" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <Chip active={accFilter === "vse"} onClick={() => setAccFilter("vse")}>Vše</Chip>
                {Object.entries(ACCOUNTS).map(([k, a]) => (
                  <Chip key={k} active={accFilter === k} onClick={() => setAccFilter(k)}>{a.label}</Chip>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => shiftMonth(-1)} aria-label="Předchozí měsíc" style={navBtn}>‹</button>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600, minWidth: 150, textAlign: "center" }}>{monthLabel(month)}</div>
                <button onClick={() => shiftMonth(1)} aria-label="Další měsíc" style={navBtn}>›</button>
              </div>
            </div>

            <section style={{ ...card, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                <Stat label="Příjmy" value={czk(income)} color={T.income} />
                <Stat label="Výdaje" value={czk(expense)} color={T.expense} />
                <Stat label="Bilance" value={czk(balance)} color={balance >= 0 ? T.income : T.expense} />
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 14, borderRadius: 7, background: T.incomeSoft, overflow: "hidden" }}>
                  <div style={{ width: `${spentShare * 100}%`, height: "100%", background: expense > income ? T.expense : T.ink,
                    opacity: expense > income ? 1 : 0.85, transition: "width .4s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: T.inkSoft }}>
                  <span>utraceno {income > 0 ? Math.round((expense / income) * 100) : 0} % příjmů</span>
                  <span>{balance >= 0 ? `zbývá ${czk(balance)}` : `přečerpáno o ${czk(-balance)}`}</span>
                </div>
              </div>
            </section>

            {/* hypotéka */}
            <section style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <h2 style={{ ...h2, margin: 0 }}>Hypotéka</h2>
                <button onClick={() => setEditMortgage(!editMortgage)} style={ghostBtn}>
                  {editMortgage ? "Hotovo" : mortgage ? "Upravit" : "Nastavit"}
                </button>
              </div>
              {editMortgage && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10, marginTop: 12 }}>
                  <Field label="Zůstatek jistiny (Kč)">
                    <input defaultValue={mortgage?.balance || ""} inputMode="decimal" placeholder="např. 2 450 000"
                      onBlur={(e) => saveMortgage({ balance: e.target.value })} style={input} />
                  </Field>
                  <Field label="Platí k měsíci">
                    <input type="month" defaultValue={mortgage?.asOf || month}
                      onBlur={(e) => saveMortgage({ asOf: e.target.value || month })} style={input} />
                  </Field>
                  <Field label="Úroková sazba (% p.a.)">
                    <input defaultValue={mortgage?.rate || ""} inputMode="decimal" placeholder="např. 4,89"
                      onBlur={(e) => saveMortgage({ rate: e.target.value })} style={input} />
                  </Field>
                  <Field label="Měsíční splátka (Kč)">
                    <input defaultValue={mortgage?.payment || ""} inputMode="decimal" placeholder="bez pojištění"
                      onBlur={(e) => saveMortgage({ payment: e.target.value })} style={input} />
                  </Field>
                  <Field label="Původní výše úvěru (nepovinné)">
                    <input defaultValue={mortgage?.original || ""} inputMode="decimal" placeholder="pro % splaceno"
                      onBlur={(e) => saveMortgage({ original: e.target.value })} style={input} />
                  </Field>
                </div>
              )}
              {!editMortgage && !mortInfo && (
                <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 10, marginBottom: 0 }}>
                  Zadej zůstatek jistiny (najdeš v aplikaci RB), sazbu a měsíční splátku hypotéky bez pojištění –
                  appka pak zůstatek k doplacení sama měsíčně dopočítává.
                </p>
              )}
              {!editMortgage && mortInfo && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
                    <Stat label="Zbývá doplatit" value={czk(mortInfo.bal)} color={CAT_COLORS["Bydlení"]} />
                    <Stat label="Úmor tento měsíc" value={czk(mortInfo.principalM)} color={T.income} />
                    <Stat label="Úrok tento měsíc" value={czk(mortInfo.interestM)} color={T.expense} />
                    {mortInfo.payoff && <Stat label="Doplaceno cca" value={mortInfo.payoff} color={T.inkSoft} />}
                  </div>
                  {mortInfo.paidShare !== null && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ height: 10, borderRadius: 5, background: "#EDF1EC", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(Math.max(mortInfo.paidShare, 0), 1) * 100}%`,
                          background: CAT_COLORS["Bydlení"], transition: "width .4s ease" }} />
                      </div>
                      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>
                        splaceno {Math.round(mortInfo.paidShare * 100)} % z {czk(mortgage.original)}
                      </div>
                    </div>
                  )}
                  <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 10, marginBottom: 0 }}>
                    Odhad amortizačním výpočtem od zadaného zůstatku – přesný zůstatek najdeš v RB.
                    Po mimořádné splátce nebo refixaci stačí zůstatek přepsat (Upravit).
                  </p>
                </>
              )}
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Nový záznam</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <Toggle active={fType === "expense"} color={T.expense} soft={T.expenseSoft}
                  onClick={() => { setFType("expense"); setFCat("Potraviny"); }}>Výdaj</Toggle>
                <Toggle active={fType === "income"} color={T.income} soft={T.incomeSoft}
                  onClick={() => { setFType("income"); setFCat(INCOME_CATS[0]); }}>Příjem</Toggle>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10 }}>
                <Field label="Účet">
                  <select value={fAccount} onChange={(e) => setFAccount(e.target.value)} style={input}>
                    {Object.entries(ACCOUNTS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
                  </select>
                </Field>
                <Field label="Částka (Kč)">
                  <input value={fAmount} onChange={(e) => setFAmount(e.target.value)} inputMode="decimal"
                    placeholder="0" style={input} onKeyDown={(e) => e.key === "Enter" && addTx()} />
                </Field>
                <Field label="Kategorie">
                  <select value={fCat} onChange={(e) => setFCat(e.target.value)} style={input}>
                    {cats.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Datum">
                  <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} style={input} />
                </Field>
                <Field label="Poznámka">
                  <input value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder="např. nákup Albert"
                    style={input} onKeyDown={(e) => e.key === "Enter" && addTx()} />
                </Field>
              </div>
              <button onClick={addTx} style={{ ...primaryBtn, marginTop: 14, background: fType === "expense" ? T.expense : T.income }}>
                Přidat {fType === "expense" ? "výdaj" : "příjem"}
              </button>
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={h2}>Rozpočty ({monthLabel(month)}{accFilter !== "vse" ? ` · ${ACCOUNTS[accFilter].label}` : ""})</h2>
                <button onClick={() => setEditBudgets(!editBudgets)} style={ghostBtn}>{editBudgets ? "Hotovo" : "Upravit rozpočty"}</button>
              </div>
              {expCats.map((cat) => {
                const spent = byCat[cat] || 0;
                const limit = budgets[cat];
                if (!editBudgets && !limit && !spent) return null;
                const ratio = limit ? Math.min(spent / limit, 1) : 0;
                const over = limit && spent > limit;
                return (
                  <div key={cat} style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500 }}>
                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3,
                          background: CAT_COLORS[cat] || "#7A8B85", marginRight: 7, verticalAlign: "1px" }} />
                        {cat}
                      </span>
                      {editBudgets ? (
                        <input defaultValue={limit || ""} placeholder="limit Kč" inputMode="decimal"
                          onBlur={(e) => setBudget(cat, e.target.value)} style={{ ...input, width: 110, padding: "4px 8px", fontSize: 13 }} />
                      ) : (
                        <span className="mono" style={{ color: over ? T.expense : T.inkSoft }}>
                          {czk(spent)}{limit ? ` / ${czk(limit)}` : ""}
                        </span>
                      )}
                    </div>
                    {limit ? (
                      <div style={{ height: 8, borderRadius: 4, background: "#EDF1EC", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${ratio * 100}%`, transition: "width .4s ease",
                          background: over ? T.expense : ratio > 0.85 ? T.amber : CAT_COLORS[cat] || "#7A8B85" }} />
                      </div>
                    ) : !editBudgets ? <div style={{ fontSize: 12, color: T.inkSoft }}>bez limitu</div> : null}
                    {over && !editBudgets && (
                      <div style={{ fontSize: 12, color: T.expense, marginTop: 3 }}>Překročeno o {czk(spent - limit)}</div>
                    )}
                  </div>
                );
              })}
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Posledních 6 měsíců{accFilter !== "vse" ? ` · ${ACCOUNTS[accFilter].label}` : ""}</h2>
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: T.inkSoft }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: T.inkSoft }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={40} />
                    <Tooltip formatter={(v) => czk(v)} cursor={{ fill: "#EDF1EC" }}
                      contentStyle={{ borderRadius: 10, border: `1px solid ${T.line}`, fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="Příjmy" fill={T.income} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Výdaje" fill={T.expense} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Záznamy — {monthLabel(month)}{accFilter !== "vse" ? ` · ${ACCOUNTS[accFilter].label}` : ""}</h2>
              {inMonth.length === 0 ? (
                <p style={{ fontSize: 13, color: T.inkSoft }}>V tomto měsíci zatím nic není. Přidej záznam nahoře, nebo naimportuj výpisy.</p>
              ) : (
                [...inMonth].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                  <TxRow key={t.id} t={t} onDelete={removeTx} onCat={updateTxCategory} onRecur={toggleTxRecurring} showAccount={accFilter === "vse"} expCats={expCats} incCats={incCats} />
                ))
              )}
            </section>
            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Zabezpečení</h2>
              {!lockSalt ? (
                <>
                  <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 0 }}>
                    Zamkni aplikaci PIN kódem – data v tomto zařízení se zašifrují (AES-256) a bez PINu
                    budou nečitelná. Pozor: PIN se nikam neukládá, při jeho ztrátě data nelze obnovit.
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <input type="password" inputMode="numeric" value={pinA} placeholder="Nový PIN"
                      onChange={(e) => setPinA(e.target.value)} style={{ ...input, width: 140 }} />
                    <input type="password" inputMode="numeric" value={pinB} placeholder="PIN znovu"
                      onChange={(e) => setPinB(e.target.value)} style={{ ...input, width: 140 }} />
                    <button onClick={enableLock} style={{ ...primaryBtn, background: T.ink }}>Zamknout aplikaci</button>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: T.income, fontWeight: 500 }}>🔒 Zámek je aktivní, data jsou šifrovaná.</span>
                  <button onClick={lockNow} style={ghostBtn}>Zamknout teď</button>
                  <button onClick={disableLock} style={{ ...ghostBtn, color: T.expense }}>Zrušit zámek</button>
                </div>
              )}
              {secMsg && <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 10 }}>{secMsg}</div>}
            </section>

            <section style={{ ...card, marginTop: 16 }}>
              <h2 style={h2}>Záloha a přenos dat</h2>
              <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 0 }}>
                Data žijí jen v tomto zařízení. Pro přenos mezi mobilem a počítačem (nebo jako pojistku
                proti ztrátě) si stáhni zálohu a na druhém zařízení ji nahraj.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={exportData} style={{ ...primaryBtn, background: T.ink }}>Stáhnout zálohu</button>
                <label style={{ ...ghostBtn, display: "inline-block", cursor: "pointer" }}>
                  Nahrát zálohu…
                  <input type="file" accept="application/json,.json" style={{ display: "none" }}
                    onChange={(e) => { pickBackupFile(e.target.files[0]); e.target.value = ""; }} />
                </label>
              </div>
              {pendingImport && (
                <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: T.amberSoft, fontSize: 13 }}>
                  <div style={{ marginBottom: 8 }}>
                    Soubor <strong>{pendingImport.name}</strong> ({(pendingImport.data.transactions || []).length} záznamů). Co s ním?
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => applyBackup("merge")} style={{ ...primaryBtn, background: T.income, padding: "7px 14px" }}>
                      Sloučit (doplnit chybějící)
                    </button>
                    <button onClick={() => applyBackup("replace")} style={{ ...primaryBtn, background: T.expense, padding: "7px 14px" }}>
                      Nahradit vším ze zálohy
                    </button>
                    <button onClick={() => setPendingImport(null)} style={ghostBtn}>Zrušit</button>
                  </div>
                </div>
              )}
              {backupMsg && <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 10 }}>{backupMsg}</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* ── malé komponenty a styly ─────────────────────────────────── */
const card = { background: "#FFFFFF", border: "1px solid #E1E6E0", borderRadius: 14, padding: "18px 20px" };
const h2 = { fontSize: 15, fontWeight: 600, margin: "0 0 12px" };
const input = { padding: "8px 10px", borderRadius: 9, border: "1px solid #D4DBD4", background: "#FBFCFA",
  fontSize: 14, color: "#1C2B27", boxSizing: "border-box", width: "100%" };
const primaryBtn = { border: "none", color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { border: "1px solid #D4DBD4", background: "transparent", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer", color: "#1C2B27" };
const navBtn = { ...ghostBtn, padding: "4px 12px", fontSize: 16, lineHeight: "20px" };

function TxRow({ t, onDelete, onCat, onRecur, showAccount, expCats = EXPENSE_CATS, incCats = INCOME_CATS }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.line}` }}>
      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2,
        background: t.type === "income" ? T.income : t.type === "transfer" ? T.transfer : CAT_COLORS[t.category] || T.expense }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.type === "transfer" ? "⇄ " : ""}{t.note || t.category}
          {t.type !== "transfer" && onRecur && (
            <RecurToggle value={!!t.recurring} onClick={() => onRecur(t.id)} />
          )}
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft }}>
          {new Date(t.date + "T00:00").toLocaleDateString("cs-CZ")}
          {showAccount && t.account ? ` · ${ACCOUNTS[t.account]?.label ?? t.account}` : ""}
        </div>
      </div>
      {t.type !== "transfer" && (
        <select value={t.category} onChange={(e) => onCat(t.id, e.target.value)} aria-label="Změnit kategorii"
          style={{ ...input, width: 150, padding: "4px 6px", fontSize: 12 }}>
          {(t.type === "income" ? incCats : expCats).map((c) => <option key={c}>{c}</option>)}
        </select>
      )}
      <div className="mono" style={{ fontSize: 13.5, fontWeight: 600, width: 105, textAlign: "right",
        color: t.type === "income" ? T.income : t.type === "transfer" ? T.transfer : T.ink }}>
        {t.type === "income" ? "+" : "−"}{czk2(t.amount)}
      </div>
      <button onClick={() => onDelete(t.id)} aria-label="Smazat záznam" style={{ ...ghostBtn, padding: "4px 8px", color: T.inkSoft }}>✕</button>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${active ? "#1C2B27" : "#D4DBD4"}`, background: active ? "#1C2B27" : "transparent",
      color: active ? "#fff" : "#5C6B66", borderRadius: 10, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    }}>{children}</button>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${active ? T.income : "#D4DBD4"}`, background: active ? T.incomeSoft : "transparent",
      color: active ? T.income : "#5C6B66", borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    }}>{children}</button>
  );
}

function RecurToggle({ value, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} title="Přepnout pravidelnost platby"
      style={{
        fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "1px 7px", marginLeft: 6,
        verticalAlign: "1px", whiteSpace: "nowrap", cursor: disabled ? "default" : "pointer",
        border: "1px solid transparent",
        background: value ? "#E3F0EA" : "#EDF0EC",
        color: value ? "#1F6F54" : "#8C9A94",
      }}>
      {value ? "pravidelná" : "jednorázová"}
    </button>
  );
}

function Badge({ kind, children }) {
  const styles = { recurring: { background: "#E3F0EA", color: "#1F6F54" }, unsure: { background: "#F8EFDC", color: "#8A6414" } }[kind];
  return (
    <span style={{ ...styles, fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "1px 7px", marginLeft: 6,
      verticalAlign: "1px", whiteSpace: "nowrap" }}>{children}</span>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5C6B66" }}>{label}</div>
      <div className="mono" style={{ fontSize: 21, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", fontSize: 12, color: "#5C6B66" }}>
      <span style={{ display: "block", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ active, color, soft, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 100, padding: "8px 0", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
      border: `1px solid ${active ? color : "#D4DBD4"}`, background: active ? soft : "transparent", color: active ? color : "#5C6B66",
    }}>{children}</button>
  );
}
