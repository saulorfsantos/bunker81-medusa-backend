import OrcamentoModuleService from "../service"

// Os nomes vêm do pluralizador da Medusa em execução; um nome errado vira HTTP 500 no PDV.
test.each(["listAndCountOrcamentos", "createOrcamentos", "deleteOrcamentos"])("o serviço tem %s", (metodo) => {
  expect(typeof (OrcamentoModuleService.prototype as unknown as Record<string, unknown>)[metodo]).toBe("function")
})
