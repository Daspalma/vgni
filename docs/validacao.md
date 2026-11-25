# Registro Técnico de Validação &middot; EstuLanches

Data da validação: 23/11/2026 às 12h15 (Horário de Brasília &middot; America/Sao_Paulo).
Versão do sistema: 1.0.0 (confirmada em `package.json`).

---

## 1. Ambiente Observado

*   **Sistema Operacional:** Windows x64 (PowerShell).
*   **Node.js / npm:** Node.js v25.5.0 e npm 11.8.0.
*   **PostgreSQL:** PostgreSQL 18.0 x64 instalado no host (`C:\Program Files\PostgreSQL\18\bin`). Cluster temporário configurado em `tmp/pgdata` ouvindo exclusivamente em `127.0.0.1:55432` com autenticação local trust. Bancos isolados criados: `estulanches` (demonstração HTTP) e `estulanches_test` (testes automatizados).
*   **Navegador:** Microsoft Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) disponível para execução do Playwright.
*   **Docker e Compose:**
    *   Docker CLI versão 29.1.3 e Docker Compose v2.40.3-desktop.1 instalados.
    *   Sintaxe de arquivos de composição validada via `docker compose config` e `docker compose -f docker-compose.test.yml config`.
    *   **Impedimento técnico no host atual:** O serviço de background `com.docker.service` (Docker Desktop) encontrava-se parado e sua inicialização requer elevação de privilégios de Administrador. Além disso, o subsistema WSL 2 acusou ausência de distribuições Linux instaladas (`wsl -l -v`), impedindo que o daemon Linux Engine subisse no host local. Nenhum log ou status de execução de container em runtime foi inventado.

---

## 2. Resultados Reais dos Testes Automatizados

### 2.1. Testes Unitários (`npm test`)
*   **Comando:** `node --test tests/unit/*.test.js`
*   **Total de testes:** 33 testes executados.
*   **Aprovados:** 33 (100% de sucesso).
*   **Reprovados / Falhas:** 0.
*   **Duração:** 94 ms.
*   **Escopo validado:**
    *   Sanitização e remoção de espaços em nomes de produtos.
    *   Aceitação de preços estritamente como inteiros em centavos.
    *   Rejeição de nomes vazios, nulos, numéricos ou com mais de 100 caracteres.
    *   Rejeição de preços inválidos (0, negativos, ponto flutuante, strings, nulos, NaN, Infinity, superiores a 1.000.000 centavos).
    *   Rejeição de descrições acima de 500 caracteres ou de tipo não-string.
    *   Validação estrutural de pedidos (deve ser array com 1 a 100 itens).
    *   Rejeição de quantidades inválidas (0, negativas, decimais, strings, > 99).
    *   Rejeição de IDs inválidos e bloqueio de produtos duplicados no mesmo pedido.
    *   Cálculo estrito no servidor ignorando `priceCents` ou `totalCents` enviados pelo cliente.
    *   Rejeição com status 422 para produtos inexistentes no cardápio.
    *   Rejeição de pedidos com valor total acima de 1.000.000.000 centavos.

### 2.2. Testes de Integração (`npm run test:integration`)
*   **Comando:** `node --test --test-concurrency=1 tests/integration/*.test.js`
*   **Banco de Dados:** PostgreSQL 18 real em `estulanches_test` isolado.
*   **Total de testes:** 6 testes de integração.
*   **Aprovados:** 6 (100% de sucesso).
*   **Reprovados / Falhas:** 0.
*   **Duração:** 668 ms.
*   **Cenários validados:**
    1.  *cadastro, total oficial, consulta e snapshot de preço/nome:* Cadastro de produto via POST, recuperação via GET, criação de pedido com cálculo oficial do servidor, snapshot imutável de preço/nome na tabela `order_items` mesmo após alteração posterior do cadastro de produtos.
    2.  *rejeição de pedidos inválidos sem registros parciais:* Validação de atomicidade com assert de integridade contínua no número de linhas.
    3.  *rollback completo sob falha:* Disparo de trigger PL/pgSQL simulando erro no segundo item; confirmação de rollback total (nem o pedido nem o primeiro item persistem).
    4.  *validação de produto, JSON, paginação e rotas inexistentes:* Tratamento de erros 400, 404, 413 e 422.
    5.  *consultas parametrizadas e cabeçalhos de segurança:* Teste de injeção SQL com `' DROP TABLE products; --` persistido seguramente como texto puro; validação de cabeçalhos Helmet (CSP ativo, `X-Powered-By` suprimido).
    6.  *reinicialização e idempotência:* Execuções consecutivas de `initializeDatabase()` confirmando que o schema e o seed inicial de produtos não são duplicados.

