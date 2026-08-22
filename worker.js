const SITE = "https://grazielataliberti-a11y.github.io/rei-dagua/";
const ORIGEM_SITE = "https://grazielataliberti-a11y.github.io";
const ORIGENS_OK = new Set([
  ORIGEM_SITE,
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const VAZIO = JSON.stringify({
  clientes: [],
  produtos: [],
  vendas: [],
  contas: [],
  lancamentos: [],
  receitas: [],
  despesas: []
});

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ORIGENS_OK.has(origin) ? origin : ORIGEM_SITE;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-ReiDagua-Chave",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function autorizado(request, env) {
  const esperada = String(env.API_CHAVE || "");
  if (!esperada) return false;
  const enviada = request.headers.get("X-ReiDagua-Chave") || "";
  return enviada === esperada;
}

function json(body, status, request) {
  return Response.json(body, { status, headers: cors(request) });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(SITE, 302);
    }

    if (url.pathname === "/api/saude") {
      return json({ ok: true, servico: "Rei D'Água" }, 200, request);
    }

    if (url.pathname === "/api/dados" && (request.method === "GET" || request.method === "PUT")) {
      if (!autorizado(request, env)) {
        return json({ ok: false }, 401, request);
      }
      if (request.method === "GET") {
        const dados = (await env.DADOS.get("main")) || VAZIO;
        return new Response(dados, {
          headers: { ...cors(request), "Content-Type": "application/json; charset=utf-8" }
        });
      }
      try {
        const texto = await request.text();
        JSON.parse(texto);
        await env.DADOS.put("main", texto);
        return json({ ok: true }, 200, request);
      } catch {
        return json({ ok: false }, 400, request);
      }
    }

    return json({ ok: false }, 404, request);
  }
};
