const { defineConfig } = require('vitest/config');

// Config mínima do Vitest para o backend: ambiente Node (não é código de
// browser), sem necessidade de setup global — cada teste que precisa de
// variáveis de ambiente específicas (ex: JWT_SECRET) as define no próprio
// arquivo, antes de importar app.js.
module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    // globals:true evita ter que importar describe/it/expect/vi em cada
    // arquivo de teste.
    globals: true,
    // define JWT_SECRET/NODE_ENV de teste antes de qualquer arquivo (e
    // antes de qualquer import transitivo de config/db.js) — ver comentário
    // no próprio arquivo.
    setupFiles: ['./vitest.setup.js'],
  },
});