### 2.3. Teste de Interface / Navegador Real (`npm run test:browser`)
*   **Comando:** `node --test tests/browser/*.test.js`
*   **Navegador:** Microsoft Edge headless via `playwright-core`.
*   **Total de testes:** 1 teste ponta a ponta complexo.
*   **Aprovados:** 1 (100% de sucesso).
*   **Reprovados / Falhas:** 0.
*   **Duração:** 4.110 ms.
*   **Fluxo verificado:**
    *   Carregamento do cardápio e listagem de produtos.
    *   Abertura do diálogo e cadastro de produto com validação de campos obrigatórios.
    *   Busca interativa com filtro no cardápio.
    *   Adição de itens ao carrinho, incremento de quantidade e recálculo dinâmico.
    *   Remoção de itens e bloqueio de confirmação com carrinho vazio.
    *   Confirmação de pedido com redirecionamento para `#historico` e exibição do registro.
    *   Tratamento de falhas de rede na API e ação do botão "Tentar novamente".
    *   Responsividade visual sem overflow horizontal nas larguras de 1440px, 1024px, 768px, 390px e 320px.

### 2.4. Validação de Fluxo HTTP e Persistência de Dados (`npm run test:e2e`)
*   **Fase 1 (`node scripts/e2e.js`):**
    *   Requisição `GET /api/health`: retorno `{ "status": "ok" }`.
    *   Criação de produto ("Lanche de validação", R$ 7,35).
    *   Fechamento de pedido com 2 unidades: total calculado no servidor = R$ 14,70 (1470 centavos).
    *   Validação de rejeição HTTP 422 para produto inexistente (`productId: 2147483647`).
    *   Gravação de metadados de conferência em `tmp/persistence-check.json`.
*   **Fase 2 (Reinicialização e Verificação):**
    *   Servidor Express finalizado e reiniciado em nova instância.
    *   Comando: `npm run test:e2e -- --verify`.
    *   Resultado: `"Persistência confirmada: pedido #1, total 1470 centavos."` (dados preservados com integridade).

---

## 3. Validação dos Arquivos de Docker e Compose

1.  **`docker compose config`:**
    *   Resultado: Sintaxe válida, interpolação de variáveis de ambiente do `.env` aprovada.
    *   Serviço `app`: Imagem gerada a partir do `Dockerfile`, porta 3000 mapeada, usuário `node`, dependência de `db` com condição `service_healthy`.
    *   Serviço `db`: Imagem `postgres:17-alpine`, volume `postgres_data`, sem porta de host exposta (apenas rede interna `db:5432`), healthcheck com `pg_isready`.
2.  **`docker-compose.test.yml`:**
    *   Resultado: Sintaxe válida. Banco efêmero em `tmpfs` e container de testes executando `npm ci && npm run test:all`.

---

## 4. Ficha RDM Gerada

*   **Arquivo gerado:** `docs/Ficha_RDM_EstuLanches.pdf` (cópia em `output/pdf/Ficha-RDM-EstuLanches.pdf`).
*   **Páginas:** Exatamente 1 página A4.
*   **Conteúdo:** Registra o status de implantação, objetivos, arquivos alterados, portas, resultados reais dos 40 testes aprovados, dados de persistência e impedimentos documentados com total transparência.
