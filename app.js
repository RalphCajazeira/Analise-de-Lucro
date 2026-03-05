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
  vIPIminus: document.getElementById("vIPIminus"),
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
    // despesas (cada uma com sua base)
    impostosRate: 0, // base: Subtotal + RT
    embalagemRate: 0, // base: Subtotal
    freteRate: 0, // base: Subtotal
    comissaoRate: 0, // base: Subtotal
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

  // ✅ LUCRO BRUTO REAL (sem repasses RT/IPI)
  const lucroBruto = subtotal - custo

  // ✅ Despesas com bases diferentes
  let despesas = 0

  // impostos incidem sobre (Subtotal + RT), sem IPI
  despesas += (state.rates.impostosRate || 0) * (subtotal + rt)

  // embalagem e frete (e outras “operacionais”) incidem só sobre Subtotal
  despesas += (state.rates.embalagemRate || 0) * subtotal
  despesas += (state.rates.freteRate || 0) * subtotal

  // ✅ Comissão sem RT e sem IPI
  const comissao = (state.rates.comissaoRate || 0) * subtotal

  const lucroLiquido = lucroBruto - despesas - comissao

  const margemBruta = subtotal ? (lucroBruto / subtotal) * 100 : 0 // base empresa
  const margemLiquida = subtotal ? (lucroLiquido / subtotal) * 100 : 0 // base empresa

  const markupBruto = 1 + lucroBruto / custo
  const markupLiquido = 1 + lucroLiquido / custo

  // “markup base preço/custo” continua sendo o que você quer mostrar como referência comercial:
  const markupPrecoCusto = custo ? subtotal / custo : 0

  // markup da venda (%) = lucro bruto / custo
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
 * Solvers (modelo NOVO - regras da marmoraria):
 * - RT e IPI são repasses (não entram no lucro)
 * - Comissão incide sobre Subtotal (sem RT e sem IPI)
 * - Impostos incidem sobre (Subtotal + RT), sem IPI
 * - Embalagem/Frete incidem sobre Subtotal
 * - Margens (%) são calculadas sobre Subtotal (base empresa)
 */
function solveSubtotalForMarkupBruto(target) {
  const custo = state.db.base.custoProducao
  // markupBruto = 1 + (lucroBruto/custo)
  // lucroBruto = subtotal - custo
  // => markupBruto = subtotal/custo
  return target * custo
}

function solveSubtotalForMargemBruta(targetPct) {
  const m = targetPct / 100
  const custo = state.db.base.custoProducao

  // margemBruta = (subtotal - custo) / subtotal
  // => subtotal = custo / (1 - m)
  const denom = 1 - m
  if (Math.abs(denom) < 1e-12) return state.subtotal
  return custo / denom
}

function solveSubtotalForMarkupLiquido(target) {
  const custo = state.db.base.custoProducao
  const rtRate = state.rates.rtRate || 0

  const impostosRate = state.rates.impostosRate || 0 // base (subtotal + rt)
  const embRate = state.rates.embalagemRate || 0 // base subtotal
  const freteRate = state.rates.freteRate || 0 // base subtotal
  const comRate = state.rates.comissaoRate || 0 // base subtotal

  // lucroLiquido = (subtotal - custo)
  //            - impostosRate*(subtotal + rtRate*subtotal)
  //            - (embRate + freteRate)*subtotal
  //            - comRate*subtotal
  // => lucroLiquido = coef*subtotal - custo
  const coef = 1 - impostosRate * (1 + rtRate) - embRate - freteRate - comRate

  // markupLiquido = 1 + (lucroLiquido/custo)
  // => lucroLiquido = custo*(target - 1)
  const targetLucro = custo * (target - 1)

  // coef*subtotal - custo = targetLucro
  // => subtotal = (targetLucro + custo) / coef
  if (Math.abs(coef) < 1e-12) return state.subtotal
  return (targetLucro + custo) / coef
}

function solveSubtotalForMargemLiquida(targetPct) {
  const m = targetPct / 100
  const custo = state.db.base.custoProducao
  const rtRate = state.rates.rtRate || 0

  const impostosRate = state.rates.impostosRate || 0
  const embRate = state.rates.embalagemRate || 0
  const freteRate = state.rates.freteRate || 0
  const comRate = state.rates.comissaoRate || 0

  const coef = 1 - impostosRate * (1 + rtRate) - embRate - freteRate - comRate

  // margemLiquida = lucroLiquido / subtotal
  // lucroLiquido = coef*subtotal - custo
  // => m = coef - custo/subtotal
  // => subtotal = custo / (coef - m)
  const denom = coef - m
  if (Math.abs(denom) < 1e-12) return state.subtotal
  return custo / denom
}

