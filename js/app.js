const KEY = "reidagua_db_v1";
const VIEWS_LIVRES = new Set([
  "clientes", "cliente-form", "cliente-ficha",
  "vendas", "venda-form",
  "produtos", "produto-form",
  "estoque",
  "distancia"
]);
const ADMIN_HASH = "7a0178cdb2fb526f5637d0f5bae3432e397a4c13f187e880195f5ddd8b41ce1d";
const ADMIN_KEY = "reidagua_admin";
const BAIRROS = [
  "Baeta Neves", "Centro", "Rudge Ramos", "Assunção", "Nova Petrópolis",
  "Jardim do Mar", "Anchieta", "Planalto", "Demarchi", "Ferrazópolis",
  "Independência", "Paulicéia", "Taboão", "Alves Dias", "Cooperativa",
  "Jordanópolis", "Santa Terezinha", "Vila Vivaldi", "Outro"
];

const state = {
  view: "inicio",
  busca: "",
  filtroClientes: "todos",
  filtroReceitas: "hoje",
  filtroDespesas: "mes",
  tipoRelatorio: "cliente",
  relatorioClienteId: null,
  clienteId: null,
  vendaClienteId: null
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function hojeISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function formatarData(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatarMoeda(n) {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MARKUPS_SUGERIDOS = [20, 30, 40, 50];

function arredondarMoeda(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function numCampo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function custoTotalProduto(p) {
  return arredondarMoeda(
    numCampo(p.custo) + numCampo(p.freteCompra) + numCampo(p.freteEntrega)
  );
}

function precoPeloLucro(custoTotal, lucroPct) {
  return arredondarMoeda(numCampo(custoTotal) * (1 + numCampo(lucroPct) / 100));
}

function analisePreco(custoTotal, venda) {
  const c = numCampo(custoTotal);
  const v = numCampo(venda);
  const lucro = arredondarMoeda(v - c);
  const markup = c > 0 ? (lucro / c) * 100 : 0;
  return { custo: c, venda: v, lucro, markup };
}

function htmlResumoPreco(custoTotal, venda, lucroPct) {
  const a = analisePreco(custoTotal, venda);
  if (a.custo <= 0) {
    return { texto: "Informe o valor pago e os fretes para calcular o preço.", classe: "" };
  }
  if (a.venda <= 0) {
    return { texto: "Informe o percentual de lucro para chegar no preço de venda.", classe: "" };
  }
  if (a.lucro < 0) {
    return {
      texto: `Prejuízo de ${formatarMoeda(-a.lucro)} por unidade. O preço está abaixo do custo total.`,
      classe: "prejuizo"
    };
  }
  if (a.lucro === 0) {
    return { texto: "Preço igual ao custo total: sem lucro por unidade.", classe: "prejuizo" };
  }
  const pct = numCampo(lucroPct);
  return {
    texto: `Custo total ${formatarMoeda(a.custo)} · lucro ${formatarMoeda(a.lucro)} (${pct || a.markup.toFixed(0)}% sobre o custo)`,
    classe: "ok"
  };
}

function normalizar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mascaraCep(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return d.replace(/(\d{5})(\d{0,3})/, "$1-$2");
}

function soDigitosCep(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 8);
}

function montarEnderecoViaCep(data) {
  return [
    data.logradouro,
    data.bairro,
    [data.localidade, data.uf].filter(Boolean).join(" - ")
  ].filter(Boolean).join(", ");
}

async function buscarViaCep(cep) {
  const digits = soDigitosCep(cep);
  if (digits.length !== 8) return null;
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  const data = await res.json();
  if (!data || data.erro) return null;
  return { ...data, label: montarEnderecoViaCep(data) };
}

function estadoDistancia() {
  return {
    modo: "cep",
    cep: "",
    endereco: "",
    enderecoViaCep: "",
    resultado: null,
    ...(state.distancia || {})
  };
}

function lerCamposDistancia() {
  const atual = estadoDistancia();
  const preview = document.getElementById("dist-endereco-preview");
  return {
    ...atual,
    cep: document.getElementById("dist-cep")?.value ?? atual.cep,
    endereco: document.getElementById("dist-endereco")?.value ?? atual.endereco,
    enderecoViaCep: preview ? preview.textContent.trim() : atual.enderecoViaCep
  };
}

function mascaraTelefone(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{0,2})(\d{0,4})(\d{0,4})/, (_, a, b, c) => {
      if (!a) return "";
      if (!b) return `(${a}`;
      if (!c) return `(${a}) ${b}`;
      return `(${a}) ${b}-${c}`;
    });
  }
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

function seed() {
  return {
    clientes: [],
    produtos: [],
    vendas: [],
    contas: [contaPadrao()],
    lancamentos: [],
    receitas: [],
    despesas: []
  };
}

function contaPadrao() {
  return {
    id: "conta-principal",
    nome: "Conta principal",
    banco: "",
    agencia: "",
    conta: "",
    tipo: "corrente",
    chavePix: "",
    saldoInicial: 0
  };
}

function garantirBanco(data) {
  data.contas ||= [];
  data.lancamentos ||= [];
  data.receitas ||= [];
  data.despesas ||= [];
  if (!data.contas.length) data.contas.push(contaPadrao());
  return data;
}

function chaveProduto(p) {
  return `${normalizar(p.nome)}|${normalizar(p.marca)}`;
}

const PRODUTOS_FICTICIOS = new Set([
  "galao 20l|rei d'agua",
  "galao 20l|crystal",
  "garrafa 1,5l|rei d'agua",
  "fardo copos 200ml|rei d'agua"
]);

function limparProdutosFicticios(data) {
  const usados = new Set();
  (data.vendas || []).forEach((v) => {
    (v.itens || []).forEach((i) => {
      if (i.produtoId) usados.add(i.produtoId);
    });
  });
  const antes = (data.produtos || []).length;
  data.produtos = (data.produtos || []).filter((p) => {
    if (usados.has(p.id)) return true;
    return !PRODUTOS_FICTICIOS.has(chaveProduto(p));
  });
  return (data.produtos || []).length !== antes;
}

function vazioProdutos(texto, origem) {
  const origemAttr = origem ? ` data-origem="${origem}"` : "";
  return `
    <div class="card empty">
      <p>${texto}</p>
      <div class="actions" style="justify-content:center;margin-top:14px">
        <button class="btn btn-gold" data-go="produto-form"${origemAttr}>Inserir produto</button>
      </div>
    </div>
  `;
}

function normalizarDados(data) {
  data.clientes ||= [];
  data.produtos ||= [];
  data.vendas ||= [];
  garantirBanco(data);
  data.produtos.forEach((p) => {
    if (p.estoque == null || p.estoque === "") p.estoque = 0;
    p.estoque = Number(p.estoque);
    p.custo = Number(p.custo || 0);
    p.freteCompra = Number(p.freteCompra || 0);
    p.freteEntrega = Number(p.freteEntrega || 0);
    p.lucroPct = Number(p.lucroPct || 0);
    p.preco = Number(p.preco || 0);
  });
  return data;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    return normalizarDados(JSON.parse(raw));
  } catch {
    return seed();
  }
}

function apiUrl() {
  return String(window.REIDAGUA_API || "").replace(/\/$/, "");
}

function apiHeaders(extra) {
  const headers = { ...(extra || {}) };
  const chave = window.REIDAGUA_CHAVE;
  if (chave) headers["X-ReiDagua-Chave"] = chave;
  return headers;
}

function servidorAtivo() {
  return Boolean(apiUrl());
}

function temMovimento(dados) {
  return Boolean(
    dados.clientes.length ||
    dados.vendas.length ||
    dados.receitas.length ||
    dados.despesas.length ||
    dados.lancamentos.length ||
    (dados.produtos || []).some((p) => Number(p.estoque) > 0)
  );
}

function marcarServidor(ok) {
  state.servidorOk = ok;
  const el = document.getElementById("status-servidor");
  if (!el) return;
  el.textContent = !servidorAtivo()
    ? "Dados neste aparelho"
    : ok
      ? "Salvo no servidor"
      : "Servidor offline";
  el.classList.toggle("ok", Boolean(ok));
}

async function carregar() {
  const local = loadLocal();
  if (!servidorAtivo()) {
    marcarServidor(false);
    return local;
  }
  try {
    const res = await fetch(apiUrl() + "/api/dados", { headers: apiHeaders() });
    if (!res.ok) throw new Error("falha");
    const remoto = normalizarDados(await res.json());
    const remotoVazio = !temMovimento(remoto);
    const localTem = temMovimento(local);
    if (remotoVazio && localTem) {
      await salvarRemoto(local);
      marcarServidor(true);
      return local;
    }
    if (remotoVazio) {
      const inicial = seed();
      await salvarRemoto(inicial);
      localStorage.setItem(KEY, JSON.stringify(inicial));
      marcarServidor(true);
      return inicial;
    }
    localStorage.setItem(KEY, JSON.stringify(remoto));
    marcarServidor(true);
    return remoto;
  } catch {
    marcarServidor(false);
    toast("Servidor offline. Usando os dados deste aparelho.");
    return local;
  }
}

async function salvarRemoto(dados) {
  const res = await fetch(apiUrl() + "/api/dados", {
    method: "PUT",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(dados)
  });
  if (!res.ok) throw new Error("falha ao salvar");
}

function save(dados) {
  localStorage.setItem(KEY, JSON.stringify(dados));
  if (!servidorAtivo()) return;
  salvarRemoto(dados)
    .then(() => marcarServidor(true))
    .catch(() => {
      marcarServidor(false);
      toast("Não foi possível gravar no servidor");
    });
}

let db = seed();

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function vendasDoCliente(id) {
  return db.vendas
    .filter((v) => v.clienteId === id)
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}

function ultimaCompra(id) {
  return vendasDoCliente(id)[0] || null;
}

function qtdEstoque(p) {
  return Number(p?.estoque || 0);
}

function badgeEstoque(n) {
  if (n <= 0) return `<span class="badge warn">Sem estoque</span>`;
  if (n <= 5) return `<span class="badge warn">${n} em estoque</span>`;
  return `<span class="badge ok">${n} em estoque</span>`;
}

function baixarEstoque(itens) {
  (itens || []).forEach((i) => {
    const p = db.produtos.find((x) => x.id === i.produtoId);
    if (!p) return;
    p.estoque = Math.max(0, qtdEstoque(p) - Number(i.quantidade || 0));
  });
}

function contaAtual() {
  garantirBanco(db);
  return db.contas[0];
}

function saldoConta(conta) {
  const c = conta || contaAtual();
  const mov = db.lancamentos
    .filter((l) => l.contaId === c.id)
    .reduce((s, l) => s + (l.tipo === "saida" ? -Number(l.valor || 0) : Number(l.valor || 0)), 0);
  return Number(c.saldoInicial || 0) + mov;
}

function criarLancamentoVenda(venda) {
  if (!venda || venda.pagamento === "fiado") return;
  if (db.lancamentos.some((l) => l.vendaId === venda.id)) return;
  const cliente = db.clientes.find((x) => x.id === venda.clienteId);
  const conta = contaAtual();
  db.lancamentos.push({
    id: uid(),
    contaId: conta.id,
    data: venda.data || hojeISO(),
    tipo: "entrada",
    valor: Number(venda.total || 0),
    descricao: `Venda — ${cliente?.nome || "cliente"}`,
    forma: venda.pagamento || "pix",
    origem: "venda",
    vendaId: venda.id,
    statusExtrato: "pendente"
  });
}

function sincronizarVendasNoBanco() {
  const antes = db.lancamentos.length;
  db.vendas.forEach(criarLancamentoVenda);
  if (db.lancamentos.length !== antes) save(db);
}

const CATEGORIAS_DESPESA = [
  { id: "compra_produto", label: "Compra de produto" },
  { id: "aluguel", label: "Aluguel" },
  { id: "energia", label: "Energia" },
  { id: "internet", label: "Internet" },
  { id: "agua", label: "Água" },
  { id: "outra", label: "Outra" }
];

function labelCategoria(id) {
  return CATEGORIAS_DESPESA.find((c) => c.id === id)?.label || id || "Outra";
}

function noPeriodo(iso, filtro) {
  const data = String(iso || "").slice(0, 10);
  if (filtro === "hoje") return data === hojeISO();
  if (filtro === "mes") return data.startsWith(hojeISO().slice(0, 7));
  return true;
}

function listaReceitas() {
  garantirBanco(db);
  const deVendas = db.vendas
    .filter((v) => v.pagamento && v.pagamento !== "fiado")
    .map((v) => {
      const c = db.clientes.find((x) => x.id === v.clienteId);
      return {
        id: "venda-" + v.id,
        data: v.data,
        valor: Number(v.total || 0),
        forma: v.pagamento,
        descricao: `Venda — ${c?.nome || "cliente"}`,
        origem: "venda",
        vendaId: v.id
      };
    });
  const manuais = db.receitas.map((r) => ({ ...r, origem: r.origem || "manual" }));
  return [...deVendas, ...manuais].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}

