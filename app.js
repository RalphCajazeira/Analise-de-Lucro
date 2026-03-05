/**
 * Base = seu print.
 * - Lê db.json
 * - Calcula rates a partir do base (RT/Subtotal, IPI/Subtotal, etc.)
 * - Targets (markup/margens) começam preenchidos com os valores BASE
 * - Ao alterar qualquer alvo, recalcula Subtotal e tudo ajusta
 * - Despesas: edita % sem perder foco (não recria DOM no input)
 * - Persistência: localStorage (override do db.json)
 */

const LS_KEY = "instonity_profit_analysis_overrides_v1"

/* ---------- helpers ---------- */
const brl = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
const pct = (n, d = 2) =>
  (Number(n) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }) + "%"
const dec = (n, d = 3) =>
  (Number(n) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
const parsePt = (str) => {
  if (typeof str !== "string") return Number(str) || 0
  const s = str.trim().replace(/\./g, "").replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function activeInputId() {
  const a = document.activeElement
  return a && a.tagName === "INPUT" ? a.id || null : null
}
function setIfNotActive(el, value) {
  if (el.id && el.id === activeInputId()) return
  el.value = value
}

/* ---------- dom ---------- */
const el = {
  inpMarkupBruto: document.getElementById("inpMarkupBruto"),
  inpMarkupLiquido: document.getElementById("inpMarkupLiquido"),
  inpMargemBruta: document.getElementById("inpMargemBruta"),
  inpMargemLiquida: document.getElementById("inpMargemLiquida"),

  outMarkupPrecoCusto: document.getElementById("outMarkupPrecoCusto"),
  outMarkupVendaPct: document.getElementById("outMarkupVendaPct"),

  kpiMB: document.getElementById("kpiMB"),
  kpiML: document.getElementById("kpiML"),
  kpiNet: document.getElementById("kpiNet"),

  badgeNF: document.getElementById("badgeNF"),

  vSubtotal: document.getElementById("vSubtotal"),
  vRTplus: document.getElementById("vRTplus"),
  vIPI: document.getElementById("vIPI"),
  vOutros: document.getElementById("vOutros"),
  vTotalNF: document.getElementById("vTotalNF"),

  vRTminus: document.getElementById("vRTminus"),
  vCusto: document.getElementById("vCusto"),
  vDespesas: document.getElementById("vDespesas"),
  vComissao: document.getElementById("vComissao"),

  vLucroBruto: document.getElementById("vLucroBruto"),
  vLucroLiquido: document.getElementById("vLucroLiquido"),
  vMargemBruta: document.getElementById("vMargemBruta"),
  vMargemLiquida: document.getElementById("vMargemLiquida"),

  btnToggleDespesas: document.getElementById("btnToggleDespesas"),
  dropDespesas: document.getElementById("dropDespesas"),
  tbDespesas: document.getElementById("tbDespesas"),

  btnResetBase: document.getElementById("btnResetBase"),

  chartGanhoGastos: document.getElementById("chartGanhoGastos"),
  chartDespesasLucro: document.getElementById("chartDespesasLucro"),
}

/* ---------- state ---------- */
const state = {
  db: null,

  // rates deduzidas do base (para recalcular cenários)
  rates: {
    rtRate: 0,
    ipiRate: 0,
    despesasRate: 0,
    comissaoRate: 0,
  },

  // targets atuais (começam iguais ao base calculado)
  target: {
    markupBruto: 0,
    markupLiquido: 0,
    margemBruta: 0,
    margemLiquida: 0,
  },

  // driver atual (último campo alterado)
  lastDriver: "markupLiquido",

  // subtotal atual
  subtotal: 0,

  // charts
  charts: { a: null, b: null },
}

/* ---------- core calc ---------- */
function computeFromSubtotal(subtotal) {
  const base = state.db.base

  const rt = state.rates.rtRate * subtotal
  const ipi = state.rates.ipiRate * subtotal
  const outros = base.outros || 0

  const totalNF = subtotal + rt + ipi + outros

  const custo = base.custoProducao

  const lucroBruto = totalNF - rt - custo // como seu relatório

  // despesas e comissão como % do Total NF (deduzidos do base)
  const despesas = state.rates.despesasRate * totalNF
  const comissao = state.rates.comissaoRate * totalNF

  const lucroLiquido = lucroBruto - despesas - comissao

  const margemBruta = totalNF ? (lucroBruto / totalNF) * 100 : 0
  const margemLiquida = totalNF ? (lucroLiquido / totalNF) * 100 : 0

  const markupBruto = 1 + lucroBruto / custo
  const markupLiquido = 1 + lucroLiquido / custo

  const markupPrecoCusto = custo ? subtotal / custo : 0
  const markupVendaPct = custo ? (lucroBruto / custo) * 100 : 0

  return {
    subtotal,
    rt,
    ipi,
    outros,
    totalNF,
    custo,
    despesas,
    comissao,
    lucroBruto,
    lucroLiquido,
    margemBruta,
    margemLiquida,
    markupBruto,
    markupLiquido,
    markupPrecoCusto,
    markupVendaPct,
  }
}

/**
 * Solvers (mantendo o modelo simples e coerente com o print):
 * - totalNF = (1+rt+ipi)*s + outros
 * - lucroBruto = (1+ipi)*s + outros - custo
 * - despesas = dRate * totalNF
 * - comissão = cRate * totalNF
 * - lucroLiquido = lucroBruto - (dRate+cRate)*totalNF
 */
function solveSubtotalForMarkupBruto(target) {
  const base = state.db.base
  const custo = base.custoProducao
  const outros = base.outros || 0

  // lucroBruto = custo*(target-1)
  const targetLucro = custo * (target - 1)

  // lucroBruto = (1+ipi)*s + outros - custo
  const a = 1 + state.rates.ipiRate
  const b = outros - custo

  // a*s + b = targetLucro => s = (targetLucro - b)/a
  return (targetLucro - b) / a
}

function solveSubtotalForMargemBruta(targetPct) {
  const m = targetPct / 100
  const base = state.db.base
  const custo = base.custoProducao
  const outros = base.outros || 0

  // lucroBruto = a*s + b
  const a = 1 + state.rates.ipiRate
  const b = outros - custo

  // totalNF = c*s + d
  const c = 1 + state.rates.rtRate + state.rates.ipiRate
  const d = outros

  // m = (a*s+b)/(c*s+d) => (m*c - a)s = b - m*d
  const denom = m * c - a
  if (Math.abs(denom) < 1e-12) return state.subtotal

  return (b - m * d) / denom
}

function solveSubtotalForMarkupLiquido(target) {
  const base = state.db.base
  const custo = base.custoProducao
  const outros = base.outros || 0

  const targetLucro = custo * (target - 1)

  // lucroLiquido = lucroBruto - k*totalNF, onde k = despesasRate+comissaoRate
  const k = state.rates.despesasRate + state.rates.comissaoRate

  // lucroBruto = a*s + b
  const a = 1 + state.rates.ipiRate
  const b = outros - custo

  // totalNF = c*s + d
  const c = 1 + state.rates.rtRate + state.rates.ipiRate
  const d = outros

  // lucroLiquido = (a*s + b) - k*(c*s + d) = (a - k*c)s + (b - k*d)
  const p = a - k * c
  const q = b - k * d

  if (Math.abs(p) < 1e-12) return state.subtotal

  // p*s + q = targetLucro
  return (targetLucro - q) / p
}

function solveSubtotalForMargemLiquida(targetPct) {
  const m = targetPct / 100
  const base = state.db.base
  const custo = base.custoProducao
  const outros = base.outros || 0

  const k = state.rates.despesasRate + state.rates.comissaoRate

  // lucroLiquido = p*s + q
  const a = 1 + state.rates.ipiRate
  const b = outros - custo

  const c = 1 + state.rates.rtRate + state.rates.ipiRate
  const d = outros

  const p = a - k * c
  const q = b - k * d

  // totalNF = c*s + d
  // m = (p*s+q)/(c*s+d) => (m*c - p)s = q - m*d
  const denom = m * c - p
  if (Math.abs(denom) < 1e-12) return state.subtotal

  return (q - m * d) / denom
}

/* ---------- UI render ---------- */
function render(o) {
  el.badgeNF.textContent = "Total NF " + brl(o.totalNF)

  el.vSubtotal.textContent = brl(o.subtotal)
  el.vRTplus.textContent = "+ " + brl(o.rt)
  el.vIPI.textContent = "+ " + brl(o.ipi)
  el.vOutros.textContent = brl(o.outros)
  el.vTotalNF.textContent = brl(o.totalNF)

  el.vRTminus.textContent = "- " + brl(o.rt)
  el.vCusto.textContent = "- " + brl(o.custo)
  el.vDespesas.textContent = "- " + brl(o.despesas)
  el.vComissao.textContent = "- " + brl(o.comissao)

  el.vLucroBruto.textContent = brl(o.lucroBruto)
  el.vLucroLiquido.textContent = brl(o.lucroLiquido)

  el.vMargemBruta.textContent = pct(o.margemBruta, 2)
  el.vMargemLiquida.textContent = pct(o.margemLiquida, 2)

  el.kpiMB.textContent = pct(o.margemBruta, 2)
  el.kpiML.textContent = pct(o.margemLiquida, 2)
  el.kpiNet.textContent = brl(o.lucroLiquido)

  el.outMarkupPrecoCusto.value = dec(o.markupPrecoCusto, 3) // deve dar 2,549 no base
  el.outMarkupVendaPct.value = pct(o.markupVendaPct, 2) // ex: 163,98%

  // targets: não sobrescreve enquanto digita
  setIfNotActive(el.inpMarkupBruto, dec(state.target.markupBruto, 3))
  setIfNotActive(el.inpMarkupLiquido, dec(state.target.markupLiquido, 3))
  setIfNotActive(el.inpMargemBruta, dec(state.target.margemBruta, 2))
  setIfNotActive(el.inpMargemLiquida, dec(state.target.margemLiquida, 2))

  updateCharts(o)
}

/* ---------- despesas dropdown (simples) ---------- */
function rebuildDespesasTable() {
  el.tbDespesas.innerHTML = ""

  // lista simples: você edita % das despesas (baseadas no TOTAL_NF)
  // Como você disse que “agora o importante é bater com o print”, a lista é simples.
  const rows = [
    {
      key: "despesasRate",
      nome: "Despesas de venda (total)",
      base: "TOTAL_NF",
    },
    { key: "comissaoRate", nome: "Comissão do vendedor", base: "TOTAL_NF" },
  ]

  for (const r of rows) {
    const tr = document.createElement("tr")

    const tdNome = document.createElement("td")
    tdNome.textContent = r.nome

    const tdBase = document.createElement("td")
    const sel = document.createElement("select")
    sel.className = "miniSelect"
    sel.innerHTML = `<option value="TOTAL_NF">Total NF</option>`
    sel.value = "TOTAL_NF"
    sel.disabled = true
    tdBase.appendChild(sel)

    const tdPct = document.createElement("td")
    const inp = document.createElement("input")
    inp.className = "miniInput"
    inp.inputMode = "decimal"
    const currentPct = state.rates[r.key] * 100
    inp.value = String(currentPct.toFixed(3)).replace(".", ",")

    // não perde foco porque a gente NÃO recria a tabela a cada tecla
    inp.addEventListener("input", () => {
      const v = parsePt(inp.value)
      state.rates[r.key] = v / 100
      recalcKeepSubtotal()
    })

    tdPct.appendChild(inp)

    const tdAct = document.createElement("td")
    const actions = document.createElement("div")
    actions.className = "actions"

    const btnZero = document.createElement("button")
    btnZero.className = "btn"
    btnZero.type = "button"
    btnZero.textContent = "Zerar"
    btnZero.addEventListener("click", () => {
      state.rates[r.key] = 0
      inp.value = "0"
      recalcKeepSubtotal()
    })

    actions.appendChild(btnZero)
    tdAct.appendChild(actions)

    tr.appendChild(tdNome)
    tr.appendChild(tdBase)
    tr.appendChild(tdPct)
    tr.appendChild(tdAct)

    el.tbDespesas.appendChild(tr)
  }
}

/* ---------- charts ---------- */
function initCharts() {
  const ctxA = el.chartGanhoGastos.getContext("2d")
  const ctxB = el.chartDespesasLucro.getContext("2d")

  state.charts.a = new Chart(ctxA, {
    type: "doughnut",
    data: {
      labels: [
        "Custo produção",
        "Despesas venda",
        "Comissão",
        "RT (repasse)",
        "Lucro líquido",
      ],
      datasets: [{ data: [0, 0, 0, 0, 0] }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)}` },
        },
      },
    },
  })

  state.charts.b = new Chart(ctxB, {
    type: "bar",
    data: {
      labels: ["Despesas de venda", "Comissão", "Lucro líquido"],
      datasets: [{ label: "R$", data: [0, 0, 0] }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => brl(c.parsed.y) } },
      },
      scales: {
        y: { ticks: { callback: (v) => brl(v) } },
      },
    },
  })
}

function updateCharts(o) {
  if (!state.charts.a || !state.charts.b) return

  state.charts.a.data.datasets[0].data = [
    o.custo,
    o.despesas,
    o.comissao,
    o.rt,
    o.lucroLiquido,
  ]
  state.charts.a.update("none")

  state.charts.b.data.datasets[0].data = [
    o.despesas,
    o.comissao,
    o.lucroLiquido,
  ]
  state.charts.b.update("none")
}

/* ---------- targets sync ---------- */
function setTargetsFromSubtotal(subtotal) {
  const o = computeFromSubtotal(subtotal)
  state.target.markupBruto = o.markupBruto
  state.target.markupLiquido = o.markupLiquido
  state.target.margemBruta = o.margemBruta
  state.target.margemLiquida = o.margemLiquida
  return o
}

function recalc(driver) {
  state.lastDriver = driver

  let s = state.subtotal

  if (driver === "markupBruto")
    s = solveSubtotalForMarkupBruto(state.target.markupBruto)
  if (driver === "markupLiquido")
    s = solveSubtotalForMarkupLiquido(state.target.markupLiquido)
  if (driver === "margemBruta")
    s = solveSubtotalForMargemBruta(state.target.margemBruta)
  if (driver === "margemLiquida")
    s = solveSubtotalForMargemLiquida(state.target.margemLiquida)

  if (!Number.isFinite(s) || s < 0) s = state.subtotal

  state.subtotal = s

  // sincroniza todos os alvos com o resultado real
  const o = setTargetsFromSubtotal(state.subtotal)
  render(o)

  persistOverrides()
}

function recalcByLastDriver() {
  recalc(state.lastDriver)
}

/* ---------- input bind: aplica no blur/enter (para digitar livre) ---------- */
function bindTargetInput(inputEl, driverKey) {
  function apply() {
    const v = parsePt(inputEl.value)
    if (!Number.isFinite(v)) return

    if (driverKey === "margemBruta" || driverKey === "margemLiquida") {
      state.target[driverKey] = v
    } else {
      state.target[driverKey] = v
    }

    recalc(driverKey)
  }

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      inputEl.blur()
    }
  })

  inputEl.addEventListener("blur", apply)
}

/* ---------- persistence (local overrides) ---------- */
function persistOverrides() {
  const payload = {
    rates: state.rates,
    lastDriver: state.lastDriver,
  }
  localStorage.setItem(LS_KEY, JSON.stringify(payload))
}

function loadOverrides() {
  const raw = localStorage.getItem(LS_KEY)
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    if (data?.rates) {
      state.rates = { ...state.rates, ...data.rates }
    }
    if (typeof data?.lastDriver === "string") {
      state.lastDriver = data.lastDriver
    }
  } catch {}
}

/* ---------- init ---------- */
async function init() {
  const res = await fetch("./db.json", { cache: "no-store" })
  state.db = await res.json()

  // base do print
  const b = state.db.base

  // rates deduzidas do base (pra recalcular cenário sem “chutar”)
  state.rates.rtRate = b.rt / b.subtotal
  state.rates.ipiRate = b.ipi / b.subtotal

  // despesas e comissão como % do TOTAL NF (do print)
  state.rates.despesasRate = b.despesasVendaTotal / b.totalNF
  state.rates.comissaoRate = b.comissaoVendedor / b.totalNF

  // aplica overrides locais (se existirem)
  loadOverrides()

  // subtotal inicial (base)
  state.subtotal = b.subtotal

  // charts
  initCharts()

  // despesas table
  rebuildDespesasTable()

  // targets iniciais = base calculado
  const o0 = setTargetsFromSubtotal(state.subtotal)

  // render base (deve bater com o print)
  render(o0)

  // binds (digitável sem travar)
  bindTargetInput(el.inpMarkupBruto, "markupBruto")
  bindTargetInput(el.inpMarkupLiquido, "markupLiquido")
  bindTargetInput(el.inpMargemBruta, "margemBruta")
  bindTargetInput(el.inpMargemLiquida, "margemLiquida")

  // dropdown
  el.btnToggleDespesas.addEventListener("click", () => {
    const open = el.btnToggleDespesas.getAttribute("data-open") === "true"
    el.btnToggleDespesas.setAttribute("data-open", String(!open))
    el.dropDespesas.hidden = open
  })

  // reset base (volta ao print)
  el.btnResetBase.addEventListener("click", () => {
    localStorage.removeItem(LS_KEY)

    // recarrega rates base do print
    state.rates.rtRate = b.rt / b.subtotal
    state.rates.ipiRate = b.ipi / b.subtotal
    state.rates.despesasRate = b.despesasVendaTotal / b.totalNF
    state.rates.comissaoRate = b.comissaoVendedor / b.totalNF

    rebuildDespesasTable()

    state.subtotal = b.subtotal
    const o = setTargetsFromSubtotal(state.subtotal)
    render(o)
  })

  // força o Chart.js a desenhar na primeira carga
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      state.charts?.a?.resize()
      state.charts?.b?.resize()
      state.charts?.a?.update()
      state.charts?.b?.update()
    })
  })
}

function recalcKeepSubtotal() {
  const o = setTargetsFromSubtotal(state.subtotal)
  render(o)
  persistOverrides()
}

init()
