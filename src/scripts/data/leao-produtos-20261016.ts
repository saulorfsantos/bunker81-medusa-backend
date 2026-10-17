import type { ImportProduct } from "../catalog-import-core"

// Products from the Leão reseller catalogue "Squadrão BR" (October 2026, promotional prices
// valid for the month). `cost` is the reseller price per unit; the store price is cost + 40%
// (Saulo, 16 Oct 2026). Items without a printed price, sold out, already in the store or
// outside the menu (camping, slingshot) were left out. No stock: they show as unavailable.
export const leaoProducts: ImportProduct[] = [
  // Armas Airsoft > Sniper / Shotgun — page 3
  {
    handle: "sniper-airsoft-m40-sa-s02-core-multicam-specna-arms", sku: "SA-S02-MC", cost: 899,
    title: "Sniper de Airsoft M40 SA-S02 Core S-Series Multicam Specna Arms", brand: "Specna Arms",
    category_handle: "sniper-shotgun", source: "Leão Squadrão BR, p. 3",
    description: "Sniper de airsoft M40 da linha Core S-Series da Specna Arms, acabamento Multicam. Acompanha 3 magazines.",
  },
  {
    handle: "sniper-airsoft-m40-a5-sa-s03-core-multicam-specna-arms", sku: "SA-S03-MC", cost: 1049,
    title: "Sniper de Airsoft M40 A5 SA-S03 Core S-Series Multicam Specna Arms", brand: "Specna Arms",
    category_handle: "sniper-shotgun", source: "Leão Squadrão BR, p. 3",
    description: "Sniper de airsoft M40 A5 da linha Core S-Series da Specna Arms, acabamento Multicam. Acompanha 3 magazines.",
  },
  {
    handle: "sniper-airsoft-m40-a5-sa-s03-core-tan-specna-arms", sku: "SA-S03-TAN", cost: 779,
    title: "Sniper de Airsoft M40 A5 SA-S03 Core S-Series Tan Specna Arms", brand: "Specna Arms",
    category_handle: "sniper-shotgun", source: "Leão Squadrão BR, p. 3",
    description: "Sniper de airsoft M40 A5 da linha Core S-Series da Specna Arms, acabamento Tan. Acompanha 3 magazines.",
  },
  {
    handle: "sniper-airsoft-m40-a5-sa-s03-core-verde-oliva-specna-arms", sku: "SA-S03-OLV", cost: 779,
    title: "Sniper de Airsoft M40 A5 SA-S03 Core S-Series Verde Oliva Specna Arms", brand: "Specna Arms",
    category_handle: "sniper-shotgun", source: "Leão Squadrão BR, p. 3",
    description: "Sniper de airsoft M40 A5 da linha Core S-Series da Specna Arms, acabamento verde oliva. Acompanha 3 magazines.",
  },
  // Armas Airsoft — page 28
  {
    handle: "kit-pistola-airsoft-beretta-92-fs-leao", sku: "BNK-KIT-B92FS", cost: 399,
    title: "Kit Pistola de Airsoft Beretta 92 FS (2 pistolas + alvo + BBs + maletas)", brand: "Leão",
    category_handle: "armas-airsoft", source: "Leão Squadrão BR, p. 28",
    description: "Kit com 2 pistolas de airsoft Beretta 92 FS de mola (260 FPS, capacidade para 12 BBs), 2 potes de 500 BBs 6 mm, 1 alvo de gel e 2 maletas Leão Slim.",
  },
  // Acessórios > Dots / Lunetas — page 14 (LEAO1544 sold out, no price)
  {
    handle: "mount-absorcao-11mm-luneta-25mm-warmmo", sku: "LEAO1541", cost: 100.42,
    title: "Mount com Absorção 11mm para Luneta 25mm Warmmo", brand: "Warmmo",
    category_handle: "dots", source: "Leão Squadrão BR, p. 14",
    description: "Mount com absorção de recuo para luneta de diâmetro 25 mm, para trilho de 11 mm.",
  },
  {
    handle: "mount-absorcao-22mm-luneta-25mm-warmmo", sku: "LEAO1542", cost: 100.42,
    title: "Mount com Absorção 22mm para Luneta 25mm Warmmo", brand: "Warmmo",
    category_handle: "dots", source: "Leão Squadrão BR, p. 14",
    description: "Mount com absorção de recuo para luneta de diâmetro 25 mm, para trilho de 22 mm.",
  },
  {
    handle: "mount-fixo-luneta-25mm-trilho-11mm-warmmo", sku: "LEAO1543", cost: 27.99,
    title: "Mount Fixo para Luneta 25mm Trilho 11mm Warmmo", brand: "Warmmo",
    category_handle: "dots", source: "Leão Squadrão BR, p. 14",
    description: "Mount único fixo para luneta de diâmetro 25 mm, para trilho de 11 mm.",
  },
  {
    handle: "mount-alto-luneta-25mm-trilho-11mm-warmmo", sku: "LEAO1545", cost: 19.21,
    title: "Mount Alto para Luneta 25mm Trilho 11mm Warmmo", brand: "Warmmo",
    category_handle: "dots", source: "Leão Squadrão BR, p. 14",
    description: "Mount alto para luneta de diâmetro 25 mm, para trilho de 11 mm.",
  },
  // Acessórios > Bipés, Grips e Trilhos — page 15
  {
    handle: "zarelho-coronha-duplo-engate-rapido-qd-warmmo", sku: "LEAO1546", cost: 37.28,
    title: "Zarelho de Coronha Duplo com Engate Rápido QD Warmmo", brand: "Warmmo",
    category_handle: "bipes-grips-trilhos", source: "Leão Squadrão BR, p. 15",
    description: "Zarelho duplo de coronha com engate rápido QD para bandoleira.",
  },
  {
    handle: "zarelho-qd-22mm-trilho-handguard-warmmo", sku: "LEAO1547", cost: 14.18,
    title: "Zarelho QD 22mm para Trilho do Handguard Warmmo", brand: "Warmmo",
    category_handle: "bipes-grips-trilhos", source: "Leão Squadrão BR, p. 15",
    description: "Zarelho QD de 22 mm para fixação no trilho do handguard.",
  },
  {
    handle: "zarelho-tradicional-bandoleira-warmmo", sku: "LEAO1548", cost: 27.83,
    title: "Zarelho Tradicional para Bandoleira Warmmo", brand: "Warmmo",
    category_handle: "bipes-grips-trilhos", source: "Leão Squadrão BR, p. 15",
    description: "Zarelho tradicional para bandoleira.",
  },
  {
    handle: "zarelho-engate-rapido-bandoleira-warmmo", sku: "LEAO1549", cost: 6.83,
    title: "Zarelho de Engate Rápido para Bandoleira Warmmo", brand: "Warmmo",
    category_handle: "bipes-grips-trilhos", source: "Leão Squadrão BR, p. 15",
    description: "Zarelho de engate rápido para bandoleira.",
  },
  {
    handle: "zarelho-m-lok-giro-360-qd-warmmo", sku: "LEAO1550", cost: 17.33,
    title: "Zarelho M-LOK Giro 360 com Botão QD Warmmo", brand: "Warmmo",
    category_handle: "bipes-grips-trilhos", source: "Leão Squadrão BR, p. 15",
    description: "Zarelho M-LOK com giro de 360° e botão de liberação rápida QD.",
  },
  {
    handle: "zarelho-trilho-22mm-engate-rapido-qd-warmmo", sku: "LEAO1551", cost: 16.28,
    title: "Zarelho para Trilho 22mm com Engate Rápido QD Warmmo", brand: "Warmmo",
    category_handle: "bipes-grips-trilhos", source: "Leão Squadrão BR, p. 15",
    description: "Zarelho para trilho de 22 mm com engate rápido QD.",
  },
  // Suprimentos — pages 18, 19 and 23
  {
    handle: "oleo-silicone-airsoft-10ml-leao", sku: "LEAO1192", cost: 5.11,
    title: "Óleo de Silicone para Airsoft 10ml Leão", brand: "Leão",
    category_handle: "suprimentos", source: "Leão Squadrão BR, p. 18",
    description: "Óleo 100% silicone para lubrificação de pistolas e rifles de airsoft. Frasco de 10 ml.",
  },
  {
    handle: "carregador-bateria-leao-l3-pro-3a-25w", sku: "LEAO1130", cost: 131.25,
    title: "Carregador de Bateria Leão L3 Pro 3A 25W LiPo/NiMH/LiFe", brand: "Leão",
    category_handle: "carregadores", source: "Leão Squadrão BR, p. 19",
    description: "Carregador e balanceador para baterias LiPo, LiFe e NiMH. Corrente de 3 A, potência máxima de 25 W, bivolt.",
  },
  {
    handle: "carregador-bateria-leao-l3-lipo-2s-3s", sku: "LEAO1118", cost: 45.89,
    title: "Carregador de Bateria Leão L3 LiPo 2S/3S", brand: "Leão",
    category_handle: "carregadores", source: "Leão Squadrão BR, p. 19",
    description: "Carregador e balanceador para baterias LiPo 2S e 3S. Corrente de 850 mA, potência máxima de 10 W, bivolt.",
  },
  {
    handle: "cilindro-co2-16g-com-rosca-leao", sku: "LEAO1528", cost: 4,
    title: "Cilindro de CO2 16g com Rosca Leão", brand: "Leão",
    category_handle: "gas", source: "Leão Squadrão BR, p. 23",
    description: "Cilindro de CO2 100% puro de 16 g, com rosca, encaixe 3/8\".",
  },
  {
    handle: "cilindro-co2-16g-sem-rosca-leao", sku: "LEAO1530", cost: 4,
    title: "Cilindro de CO2 16g sem Rosca Leão", brand: "Leão",
    category_handle: "gas", source: "Leão Squadrão BR, p. 23",
    description: "Cilindro de CO2 100% puro de 16 g, sem rosca, encaixe 3/8\".",
  },
  // Airguns e Carabinas (steel BBs and PCP) — pages 16, 24–27
  {
    handle: "esfera-aco-niquelada-4-5mm-pote-300un-leao", sku: "LEAO1135", cost: 9.6,
    title: "Esfera de Aço Niquelada 4,5mm Pote com 300 Leão", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 24",
    description: "Esferas de aço niqueladas de 4,5 mm para armas de pressão. Pote com 300 unidades. Não usar em armas de airsoft.",
  },
  {
    handle: "esfera-aco-niquelada-4-5mm-pacote-1000un-leao", sku: "LEAO1443", cost: 12,
    title: "Esfera de Aço Niquelada 4,5mm Pacote com 1000 Leão", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 16",
    description: "Esferas de aço niqueladas de 4,5 mm para armas de pressão. Pacote com 1000 unidades. Não usar em armas de airsoft.",
  },
  {
    handle: "esfera-aco-niquelada-6mm-pote-100un-leao", sku: "LEAO1265", cost: 9.6,
    title: "Esfera de Aço Niquelada 6mm Pote com 100 Leão", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 25",
    description: "Esferas de aço niqueladas de 6 mm para armas de pressão. Pote com 100 unidades. Não usar em armas de airsoft.",
  },
  {
    handle: "esfera-aco-niquelada-6mm-pacote-500un-leao", sku: "LEAO1444", cost: 20.19,
    title: "Esfera de Aço Niquelada 6mm Pacote com 500 Leão", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 26",
    description: "Esferas de aço niqueladas de 6 mm para armas de pressão. Pacote com 500 unidades. Não usar em armas de airsoft.",
  },
  {
    handle: "esfera-aco-niquelada-6mm-pote-650un-leao", sku: "LEAO1371", cost: 29.95,
    title: "Esfera de Aço Niquelada 6mm Pote com 650 Leão", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 26",
    description: "Esferas de aço niqueladas de 6 mm para armas de pressão. Pote com 650 unidades. Não usar em armas de airsoft.",
  },
  {
    handle: "cilindro-scuba-6-8l-fibra-carbono-estacao-recarga-pcp", sku: "BNK-SCUBA-6.8L", cost: 1627.3,
    title: "Cilindro Scuba 6,8L Fibra de Carbono + Estação de Recarga PCP", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 27",
    description: "Kit com cilindro scuba de alumínio com fibra de carbono de 6,8 L (PCP 300 bar, rosca M18 x 1,5) e estação de recarga PCP com manômetro e mangueira de 49 cm (conexão 1/8 BSP fêmea).",
  },
  {
    handle: "cilindro-scuba-9l-fibra-carbono-estacao-recarga-pcp", sku: "BNK-SCUBA-9L", cost: 2200.46,
    title: "Cilindro Scuba 9L Fibra de Carbono + Estação de Recarga PCP", brand: "Leão",
    category_handle: "airguns-carabinas", source: "Leão Squadrão BR, p. 27",
    description: "Kit com cilindro scuba de alumínio com fibra de carbono de 9 L (PCP 300 bar, rosca M18 x 1,5) e estação de recarga PCP com manômetro e mangueira de 49 cm (conexão 1/8 BSP fêmea).",
  },
]