function registrarLancamentoFinanceiro({ tipo, valor, data, descricao, forma, receitaId, despesaId }) {
  db.lancamentos.push({
    id: uid(),
    contaId: contaAtual().id,
    data: data || hojeISO(),
    tipo,
    valor: Number(valor || 0),
    descricao,
    forma: forma || "outro",
    origem: "manual",
    receitaId,
    despesaId,
    statusExtrato: "pendente"
  });
}

function saldoCliente(id) {
  return vendasDoCliente(id)
    .filter((v) => v.pagamento === "fiado")
    .reduce((s, v) => s + Number(v.total || 0), 0);
}

function vasilhameCliente(id) {
  const entregues = vendasDoCliente(id).reduce((s, v) => {
    const qtd = (v.itens || []).reduce((n, i) => n + (i.vasilhame ? Number(i.quantidade || 0) : 0), 0);
    return s + qtd;
  }, 0);
  const recolhidos = vendasDoCliente(id).reduce((s, v) => s + Number(v.vasilhamesRecolhidos || 0), 0);
  return Math.max(0, entregues - recolhidos);
}

function diasDesde(iso) {
  if (!iso) return Infinity;
  const a = new Date(iso.slice(0, 10) + "T00:00:00");
  const b = new Date(hojeISO() + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function clienteBuscaTexto(c) {
  return [
    c.nome, c.telefone, c.telefone2, c.rua, c.numero, c.bairro,
    c.cidade, c.referencia, c.complemento, c.observacoes, formatarData(c.dataCadastro)
  ].join(" ");
}

function clientesFiltrados(termo = state.busca, filtro = state.filtroClientes) {
  const q = normalizar(termo);
  return db.clientes
    .filter((c) => !q || normalizar(clienteBuscaTexto(c)).includes(q))
    .filter((c) => {
      const ultima = ultimaCompra(c.id);
      if (filtro === "ativos") return c.status !== "inativo";
      if (filtro === "inativos") return c.status === "inativo";
      if (filtro === "sem15") return !ultima || diasDesde(ultima.data) >= 15;
      if (filtro === "hoje") return c.dataCadastro === hojeISO();
      return true;
    })
    .sort((a, b) => (b.dataCadastro || "").localeCompare(a.dataCadastro || "") || a.nome.localeCompare(b.nome, "pt-BR"));
}

function ehAdmin() {
  if (localStorage.getItem(ADMIN_KEY) === "1") return true;
  if (sessionStorage.getItem(ADMIN_KEY) === "1") {
    localStorage.setItem(ADMIN_KEY, "1");
    sessionStorage.removeItem(ADMIN_KEY);
    return true;
  }
  return false;
}

async function hashSenha(texto) {
  const data = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function abrirLogin(view, extra = {}) {
  state.pendenteView = view;
  state.pendenteExtra = extra;
  document.getElementById("login-modal")?.classList.add("show");
  document.getElementById("login-erro").textContent = "";
  const campo = document.getElementById("login-senha");
  if (campo) {
    campo.value = "";
    campo.focus();
  }
}

function fecharLogin() {
  document.getElementById("login-modal")?.classList.remove("show");
}

function atualizarAcessoAdmin() {
  document.body.classList.toggle("admin-on", ehAdmin());
  const btn = document.getElementById("btn-sair-admin");
  if (btn) btn.hidden = !ehAdmin();
}

function setView(view, extra = {}) {
  if (!VIEWS_LIVRES.has(view) && !ehAdmin()) {
    abrirLogin(view, extra);
    return;
  }
  state.view = view;
  Object.assign(state, extra);
  document.querySelectorAll(".nav-btn, .bottom-nav button").forEach((btn) => {
    const tipoBtn = btn.dataset.tipoRelatorio;
    const ativo = tipoBtn
      ? view === "relatorios" && state.tipoRelatorio === tipoBtn
      : btn.dataset.view === view ||
        (["cliente-form", "cliente-ficha"].includes(view) && btn.dataset.view === "clientes") ||
        (view === "venda-form" && btn.dataset.view === "vendas") ||
        (view === "produto-form" && btn.dataset.view === (state.origem || "produtos")) ||
        (view === "precificacao" && btn.dataset.view === "precificacao") ||
        (view === "banco" && btn.dataset.view === "banco");
    btn.classList.toggle("active", ativo);
  });
  const grupo = document.getElementById("grupo-relatorios");
  const toggle = document.getElementById("btn-relatorios-toggle");
  if (grupo) {
    grupo.classList.toggle("open", view === "relatorios");
    toggle?.classList.toggle("active", view === "relatorios");
    toggle?.setAttribute("aria-expanded", view === "relatorios" ? "true" : "false");
  }
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
  atualizarAcessoAdmin();
  render();
}

function render() {
  destruirMapaDistancia();
  const root = document.getElementById("conteudo");
  const views = {
    inicio: viewInicio,
    clientes: viewClientes,
    "cliente-form": viewClienteForm,
    "cliente-ficha": viewClienteFicha,
    distancia: viewDistancia,
    produtos: viewProdutos,
    estoque: viewEstoque,
    "produto-form": viewProdutoForm,
    precificacao: viewPrecificacao,
    vendas: viewVendas,
    "venda-form": viewVendaForm,
    banco: viewBanco,
    receitas: viewReceitas,
    despesas: viewDespesas,
    relatorios: viewRelatorios
  };
  root.innerHTML = (views[state.view] || viewInicio)();
  bindView();
}

function cardCliente(c) {
  const ultima = ultimaCompra(c.id);
  const itens = ultima ? (ultima.itens || []).map((i) => `${i.quantidade} ${i.nome}`).join(", ") : "";
  return `
    <button class="item" data-open-cliente="${c.id}">
      <div class="row">
        <h3>${esc(c.nome)}</h3>
        <span class="badge">${c.tipo === "comercial" ? "Comercial" : "Residencial"}</span>
      </div>
      <div class="meta">${esc([c.rua, c.numero].filter(Boolean).join(", "))}${c.bairro ? " — " + esc(c.bairro) : ""}</div>
      <div class="meta">Cadastro: ${formatarData(c.dataCadastro)} · ${esc(c.telefone || "sem telefone")}</div>
      <div class="meta">${ultima ? `Última compra: ${formatarData(ultima.data)} — ${esc(itens)}` : "Ainda sem compra"}</div>
    </button>
  `;
}

function figuraDistancia(ok) {
  if (ok) {
    return `
      <svg class="dist-figura" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="56" fill="#1b8a4a"/>
        <path d="M34 62 l18 18 34-40" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }
  return `
    <svg class="dist-figura" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="#c62828"/>
      <path d="M40 40 l40 40 M80 40 l-40 40" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
    </svg>
  `;
}

function urlGooglePercurso(r) {
  return (
    "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" +
    encodeURIComponent((r.origem?.lat || "") + "," + (r.origem?.lng || "")) +
    "&destination=" +
    encodeURIComponent((r.destino?.lat || "") + "," + (r.destino?.lng || ""))
  );
}

function urlEmbedPercurso(r) {
  const o = Number(r.origem.lat) + "," + Number(r.origem.lng);
  const d = Number(r.destino.lat) + "," + Number(r.destino.lng);
  const key = window.REIDAGUA_MAPS_EMBED_KEY;
  if (key) {
    return (
      "https://www.google.com/maps/embed/v1/directions?key=" +
      encodeURIComponent(key) +
      "&origin=" + encodeURIComponent(o) +
      "&destination=" + encodeURIComponent(d) +
      "&mode=driving&language=pt-BR&units=metric"
    );
  }
  return (
    "https://www.google.com/maps?saddr=" + encodeURIComponent(o) +
    "&daddr=" + encodeURIComponent(d) +
    "&hl=pt-BR&dirflg=d&output=embed"
  );
}

function htmlResultadoDistancia(r) {
  if (!r) return "";
  if (!r.ok) {
    return `<div class="card empty"><p>${esc(r.erro || "Não foi possível calcular a distância.")}</p></div>`;
  }
  const maps = urlGooglePercurso(r);
  const minutos = r.minutos > 0 ? ` · cerca de ${r.minutos} min` : "";
  const podeMapa = r.atende && r.origem?.lat && r.destino?.lat;
  const usaEmbed = podeMapa && window.REIDAGUA_MAPS_EMBED_KEY;
  const mapa = !podeMapa ? "" : usaEmbed
    ? `
      <div class="dist-mapa-wrap">
        <p class="dist-mapa-titulo">Melhor percurso de carro</p>
        <iframe
          class="dist-mapa"
          title="Melhor percurso de carro da loja até o cliente"
          src="${esc(urlEmbedPercurso(r))}"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen
        ></iframe>
      </div>
    `
    : `
      <div class="dist-mapa-wrap">
        <p class="dist-mapa-titulo">Melhor percurso de carro</p>
        <div id="dist-mapa-leaflet" class="dist-mapa-leaflet"></div>
      </div>
    `;
  return `
    <div class="card dist-card ${r.atende ? "dist-ok" : "dist-nao"}">
      ${figuraDistancia(r.atende)}
      <div class="dist-km">${String(r.km).replace(".", ",")} km</div>
      <p class="dist-status">${r.atende ? "Dentro da área — podemos atender" : "Fora da área — acima de 5 km"}</p>
      <p class="meta">${r.fonte === "google" ? "Rota de carro no Google Maps" : "Rota de carro pelas ruas"} (não a pé e não em linha reta)${minutos}</p>
      <p class="meta">Loja: Rua Itapeva, 158 — CEP 09751-120</p>
      <p class="meta">Cliente: ${esc(r.destino?.label || "—")}</p>
      ${mapa}
      <a class="btn btn-navy" href="${maps}" target="_blank" rel="noopener">Abrir percurso no Google Maps</a>
    </div>
  `;
}

let mapaDistancia = null;
let mapaDistanciaSeq = 0;

function destruirMapaDistancia() {
  mapaDistanciaSeq += 1;
  if (mapaDistancia) {
    mapaDistancia.remove();
    mapaDistancia = null;
  }
}

function pinDistancia(cor, letra) {
  return L.divIcon({
    className: "dist-pin",
    html: `<span style="background:${cor}"><b>${letra}</b></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28]
  });
}

async function pontosDoPercurso(r) {
  if (Array.isArray(r.percurso) && r.percurso.length > 1) return r.percurso;
  const o = r.origem;
  const d = r.destino;
  const pontos = o.lng + "," + o.lat + ";" + d.lng + "," + d.lat;
  const urls = [
    "https://router.project-osrm.org/route/v1/driving/" + pontos + "?overview=full&geometries=geojson",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/" + pontos + "?overview=full&geometries=geojson"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const j = await res.json();
      const coords = j.routes?.[0]?.geometry?.coordinates;
      if (coords?.length) return coords.map(([lng, lat]) => [lat, lng]);
    } catch {
      /* tenta o próximo */
    }
  }
  return [[o.lat, o.lng], [d.lat, d.lng]];
}

async function mostrarPercursoNoMapa(r) {
  const seq = ++mapaDistanciaSeq;
  if (mapaDistancia) {
    mapaDistancia.remove();
    mapaDistancia = null;
  }
  if (!r?.ok || !r.atende || window.REIDAGUA_MAPS_EMBED_KEY) return;
  const el = document.getElementById("dist-mapa-leaflet");
  if (!el || typeof L === "undefined") return;
  const pontos = await pontosDoPercurso(r);
  if (seq !== mapaDistanciaSeq) return;
  if (!document.getElementById("dist-mapa-leaflet")) return;
  mapaDistancia = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(mapaDistancia);
  const linha = L.polyline(pontos, { color: "#0b3d8c", weight: 5, opacity: 0.9 }).addTo(mapaDistancia);
  L.marker([r.origem.lat, r.origem.lng], { icon: pinDistancia("#0b3d8c", "L"), title: "Loja" })
    .addTo(mapaDistancia)
    .bindPopup("Loja — Rua Itapeva, 158");
  L.marker([r.destino.lat, r.destino.lng], { icon: pinDistancia("#c9a227", "C"), title: "Cliente" })
    .addTo(mapaDistancia)
    .bindPopup(r.destino.label || "Cliente");
  mapaDistancia.fitBounds(linha.getBounds(), { padding: [28, 28] });
  setTimeout(() => mapaDistancia?.invalidateSize(), 180);
}

