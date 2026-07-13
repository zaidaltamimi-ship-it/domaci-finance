import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine,
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
  rodina: { label: "Rodina", num: "1112083044" },
  bezny: { label: "Běžný", num: "1112083036" },
  sporici: { label: "Spořicí", num: "1112083028" },
};

const STORAGE_KEY = "domaci-finance-v2";
const OLD_KEY = "domaci-finance-v1";

/* Lokální úložiště – data zůstávají jen v tomto prohlížeči/telefonu,
   nikam se neposílají. Stejné rozhraní jako window.storage v Claude. */
const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    if (value === null) throw new Error("key not found: " + key);
    return { key, value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
};
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

  /* load + migrace z v1 */
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get(STORAGE_KEY);
        if (r && r.value) {
          const d = JSON.parse(r.value);
          setTx(d.transactions || []); setBudgets(d.budgets || {});
          setImportedBatches(d.importedBatches || []); setSavingsGoal(d.savingsGoal ?? null);
          setCustomCats(d.customCats || { expense: [], income: [] });
          if ((d.importedBatches || []).length >= 3) setTab("prehled");
          setLoading(false); return;
        }
      } catch (e) { /* v2 zatím neexistuje */ }
      try {
        const old = await storage.get(OLD_KEY);
        if (old && old.value) {
          const d = JSON.parse(old.value);
          const migrated = (d.transactions || []).map((t) => ({
            ...t, account: t.account || "rodina",
            dir: t.type === "transfer" ? "out" : null,
            counter: t.type === "transfer" ? "bezny" : null,
          }));
          setTx(migrated); setBudgets(d.budgets || {}); setImportedBatches(d.importedBatches || []);
          await storage.set(STORAGE_KEY, JSON.stringify({
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
      await storage.set(STORAGE_KEY, JSON.stringify({
        transactions: patch.transactions ?? tx,
        budgets: patch.budgets ?? budgets,
        importedBatches: patch.importedBatches ?? importedBatches,
        savingsGoal: patch.savingsGoal !== undefined ? patch.savingsGoal : savingsGoal,
        customCats: patch.customCats ?? customCats,
      }));
    } catch (e) { setSaveError(true); }
  };

  const confirmImport = (batch) => {
    const stamp = Date.now();
    const rows = importState[batch.id].filter((r) => r.include);
    const newTx = rows.map((r, i) => ({
      id: `imp-${batch.id}-${stamp}-${i}`,
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
    setTx(nextTx); setImportedBatches(nextBatches);
    persist({ transactions: nextTx, importedBatches: nextBatches });
    setMonth("2026-06");
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

  /* ── derived: spoření ── */
  const savingsForMonth = (mKey) => {
    const mt = tx.filter((t) => t.date.slice(0, 7) === mKey);
    const spor = mt.filter((t) => t.account === "sporici");
    // vklady: max z obou stran výpisů, aby se nic nepočítalo dvakrát ani nechybělo
    const depA = spor.filter((t) => t.type === "transfer" && t.dir === "in").reduce((s, t) => s + t.amount, 0);
    const depB = mt.filter((t) => t.account !== "sporici" && t.type === "transfer" && t.dir === "out" && t.counter === "sporici").reduce((s, t) => s + t.amount, 0);
    const wdA = spor.filter((t) => t.type === "transfer" && t.dir === "out").reduce((s, t) => s + t.amount, 0);
    const wdB = mt.filter((t) => t.account !== "sporici" && t.type === "transfer" && t.dir === "in" && t.counter === "sporici").reduce((s, t) => s + t.amount, 0);
    const deposits = Math.max(depA, depB);
    const withdrawals = Math.max(wdA, wdB);
    const directSpendTx = spor.filter((t) => t.type === "expense" && t.category !== "Poplatky a daně");
    const directSpend = directSpendTx.reduce((s, t) => s + t.amount, 0);
    const interest = spor.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const fees = spor.filter((t) => t.type === "expense" && t.category === "Poplatky a daně").reduce((s, t) => s + t.amount, 0);
    const wdCountA = spor.filter((t) => t.type === "transfer" && t.dir === "out").length;
    const wdCountB = mt.filter((t) => t.account !== "sporici" && t.type === "transfer" && t.dir === "in" && t.counter === "sporici").length;
    const dotaceCount = Math.max(wdCountA, wdCountB) + directSpendTx.length;
    const net = deposits + interest - withdrawals - directSpend - fees;
    return { deposits, withdrawals, directSpend, interest, fees, dotaceCount, net };
  };

  const sav = useMemo(() => savingsForMonth(month), [tx, month]);

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
      const perMonth = g.total / g.months.size;
      const yearly = g.recurring ? perMonth * 12 : g.total;
      return { ...g, perMonth, yearly };
    }).sort((a, b) => b.yearly - a.yearly);
    const yearTotal = list.reduce((s, g) => s + g.yearly, 0);
    // odhad měsíční mzdy pro podíl nákladů na příjmu
    const mzdy = tx.filter((t) => t.type === "income" && t.category === "Mzda");
    const mzdaMonths = new Set(mzdy.map((t) => t.date.slice(0, 7))).size;
    const mzdaMonthly = mzdaMonths > 0 ? mzdy.reduce((s, t) => s + t.amount, 0) / mzdaMonths : 0;
    const dataMonths = new Set(rows.map((t) => t.date.slice(0, 7))).size;
    return { list, yearTotal, mzdaMonthly, dataMonths };
  }, [tx]);

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
            <TabBtn active={tab === "sporeni"} onClick={() => setTab("sporeni")}>Spoření</TabBtn>
            <TabBtn active={tab === "bydleni"} onClick={() => setTab("bydleni")}>Bydlení</TabBtn>
            <TabBtn active={tab === "import"} onClick={() => setTab("import")}>
              Import výpisů{importedBatches.length > 0 ? ` ${importedBatches.length}/3` : ""}
            </TabBtn>
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        flexWrap: "wrap", gap: 6, fontSize: 13.5, marginBottom: 4 }}>
                        <span style={{ fontWeight: 500 }}>
                          {g.name}
                          {g.recurring
                            ? <Badge kind="recurring">pravidelná</Badge>
                            : <Badge kind="unsure">jednorázově</Badge>}
                        </span>
                        <span className="mono" style={{ color: T.inkSoft }}>
                          {g.recurring ? `${czk(g.perMonth)} /měs → ` : ""}
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
        {tab === "import" && IMPORT_BATCHES.map((batch) => {
          const rows = importState[batch.id];
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
                        {r.recurring && <Badge kind="recurring">pravidelná</Badge>}
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
              <button onClick={() => confirmImport(batch)} disabled={included.length === 0 || done}
                style={{ ...primaryBtn, marginTop: 14, background: T.income, opacity: included.length === 0 || done ? 0.5 : 1 }}>
                {done ? "Importováno" : `Importovat ${included.length} záznamů`}
              </button>
            </section>
          );
        })}

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
                  t.account === "sporici" || (t.type === "transfer" && t.counter === "sporici"));
                if (moves.length === 0) return <p style={{ fontSize: 13, color: T.inkSoft }}>Žádné pohyby v tomto měsíci.</p>;
                return [...moves].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                  <TxRow key={t.id} t={t} onDelete={removeTx} onCat={updateTxCategory} showAccount expCats={expCats} incCats={incCats} />
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
                  <TxRow key={t.id} t={t} onDelete={removeTx} onCat={updateTxCategory} showAccount={accFilter === "vse"} expCats={expCats} incCats={incCats} />
                ))
              )}
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

function TxRow({ t, onDelete, onCat, showAccount, expCats = EXPENSE_CATS, incCats = INCOME_CATS }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.line}` }}>
      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2,
        background: t.type === "income" ? T.income : t.type === "transfer" ? T.transfer : CAT_COLORS[t.category] || T.expense }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.type === "transfer" ? "⇄ " : ""}{t.note || t.category}
          {t.recurring && <Badge kind="recurring">pravidelná</Badge>}
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
