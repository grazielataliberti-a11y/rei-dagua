const { createServer } = require("node:http");
const { mkdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = join(__dirname, "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new DatabaseSync(join(DATA_DIR, "reidagua.db"));
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS store (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const vazio = {
  clientes: [],
  produtos: [],
  vendas: [],
  contas: [],
  lancamentos: [],
  receitas: [],
  despesas: []
};

function lerDados() {
  const row = sqlite.prepare("SELECT payload FROM store WHERE id = 'main'").get();
  if (!row) return { ...vazio };
  try {
    return JSON.parse(row.payload);
  } catch {
    return { ...vazio };
  }
}

function gravarDados(dados) {
  const payload = JSON.stringify(dados);
  const agora = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO store (id, payload, updated_at)
    VALUES ('main', ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(payload, agora);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function enviar(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/saude") {
    enviar(res, 200, { ok: true, servico: "Rei D'Água" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/dados") {
    enviar(res, 200, lerDados());
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/dados") {
    let bruto = "";
    req.on("data", (parte) => {
      bruto += parte;
      if (bruto.length > 6_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const dados = JSON.parse(bruto || "{}");
        gravarDados({
          clientes: dados.clientes || [],
          produtos: dados.produtos || [],
          vendas: dados.vendas || [],
          contas: dados.contas || [],
          lancamentos: dados.lancamentos || [],
          receitas: dados.receitas || [],
          despesas: dados.despesas || []
        });
        enviar(res, 200, { ok: true });
      } catch {
        enviar(res, 400, { ok: false, erro: "JSON inválido" });
      }
    });
    return;
  }

  enviar(res, 404, { ok: false, erro: "Não encontrado" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Banco Rei D'Água no ar em http://localhost:${PORT}`);
});
