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

const LOJA = {
  cep: "09751120",
  endereco: "Rua Itapeva, 158, Baeta Neves, São Bernardo do Campo - SP",
  lat: -23.6859695,
  lng: -46.5444094
};
const LIMITE_KM = 5;
const UA = { "User-Agent": "ReiDagua/1.0 (distribuidora)" };

function soCep(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 8);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function viaCep(cep) {
  const res = await fetch("https://viacep.com.br/ws/" + cep + "/json/");
  if (!res.ok) return null;
  const j = await res.json();
  if (j.erro) return null;
  const partes = [j.logradouro, j.bairro, j.localidade, j.uf].filter(Boolean);
  return {
    label: partes.join(", "),
    query: [...partes, "Brasil"].join(", ")
  };
}

async function geocodeNominatim(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr?.[0]) return null;
  return {
    lat: Number(arr[0].lat),
    lng: Number(arr[0].lon),
    label: arr[0].display_name
  };
}

async function geocodeGoogle(env, q) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?language=pt-BR&region=br&address=" +
    encodeURIComponent(q) +
    "&key=" +
    encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const r = j.results?.[0];
  if (!r) return null;
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    label: r.formatted_address
  };
}

async function distanciaGoogle(env, origem, dest) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&language=pt-BR&mode=driving&origins=" +
    encodeURIComponent(origem.lat + "," + origem.lng) +
    "&destinations=" +
    encodeURIComponent(dest.lat + "," + dest.lng) +
    "&key=" +
    encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const el = j.rows?.[0]?.elements?.[0];
  if (el?.status !== "OK" || el.distance?.value == null) return null;
  return el.distance.value / 1000;
}

async function distanciaOsrm(origem, dest) {
  const pontos = origem.lng + "," + origem.lat + ";" + dest.lng + "," + dest.lat;
  const urls = [
    "https://router.project-osrm.org/route/v1/driving/" + pontos + "?overview=false",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/" + pontos + "?overview=false"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) continue;
      const j = await res.json();
      const m = j.routes?.[0]?.distance;
      if (m != null) return m / 1000;
    } catch {
      /* tenta o próximo servidor */
    }
  }
  return null;
}

async function localizar(env, cep, endereco) {
  const texto = [endereco, cep ? "CEP " + cep : ""].filter(Boolean).join(", ");
  const g = await geocodeGoogle(env, texto || cep);
  if (g?.lat) return g;
  if (endereco) {
    const n = await geocodeNominatim(endereco + (cep ? ", " + cep : "") + ", Brasil");
    if (n?.lat) return n;
  }
  if (cep) {
    const via = await viaCep(cep);
    if (via?.query) {
      const n = await geocodeNominatim(via.query);
      if (n?.lat) return { ...n, label: via.label };
    }
  }
  return null;
}

async function origemLoja(env) {
  const g = await geocodeGoogle(env, LOJA.endereco);
  if (g?.lat) return { ...g, cep: LOJA.cep };
  return { lat: LOJA.lat, lng: LOJA.lng, label: LOJA.endereco, cep: LOJA.cep };
}

async function calcularDistancia(env, cep, endereco) {
  const dest = await localizar(env, cep, endereco);
  if (!dest?.lat) {
    return { ok: false, erro: "Nao foi possivel localizar este CEP ou endereco." };
  }
  const origem = await origemLoja(env);
  const linha = haversineKm(origem.lat, origem.lng, dest.lat, dest.lng);
  let km = await distanciaGoogle(env, origem, dest);
  let fonte = "google";
  if (km == null) {
    km = await distanciaOsrm(origem, dest);
    fonte = km == null ? "linha" : "rota";
  }
  if (km == null) km = linha;
  km = Math.round(km * 10) / 10;
  return {
    ok: true,
    km,
    kmLinha: Math.round(linha * 10) / 10,
    atende: km <= LIMITE_KM,
    limiteKm: LIMITE_KM,
    origem,
    destino: dest,
    fonte
  };
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

    if (url.pathname === "/api/distancia" && request.method === "GET") {
      const cep = soCep(url.searchParams.get("cep"));
      const endereco = String(url.searchParams.get("endereco") || "").trim();
      if (cep.length !== 8 && !endereco) {
        return json({ ok: false, erro: "Informe o CEP ou o endereco do cliente." }, 400, request);
      }
      try {
        const resultado = await calcularDistancia(env, cep.length === 8 ? cep : "", endereco);
        return json(resultado, resultado.ok ? 200 : 404, request);
      } catch {
        return json({ ok: false, erro: "Nao foi possivel calcular a distancia agora." }, 500, request);
      }
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
