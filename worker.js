const VAZIO = JSON.stringify({
  clientes: [],
  produtos: [],
  vendas: [],
  contas: [],
  lancamentos: [],
  receitas: [],
  despesas: []
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/saude") {
      return Response.json({ ok: true, servico: "Rei D'Água" }, { headers: CORS });
    }
    if (url.pathname === "/api/dados" && request.method === "GET") {
      const dados = (await env.DADOS.get("main")) || VAZIO;
      return new Response(dados, {
        headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
      });
    }
    if (url.pathname === "/api/dados" && request.method === "PUT") {
      const texto = await request.text();
      JSON.parse(texto);
      await env.DADOS.put("main", texto);
      return Response.json({ ok: true }, { headers: CORS });
    }
    return Response.json({ ok: false }, { status: 404, headers: CORS });
  }
};