function viewDistancia() {
  const d = estadoDistancia();
  const modo = d.modo || "cep";
  const modos = [
    ["cep", "1. Só o CEP"],
    ["cep-endereco", "2. CEP e endereço"],
    ["endereco", "3. Só o endereço"]
  ];
  const ajudaCep = modo === "cep"
    ? "Digite o CEP para aparecer o endereço."
    : "Digite o CEP para preencher o endereço. Complete com o número.";
  return `
    <div class="page-head">
      <div>
        <h1>Distância</h1>
        <p>Escolha como informar o local. Em todos os casos a distância é a rota de carro no Google Maps até a loja (Rua Itapeva, 158 — CEP 09751-120). Até 5 km atendemos.</p>
      </div>
    </div>
    <form class="card form" id="form-distancia">
      <div class="chips dist-modos" id="modos-distancia">
        ${modos.map(([id, label]) => `<button type="button" class="chip ${modo === id ? "active" : ""}" data-modo-distancia="${id}">${label}</button>`).join("")}
      </div>
      <div class="fields">
        ${modo !== "endereco" ? `
        <div class="field full">
          <label for="dist-cep">CEP do cliente</label>
          <input id="dist-cep" name="cep" inputmode="numeric" maxlength="9" autocomplete="postal-code" placeholder="00000-000" value="${esc(d.cep || "")}" />
          <span class="help" id="dist-cep-status">${ajudaCep}</span>
        </div>
        ` : ""}
        ${modo === "cep" ? `
        <div class="field full" id="dist-endereco-preview-wrap"${d.enderecoViaCep ? "" : " hidden"}>
          <label>Endereço encontrado</label>
          <p class="dist-endereco-preview" id="dist-endereco-preview">${esc(d.enderecoViaCep || "")}</p>
        </div>
        ` : ""}
        ${modo !== "cep" ? `
        <div class="field full">
          <label for="dist-endereco">${modo === "endereco" ? "Endereço completo" : "Endereço completo (além do CEP)"}</label>
          <input id="dist-endereco" name="endereco" placeholder="Rua, número, bairro, cidade" value="${esc(d.endereco || "")}" />
          <span class="help">${modo === "endereco" ? "Informe rua, número, bairro e cidade. Sem CEP." : "Confira o endereço do CEP e complete com o número da casa."}</span>
        </div>
        ` : ""}
      </div>
      <div class="actions">
        <button class="btn btn-gold" type="submit">Calcular distância</button>
      </div>
    </form>
    <div id="resultado-distancia" style="margin-top:14px">${htmlResultadoDistancia(d.resultado)}</div>
  `;
}

function viewInicio() {
  const hoje = hojeISO();
  const vendasHoje = db.vendas.filter((v) => v.data === hoje);
  const mes = hoje.slice(0, 7);
  const vendasMes = db.vendas.filter((v) => (v.data || "").startsWith(mes));
  const novosHoje = db.clientes.filter((c) => c.dataCadastro === hoje);
  return `
    <div class="home-logo">
      <img src="assets/logo-header.jpg" alt="Rei D'Água" />
    </div>
    <div class="page-head">
      <div>
        <h1>RESUMO DO DIA</h1>
      </div>
      <div class="actions">
        <button class="btn btn-navy" data-go="cliente-form">+ Cliente</button>
        <button class="btn btn-gold" data-go="venda-form">+ Venda</button>
      </div>
    </div>
    <div class="grid grid-4">
      <div class="card stat"><div class="label">Clientes</div><div class="value">${db.clientes.length}</div><div class="hint">${novosHoje.length} cadastrado(s) hoje</div></div>
      <div class="card stat"><div class="label">Vendas de hoje</div><div class="value">${vendasHoje.length}</div><div class="hint">${formatarMoeda(vendasHoje.reduce((s, v) => s + Number(v.total || 0), 0))}</div></div>
      <div class="card stat"><div class="label">Faturamento do mês</div><div class="value">${formatarMoeda(vendasMes.reduce((s, v) => s + Number(v.total || 0), 0))}</div><div class="hint">${vendasMes.length} venda(s)</div></div>
      <div class="card stat"><div class="label">Saldo bancário</div><div class="value">${formatarMoeda(saldoConta())}</div><div class="hint">controle de caixa</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:14px">
      <section class="card">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Cadastros de hoje</h2>
        <div class="list">${novosHoje.length ? novosHoje.map(cardCliente).join("") : `<div class="empty">Nenhum cliente cadastrado hoje.</div>`}</div>
      </section>
      <section class="card">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Últimas vendas</h2>
        <div class="list">${
          db.vendas.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 6).map((v) => {
            const c = db.clientes.find((x) => x.id === v.clienteId);
            return `<button class="item" data-open-cliente="${v.clienteId}">
              <div class="row"><h3>${esc(c?.nome || "Cliente removido")}</h3><span class="badge ok">${formatarMoeda(v.total)}</span></div>
              <div class="meta">${formatarData(v.data)} — ${(v.itens || []).map((i) => `${i.quantidade} ${i.nome}`).join(", ")}</div>
            </button>`;
          }).join("") || `<div class="empty">Nenhuma venda ainda.</div>`
        }</div>
      </section>
    </div>
  `;
}

function viewClientes() {
  const lista = clientesFiltrados();
  return `
    <div class="page-head">
      <div>
        <h1>Clientes</h1>
        <p>${lista.length} resultado(s) — busque por nome, telefone, rua, bairro ou data</p>
      </div>
      <button class="btn btn-navy" data-go="cliente-form">+ Novo cliente</button>
    </div>
    <div class="search-wrap">
      <input id="busca-pagina" type="search" placeholder="Buscar cliente, telefone, rua ou bairro…" value="${esc(state.busca)}" autocomplete="off" />
    </div>
    <div class="chips" id="filtros-clientes">
      ${[
        ["todos", "Todos"],
        ["hoje", "Cadastrados hoje"],
        ["ativos", "Ativos"],
        ["sem15", "Sem compra há 15 dias"],
        ["inativos", "Inativos"]
      ].map(([id, label]) => `<button class="chip ${state.filtroClientes === id ? "active" : ""}" data-filtro="${id}">${label}</button>`).join("")}
    </div>
    <div class="list">
      ${lista.length ? lista.map(cardCliente).join("") : `<div class="card empty"><img src="assets/logo-header.jpg" alt="Rei D'Água" /><p>Nenhum cliente encontrado. Cadastre o primeiro.</p></div>`}
    </div>
  `;
}

function viewClienteForm() {
  const c = db.clientes.find((x) => x.id === state.clienteId) || {
    nome: "", tipo: "residencial", telefone: "", telefone2: "",
    dataCadastro: hojeISO(), cep: "", rua: "", numero: "", complemento: "",
    bairro: "Baeta Neves", cidade: "São Bernardo do Campo", referencia: "",
    diaEntrega: "", observacoes: "", status: "ativo"
  };
  const editando = Boolean(state.clienteId && db.clientes.some((x) => x.id === state.clienteId));
  return `
    <div class="page-head">
      <div>
        <h1>${editando ? "Editar cliente" : "Novo cliente"}</h1>
        <p>A data do cadastro é preenchida automaticamente com o dia de hoje.</p>
      </div>
      <button class="btn btn-ghost" data-go="clientes">Voltar</button>
    </div>
    <form class="card form" id="form-cliente">
      <div class="fields">
        <div class="field full">
          <label for="nome">Nome do cliente</label>
          <input id="nome" name="nome" required value="${esc(c.nome)}" placeholder="Nome completo ou empresa" />
        </div>
        <div class="field">
          <label for="dataCadastro">Data do cadastro</label>
          <input id="dataCadastro" name="dataCadastro" type="date" required value="${esc(c.dataCadastro || hojeISO())}" />
          <span class="help">Preenchida com a data de hoje. Pode alterar se o cadastro for retroativo.</span>
        </div>
        <div class="field">
          <label for="tipo">Tipo</label>
          <select id="tipo" name="tipo">
            <option value="residencial" ${c.tipo !== "comercial" ? "selected" : ""}>Residencial</option>
            <option value="comercial" ${c.tipo === "comercial" ? "selected" : ""}>Comercial</option>
          </select>
        </div>
        <div class="field">
          <label for="telefone">Telefone / WhatsApp</label>
          <input id="telefone" name="telefone" class="tel" value="${esc(c.telefone)}" placeholder="(11) 90000-0000" />
        </div>
        <div class="field">
          <label for="telefone2">Telefone 2</label>
          <input id="telefone2" name="telefone2" class="tel" value="${esc(c.telefone2 || "")}" placeholder="Opcional" />
        </div>
        <div class="field">
          <label for="cep">CEP</label>
          <input id="cep" name="cep" inputmode="numeric" maxlength="9" autocomplete="postal-code" value="${esc(c.cep || "")}" placeholder="00000-000" />
          <span class="help" id="cep-status">Digite o CEP para preencher o endereço.</span>
        </div>
        <div class="field">
          <label for="rua">Rua</label>
          <input id="rua" name="rua" value="${esc(c.rua || "")}" placeholder="Nome da rua" />
        </div>
        <div class="field">
          <label for="numero">Número</label>
          <input id="numero" name="numero" value="${esc(c.numero || "")}" />
        </div>
        <div class="field">
          <label for="complemento">Complemento</label>
          <input id="complemento" name="complemento" value="${esc(c.complemento || "")}" placeholder="Apto, bloco, fundos…" />
        </div>
        <div class="field">
          <label for="bairro">Bairro</label>
          <input id="bairro" name="bairro" list="lista-bairros" value="${esc(c.bairro || "")}" />
          <datalist id="lista-bairros">${BAIRROS.map((b) => `<option value="${b}">`).join("")}</datalist>
        </div>
        <div class="field">
          <label for="cidade">Cidade</label>
          <input id="cidade" name="cidade" value="${esc(c.cidade || "São Bernardo do Campo")}" />
        </div>
        <div class="field full">
          <label for="referencia">Ponto de referência</label>
          <input id="referencia" name="referencia" value="${esc(c.referencia || "")}" placeholder="Em frente à padaria, portão azul…" />
        </div>
        <div class="field">
          <label for="diaEntrega">Dia preferido de entrega</label>
          <input id="diaEntrega" name="diaEntrega" value="${esc(c.diaEntrega || "")}" placeholder="Terça e sexta" />
        </div>
        <div class="field">
          <label for="status">Status</label>
          <select id="status" name="status">
            <option value="ativo" ${c.status !== "inativo" ? "selected" : ""}>Ativo</option>
            <option value="inativo" ${c.status === "inativo" ? "selected" : ""}>Inativo</option>
          </select>
        </div>
        <div class="field full">
          <label for="observacoes">Observações</label>
          <textarea id="observacoes" name="observacoes" placeholder="Portão trancado, deixar com o vizinho, cachorro…">${esc(c.observacoes || "")}</textarea>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-navy" type="submit">Salvar cadastro</button>
        <button class="btn btn-ghost" type="button" data-go="clientes">Cancelar</button>
      </div>
    </form>
  `;
}

function viewClienteFicha() {
  const c = db.clientes.find((x) => x.id === state.clienteId);
  if (!c) return `<div class="card empty">Cliente não encontrado.</div>`;
  const vendas = vendasDoCliente(c.id);
  const tel = (c.telefone || "").replace(/\D/g, "");
  const wa = tel ? `https://wa.me/55${tel}` : "";
  return `
    <div class="page-head">
      <div>
        <h1>${esc(c.nome)}</h1>
        <p>Cadastrado em ${formatarData(c.dataCadastro)}</p>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" data-go="clientes">Voltar</button>
        <button class="btn btn-navy" data-editar-cliente="${c.id}">Editar</button>
        <button class="btn btn-gold" data-nova-venda="${c.id}">+ Venda</button>
      </div>
    </div>
    <div class="grid grid-2">
      <section class="card">
        <p class="meta"><strong>Tipo:</strong> ${c.tipo === "comercial" ? "Comercial" : "Residencial"} · <strong>Status:</strong> ${c.status === "inativo" ? "Inativo" : "Ativo"}</p>
        <p><strong>Telefone:</strong> ${esc(c.telefone || "—")}${c.telefone2 ? " / " + esc(c.telefone2) : ""}</p>
        <p><strong>Endereço:</strong> ${esc([c.rua, c.numero, c.complemento].filter(Boolean).join(", ") || "—")}</p>
        <p class="meta">${esc([c.bairro, c.cidade].filter(Boolean).join(" — "))}${c.cep ? " · CEP " + esc(c.cep) : ""}</p>
        <p><strong>Referência:</strong> ${esc(c.referencia || "—")}</p>
        <p><strong>Entrega:</strong> ${esc(c.diaEntrega || "—")}</p>
        <p><strong>Observações:</strong> ${esc(c.observacoes || "—")}</p>
        <p><strong>Vasilhame em casa:</strong> ${vasilhameCliente(c.id)} · <strong>Fiado:</strong> ${formatarMoeda(saldoCliente(c.id))}</p>
        <div class="actions" style="margin-top:10px">
          ${c.telefone ? `<a class="btn btn-whats btn-sm" href="tel:${tel}">Ligar</a>` : ""}
          ${wa ? `<a class="btn btn-whats btn-sm" target="_blank" rel="noopener" href="${wa}">WhatsApp</a>` : ""}
          <button class="btn btn-danger btn-sm" data-excluir-cliente="${c.id}">Excluir</button>
        </div>
      </section>
      <section class="card">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Histórico de compras</h2>
        ${vendas.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Produtos</th><th>Valor</th><th>Pagamento</th></tr></thead>
              <tbody>
                ${vendas.map((v) => `<tr>
                  <td>${formatarData(v.data)}</td>
                  <td>${(v.itens || []).map((i) => `${i.quantidade} ${esc(i.nome)} ${esc(i.marca || "")}`).join("<br>")}</td>
                  <td>${formatarMoeda(v.total)}</td>
                  <td>${esc(v.pagamento || "—")}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="empty">Nenhuma compra registrada.</div>`}
      </section>
    </div>
  `;
}

