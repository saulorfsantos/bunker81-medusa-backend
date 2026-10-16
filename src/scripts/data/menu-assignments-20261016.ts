import type { Assignment } from "../menu-categories-core"

// Product → menu category for the 72 products in the catalogue on 12 Oct 2026, decided by
// Saulo/Claude on 16 Oct 2026 (Adriano reviews afterwards). Source spreadsheet:
// outputs/menu-20261016/produtos-categorias.csv. Products created later need their own rows.
export const menuAssignments: Assignment[] = [
  { product_id: "prod_01KS8A4RG2JCHKXZFS7Q82QV5J", category_handle: "loadout" }, // Canivete Jararaca F067 LRW Rossi
  { product_id: "prod_01KS8A4RG19SSR9R56SXTP37KP", category_handle: "loadout" }, // Canivete Jiboia Karambit F386 Rossi
  { product_id: "prod_01KS8A4RG2TD5RY00P6BN57M19", category_handle: "loadout" }, // Canivete Sucuri F121-2 Rossi
  { product_id: "prod_01M3WFB296PY97KYF7902P2R7W", category_handle: "suprimentos" }, // OLEO LUBRIFICANTE SHIELD 300ML ROSSI
  { product_id: "prod_01KS8A4RG13AH95FDADMTJXSS2", category_handle: "bipes-grips-trilhos" }, // Bipé Rossi 6-9 Fixo Estilo Harris
  { product_id: "prod_01KS8A4RG123Y37NJZKH3V8KJG", category_handle: "bipes-grips-trilhos" }, // Elevador de Mount para Trilho 22mm
  { product_id: "prod_01KS8A4RG10B2S20MT023JHK59", category_handle: "bipes-grips-trilhos" }, // Suporte Bandoleira Engate Rápido Metal
  { product_id: "prod_01KS8A4RG1KFV0GDX8CAWZ5AP2", category_handle: "dots" }, // Mira Holográfica Dot 551 Red/Green Rossi
  { product_id: "prod_01KS8A4RG186RYZP6790F1N65R", category_handle: "dots" }, // Mira Red Dot Mini 1x18 Rossi
  { product_id: "prod_01KW4KQ8MG881PDNYP0MF4WKE2", category_handle: "dots" }, // Red Dot Rossi 1x32C ACOG
  { product_id: "prod_01KW4KQ8MF6BQN3PQD3N68NCCR", category_handle: "dots" }, // Red Dot Rossi 553 Black
  { product_id: "prod_01KW4KQ8MFG929EJA1BANDTBYK", category_handle: "dots" }, // Red Dot Rossi 558
  { product_id: "prod_01KW4KQ8MG4AB3ZFXKNGSXAR6M", category_handle: "dots" }, // Red Dot Rossi M1
  { product_id: "prod_01KW4KQ8MG63Q70HK8MV30J50T", category_handle: "dots" }, // Red Dot Rossi ROMEO BK
  { product_id: "prod_01KW4KQ8MG39TCY2K143XWXJ28", category_handle: "dots" }, // Red Dot Rossi ROMEO TAN
  { product_id: "prod_01KS8A4RG1SG65YQZ3XAX2NMCT", category_handle: "lunetas" }, // Luneta Discovery HT-NV 3x24IR Retículo Iluminado
  { product_id: "prod_01KW4KQ8MF0W7DGESCAS1F3D1C", category_handle: "lunetas" }, // Luneta Rossi 1.2-6x24 LPVO
  { product_id: "prod_01KW4KQ8MGJEV63XMPJK080S59", category_handle: "lunetas" }, // Luneta Rossi 4-16x42AO
  { product_id: "prod_01KS8A4RG110HX3VDKSWJA9SRZ", category_handle: "lunetas" }, // Luneta Rossi 4.5x20 WA Mount 3/8 11mm
  { product_id: "prod_01KW4KQ8MGXREG0D3QMXAR3J73", category_handle: "lunetas" }, // Luneta Rossi 6-24x42AO
  { product_id: "prod_01KW4KQ8MF35H5BYJ9X48AZE1M", category_handle: "lunetas" }, // Luneta Rossi Gold Crown 3-9x40EG
  { product_id: "prod_01KS8A4RG13MEBWEKHAPRPPPPY", category_handle: "lunetas" }, // Luneta Rossi Gold Crown 4x32 PCP
  { product_id: "prod_01KS8A4RG1KN27YVKQNPYVD1MG", category_handle: "coldres" }, // Coldre Tan Porta Magazine M4/AK Rossi
  { product_id: "prod_01KS8A4RG1AQ57ZVVZRZTPTG7S", category_handle: "coldres" }, // Coldre Tan Porta Magazine Pistola Rossi
  { product_id: "prod_01M3Z407FZ3TB8M68M9A5TG32P", category_handle: "coletes-modulares" }, // COLETE MUDULAR PCR ROSSI
  { product_id: "prod_01KS8A4RG0QXSPS7EM10SZR49M", category_handle: "coletes-modulares" }, // Colete Tático Modular SP-033 Verde Militar Rossi
  { product_id: "prod_01KS8A4RG06CVR48YY17005Y3W", category_handle: "coletes-modulares" }, // Colete Tático Modular SP-033 Woodland Rossi
  { product_id: "prod_01KS8A4RG2CGX6SSKPQNJZM5Q1", category_handle: "maletas" }, // Maleta Pistola Desert Premium Tan
  { product_id: "prod_01KS8A4RG2QD7HE4VXC31XEF6W", category_handle: "oculos" }, // Óculos Tático Warmmo 3 Lentes
  { product_id: "prod_01KS8A4RG0RKBC3QDB3HDVXWF6", category_handle: "magazines-rossi" }, // Magazine AK Mid-Cap Polímero 130 BB's Rossi
  { product_id: "prod_01KS8A4RG0TCNAQD4KXBDD9YWP", category_handle: "magazines-rossi" }, // Magazine Green Gás Pistola 1911 Redwings Rossi
  { product_id: "prod_01KS8A4RG0ZSH1JGZK8XP8TQV9", category_handle: "magazines-rossi" }, // Magazine Green Gás Pistola Glock R17/R18 Rossi
  { product_id: "prod_01KS8A4RG1K7FPYKESFSD9BFEB", category_handle: "magazines-rossi" }, // Magazine M4 Hi-Cap Full Metal 300 BB's Rossi
  { product_id: "prod_01KS8A4RG1F76Q6085G9NNSP20", category_handle: "magazines-rossi" }, // Magazine M4 Hi-Cap HP Polímero 350 BB's Rossi
  { product_id: "prod_01KS8A4RG17ZDRD1Z467B8RX43", category_handle: "magazines-rossi" }, // Magazine M4 Mid-Cap Full Metal 110 BB's Rossi
  { product_id: "prod_01KS8A4RG01K23BTS7R46DMNJ1", category_handle: "magazines-rossi" }, // Magazine M4 Mid-Cap HP Polímero 130 BB's Rossi
  { product_id: "prod_01KS8A4RG0Q029JBZV1A4N60WH", category_handle: "magazines-rossi" }, // Magazine M4 Mid-Cap Polímero 100 BB's Rossi
  { product_id: "prod_01KS8A4RG219AC4XEXGHBJP6GS", category_handle: "magazines-specna-arms" }, // Combo Specna Arms 5 Mid-Cap 125 BB's
  { product_id: "prod_01KS8A4RG2QBHMW99KCZJB4EHH", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S 1100mAh 20C/40C Deans
  { product_id: "prod_01KS8A4RG2VNT24N05R64Q0M3B", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S 1100mAh 20C/40C Tamiya
  { product_id: "prod_01KS8A4RG2HGCRH98F1RTVMQQ2", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S 1100mAh 20C/40C XT60
  { product_id: "prod_01KS8A4RG3SCF1PXN2K3K2Z1PN", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S 3-Pack 1100mAh 20C/40C Deans
  { product_id: "prod_01KS8A4RG3V908PFAS7Y6D0KMC", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S 3-Pack 1100mAh 20C/40C Tamiya
  { product_id: "prod_01KS8A4RG2F4H0CFMAJ7FNF3ES", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S 900mAh 20C/40C XT60
  { product_id: "prod_01KS8A4RG3CRH17484WFPBHEEM", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 11.1V/3S AK Series 1400mAh 25C/50C Mini Tamiya
  { product_id: "prod_01KS8A4RG2DP4RPTGHYZJS6YXJ", category_handle: "baterias" }, // Bateria LiPo Ultra Leão 7.4V/2S 250mAh 20C AEP
  { product_id: "prod_01KYYM3JWY1F5AAHKC27PZT636", category_handle: "baterias" }, // Bolsa anti-chama de carregar Bateria LiPo 20x10cm
  { product_id: "prod_01KS8A4RG26EG1RQJCN2PS4726", category_handle: "baterias" }, // Lipo Bag Lipo-Safe Leão
  { product_id: "prod_01KS8A4RFZW1JBK2GSTM1855CP", category_handle: "bbs" }, // BB's Sniper Tango Down 0.32g 2.000un
  { product_id: "prod_01KS8A4RFZFN7AS639JS8S275F", category_handle: "bbs" }, // BB's Sniper Tango Down 0.36g 1.000un
  { product_id: "prod_01KS8A4RFZZXX8KBPBJP3QA9G1", category_handle: "bbs" }, // BB's Sniper Tango Down 0.36g 500un
  { product_id: "prod_01KS8A4RG09X2AM91B1AQ8P42W", category_handle: "bbs" }, // BB's Sniper Tango Down 0.40g 1.000un
  { product_id: "prod_01KS8A4RG04XRKBE416PB3NWY8", category_handle: "bbs" }, // BB's Sniper Tango Down 0.40g 500un
  { product_id: "prod_01KS8A4RG06GKC1GS79XKAE7WK", category_handle: "bbs" }, // BB's Sniper Tango Down 0.45g 1.000un
  { product_id: "prod_01KS8A4RG0JXKGW4165K63Y8XN", category_handle: "bbs" }, // BB's Sniper Tango Down 0.45g 500un
  { product_id: "prod_01KS8A4RG095XS8R1Z4EC0N0RK", category_handle: "bbs" }, // BB's Sniper Tango Down 0.48g 1.000un
  { product_id: "prod_01KS8A4RG0HZHZ43BQJSM1EA6C", category_handle: "bbs" }, // BB's Sniper Tango Down 0.48g 500un
  { product_id: "prod_01KS8A4RG0A30ZZJ4ZEM4E9GCJ", category_handle: "bbs" }, // BB's Sniper Tango Down 0.50g 500un
  { product_id: "prod_01KS8A4RFZ05B8E10CYSQWZG3B", category_handle: "bbs" }, // BB's Tango Down 0.20g 2.800un
  { product_id: "prod_01KS8A4RFZYASNRKKKB5HXSZM5", category_handle: "bbs" }, // BB's Tango Down 0.20g 5000un
  { product_id: "prod_01KS8A4RFZ8B9MNSHY2EREX3G4", category_handle: "bbs" }, // BB's Tango Down 0.25g 2.800un
  { product_id: "prod_01KS8A4RFZZTQ5KE4W7EEFVZBG", category_handle: "bbs" }, // BB's Tango Down 0.25g 5000un
  { product_id: "prod_01KS8A4RFZVFDGV8JE9585Q0Y9", category_handle: "bbs" }, // BB's Tango Down 0.28g 2.800un
  { product_id: "prod_01KS8A4RFZ4G5H2X1KN8JFTK6W", category_handle: "bbs" }, // BB's Tango Down 0.28g 5000un
  { product_id: "prod_01KS8A4RFZ1CDZ7H9CX2QKMHT6", category_handle: "bbs" }, // BB's Tango Down 0.30g 2.800un
  { product_id: "prod_01KS8A4RFZH69JRSE59X8Y343K", category_handle: "bbs" }, // BB's Tango Down 0.30g 5000un
  { product_id: "prod_01KS8A4RFZBKNFWK3B58S2EBAF", category_handle: "bbs" }, // BB's Tracer Tango Down 0.25g 2.800un
  { product_id: "prod_01KS8A4RFZZZVQE7Y4XJS5T19V", category_handle: "bbs" }, // BB's Tracer Tango Down 0.25g 5000un
  { product_id: "prod_01KS8A4RG22ZTEP12Y4FMJVRA3", category_handle: "gas" }, // Cilindro CO2 12g Leão
  { product_id: "prod_01KS8A4RG285B9M8VKCRDH78X1", category_handle: "gas" }, // GREEN GAS 12kg COM SILICONE LEÃO
  { product_id: "prod_01M3WJHS2HYW2MEZ1KCMC529PX", category_handle: "gas" }, // GREEN GAS PUFF DINO
  { product_id: "prod_01M3YQ1S0J9EV40KFDDFWW6KD3", category_handle: "gas" }, // GREEN GAS PUFF DINO SEM SILICONE
]
