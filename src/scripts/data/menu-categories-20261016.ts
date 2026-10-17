import type { MenuCategory } from "../menu-categories-core"

// Storefront menu approved by Adriano (sketch + audio, 16 October 2026) and adjusted by Saulo
// the same evening (Airguns by brand; no PTS; Dots and Lunetas together); on 17 Oct Armas Airsoft got its three sub-items back. Order = menu order.
// `reuse` renames an existing category so the products already in it stay in place.
export const menuCategories: MenuCategory[] = [
  {
    handle: "armas-airsoft", name: "Armas Airsoft", reuse: "airsoft",
    children: [
      { handle: "pistolas-gbb-co2", name: "Pistolas GBB / CO2" },
      { handle: "rifles-eletricos-gbbr", name: "Rifles Elétricos / GBBR" },
      { handle: "sniper-shotgun", name: "Sniper / Shotgun" },
    ],
  },
  {
    handle: "airguns-carabinas", name: "Airguns e Carabinas", reuse: "pressao",
    children: [
      { handle: "airguns-rossi", name: "Rossi" },
      { handle: "airguns-specna-arms", name: "Specna Arms" },
    ],
  },
  {
    handle: "suprimentos", name: "Suprimentos",
    children: [
      { handle: "bbs", name: "BBs" },
      { handle: "gas", name: "Gás" },
      { handle: "baterias", name: "Baterias" },
      { handle: "carregadores", name: "Carregadores" },
      { handle: "speedloaders", name: "Speedloaders" },
    ],
  },
  {
    handle: "pecas", name: "Peças",
    children: [
      { handle: "buckings-engrenagens", name: "Buckings e Engrenagens" },
      { handle: "gearbox-hop-ups", name: "Gearbox e Hop-ups" },
      { handle: "motores", name: "Motores" },
      { handle: "canos-molas", name: "Canos e Molas" },
    ],
  },
  {
    handle: "loadout", name: "Loadout",
    children: [
      { handle: "coletes-modulares", name: "Coletes Modulares" },
      { handle: "capacetes", name: "Capacetes" },
      { handle: "mascaras", name: "Máscaras" },
      { handle: "oculos", name: "Óculos" },
      { handle: "luvas-shemagh", name: "Luvas e Shemagh" },
      { handle: "coldres", name: "Coldres" },
      { handle: "cintos", name: "Cinto" },
      { handle: "mochilas", name: "Mochilas" },
      { handle: "maletas", name: "Maletas" },
    ],
  },
  {
    handle: "acessorios", name: "Acessórios", reuse: "acessorios",
    children: [
      { handle: "dots", name: "Dots / Lunetas" },
      { handle: "lanternas-laser", name: "Lanternas e Laser" },
      { handle: "stock-coronha", name: "Stock / Coronha" },
      { handle: "hand-guard", name: "Hand Guard" },
      { handle: "bipes-grips-trilhos", name: "Bipés, Grips e Trilhos" },
      { handle: "supressores-porquinho-flash-hider", name: "Supressores, Porquinho e Flash Hider" },
      { handle: "tracer", name: "Tracer" },
    ],
  },
  {
    handle: "magazines", name: "Magazines",
    children: [
      { handle: "magazines-rossi", name: "Rossi" },
      { handle: "magazines-specna-arms", name: "Specna Arms" },
    ],
  },
]

// Categories hidden by the switch; their products stay purchasable through search.
export const retiredCategoryHandles = ["cutelaria"]

// First matching rule suggests the sub-item for a product title. Only a suggestion:
// the reviewed spreadsheet decides what `assign` writes.
export const suggestionRules: Array<{ pattern: RegExp; handle: string }> = [
  { pattern: /coldre/i, handle: "coldres" },
  { pattern: /\bmagazine|mid-?cap|hi-?cap|\bdrum\b/i, handle: "magazines" },
  { pattern: /bateria.*(carregador|balanceador)|carregador.*bateria|balanceador/i, handle: "carregadores" },
  { pattern: /speed ?loader/i, handle: "speedloaders" },
  { pattern: /\bbb'?s?\b|esferas? pl[áa]stic/i, handle: "bbs" },
  { pattern: /green ?g[áa]s|\bg[áa]s\b|co2/i, handle: "gas" },
  { pattern: /bateria|lipo/i, handle: "baterias" },
  { pattern: /bucking|engrenage/i, handle: "buckings-engrenagens" },
  { pattern: /gearbox|hop-?up/i, handle: "gearbox-hop-ups" },
  { pattern: /\bmotor/i, handle: "motores" },
  { pattern: /\bcano\b|\bmola\b/i, handle: "canos-molas" },
  { pattern: /colete|plate carrier/i, handle: "coletes-modulares" },
  { pattern: /capacete/i, handle: "capacetes" },
  { pattern: /m[áa]scara/i, handle: "mascaras" },
  { pattern: /[óo]culos/i, handle: "oculos" },
  { pattern: /luva|shemagh|balaclava/i, handle: "luvas-shemagh" },
  { pattern: /\bcinto|cintur[ãa]o/i, handle: "cintos" },
  { pattern: /mochila/i, handle: "mochilas" },
  { pattern: /maleta/i, handle: "maletas" },
  { pattern: /red ?dot|hologr[áa]fica|\bdot\b/i, handle: "dots" },
  { pattern: /luneta|\blpvo\b/i, handle: "dots" },
  { pattern: /lanterna|laser/i, handle: "lanternas-laser" },
  { pattern: /\bstock\b|coronha/i, handle: "stock-coronha" },
  { pattern: /hand ?guard/i, handle: "hand-guard" },
  { pattern: /bip[ée]|\bgrip|trilho|\bmount\b|bandoleira/i, handle: "bipes-grips-trilhos" },
  { pattern: /supressor|silenciador|porquinho|flash ?hider/i, handle: "supressores-porquinho-flash-hider" },
  { pattern: /\btracer\b(?!.*\bbb)/i, handle: "tracer" },
  { pattern: /pistola/i, handle: "pistolas-gbb-co2" },
  { pattern: /\brifle|\baeg\b|gbbr|\bm4\b|\bak\b/i, handle: "rifles-eletricos-gbbr" },
  { pattern: /sniper|shotgun|escopeta/i, handle: "sniper-shotgun" },
  { pattern: /carabina|airgun|chumbinho/i, handle: "airguns-carabinas" },
]

// Magazines go to the brand sub-item when the title names it.
export const magazineBrandRules: Array<{ pattern: RegExp; handle: string }> = [
  { pattern: /rossi/i, handle: "magazines-rossi" },
  { pattern: /specna/i, handle: "magazines-specna-arms" },
]
