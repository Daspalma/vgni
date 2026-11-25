# Arquitetura de Alta Disponibilidade e Escalabilidade &middot; EstuLanches

Este documento descreve o plano conceitual e de engenharia para evolução da arquitetura do sistema **EstuLanches**, projetada inicialmente como uma solução monolítica conteinerizada com Docker Compose, para um ecossistema corporativo de alta disponibilidade capaz de atender a **1.000.000 de usuários cadastrados** com picos sazonais de até **100.000 usuários simultâneos** (cenário típico de horário de recreio ou encerramento de turno escolar).

---

## 1. Distinção Fundamental: Base Cadastrada vs. Usuários Simultâneos

Uma premissa de engenharia de software é diferenciar a carga de dados em repouso da concorrência ativa:

*   **1.000.000 de Usuários Cadastrados (Dados em Repouso):**
    *   Impacta primariamente a camada de armazenamento persistente (PostgreSQL).
    *   Exige modelagem relacional rigorosa, tipos de dados enxutos, estratégias de indexação (índices B-Tree compostos), particionamento de tabelas históricas (`orders` e `order_items`) e integridade referencial com chaves primárias e estrangeiras.
    *   Volume estimado: alguns gigabytes de armazenamento em disco, facilmente suportado por clusters PostgreSQL modernos sem necessidade de sharding complexo inicial.
*   **100.000 Usuários Simultâneos no Pico (Tráfego Concorrente em Trânsito):**
    *   Impacta severamente a largura de banda, a camada de rede, a capacidade de CPU/memória das instâncias Node.js, os limites do Event Loop, o número de sockets TCP abertos e o pool de conexões do banco de dados.
    *   Se 100.000 usuários realizarem em média uma requisição a cada 5 a 10 segundos (tempo de navegação, visualização de produtos e fechamento de pedidos), a infraestrutura precisará processar um throughput sustentado entre **10.000 e 20.000 Requisições por Segundo (RPS)**, com picos instantâneos superiores.

> [!WARNING]
> **Aviso de Integridade Técnica:**
> A aplicação atual é um monólito otimizado para ambiente local ou escolar de pequeno porte. **Não se deve afirmar que a implementação atual suporte tal escala sem antes executar testes de estresse e implementar as camadas de orquestração, cache e balanceamento descritas a seguir.**

---

## 2. Visão Geral da Arquitetura Alvo

```
               [ 100.000 Clientes / Navegadores / Mobile ]
                                   │
                                   ▼
          ┌──────────────────────────────────────────────────┐
          │      Camada de Borda & CDN (Cloudflare / WAF)     │
          │  - Cache de estáticos (HTML/CSS/JS/Imagens)      │
          │  - Terminação TLS (HTTPS), Mitigação de DDoS     │
          └────────────────────────┬─────────────────────────┘
                                   │ Tráfego dinâmico (/api/*)
                                   ▼
          ┌──────────────────────────────────────────────────┐
          │      Ingress Controller / Load Balancer (ALB)    │
          │  - Round-Robin ponderado, SSL Termination        │
          └────────────────────────┬─────────────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
          ┌────────────┐     ┌────────────┐     ┌────────────┐
          │ Pod Node 1 │     │ Pod Node 2 │ ... │ Pod Node N │ (Kubernetes HPA)
          └─────┬──────┘     └─────┬──────┘     └─────┬──────┘
                │                  │                  │
                ├──────────────────┴──────────────────┤
                │                                     │
                ▼                                     ▼
     ┌──────────────────────┐              ┌──────────────────────┐
     │ Redis Cluster (Mem)  │              │ RabbitMQ / SQS (Msg) │
     │ - Cache de Cardápio  │              │ - Tarefas Assíncronas│
     │ - Rate-Limiting Dist.│              │   (E-mails, Recibos) │
     └──────────────────────┘              └──────────────────────┘
                │
                ▼
     ┌──────────────────────┐
     │  PgBouncer (Pooler)  │
     └──────────┬───────────┘
                ├─────────────────────────────────────┐
                ▼ (Escritas: POST /api/orders)        ▼ (Leituras: GET /api/orders)
     ┌──────────────────────┐              ┌──────────────────────┐
     │  PostgreSQL Primário │──Replicação─▶│  PostgreSQL Réplicas │
     │  (Writer / ACID)     │  Streaming   │  (Read Replicas 1..N)│
     └──────────────────────┘              └──────────────────────┘
```