function viewEstoque() {
  const lista = db.produtos.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return `
    <div class="page-head">
      <div>
        <h1>Estoque</h1>
        <p>Cadastre a quantidade. Cada venda baixa o estoque automaticamente.</p>
      </div>
      <button class="btn btn-navy" data-go="produto-form" data-origem="estoque">+ Produto</button>
    </div>
    <div class="list">
      ${lista.map((p) => `
        <div class="item" style="cursor:default">
          <div class="row">
            <h3>${esc(p.nome)} · ${esc(p.marca)}</h3>
            ${badgeEstoque(qtdEstoque(p))}
          </div>
          <div class="meta">${formatarMoeda(p.preco)} / ${esc(p.unidade)}${p.vasilhame ? " · vasilhame" : ""}</div>
          <div class="actions" style="margin-top:8px">
            <input class="entrada-qtd" type="number" min="1" step="1" value="1" aria-label="Quantidade de entrada" style="width:90px;padding:8px 10px" />
            <button type="button" class="btn btn-navy btn-sm" data-entrada="${p.id}">+ Entrada</button>
            <button type="button" class="btn btn-ghost btn-sm" data-editar-produto="${p.id}" data-origem="estoque">Editar</button>
          </div>
        </div>
      `).join("") || vazioProdutos("Nenhum produto cadastrado.")}
    </div>
  `;
}

function viewProdutos() {
  return `
    <div class="page-head">
      <div>
        <h1>Produtos</h1>
        <p>Cadastre uma vez e use em todas as vendas</p>
      </div>
      <div class="actions">
        <button class="btn btn-gold" data-go="precificacao">Precificação</button>
        <button class="btn btn-navy" data-go="produto-form">+ Produto</button>
      </div>
    </div>
    <div class="list">
      ${db.produtos.map((p) => `
        <button class="item" data-editar-produto="${p.id}">
          <div class="row">
            <h3>${esc(p.nome)} · ${esc(p.marca)}</h3>
            <span class="badge">${formatarMoeda(p.preco)} / ${esc(p.unidade)}</span>
          </div>
          <div class="meta">${p.vasilhame ? "Controla vasilhame" : "Sem vasilhame"} · ${qtdEstoque(p)} em estoque</div>
        </button>
      `).join("") || vazioProdutos("Nenhum produto cadastrado.")}
    </div>
  `;
}

