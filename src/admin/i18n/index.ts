// Sobrescreve textos do painel admin com a marca Bunker 81. O dashboard mescla estas
// traduções por cima das originais (deepMerge), então só as chaves listadas mudam.
import ptBR from "./json/ptBR.json" with { type: "json" }
import en from "./json/en.json" with { type: "json" }

export default {
  ptBR: {
    translation: ptBR,
  },
  en: {
    translation: en,
  },
}