---

## 3. Componentes da Solução Escalável

### 3.1. CDN e Camada de Borda (Edge / WAF)
*   **Provedores recomendados:** Cloudflare Enterprise, AWS CloudFront ou Fastly.
*   **Descarga de Tráfego:** Os arquivos estáticos da interface (`public/index.html`, `public/styles.css`, `public/app.js`, ícones) devem ser armazenados em cache na borda geográfica com cabeçalhos `Cache-Control: public, max-age=31536000, immutable` (utilizando hashes no nome dos arquivos).
*   **Redução de Carga:** A CDN absorve até 95% das requisições brutas de recursos visuais, garantindo que os servidores de backend recebam apenas chamadas de API (`/api/*`).
*   **Segurança de Borda:** Mitigação de ataques distribuídos de negação de serviço (DDoS nas camadas 3, 4 e 7) e regras de WAF para bloqueio de requisições maliciosas.

### 3.2. Balanceamento de Carga (Load Balancer)
*   **Tecnologias:** AWS Application Load Balancer (ALB), Nginx Ingress Controller ou HAProxy.
*   **Distribuição de Tráfego:** Algoritmo *Least Connections* ou *Round-Robin* ponderado entre as réplicas ativas da aplicação Node.js.
*   **Sessão Stateless:** A aplicação EstuLanches já não retém estado de sessão na memória local do processo Express (não utiliza variáveis globais para sessão), permitindo que qualquer requisição seja atendida por qualquer pod sem necessidade de *sticky sessions*.

### 3.3. Orquestração e Escalabilidade Horizontal de Instâncias (Kubernetes)
*   **Orquestrador:** Kubernetes (EKS, GKE ou cluster Kubernetes gerenciado).
*   **Horizontal Pod Autoscaler (HPA):**
    *   Regras de escalonamento baseadas no uso médio de CPU (> 65%), saturação do Event Loop do Node.js e métricas externas de requisições por segundo via Prometheus Adapter / KEDA.
    *   Configuração de *PodDisruptionBudgets* para assegurar disponibilidade mínima contínua de réplicas durante manutenções ou deploys sem downtime (Rolling Updates).
*   **Dimensionamento Prático de Pods:**
    *   Cada processo Node.js roda em uma única thread principal (Single-Threaded Event Loop). Um processo Node.js bem calibrado consome cerca de 1 vCPU e 512 MB de RAM, suportando confortavelmente entre 800 e 1.200 requisições I/O-bound leves por segundo.
    *   Para absorver um pico de 15.000 a 20.000 RPS, dimensiona-se um cluster dinâmico com **25 a 40 réplicas ativas do Pod da aplicação** durante os horários de maior movimento, regredindo automaticamente para 4 a 6 pods nos horários ociosos.

### 3.4. Cache Distribuído em Memória (Redis Cluster)
*   **Casos de Uso Primários:**
    1.  **Cache do Cardápio (`GET /api/products`):** É a rota mais acessada no recreio escolar. Os dados mudam com pouca frequência. Implementação do padrão *Cache-Aside* com TTL de 60 segundos ou invalidação acionada no momento do cadastro de novos produtos (`POST /api/products`). O Redis responde em menos de 1 milissegundo, desonerando o PostgreSQL de milhões de consultas repetitivas.
    2.  **Rate Limiting Distribuído:** Algoritmo de *Token Bucket* / *Sliding Window* via Redis para impedir que scripts automatizados ou usuários abusivos esgotem os recursos da cantina.
    3.  **Locks Distribuídos:** Caso haja necessidade futura de controle de estoque concorrente por item (evitando sobre-venda do último pão de queijo).