/* ---------- UI render ---------- */
function render(o) {
  el.badgeNF.textContent = "Total NF " + brl(o.totalNF)

  el.vSubtotal.textContent = brl(o.subtotal)
  el.vRTplus.textContent = "+ " + brl(o.rt)
  el.vIPI.textContent = "+ " + brl(o.ipi)
  el.vOutros.textContent = brl(o.outros)
  el.vTotalNF.textContent = brl(o.totalNF)

  if (el.vRTminus) el.vRTminus.textContent = "- " + brl(o.rt)
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

  if (el.vIPIminus) el.vIPIminus.textContent = "- " + brl(o.ipi)

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
      key: "impostosRate",
      nome: "Impostos (sobre Subtotal + RT)",
      base: "Subtotal + RT",
    },
    {
      key: "embalagemRate",
      nome: "Embalagem (sobre Subtotal)",
      base: "Subtotal",
    },
    { key: "freteRate", nome: "Frete (sobre Subtotal)", base: "Subtotal" },
    {
      key: "comissaoRate",
      nome: "Comissão vendedor (sobre Subtotal)",
      base: "Subtotal",
    },
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
    const currentPct = (state.rates[r.key] || 0) * 100
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

  const b = state.db.base
  const d = state.db.defaults || {}

  // ✅ RT e IPI são do orçamento (print): deduzidos do base
  state.rates.rtRate = b.rt / b.subtotal
  state.rates.ipiRate = b.ipi / b.subtotal

  // ✅ Página inicial deve abrir com o preset (2ª imagem)
  state.rates.impostosRate = (d.impostosPct ?? 0) / 100
  state.rates.embalagemRate = (d.embalagemPct ?? 0) / 100
  state.rates.freteRate = (d.fretePct ?? 0) / 100
  state.rates.comissaoRate = (d.comissaoPct ?? 0) / 100

  // ✅ aplica overrides locais por cima (se existirem)
  loadOverrides()

  // subtotal inicial (base do print)
  state.subtotal = b.subtotal

  initCharts()
  rebuildDespesasTable()

  // targets iniciais calculados em cima do subtotal base
  const o0 = setTargetsFromSubtotal(state.subtotal)
  render(o0)

  // (opcional) força charts desenhar de primeira
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      state.charts?.a?.resize()
      state.charts?.b?.resize()
      state.charts?.a?.update()
      state.charts?.b?.update()
    })
  })

  bindTargetInput(el.inpMarkupBruto, "markupBruto")
  bindTargetInput(el.inpMarkupLiquido, "markupLiquido")
  bindTargetInput(el.inpMargemBruta, "margemBruta")
  bindTargetInput(el.inpMargemLiquida, "margemLiquida")

  el.btnToggleDespesas.addEventListener("click", () => {
    const open = el.btnToggleDespesas.getAttribute("data-open") === "true"
    el.btnToggleDespesas.setAttribute("data-open", String(!open))
    el.dropDespesas.hidden = open
  })

  // ⚠️ seu reset deve voltar para defaults também (te mando abaixo)

  el.btnResetBase.addEventListener("click", () => {
    localStorage.removeItem(LS_KEY)

    const b = state.db.base
    const d = state.db.defaults || {}

    // RT e IPI do orçamento
    state.rates.rtRate = b.rt / b.subtotal
    state.rates.ipiRate = b.ipi / b.subtotal

    // valores padrão do db.json
    state.rates.impostosRate = (d.impostosPct ?? 0) / 100
    state.rates.embalagemRate = (d.embalagemPct ?? 0) / 100
    state.rates.freteRate = (d.fretePct ?? 0) / 100
    state.rates.comissaoRate = (d.comissaoPct ?? 0) / 100

    // subtotal volta ao base
    state.subtotal = b.subtotal

    // reconstrói tabela de despesas
    rebuildDespesasTable()

    const o = setTargetsFromSubtotal(state.subtotal)
    render(o)
  })
}

function recalcKeepSubtotal() {
  const o = setTargetsFromSubtotal(state.subtotal)
  render(o)
  persistOverrides()
}

init()