function viewProdutoForm() {
  const p = db.produtos.find((x) => x.id === state.produtoId) || {
    nome: "", marca: "", unidade: "galão", preco: "", vasilhame: true, estoque: 0
  };
  const editando = Boolean(state.produtoId);
  const voltar = state.origem || "produtos";
  return `
    <div class="page-head">
      <div><h1>${editando ? "Editar produto" : "Novo produto"}</h1></div>
      <button class="btn btn-ghost" data-go="${voltar}">Voltar</button>
    </div>
    <form class="card form" id="form-produto">
      <div class="fields">
        <div class="field"><label>Produto</label><input name="nome" required value="${esc(p.nome)}" placeholder="Nome do produto" /></div>
        <div class="field"><label>Marca</label><input name="marca" required value="${esc(p.marca)}" placeholder="Marca" /></div>
        <div class="field">
          <label>Unidade</label>
          <select name="unidade">
            ${["galão", "unidade", "fardo", "caixa"].map((u) => `<option ${p.unidade === u ? "selected" : ""}>${u}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Preço padrão de venda</label><input name="preco" type="number" min="0" step="0.01" required value="${esc(p.preco)}" /></div>
        <div class="field">
          <label>Valor pago pelo produto</label>
          <input name="custo" type="number" min="0" step="0.01" value="${esc(p.custo || "")}" placeholder="0,00" />
          <span class="help">Fretes e % de lucro são calculados em Precificação.</span>
        </div>
        <div class="field">
          <label>Quantidade em estoque</label>
          <input name="estoque" type="number" min="0" step="1" required value="${esc(qtdEstoque(p))}" />
          <span class="help">Informe o saldo atual. As vendas vão diminuir este número.</span>
        </div>
        <div class="field">
          <label>Vasilhame</label>
          <select name="vasilhame">
            <option value="sim" ${p.vasilhame ? "selected" : ""}>Sim</option>
            <option value="nao" ${!p.vasilhame ? "selected" : ""}>Não</option>
          </select>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-navy" type="submit">Salvar</button>
        ${editando ? `<button class="btn btn-danger" type="button" data-excluir-produto="${p.id}">Excluir</button>` : ""}
      </div>
    </form>
  `;
}

function kpisPrecificacao(linhas) {
  const analisados = linhas.filter((l) => l.custoTotal > 0 && l.venda > 0);
  const semCusto = linhas.filter((l) => l.custo <= 0).length;
  const prejuizo = analisados.filter((l) => l.venda < l.custoTotal).length;
  const lucroMedio = analisados.length
    ? analisados.reduce((s, l) => s + (l.venda - l.custoTotal), 0) / analisados.length
    : 0;
  return { semCusto, prejuizo, lucroMedio, analisados: analisados.length };
}

function htmlKpisPrecificacao(kpis) {
  return `
    <div class="grid grid-3" id="preco-kpis">
      <div class="card stat"><div class="label">Lucro médio / unidade</div><div class="value ${kpis.lucroMedio < 0 ? "valor-saida" : ""}">${kpis.analisados ? formatarMoeda(kpis.lucroMedio) : "—"}</div></div>
      <div class="card stat"><div class="label">Sem valor pago</div><div class="value">${kpis.semCusto}</div><div class="hint">Preencha o valor do produto</div></div>
      <div class="card stat"><div class="label">Abaixo do custo total</div><div class="value ${kpis.prejuizo ? "valor-saida" : ""}">${kpis.prejuizo}</div><div class="hint">Venda menor que pago + fretes</div></div>
    </div>
  `;
}

function htmlSugestoesLucro(pctAtual) {
  return MARKUPS_SUGERIDOS.map((pct) => `
    <button type="button" class="chip sug-preco ${Number(pctAtual) === pct ? "active" : ""}" data-lucro="${pct}">${pct}% de lucro</button>
  `).join("");
}

function htmlCamposPrecificacao(p = {}) {
  const total = custoTotalProduto(p);
  const venda = numCampo(p.preco) || (total ? precoPeloLucro(total, p.lucroPct) : 0);
  const resumo = htmlResumoPreco(total, venda, p.lucroPct);
  return `
    <div class="fields">
      <div class="field">
        <label>Valor pago pelo produto</label>
        <input class="preco-custo" type="number" min="0" step="0.01" inputmode="decimal" value="${p.custo || ""}" placeholder="0,00" />
      </div>
      <div class="field">
        <label>Frete de entrega do produto</label>
        <input class="preco-frete-compra" type="number" min="0" step="0.01" inputmode="decimal" value="${p.freteCompra || ""}" placeholder="0,00" />
        <span class="help">Frete para trazer o produto até a loja</span>
      </div>
      <div class="field">
        <label>Frete de entrega ao cliente</label>
        <input class="preco-frete-entrega" type="number" min="0" step="0.01" inputmode="decimal" value="${p.freteEntrega || ""}" placeholder="0,00" />
        <span class="help">Frete da entrega da venda</span>
      </div>
      <div class="field">
        <label>Percentual de lucro (%)</label>
        <input class="preco-lucro-pct" type="number" min="0" step="0.1" inputmode="decimal" value="${p.lucroPct || ""}" placeholder="30" />
      </div>
    </div>
    <div class="chips sugestoes">${htmlSugestoesLucro(p.lucroPct)}</div>
    <div class="preco-resultado">
      <div>
        <div class="label">Custo total</div>
        <div class="value" data-custo-total>${formatarMoeda(total)}</div>
      </div>
      <div class="field">
        <label>Preço de venda</label>
        <input class="preco-venda" type="number" min="0" step="0.01" inputmode="decimal" value="${venda || ""}" placeholder="0,00" />
      </div>
    </div>
    <p class="preco-resumo ${resumo.classe}">${resumo.texto}</p>
  `;
}

function viewPrecificacao() {
  const lista = db.produtos.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.marca.localeCompare(b.marca, "pt-BR"));
  const linhas = lista.map((p) => {
    const custoTotal = custoTotalProduto(p);
    return { custo: numCampo(p.custo), custoTotal, venda: numCampo(p.preco) };
  });
  const kpis = kpisPrecificacao(linhas);
  return `
    <div id="pagina-precificacao">
    <div class="page-head">
      <div>
        <h1>Precificação</h1>
        <p>Informe o produto real, o valor pago, os fretes e o percentual de lucro para chegar no preço de venda.</p>
      </div>
    </div>
    ${lista.length ? htmlKpisPrecificacao(kpis) : ""}
    <form id="form-novo-preco" class="item preco-card" style="cursor:default;margin-top:14px">
      <h3>Inserir produto</h3>
      <div class="fields">
        <div class="field">
          <label>Produto</label>
          <input class="preco-nome" name="nome" required placeholder="Nome do produto" />
        </div>
        <div class="field">
          <label>Marca</label>
          <input class="preco-marca" name="marca" required placeholder="Marca" />
        </div>
        <div class="field">
          <label>Unidade</label>
          <select class="preco-unidade" name="unidade">
            ${["galão", "unidade", "fardo", "caixa"].map((u) => `<option>${u}</option>`).join("")}
          </select>
        </div>
      </div>
      ${htmlCamposPrecificacao({})}
      <div class="actions" style="margin-top:12px">
        <button class="btn btn-gold" type="submit">Inserir produto</button>
      </div>
    </form>
    ${lista.length ? `
      <form id="form-precificacao">
        <div class="list" style="margin-top:14px">
          ${lista.map((p) => `
              <div class="item preco-card" data-preco-produto="${p.id}" style="cursor:default">
                <div class="row">
                  <h3>${esc(p.nome)} · ${esc(p.marca)}</h3>
                  <span class="badge">${esc(p.unidade)}</span>
                </div>
                ${htmlCamposPrecificacao(p)}
              </div>
            `).join("")}
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="btn btn-gold" type="submit">Salvar precificação</button>
        </div>
      </form>
    ` : ""}
    </div>
  `;
}

function viewVendas() {
  const q = normalizar(state.busca);
  const lista = db.vendas
    .slice()
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""))
    .filter((v) => {
      if (!q) return true;
      const c = db.clientes.find((x) => x.id === v.clienteId);
      const txt = [c?.nome, c?.bairro, c?.telefone, v.data, formatarData(v.data), ...(v.itens || []).map((i) => `${i.nome} ${i.marca}`)].join(" ");
      return normalizar(txt).includes(q);
    });
  return `
    <div class="page-head">
      <div>
        <h1>Vendas</h1>
        <p>${lista.length} registro(s)</p>
      </div>
      <button class="btn btn-gold" data-go="venda-form">+ Nova venda</button>
    </div>
    <div class="search-wrap">
      <input id="busca-pagina" type="search" placeholder="Buscar venda por cliente, bairro ou produto…" value="${esc(state.busca)}" autocomplete="off" />
    </div>
    <div class="list">
      ${lista.map((v) => {
        const c = db.clientes.find((x) => x.id === v.clienteId);
        return `<button class="item" data-open-cliente="${v.clienteId}">
          <div class="row"><h3>${esc(c?.nome || "Cliente removido")}</h3><span class="badge ok">${formatarMoeda(v.total)}</span></div>
          <div class="meta">${formatarData(v.data)} · ${esc(v.pagamento || "")} · ${(v.itens || []).map((i) => `${i.quantidade} ${i.nome} ${i.marca || ""}`).join(", ")}</div>
        </button>`;
      }).join("") || `<div class="card empty">Nenhuma venda ainda.</div>`}
    </div>
  `;
}

function viewVendaForm() {
  const clienteSelecionado = state.vendaClienteId || "";
  return `
    <div class="page-head">
      <div>
        <h1>Nova venda</h1>
        <p>Escolha o cliente, os produtos e a data da compra</p>
      </div>
      <button class="btn btn-ghost" data-go="vendas">Voltar</button>
    </div>
    <form class="card form" id="form-venda">
      <div class="fields">
        <div class="field full">
          <label>Cliente</label>
          <select name="clienteId" required>
            <option value="">Selecione…</option>
            ${db.clientes.filter((c) => c.status !== "inativo").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((c) =>
              `<option value="${c.id}" ${c.id === clienteSelecionado ? "selected" : ""}>${esc(c.nome)} — ${esc(c.bairro || "")}</option>`
            ).join("")}
          </select>
        </div>
        <div class="field">
          <label>Data da compra</label>
          <input name="data" type="date" required value="${hojeISO()}" />
        </div>
        <div class="field">
          <label>Pagamento</label>
          <select name="pagamento">
            <option value="pix">Pix</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="cartao">Cartão</option>
            <option value="fiado">Fiado</option>
          </select>
        </div>
        <div class="field"><label>Entregue por</label><input name="entreguePor" placeholder="Opcional" /></div>
        <div class="field"><label>Galões vazios recolhidos</label><input name="vasilhamesRecolhidos" type="number" min="0" value="0" /></div>
      </div>
      <div>
        <label style="font-weight:700;color:var(--navy-deep)">Produtos</label>
        <div id="itens-venda" class="list" style="margin-top:8px">
          ${db.produtos.map((p) => `
            <div class="item" style="cursor:default" data-produto="${p.id}" data-vasilhame="${p.vasilhame ? "1" : "0"}" data-nome="${esc(p.nome)}" data-marca="${esc(p.marca)}" data-preco="${p.preco}" data-estoque="${qtdEstoque(p)}">
              <div class="row">
                <h3>${esc(p.nome)} · ${esc(p.marca)}</h3>
                <span class="badge">${formatarMoeda(p.preco)}</span>
              </div>
              <div class="meta">Estoque: ${qtdEstoque(p)} ${esc(p.unidade)}</div>
              <div class="qty">
                <button type="button" data-menos>−</button>
                <strong data-qtd>0</strong>
                <button type="button" data-mais>+</button>
              </div>
            </div>
          `).join("")}
        </div>
        <p style="margin:12px 0 0;font-weight:700;color:var(--navy-deep)">Total: <span id="total-venda">${formatarMoeda(0)}</span></p>
      </div>
      <div class="field"><label>Observação da entrega</label><textarea name="observacao"></textarea></div>
      <div class="actions">
        <button class="btn btn-gold" type="submit">Salvar venda</button>
        ${!db.clientes.length ? `<span class="help">Cadastre um cliente antes de lançar a venda.</span>` : ""}
      </div>
    </form>
  `;
}

function viewBanco() {
  sincronizarVendasNoBanco();
  const conta = contaAtual();
  const saldo = saldoConta(conta);
  const mes = hojeISO().slice(0, 7);
  const movMes = db.lancamentos.filter((l) => (l.data || "").startsWith(mes) && l.contaId === conta.id);
  const entradas = movMes.filter((l) => l.tipo !== "saida").reduce((s, l) => s + Number(l.valor || 0), 0);
  const saidas = movMes.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor || 0), 0);
  const lista = db.lancamentos
    .filter((l) => l.contaId === conta.id)
    .slice()
    .sort((a, b) => (b.data || "").localeCompare(a.data || "") || String(b.id).localeCompare(String(a.id)));
  return `
    <div class="page-head">
      <div>
        <h1>Controle bancário</h1>
        <p>Caixa e conta para, no futuro, conferir com o extrato do banco.</p>
      </div>
    </div>
    <div class="grid grid-3">
      <div class="card stat"><div class="label">Saldo atual</div><div class="value">${formatarMoeda(saldo)}</div><div class="hint">${esc(conta.nome || "Conta principal")}</div></div>
      <div class="card stat"><div class="label">Entradas do mês</div><div class="value valor-entrada">${formatarMoeda(entradas)}</div><div class="hint">vendas e lançamentos</div></div>
      <div class="card stat"><div class="label">Saídas do mês</div><div class="value valor-saida">${formatarMoeda(saidas)}</div><div class="hint">despesas e retiradas</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:14px">
      <form class="card form" id="form-conta">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Dados da conta</h2>
        <div class="fields">
          <div class="field full"><label>Nome da conta</label><input name="nome" required value="${esc(conta.nome)}" placeholder="Conta principal" /></div>
          <div class="field"><label>Banco</label><input name="banco" value="${esc(conta.banco || "")}" placeholder="Nubank, Itaú, Bradesco…" /></div>
          <div class="field">
            <label>Tipo</label>
            <select name="tipo">
              <option value="corrente" ${conta.tipo === "corrente" ? "selected" : ""}>Conta corrente</option>
              <option value="poupanca" ${conta.tipo === "poupanca" ? "selected" : ""}>Poupança</option>
              <option value="caixa" ${conta.tipo === "caixa" ? "selected" : ""}>Caixa físico</option>
            </select>
          </div>
          <div class="field"><label>Agência</label><input name="agencia" value="${esc(conta.agencia || "")}" /></div>
          <div class="field"><label>Conta</label><input name="conta" value="${esc(conta.conta || "")}" /></div>
          <div class="field full"><label>Chave Pix</label><input name="chavePix" value="${esc(conta.chavePix || "")}" placeholder="CPF, e-mail ou celular" /></div>
          <div class="field full">
            <label>Saldo inicial</label>
            <input name="saldoInicial" type="number" step="0.01" value="${esc(conta.saldoInicial || 0)}" />
            <span class="help">Valor que já estava na conta antes de usar o sistema.</span>
          </div>
        </div>
        <div class="actions"><button class="btn btn-navy" type="submit">Salvar dados da conta</button></div>
      </form>
      <form class="card form" id="form-lancamento">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Novo lançamento</h2>
        <div class="fields">
          <div class="field"><label>Data</label><input name="data" type="date" required value="${hojeISO()}" /></div>
          <div class="field">
            <label>Tipo</label>
            <select name="tipo">
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </select>
          </div>
          <div class="field"><label>Valor</label><input name="valor" type="number" min="0" step="0.01" required /></div>
          <div class="field">
            <label>Forma</label>
            <select name="forma">
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="cartao">Cartão</option>
              <option value="ted">TED / transferência</option>
              <option value="boleto">Boleto</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div class="field full"><label>Descrição</label><input name="descricao" required placeholder="Venda, aluguel, compra de galões…" /></div>
        </div>
        <div class="actions"><button class="btn btn-gold" type="submit">Lançar no caixa</button></div>
      </form>
    </div>
    <section class="card" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 6px;font-size:20px;color:var(--navy-deep)">Extrato bancário</h2>
      <p class="help">Em breve você poderá importar o extrato do banco para conferir cada lançamento com o caixa.</p>
      <div class="actions" style="margin-top:10px">
        <button class="btn btn-ghost" type="button" disabled>Importar extrato (em breve)</button>
        <span class="badge muted">${lista.filter((l) => l.statusExtrato === "pendente").length} pendente(s) de conferência</span>
      </div>
    </section>
    <section class="card" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Movimentações</h2>
      ${lista.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Origem</th><th>Forma</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              ${lista.map((l) => `
                <tr>
                  <td>${formatarData(l.data)}</td>
                  <td>${esc(l.descricao)}</td>
                  <td>${l.origem === "venda" ? "Venda" : l.origem === "extrato" ? "Extrato" : "Manual"}</td>
                  <td>${esc(l.forma || "—")}</td>
                  <td class="${l.tipo === "saida" ? "valor-saida" : "valor-entrada"}">${l.tipo === "saida" ? "− " : "+ "}${formatarMoeda(l.valor)}</td>
                  <td>${l.origem === "venda" ? "" : `<button type="button" class="btn btn-danger btn-sm" data-excluir-lancamento="${l.id}">Excluir</button>`}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>` : `<div class="empty">Nenhum lançamento ainda. As vendas pagas entram sozinhas aqui.</div>`}
    </section>
  `;
}

function viewReceitas() {
  const filtro = state.filtroReceitas || "hoje";
  const lista = listaReceitas().filter((r) => noPeriodo(r.data, filtro));
  const por = (forma) => lista.filter((r) => r.forma === forma).reduce((s, r) => s + Number(r.valor || 0), 0);
  const total = lista.reduce((s, r) => s + Number(r.valor || 0), 0);
  const tituloPeriodo = filtro === "hoje" ? "hoje" : "neste mês";
  return `
    <div class="page-head">
      <div>
        <h1>Receitas</h1>
        <p>Acompanhe o que entrou por Pix, dinheiro e cartão.</p>
      </div>
    </div>
    <div class="chips">
      <button class="chip ${filtro === "hoje" ? "active" : ""}" data-filtro-receita="hoje">Hoje</button>
      <button class="chip ${filtro === "mes" ? "active" : ""}" data-filtro-receita="mes">Mês</button>
    </div>
    <div class="grid grid-4">
      <div class="card stat"><div class="label">Total ${tituloPeriodo}</div><div class="value">${formatarMoeda(total)}</div></div>
      <div class="card stat"><div class="label">Pix</div><div class="value valor-entrada">${formatarMoeda(por("pix"))}</div></div>
      <div class="card stat"><div class="label">Dinheiro</div><div class="value valor-entrada">${formatarMoeda(por("dinheiro"))}</div></div>
      <div class="card stat"><div class="label">Cartão</div><div class="value valor-entrada">${formatarMoeda(por("cartao"))}</div></div>
    </div>
    <form class="card form" id="form-receita" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Lançar receita</h2>
      <div class="fields">
        <div class="field"><label>Data</label><input name="data" type="date" required value="${hojeISO()}" /></div>
        <div class="field">
          <label>Forma de recebimento</label>
          <select name="forma">
            <option value="pix">Pix</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="cartao">Cartão</option>
          </select>
        </div>
        <div class="field"><label>Valor</label><input name="valor" type="number" min="0" step="0.01" required /></div>
        <div class="field full">
          <label>Descrição da receita</label>
          <input name="descricao" required placeholder="Digite a receita: venda avulsa, extra, etc." />
        </div>
      </div>
      <div class="actions"><button class="btn btn-gold" type="submit">Salvar receita</button></div>
    </form>
    <section class="card" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Movimento ${tituloPeriodo}</h2>
      ${lista.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              ${lista.map((r) => `
                <tr>
                  <td>${formatarData(r.data)}</td>
                  <td>${esc(r.descricao)}</td>
                  <td>${r.forma === "pix" ? "Pix" : r.forma === "dinheiro" ? "Dinheiro" : "Cartão"}</td>
                  <td class="valor-entrada">${formatarMoeda(r.valor)}</td>
                  <td>${r.origem === "venda" ? "" : `<button type="button" class="btn btn-danger btn-sm" data-excluir-receita="${r.id}">Excluir</button>`}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>` : `<div class="empty">Nenhuma receita ${tituloPeriodo}.</div>`}
    </section>
  `;
}

function viewDespesas() {
  garantirBanco(db);
  const filtro = state.filtroDespesas || "mes";
  const lista = db.despesas
    .filter((d) => noPeriodo(d.data, filtro))
    .slice()
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const total = lista.reduce((s, d) => s + Number(d.valor || 0), 0);
  const fixas = lista.filter((d) => d.tipo === "fixa").reduce((s, d) => s + Number(d.valor || 0), 0);
  const variaveis = lista.filter((d) => d.tipo !== "fixa").reduce((s, d) => s + Number(d.valor || 0), 0);
  const tituloPeriodo = filtro === "hoje" ? "hoje" : "neste mês";
  return `
    <div class="page-head">
      <div>
        <h1>Despesas</h1>
        <p>Controle gastos fixos e variáveis. Digite a descrição livremente.</p>
      </div>
    </div>
    <div class="chips">
      <button class="chip ${filtro === "hoje" ? "active" : ""}" data-filtro-despesa="hoje">Hoje</button>
      <button class="chip ${filtro === "mes" ? "active" : ""}" data-filtro-despesa="mes">Mês</button>
    </div>
    <div class="grid grid-3">
      <div class="card stat"><div class="label">Total ${tituloPeriodo}</div><div class="value valor-saida">${formatarMoeda(total)}</div></div>
      <div class="card stat"><div class="label">Despesas fixas</div><div class="value">${formatarMoeda(fixas)}</div></div>
      <div class="card stat"><div class="label">Despesas variáveis</div><div class="value">${formatarMoeda(variaveis)}</div></div>
    </div>
    <form class="card form" id="form-despesa" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Lançar despesa</h2>
      <div class="fields">
        <div class="field"><label>Data</label><input name="data" type="date" required value="${hojeISO()}" /></div>
        <div class="field"><label>Valor</label><input name="valor" type="number" min="0" step="0.01" required /></div>
        <div class="field">
          <label>Categoria</label>
          <select name="categoria">
            ${CATEGORIAS_DESPESA.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Tipo de despesa</label>
          <select name="tipo">
            <option value="fixa">Fixa</option>
            <option value="variavel" selected>Variável</option>
          </select>
        </div>
        <div class="field full">
          <label>Descrição</label>
          <input name="descricao" required placeholder="Digite a despesa: compra de galões, conta de luz…" />
        </div>
      </div>
      <div class="actions"><button class="btn btn-navy" type="submit">Salvar despesa</button></div>
    </form>
    <section class="card" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Despesas ${tituloPeriodo}</h2>
      ${lista.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              ${lista.map((d) => `
                <tr>
                  <td>${formatarData(d.data)}</td>
                  <td>${esc(d.descricao)}</td>
                  <td>${esc(labelCategoria(d.categoria))}</td>
                  <td>${d.tipo === "fixa" ? "Fixa" : "Variável"}</td>
                  <td class="valor-saida">${formatarMoeda(d.valor)}</td>
                  <td><button type="button" class="btn btn-danger btn-sm" data-excluir-despesa="${d.id}">Excluir</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>` : `<div class="empty">Nenhuma despesa ${tituloPeriodo}.</div>`}
    </section>
  `;
}

function viewRelatorios() {
  const tipo = state.tipoRelatorio || "cliente";
  return `
    <div class="page-head">
      <div>
        <h1>Relatórios</h1>
        <p>Escolha o relatório de cliente ou o relatório do lojista</p>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" id="btn-imprimir">Imprimir</button>
        <button class="btn btn-ghost" id="btn-exportar">Exportar dados</button>
        <button class="btn btn-ghost" id="btn-importar">Importar</button>
        <input id="file-import" type="file" accept="application/json" hidden />
      </div>
    </div>
    <div class="chips">
      <button class="chip ${tipo === "cliente" ? "active" : ""}" data-tipo-relatorio="cliente">Relatório cliente</button>
      <button class="chip ${tipo === "lojista" ? "active" : ""}" data-tipo-relatorio="lojista">Relatório lojista</button>
    </div>
    ${tipo === "lojista" ? blocoRelatorioLojista() : blocoRelatorioCliente()}
  `;
}

function estatisticasVendas(vendasFiltro = db.vendas) {
  const porBairro = {};
  const porProduto = {};
  vendasFiltro.forEach((v) => {
    const cliente = db.clientes.find((x) => x.id === v.clienteId);
    const bairro = cliente?.bairro || "Sem bairro";
    porBairro[bairro] ||= { nome: bairro, qtd: 0, total: 0 };
    porBairro[bairro].qtd += 1;
    porBairro[bairro].total += Number(v.total || 0);
    (v.itens || []).forEach((i) => {
      const chave = `${i.nome} · ${i.marca || ""}`.trim();
      porProduto[chave] ||= { nome: i.nome, marca: i.marca || "", qtd: 0, total: 0 };
      porProduto[chave].qtd += Number(i.quantidade || 0);
      porProduto[chave].total += Number(i.quantidade || 0) * Number(i.valorUnitario || 0);
    });
  });
  const bairros = Object.values(porBairro).sort((a, b) => b.total - a.total || b.qtd - a.qtd);
  const produtos = Object.values(porProduto).sort((a, b) => b.qtd - a.qtd || b.total - a.total);
  return { bairros, produtos };
}

function blocoRelatorioCliente() {
  const clientes = db.clientes.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const c = db.clientes.find((x) => x.id === state.relatorioClienteId);
  const vendas = c ? vendasDoCliente(c.id) : [];
  const total = vendas.reduce((s, v) => s + Number(v.total || 0), 0);
  const stats = estatisticasVendas();
  const topBairro = stats.bairros[0];
  const topProduto = stats.produtos[0];
  const statsCliente = c ? estatisticasVendas(vendas) : { produtos: [] };
  const topProdutoCliente = statsCliente.produtos[0];
  const contPag = {};
  vendas.forEach((v) => { if (v.pagamento) contPag[v.pagamento] = (contPag[v.pagamento] || 0) + 1; });
  const topPag = Object.entries(contPag).sort((a, b) => b[1] - a[1])[0];
  const nomesPag = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", fiado: "Fiado" };
  const pagamentoMaisUsado = topPag ? (nomesPag[topPag[0]] || topPag[0]) : "—";
  return `
    <div class="grid grid-2">
      <div class="card stat">
        <div class="label">Bairro que mais vende</div>
        <div class="value" style="font-size:22px">${esc(topBairro?.nome || "—")}</div>
        <div class="hint">${topBairro ? `${topBairro.qtd} venda(s) · ${formatarMoeda(topBairro.total)}` : "Sem vendas ainda"}</div>
      </div>
      <div class="card stat">
        <div class="label">Produto que mais vende</div>
        <div class="value" style="font-size:22px">${esc(topProduto ? `${topProduto.nome}${topProduto.marca ? " · " + topProduto.marca : ""}` : "—")}</div>
        <div class="hint">${topProduto ? `${topProduto.qtd} un. · ${formatarMoeda(topProduto.total)}` : "Sem vendas ainda"}</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:14px">
      <section class="card">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Vendas por bairro</h2>
        ${stats.bairros.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Bairro</th><th>Vendas</th><th>Total</th></tr></thead>
              <tbody>
                ${stats.bairros.map((b, i) => `<tr>
                  <td>${i + 1}</td>
                  <td>${esc(b.nome)}</td>
                  <td>${b.qtd}</td>
                  <td>${formatarMoeda(b.total)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="empty">Sem dados de bairro.</div>`}
      </section>
      <section class="card">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Produtos mais vendidos</h2>
        ${stats.produtos.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Produto</th><th>Qtd</th><th>Total</th></tr></thead>
              <tbody>
                ${stats.produtos.map((p, i) => `<tr>
                  <td>${i + 1}</td>
                  <td>${esc(p.nome)}${p.marca ? " · " + esc(p.marca) : ""}</td>
                  <td>${p.qtd}</td>
                  <td>${formatarMoeda(p.total)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="empty">Sem dados de produto.</div>`}
      </section>
    </div>
    <section class="card" style="margin-top:14px">
      <div class="field">
        <label>Selecione o cliente</label>
        <select id="relatorio-cliente">
          <option value="">Escolha um cliente…</option>
          ${clientes.map((x) => `<option value="${x.id}" ${x.id === state.relatorioClienteId ? "selected" : ""}>${esc(x.nome)} — ${esc(x.bairro || "")}</option>`).join("")}
        </select>
      </div>
    </section>
    ${!c ? `<div class="card empty" style="margin-top:14px">Selecione um cliente para ver o relatório de compras.</div>` : `
      <section class="card" style="margin-top:14px">
        <h2 class="serif" style="margin:0 0 4px;font-size:22px;color:var(--navy-deep)">${esc(c.nome)}</h2>
        <p class="meta">${esc(c.bairro || "Sem bairro")} · ${esc(c.telefone || "sem telefone")} · Cliente desde ${formatarData(c.dataCadastro)}</p>
      </section>
      <div class="grid grid-4" style="margin-top:14px">
        <div class="card stat"><div class="label">Vendas</div><div class="value">${vendas.length}</div></div>
        <div class="card stat"><div class="label">Total comprado</div><div class="value">${formatarMoeda(total)}</div><div class="hint">ticket médio ${formatarMoeda(vendas.length ? total / vendas.length : 0)}</div></div>
        <div class="card stat"><div class="label">Última compra</div><div class="value" style="font-size:22px">${formatarData(vendas[0]?.data)}</div><div class="hint">${vendas[0] ? `${diasDesde(vendas[0].data)} dia(s) atrás` : ""}</div></div>
        <div class="card stat"><div class="label">Produto que mais compra</div><div class="value" style="font-size:20px">${esc(topProdutoCliente ? `${topProdutoCliente.nome}${topProdutoCliente.marca ? " · " + topProdutoCliente.marca : ""}` : "—")}</div><div class="hint">${topProdutoCliente ? `${topProdutoCliente.qtd} un.` : "Sem compras"}</div></div>
        <div class="card stat"><div class="label">Pagamento mais usado</div><div class="value" style="font-size:22px">${esc(pagamentoMaisUsado)}</div></div>
        <div class="card stat"><div class="label">Fiado em aberto</div><div class="value">${formatarMoeda(saldoCliente(c.id))}</div></div>
        <div class="card stat"><div class="label">Dia de entrega</div><div class="value" style="font-size:22px">${esc(c.diaEntrega || "—")}</div></div>
        <div class="card stat"><div class="label">Bairro</div><div class="value" style="font-size:22px">${esc(c.bairro || "—")}</div></div>
      </div>
      <section class="card" style="margin-top:14px">
        <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Vendas do cliente</h2>
        ${vendas.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Produtos</th><th>Pagamento</th><th>Valor</th></tr></thead>
              <tbody>
                ${vendas.map((v) => `<tr>
                  <td>${formatarData(v.data)}</td>
                  <td>${(v.itens || []).map((i) => `${i.quantidade} ${esc(i.nome)} ${esc(i.marca || "")}`).join("<br>")}</td>
                  <td>${esc(v.pagamento || "—")}</td>
                  <td>${formatarMoeda(v.total)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="empty">Este cliente ainda não tem vendas.</div>`}
      </section>
    `}
  `;
}

function blocoRelatorioLojista() {
  garantirBanco(db);
  const mes = hojeISO().slice(0, 7);
  const [ano, mesNum] = mes.split("-");
  const nomeMes = new Date(Number(ano), Number(mesNum) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const vendasMes = db.vendas.filter((v) => (v.data || "").startsWith(mes));
  const ranking = {};
  vendasMes.forEach((v) => {
    (v.itens || []).forEach((i) => {
      const chave = `${i.nome} · ${i.marca || ""}`.trim();
      ranking[chave] ||= { nome: i.nome, marca: i.marca || "", qtd: 0, total: 0 };
      ranking[chave].qtd += Number(i.quantidade || 0);
      ranking[chave].total += Number(i.quantidade || 0) * Number(i.valorUnitario || 0);
    });
  });
  const maisVendidos = Object.values(ranking).sort((a, b) => b.qtd - a.qtd || b.total - a.total);
  const receitaMes = listaReceitas().filter((r) => noPeriodo(r.data, "mes")).reduce((s, r) => s + Number(r.valor || 0), 0);
  const despesaMes = (db.despesas || []).filter((d) => noPeriodo(d.data, "mes")).reduce((s, d) => s + Number(d.valor || 0), 0);
  const saldo = saldoConta();
  return `
    <div class="grid grid-4">
      <div class="card stat"><div class="label">Receita do mês</div><div class="value valor-entrada">${formatarMoeda(receitaMes)}</div><div class="hint">${nomeMes}</div></div>
      <div class="card stat"><div class="label">Despesa do mês</div><div class="value valor-saida">${formatarMoeda(despesaMes)}</div><div class="hint">${nomeMes}</div></div>
      <div class="card stat"><div class="label">Resultado do mês</div><div class="value">${formatarMoeda(receitaMes - despesaMes)}</div><div class="hint">receita − despesa</div></div>
      <div class="card stat"><div class="label">Saldo bancário</div><div class="value">${formatarMoeda(saldo)}</div><div class="hint">${esc(contaAtual().nome || "Conta principal")}</div></div>
    </div>
    <section class="card" style="margin-top:14px">
      <h2 class="serif" style="margin:0 0 10px;font-size:20px;color:var(--navy-deep)">Produtos que mais venderam</h2>
      <p class="help">Ranking do mês de ${nomeMes}</p>
      ${maisVendidos.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Produto</th><th>Marca</th><th>Quantidade</th><th>Total</th></tr></thead>
            <tbody>
              ${maisVendidos.map((p, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(p.nome)}</td>
                <td>${esc(p.marca || "—")}</td>
                <td>${p.qtd}</td>
                <td>${formatarMoeda(p.total)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` : `<div class="empty">Ainda não há vendas neste mês.</div>`}
    </section>
  `;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindView() {
  const buscaPagina = document.getElementById("busca-pagina");
  if (buscaPagina) {
    buscaPagina.addEventListener("input", () => {
      const pos = buscaPagina.selectionStart;
      state.busca = buscaPagina.value;
      render();
      const again = document.getElementById("busca-pagina");
      if (again) {
        again.focus();
        const p = Math.min(pos, again.value.length);
        again.setSelectionRange(p, p);
      }
    });
  }
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      state.clienteId = null;
      state.produtoId = null;
      state.vendaClienteId = null;
      state.origem = el.dataset.origem || null;
      setView(el.dataset.go);
    });
  });
  const formDistancia = document.getElementById("form-distancia");
  if (formDistancia) {
    document.querySelectorAll("[data-modo-distancia]").forEach((el) => {
      el.addEventListener("click", () => {
        const d = lerCamposDistancia();
        const modo = el.dataset.modoDistancia;
        if (modo === "cep-endereco" && !String(d.endereco || "").trim() && d.enderecoViaCep) {
          d.endereco = d.enderecoViaCep;
        }
        state.distancia = { ...d, modo };
        render();
      });
    });
    const cepCampo = document.getElementById("dist-cep");
    const statusCep = document.getElementById("dist-cep-status");
    const preview = document.getElementById("dist-endereco-preview");
    const previewWrap = document.getElementById("dist-endereco-preview-wrap");
    const enderecoCampo = document.getElementById("dist-endereco");
    let buscaCepAtual = 0;
    const setStatus = (msg, tipo) => {
      if (!statusCep) return;
      statusCep.textContent = msg;
      statusCep.classList.toggle("ok", tipo === "ok");
      statusCep.classList.toggle("erro", tipo === "erro");
    };
    const mostrarEnderecoCep = (label) => {
      const d = estadoDistancia();
      const anterior = String(d.enderecoViaCep || "").trim();
      state.distancia = { ...d, enderecoViaCep: label || "" };
      if (preview) preview.textContent = label || "";
      if (previewWrap) previewWrap.hidden = !label;
      if (!enderecoCampo) return;
      const atual = enderecoCampo.value.trim();
      if (!label) {
        if (atual && atual === anterior) enderecoCampo.value = "";
        return;
      }
      if (!atual || atual === anterior) enderecoCampo.value = label;
    };
    const preencherEnderecoCep = async () => {
      const digits = soDigitosCep(cepCampo?.value);
      if (digits.length !== 8) {
        mostrarEnderecoCep("");
        setStatus(estadoDistancia().modo === "cep-endereco"
          ? "Digite o CEP para preencher o endereço. Complete com o número."
          : "Digite o CEP para aparecer o endereço.", "");
        return;
      }
      const ordem = ++buscaCepAtual;
      setStatus("Buscando endereço…", "");
      try {
        const data = await buscarViaCep(digits);
        if (ordem !== buscaCepAtual) return;
        if (!data) {
          mostrarEnderecoCep("");
          setStatus("CEP não encontrado. Tente outro CEP ou use o endereço completo.", "erro");
          return;
        }
        mostrarEnderecoCep(data.label);
        setStatus(estadoDistancia().modo === "cep-endereco"
          ? "Endereço preenchido. Complete com o número da casa."
          : "Endereço encontrado. Pode calcular a distância.", "ok");
      } catch {
        if (ordem !== buscaCepAtual) return;
        setStatus("Não foi possível consultar o CEP. Verifique a internet.", "erro");
      }
    };
    cepCampo?.addEventListener("input", () => {
      cepCampo.value = mascaraCep(cepCampo.value);
      if (soDigitosCep(cepCampo.value).length === 8) preencherEnderecoCep();
      else {
        mostrarEnderecoCep("");
        setStatus(estadoDistancia().modo === "cep-endereco"
          ? "Digite o CEP para preencher o endereço. Complete com o número."
          : "Digite o CEP para aparecer o endereço.", "");
      }
    });
    cepCampo?.addEventListener("blur", preencherEnderecoCep);
    if (cepCampo && soDigitosCep(cepCampo.value).length === 8 && !estadoDistancia().enderecoViaCep) {
      preencherEnderecoCep();
    }
    formDistancia.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = lerCamposDistancia();
      const modo = d.modo || "cep";
      const cep = soDigitosCep(d.cep);
      const enderecoDigitado = String(d.endereco || "").trim();
      const enderecoViaCep = String(d.enderecoViaCep || "").trim();
      let endereco = "";
      if (modo === "cep") {
        if (cep.length !== 8) {
          toast("Informe o CEP do cliente");
          return;
        }
        endereco = enderecoViaCep;
      } else if (modo === "cep-endereco") {
        if (cep.length !== 8) {
          toast("Informe o CEP do cliente");
          return;
        }
        if (!enderecoDigitado) {
          toast("Informe o endereço completo além do CEP");
          return;
        }
        endereco = enderecoDigitado;
      } else if (!enderecoDigitado) {
        toast("Informe o endereço completo do cliente");
        return;
      } else {
        endereco = enderecoDigitado;
      }
      state.distancia = {
        ...d,
        modo,
        cep: mascaraCep(cep),
        endereco: enderecoDigitado,
        enderecoViaCep,
        resultado: null
      };
      const caixa = document.getElementById("resultado-distancia");
      if (caixa) caixa.innerHTML = `<div class="card empty"><p>Calculando distância no Google Maps…</p></div>`;
      const qs = new URLSearchParams();
      if (cep.length === 8) qs.set("cep", cep);
      if (endereco) qs.set("endereco", endereco);
      try {
        const res = await fetch(apiUrl() + "/api/distancia?" + qs.toString(), { headers: apiHeaders() });
        const json = await res.json();
        state.distancia.resultado = json;
        destruirMapaDistancia();
        if (caixa) caixa.innerHTML = htmlResultadoDistancia(json);
        mostrarPercursoNoMapa(json);
        if (!json.ok) toast(json.erro || "Não foi possível calcular");
      } catch {
        toast("Não foi possível calcular a distância");
        if (caixa) caixa.innerHTML = htmlResultadoDistancia({ ok: false, erro: "Servidor offline. Tente de novo." });
      }
    });
  }
  document.querySelectorAll("[data-open-cliente]").forEach((el) => {
    el.addEventListener("click", () => setView("cliente-ficha", { clienteId: el.dataset.openCliente }));
  });
  document.querySelectorAll("[data-editar-cliente]").forEach((el) => {
    el.addEventListener("click", () => setView("cliente-form", { clienteId: el.dataset.editarCliente }));
  });
  document.querySelectorAll("[data-nova-venda]").forEach((el) => {
    el.addEventListener("click", () => setView("venda-form", { vendaClienteId: el.dataset.novaVenda }));
  });
  document.querySelectorAll("#conteudo [data-tipo-relatorio]").forEach((el) => {
    el.addEventListener("click", () => {
      state.tipoRelatorio = el.dataset.tipoRelatorio;
      setView("relatorios");
    });
  });
  document.getElementById("relatorio-cliente")?.addEventListener("change", (e) => {
    state.relatorioClienteId = e.target.value || null;
    render();
  });
  document.getElementById("btn-imprimir")?.addEventListener("click", () => window.print());
  document.querySelectorAll("[data-filtro-receita]").forEach((el) => {
    el.addEventListener("click", () => {
      state.filtroReceitas = el.dataset.filtroReceita;
      render();
    });
  });
  document.querySelectorAll("[data-filtro-despesa]").forEach((el) => {
    el.addEventListener("click", () => {
      state.filtroDespesas = el.dataset.filtroDespesa;
      render();
    });
  });
  document.querySelectorAll("[data-filtro]").forEach((el) => {
    el.addEventListener("click", () => {
      state.filtroClientes = el.dataset.filtro;
      render();
    });
  });
  document.querySelectorAll(".tel").forEach((el) => {
    el.addEventListener("input", () => { el.value = mascaraTelefone(el.value); });
  });

  const cepInput = document.getElementById("cep");
  if (cepInput) {
    let buscaCepAtual = 0;
    const statusCep = document.getElementById("cep-status");
    const setStatus = (msg, tipo) => {
      if (!statusCep) return;
      statusCep.textContent = msg;
      statusCep.classList.toggle("ok", tipo === "ok");
      statusCep.classList.toggle("erro", tipo === "erro");
    };
    const preencherEndereco = async () => {
      const digits = cepInput.value.replace(/\D/g, "");
      if (digits.length !== 8) {
        setStatus("Digite o CEP para preencher o endereço.", "");
        return;
      }
      const ordem = ++buscaCepAtual;
      setStatus("Buscando endereço…", "");
      try {
        const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const data = await res.json();
        if (ordem !== buscaCepAtual) return;
        if (data.erro) {
          setStatus("CEP não encontrado. Preencha o endereço manualmente.", "erro");
          return;
        }
        const rua = document.getElementById("rua");
        const bairro = document.getElementById("bairro");
        const cidade = document.getElementById("cidade");
        const numero = document.getElementById("numero");
        if (data.logradouro) rua.value = data.logradouro;
        if (data.bairro) bairro.value = data.bairro;
        if (data.localidade) cidade.value = data.uf ? `${data.localidade} - ${data.uf}` : data.localidade;
        setStatus("Endereço preenchido. Confira e informe o número.", "ok");
        numero.focus();
      } catch {
        if (ordem !== buscaCepAtual) return;
        setStatus("Não foi possível consultar o CEP. Verifique a internet ou preencha na mão.", "erro");
      }
    };
    cepInput.addEventListener("input", () => {
      cepInput.value = mascaraCep(cepInput.value);
      if (cepInput.value.replace(/\D/g, "").length === 8) preencherEndereco();
      else setStatus("Digite o CEP para preencher o endereço.", "");
    });
    cepInput.addEventListener("blur", preencherEndereco);
  }

  const formCliente = document.getElementById("form-cliente");
  if (formCliente) {
    formCliente.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formCliente);
      const registro = {
        id: state.clienteId || uid(),
        nome: d.nome.trim(),
        tipo: d.tipo,
        telefone: mascaraTelefone(d.telefone),
        telefone2: mascaraTelefone(d.telefone2),
        dataCadastro: d.dataCadastro || hojeISO(),
        cep: mascaraCep(d.cep),
        rua: d.rua.trim(),
        numero: d.numero.trim(),
        complemento: d.complemento.trim(),
        bairro: d.bairro.trim(),
        cidade: d.cidade.trim(),
        referencia: d.referencia.trim(),
        diaEntrega: d.diaEntrega.trim(),
        observacoes: d.observacoes.trim(),
        status: d.status
      };
      const idx = db.clientes.findIndex((c) => c.id === registro.id);
      if (idx >= 0) db.clientes[idx] = { ...db.clientes[idx], ...registro };
      else db.clientes.push(registro);
      save(db);
      toast("Cliente salvo com data de cadastro " + formatarData(registro.dataCadastro));
      setView("cliente-ficha", { clienteId: registro.id });
    });
  }

  const formProduto = document.getElementById("form-produto");
  if (formProduto) {
    formProduto.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formProduto);
      const id = state.produtoId || uid();
      const idx = db.produtos.findIndex((p) => p.id === id);
      const atual = idx >= 0 ? db.produtos[idx] : {};
      const registro = {
        ...atual,
        id,
        nome: d.nome.trim(),
        marca: d.marca.trim(),
        unidade: d.unidade,
        preco: Number(d.preco || 0),
        custo: Number(d.custo || 0),
        vasilhame: d.vasilhame === "sim",
        estoque: Number(d.estoque || 0)
      };
      if (idx >= 0) db.produtos[idx] = registro;
      else db.produtos.push(registro);
      save(db);
      toast("Produto salvo");
      setView(state.origem || "produtos");
    });
  }

  const paginaPreco = document.getElementById("pagina-precificacao");
  if (paginaPreco) {
    const valoresCard = (card) => ({
      custo: numCampo(card.querySelector(".preco-custo")?.value),
      freteCompra: numCampo(card.querySelector(".preco-frete-compra")?.value),
      freteEntrega: numCampo(card.querySelector(".preco-frete-entrega")?.value),
      lucroPct: numCampo(card.querySelector(".preco-lucro-pct")?.value),
      preco: numCampo(card.querySelector(".preco-venda")?.value)
    });
    const atualizarCard = (card, recalcularVenda) => {
      const v = valoresCard(card);
      const total = arredondarMoeda(v.custo + v.freteCompra + v.freteEntrega);
      if (recalcularVenda) {
        const venda = total > 0 ? precoPeloLucro(total, v.lucroPct) : 0;
        const campoVenda = card.querySelector(".preco-venda");
        if (campoVenda) campoVenda.value = venda || "";
        v.preco = venda;
      }
      const totalEl = card.querySelector("[data-custo-total]");
      if (totalEl) totalEl.textContent = formatarMoeda(total);
      const resumo = htmlResumoPreco(total, v.preco, v.lucroPct);
      const el = card.querySelector(".preco-resumo");
      if (el) {
        el.textContent = resumo.texto;
        el.className = "preco-resumo " + resumo.classe;
      }
      card.querySelectorAll("[data-lucro]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.lucro) === v.lucroPct);
      });
      const linhas = [...document.querySelectorAll("[data-preco-produto]")].map((c) => {
        const x = valoresCard(c);
        return {
          custo: x.custo,
          custoTotal: arredondarMoeda(x.custo + x.freteCompra + x.freteEntrega),
          venda: x.preco
        };
      });
      const kpis = document.getElementById("preco-kpis");
      if (kpis) kpis.outerHTML = htmlKpisPrecificacao(kpisPrecificacao(linhas));
    };
    paginaPreco.addEventListener("input", (e) => {
      const card = e.target.closest(".preco-card");
      if (!card) return;
      const recalcular = !e.target.classList.contains("preco-venda");
      atualizarCard(card, recalcular);
    });
    paginaPreco.querySelectorAll("[data-lucro]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".preco-card");
        const campo = card?.querySelector(".preco-lucro-pct");
        if (!campo) return;
        campo.value = btn.dataset.lucro;
        atualizarCard(card, true);
      });
    });
    document.getElementById("form-novo-preco")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const card = e.target;
      const nome = String(card.querySelector(".preco-nome")?.value || "").trim();
      const marca = String(card.querySelector(".preco-marca")?.value || "").trim();
      const unidade = String(card.querySelector(".preco-unidade")?.value || "unidade");
      if (!nome || !marca) {
        toast("Informe o produto e a marca");
        return;
      }
      const v = valoresCard(card);
      const total = arredondarMoeda(v.custo + v.freteCompra + v.freteEntrega);
      db.produtos.push({
        id: uid(),
        nome,
        marca,
        unidade,
        custo: v.custo,
        freteCompra: v.freteCompra,
        freteEntrega: v.freteEntrega,
        lucroPct: v.lucroPct,
        preco: v.preco || (total ? precoPeloLucro(total, v.lucroPct) : 0),
        vasilhame: unidade === "galão",
        estoque: 0
      });
      save(db);
      toast("Produto inserido na precificação");
      setView("precificacao");
    });
    document.getElementById("form-precificacao")?.addEventListener("submit", (e) => {
      e.preventDefault();
      document.querySelectorAll("[data-preco-produto]").forEach((card) => {
        const p = db.produtos.find((x) => x.id === card.dataset.precoProduto);
        if (!p) return;
        const v = valoresCard(card);
        const total = arredondarMoeda(v.custo + v.freteCompra + v.freteEntrega);
        p.custo = v.custo;
        p.freteCompra = v.freteCompra;
        p.freteEntrega = v.freteEntrega;
        p.lucroPct = v.lucroPct;
        p.preco = v.preco || (total ? precoPeloLucro(total, v.lucroPct) : 0);
      });
      save(db);
      toast("Precificação salva. O preço de venda vale nas próximas vendas.");
      setView("precificacao");
    });
  }

  document.querySelectorAll("[data-editar-produto]").forEach((el) => {
    el.addEventListener("click", () => setView("produto-form", {
      produtoId: el.dataset.editarProduto,
      origem: el.dataset.origem || "produtos"
    }));
  });
  document.querySelectorAll("[data-entrada]").forEach((el) => {
    el.addEventListener("click", () => {
      const qtd = Number(el.closest(".item")?.querySelector(".entrada-qtd")?.value);
      if (!qtd || qtd < 1) {
        toast("Informe a quantidade de entrada");
        return;
      }
      const p = db.produtos.find((x) => x.id === el.dataset.entrada);
      if (!p) return;
      p.estoque = qtdEstoque(p) + qtd;
      save(db);
      toast(`Entrada de ${qtd}. Estoque atual: ${p.estoque}`);
      setView("estoque");
    });
  });
  document.querySelectorAll("[data-excluir-produto]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!confirm("Excluir este produto?")) return;
      db.produtos = db.produtos.filter((p) => p.id !== el.dataset.excluirProduto);
      save(db);
      toast("Produto excluído");
      setView(state.origem || "produtos");
    });
  });
  document.querySelectorAll("[data-excluir-cliente]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!confirm("Excluir este cliente e o histórico de vendas dele?")) return;
      const vendasRemovidas = db.vendas.filter((v) => v.clienteId === el.dataset.excluirCliente).map((v) => v.id);
      db.clientes = db.clientes.filter((c) => c.id !== el.dataset.excluirCliente);
      db.vendas = db.vendas.filter((v) => v.clienteId !== el.dataset.excluirCliente);
      db.lancamentos = db.lancamentos.filter((l) => !vendasRemovidas.includes(l.vendaId));
      save(db);
      toast("Cliente excluído");
      setView("clientes");
    });
  });

  const itens = document.getElementById("itens-venda");
  if (itens) {
    const atualizarTotal = () => {
      let total = 0;
      itens.querySelectorAll("[data-produto]").forEach((row) => {
        const qtd = Number(row.querySelector("[data-qtd]").textContent);
        total += qtd * Number(row.dataset.preco);
      });
      document.getElementById("total-venda").textContent = formatarMoeda(total);
    };
    itens.querySelectorAll("[data-mais], [data-menos]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hold = btn.closest("[data-produto]").querySelector("[data-qtd]");
        let n = Number(hold.textContent);
        n = btn.hasAttribute("data-mais") ? n + 1 : Math.max(0, n - 1);
        hold.textContent = n;
        atualizarTotal();
      });
    });
  }

  const formVenda = document.getElementById("form-venda");
  if (formVenda) {
    formVenda.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formVenda);
      const itensVenda = [];
      document.querySelectorAll("#itens-venda [data-produto]").forEach((row) => {
        const quantidade = Number(row.querySelector("[data-qtd]").textContent);
        if (!quantidade) return;
        itensVenda.push({
          produtoId: row.dataset.produto,
          nome: row.dataset.nome,
          marca: row.dataset.marca,
          quantidade,
          valorUnitario: Number(row.dataset.preco),
          vasilhame: row.dataset.vasilhame === "1"
        });
      });
      if (!itensVenda.length) {
        toast("Escolha pelo menos um produto");
        return;
      }
      const faltando = itensVenda.filter((i) => {
        const p = db.produtos.find((x) => x.id === i.produtoId);
        return qtdEstoque(p) < i.quantidade;
      });
      if (faltando.length) {
        const nomes = faltando.map((i) => i.nome).join(", ");
        if (!confirm(`Estoque insuficiente em: ${nomes}. Deseja vender mesmo assim?`)) return;
      }
      const total = itensVenda.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
      db.vendas.push({
        id: uid(),
        clienteId: d.clienteId,
        data: d.data || hojeISO(),
        pagamento: d.pagamento,
        entreguePor: d.entreguePor.trim(),
        vasilhamesRecolhidos: Number(d.vasilhamesRecolhidos || 0),
        observacao: d.observacao.trim(),
        itens: itensVenda,
        total
      });
      const venda = db.vendas[db.vendas.length - 1];
      baixarEstoque(itensVenda);
      criarLancamentoVenda(venda);
      save(db);
      toast("Venda salva, estoque e caixa atualizados");
      setView("cliente-ficha", { clienteId: d.clienteId });
    });
  }

  const formReceita = document.getElementById("form-receita");
  if (formReceita) {
    formReceita.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formReceita);
      const receita = {
        id: uid(),
        data: d.data || hojeISO(),
        valor: Number(d.valor || 0),
        forma: d.forma,
        descricao: d.descricao.trim(),
        origem: "manual"
      };
      db.receitas.push(receita);
      registrarLancamentoFinanceiro({
        tipo: "entrada",
        valor: receita.valor,
        data: receita.data,
        descricao: receita.descricao,
        forma: receita.forma,
        receitaId: receita.id
      });
      save(db);
      toast("Receita lançada no caixa");
      setView("receitas");
    });
  }

  const formDespesa = document.getElementById("form-despesa");
  if (formDespesa) {
    formDespesa.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formDespesa);
      const despesa = {
        id: uid(),
        data: d.data || hojeISO(),
        valor: Number(d.valor || 0),
        categoria: d.categoria,
        tipo: d.tipo,
        descricao: d.descricao.trim()
      };
      db.despesas.push(despesa);
      registrarLancamentoFinanceiro({
        tipo: "saida",
        valor: despesa.valor,
        data: despesa.data,
        descricao: `${labelCategoria(despesa.categoria)} — ${despesa.descricao}`,
        forma: "outro",
        despesaId: despesa.id
      });
      save(db);
      toast("Despesa lançada no caixa");
      setView("despesas");
    });
  }

  document.querySelectorAll("[data-excluir-receita]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!confirm("Excluir esta receita?")) return;
      db.receitas = db.receitas.filter((r) => r.id !== el.dataset.excluirReceita);
      db.lancamentos = db.lancamentos.filter((l) => l.receitaId !== el.dataset.excluirReceita);
      save(db);
      toast("Receita excluída");
      setView("receitas");
    });
  });
  document.querySelectorAll("[data-excluir-despesa]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!confirm("Excluir esta despesa?")) return;
      db.despesas = db.despesas.filter((x) => x.id !== el.dataset.excluirDespesa);
      db.lancamentos = db.lancamentos.filter((l) => l.despesaId !== el.dataset.excluirDespesa);
      save(db);
      toast("Despesa excluída");
      setView("despesas");
    });
  });

  const formConta = document.getElementById("form-conta");
  if (formConta) {
    formConta.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formConta);
      const conta = contaAtual();
      Object.assign(conta, {
        nome: d.nome.trim(),
        banco: d.banco.trim(),
        tipo: d.tipo,
        agencia: d.agencia.trim(),
        conta: d.conta.trim(),
        chavePix: d.chavePix.trim(),
        saldoInicial: Number(d.saldoInicial || 0)
      });
      save(db);
      toast("Dados da conta salvos");
      setView("banco");
    });
  }

  const formLancamento = document.getElementById("form-lancamento");
  if (formLancamento) {
    formLancamento.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = formData(formLancamento);
      db.lancamentos.push({
        id: uid(),
        contaId: contaAtual().id,
        data: d.data || hojeISO(),
        tipo: d.tipo,
        valor: Number(d.valor || 0),
        descricao: d.descricao.trim(),
        forma: d.forma,
        origem: "manual",
        statusExtrato: "pendente"
      });
      save(db);
      toast(d.tipo === "saida" ? "Saída lançada no caixa" : "Entrada lançada no caixa");
      setView("banco");
    });
  }

  document.querySelectorAll("[data-excluir-lancamento]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!confirm("Excluir este lançamento?")) return;
      db.lancamentos = db.lancamentos.filter((l) => l.id !== el.dataset.excluirLancamento);
      save(db);
      toast("Lançamento excluído");
      setView("banco");
    });
  });

  document.getElementById("btn-exportar")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rei-dagua-backup-${hojeISO()}.json`;
    a.click();
  });
  document.getElementById("btn-importar")?.addEventListener("click", () => {
    document.getElementById("file-import").click();
  });
  document.getElementById("file-import")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.clientes || !data.produtos || !data.vendas) throw new Error("arquivo inválido");
        garantirBanco(data);
        db = data;
        save(db);
        toast("Dados importados");
        render();
      } catch {
        toast("Não foi possível importar este arquivo");
      }
    };
    reader.readAsText(file);
  });
  if (state.view === "distancia") {
    mostrarPercursoNoMapa(estadoDistancia().resultado);
  }
}

function init() {
  document.querySelectorAll(".novo-tag").forEach((el) => el.remove());
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.clienteId = null;
      state.produtoId = null;
      state.vendaClienteId = null;
      state.origem = null;
      state.filtroClientes = "todos";
      if (btn.dataset.tipoRelatorio) state.tipoRelatorio = btn.dataset.tipoRelatorio;
      setView(btn.dataset.view);
    });
  });
  document.getElementById("btn-relatorios-toggle")?.addEventListener("click", () => {
    const grupo = document.getElementById("grupo-relatorios");
    const aberto = grupo.classList.toggle("open");
    document.getElementById("btn-relatorios-toggle").setAttribute("aria-expanded", aberto ? "true" : "false");
  });
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("overlay").classList.toggle("show");
  });
  document.getElementById("overlay").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("overlay").classList.remove("show");
  });
  document.getElementById("form-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const senha = document.getElementById("login-senha").value;
    const hash = await hashSenha(senha);
    if (hash !== ADMIN_HASH) {
      document.getElementById("login-erro").textContent = "Senha incorreta.";
      return;
    }
    localStorage.setItem(ADMIN_KEY, "1");
    sessionStorage.removeItem(ADMIN_KEY);
    fecharLogin();
    atualizarAcessoAdmin();
    setView(state.pendenteView || "inicio", state.pendenteExtra || {});
  });
  document.getElementById("login-cancelar")?.addEventListener("click", fecharLogin);
  document.getElementById("btn-sair-admin")?.addEventListener("click", () => {
    localStorage.removeItem(ADMIN_KEY);
    sessionStorage.removeItem(ADMIN_KEY);
    atualizarAcessoAdmin();
    toast("Saiu do modo administrador");
    setView("clientes");
  });
  atualizarAcessoAdmin();
  setView("clientes");
}

async function iniciar() {
  db = await carregar();
  if (limparProdutosFicticios(db)) save(db);
  init();
}

iniciar();