### 3.5. Otimização e Escalabilidade da Camada de Banco (PostgreSQL)
*   **Pool de Conexões Externo (PgBouncer):**
    *   No PostgreSQL, cada conexão cliente gera um processo pesado do sistema operacional que consome memória compartilhada.
    *   Com 40 pods Node.js abrindo pools locais de 10 a 20 conexões, o banco seria sobrecarregado por centenas de conexões ociosas.
    *   **Solução:** Implementação do PgBouncer em modo *Transaction Pooling* entre os Pods Node.js e o PostgreSQL. O PgBouncer multiplexa centenas de conexões virtuais em um grupo enxuto de conexões físicas reais (ex.: 50 a 80 conexões ativas), minimizando o consumo de memória do Postgres.
*   **Segregação Leitura/Escrita (Read Replicas):**
    *   **PostgreSQL Primário (Primary / Writer):** Atende exclusivamente mutações com transações ACID (`POST /api/orders`, `POST /api/products`).
    *   **PostgreSQL Secundários (Read Replicas):** Duas ou mais réplicas de leitura com replicação contínua (*Streaming Replication*). Atendem leituras de histórico (`GET /api/orders`) e consultas de auditoria, desobstruindo a CPU do nó primário.
*   **Particionamento de Tabelas (Table Partitioning):**
    *   Quando a base atingir milhões de registros em `orders` e `order_items`, aplicar particionamento declarativo por intervalo de data (`RANGE (created_at)`), segregando os dados por mês ou ano letivo. As buscas de pedidos recentes vasculharão apenas a partição corrente.

### 3.6. Fila de Mensageria para Tarefas Assíncronas
*   **Tecnologias:** RabbitMQ, Apache Kafka ou AWS SQS.
*   **Desacoplamento de Tarefas Não Críticas:**
    *   Ao confirmar um pedido, a transação HTTP síncrona deve gravar apenas o estritamente necessário para garantir o pedido no banco (`orders` e `order_items`).
    *   Efeitos secundários (envio de recibo por e-mail/WhatsApp para os responsáveis, atualização do painel de produção da cozinha, cálculos analíticos de vendas) devem ser enfileirados como mensagens e consumidos assincronamente por workers dedicados.

---

## 4. Observabilidade, Monitoramento e Resiliência

*   **Três Pilares de Observabilidade:**
    *   **Métricas:** Prometheus coletando métricas da infraestrutura e dos processos Node.js (latência do Event Loop, consumo de heap, duração de requisições HTTP) com dashboards no Grafana.
    *   **Logs Centralizados:** Agregação de logs com FluentBit enviando para OpenSearch, Grafana Loki ou Datadog em formato estruturado JSON.
    *   **Rastreamento Distribuído (Distributed Tracing):** OpenTelemetry instrumentando as requisições para identificar gargalos em queries SQL específicas ou chamadas ao Redis.
*   **Políticas de Backup e Disaster Recovery:**
    *   Arquivamento contínuo de Write-Ahead Logging (WAL) com ferramentas como *pgBackRest* ou *WAL-G* para permitir Point-in-Time Recovery (PITR) com RPO (Recovery Point Objective) inferior a 5 minutos.
    *   Backups lógicos diários e snapshots automatizados de volume de armazenamento redundante (ex.: AWS EBS gp3 com IOPS provisionados).

---

## 5. Metodologia de Testes de Carga e Dimensionamento

Antes de qualquer certificação de suporte a 100.000 usuários simultâneos, deve-se aplicar uma esteira de testes de carga contínuos com ferramentas como **k6** ou **Locust**:

1.  **Smoke Test:** 5 a 10 usuários virtuais para certificar que os endpoints respondem sem erros funcionais.
2.  **Load Test (Carga Nominal):** Simulação de subida progressiva para 10.000 usuários simultâneos mantidos por 30 minutos, medindo a latência no 95º e 99º percentil (p95 e p99).
3.  **Spike Test (Onda de Recreio):** Salto abrupto de 1.000 para 80.000 usuários em 60 segundos, avaliando o tempo de resposta do HPA do Kubernetes e a estabilidade do pool de conexões do banco.
4.  **Soak / Endurance Test:** Execução contínua com carga moderada por 12 horas para detecção de vazamentos sutis de memória (memory leaks) ou exaustão de descritores de arquivo no sistema operacional.
5.  **Stress / Breakpoint Test:** Aumento ininterrupto de carga até identificar a saturação total do sistema, localizando o gargalo exato (I/O do disco, limite de conexões do PgBouncer ou saturação de CPU).

