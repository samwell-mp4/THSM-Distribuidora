# PLANO DE IMPLEMENTAÇÃO — MÓDULO INTELIGENTE DE ROTAS (ENTREGAS & CONTABILIDADE)

## 1. Visão Geral e Objetivo

Transformar a aba **Rotas** em um centro operacional de entregas em tempo real ("Painel do Entregador & Logística THSM"), integrando:
1. **Pedidos "Em Rota"**: Seleção rápida de pedidos ativos para compor a rota do dia ou rota por região/cidade (ex: Conselheiro Lafaiete, Ouro Preto, Mariana, etc.).
2. **Ordens de Entrega & Reordenação**: Possibilidade de mover e ordenar a sequência de entregas (quem entregar primeiro, segundo, etc.).
3. **Integração com Google Maps & Waze**: Puxar endereços diretamente do pedido (rua, número, bairro, cidade, CEP, pontos de referência) com rota visualizada e botão de navegação direta via 1 toque no celular (Google Maps / Waze).
4. **Ações Rápidas Operacionais no Local**: Botões de ação idênticos e integrados aos do módulo de Pedidos:
   - **Marcar Entregue** (`status: 'entregue'`)
   - **Abrir Modal de Acerto / Finalizar** (com cálculo automático de pagamento, devoluções parciais e comprovante WhatsApp)
   - **WhatsApp direto** para avisar o cliente que o entregador está chegando.
   - **Voltar para Pendente** caso o cliente não esteja no local.
5. **Contabilidade & Fechamento Financeiro da Rota**:
   - Registro de **Despesas da Rota** (Combustível, Pedágio, Alimentação, Estacionamento, Manutenção/Outros).
   - Cálculo automático do **Resultado Líquido da Rota**: `Faturamento Recebido - Despesas Operacionais = Lucro Líquido da Viagem`.
   - Vínculo direto com a aba **Financeiro** (as despesas lançadas na rota podem ser sincronizadas automaticamente com as Despesas gerais da empresa).
6. **Dashboard Próprio de Entregas & Indicadores**:
   - Total em rota no dia.
   - Entregas concluídas hoje (com valor total recebido / faturado).
   - Acertos realizados vs pendentes da rota ativa.
   - Progresso percentual da rota (ex: `8 de 12 pedidos entregues — 67%`).

---

## 2. Estrutura de Dados e Persistência

### 2.1 Modelo de Rota com Contabilidade Integrada

```typescript
interface DespesaRota {
  id: string; // Ex: 'desp-1718293041'
  tipo: 'Combustível' | 'Pedágio' | 'Alimentação' | 'Estacionamento' | 'Outros';
  descricao: string; // Ex: 'Posto Shell BR-040'
  valor: number; // Ex: 180.50
  formaPagamento: 'dinheiro' | 'pix' | 'cartao_empresa';
  comprovanteFoto?: string; // foto/cupom fiscal opcional
  hora: string;
}

interface RotaEntrega {
  id: string; // Ex: 'rota-2026-10-29-lafaiete'
  nome: string; // Ex: 'Rota Lafaiete & Região - Manhã'
  data: string; // 'YYYY-MM-DD'
  cidade: string; // 'Conselheiro Lafaiete' ou 'Múltiplas Cidades'
  status: 'ativa' | 'concluida' | 'cancelada';
  pedidosIds: number[]; // IDs dos pedidos em ordem de entrega [101, 105, 102]
  criadoEm: string;
  finalizadoEm?: string;
  motorista?: string;
  kmInicial?: number;
  kmFinal?: number;
  
  // Módulo de Contabilidade da Rota
  despesas: DespesaRota[];
  totalDespesas: number;
  totalFaturado: number; // soma dos pedidos da rota
  totalRecebido: number; // soma dos pagamentos já quitados/acertos no dia
  totalAReceber: number; // pendente a prazo
  lucroLiquido: number; // totalRecebido - totalDespesas
}
```

---

## 3. Experiência de Uso (Fluxo Operacional)

### Fluxo 1: Criar / Montar Rota do Dia
1. O administrador ou entregador clica em **"Nova Rota de Entrega"**.
2. O sistema lista todos os pedidos que estão com status **"Em Rota"** (e também pedidos "Pendentes" com opção de colocá-los em rota na hora).
3. Filtro rápido por Cidade (ex: *Lafaiete*, *Ouro Preto*, *Betim*): ao clicar na cidade, todos os pedidos com endereços daquela cidade são pré-selecionados.
4. Ao confirmar, a rota é criada e abre o **Modo Entregador Ativo**.

### Fluxo 2: Modo Entregador Ativo (Prático para Rua/Mobile)
1. **Lista de Paradas em Sequência (1ª, 2ª, 3ª...)**:
   - Cada parada exibe: Nome do Cliente, Telefone, Endereço Completo formatado, Valor a Receber, Itens do Pedido.
   - **Reordenação**: Botões de "Mover para cima" / "Mover para baixo" (ou drag & drop) para definir a melhor ordem de entrega.
2. **Botões de 1 Toque por Parada**:
   - 🗺️ **Abrir no Google Maps / Waze**: Inicia a rota GPS diretamente no aplicativo do celular com as coordenadas ou endereço exato.
   - 💬 **WhatsApp Chegando**: Envia mensagem padrão: *"Olá [Cliente], seu pedido da THSM está chegando no seu endereço!"*.
   - 📦 **Entregue**: Marca como entregue instantaneamente.
   - 🤝 **Fazer Acerto / Finalizar**: Abre o modal de conferência financeira e fechamento do pedido sem precisar sair da tela de rotas.
   - ⚠️ **Ausente / Reagendar**: Opção rápida de registrar tentativa de entrega e devolver o pedido para pendente.
3. **Visão de Rota Completa no Google Maps**:
   - Botão para abrir todos os waypoints da rota juntos no Google Maps.

### Fluxo 3: Contabilidade & Despesas da Rota (Gestão Financeira no Local)
1. **Aba/Drawer "Despesas da Rota"**:
   - Botão rápido: **"＋ Nova Despesa de Viagem"** com categorias pré-definidas (Gasolina/Álcool/Diesel, Pedágio, Almoço/Lanche, Hotel, Outros).
   - Campo para informar valor, forma de pagamento (Dinheiro do Caixa, PIX, Cartão Empresa) e observação.
   - **Sincronização com o Financeiro Central**: Opção automática de espelhar essa despesa no módulo Financeiro geral com a tag `Rota: [Nome da Rota]`.
2. **Card Resumo de Fechamento da Rota**:
   - **Bruto Faturado**: Total das entregas daquela rota.
   - **Total Arrecadado em Dinheiro / PIX**: Dinheiro físico em mãos + PIX dos acertos.
   - **(-) Despesas Operacionais**: Total gasto com viagem/combustível.
   - **(=) Saldo Líquido do Entregador a Prestar Contas**: Valor exato que o entregador deve entregar no caixa da empresa no retorno da viagem.

### Fluxo 4: Dashboard & Histórico de Rotas
- **Progresso de Entregas**: Barra de progresso interativa (`X / Total entregues`).
- **Valores da Rota**: Total a Cobrar, Total já Recebido no dia, Total a Prazo.
- **Histórico de Rotas Concluídas**: Consulta detalhada de rotas passadas com resumo de entregas, despesas e margem líquida de cada viagem.

---

## 4. Plano de Componentes e Modificações

| Componente / Área | Alteração |
| :--- | :--- |
| `src/pages/Admin.jsx` | Sub-abas na aba Rotas: **Rotas do Dia & Entregas** vs **Contatos & Cidades WhatsApp**.<br>• Criação de rota com filtro por cidade.<br>• Sequenciador de paradas com navegação GPS/Waze.<br>• Modal de Acerto e Entrega integrados.<br>• Módulo de Contabilidade/Despesas com fechamento de caixa do entregador.<br>• Integração com `setDespesas` do Financeiro. |
| `src/components/MapView.jsx` | Marcadores numerados da sequência de paradas (1, 2, 3...) com rota interativa no mapa. |
| `src/pages/Admin.css` | Estilo NexRoute SaaS para paradas de rota, botões táteis grandes para motorista no celular, cards de fechamento contábil e extrato de despesas da rota. |

---

## 5. Próximos Passos para Execução
1. **Aprovação do Plano**: Validação final dos fluxos e contabilidade integrada.
2. **Implementação do Estado & Criação de Rotas com Seleção de Pedidos**.
3. **Construção do Sequenciador de Paradas (Google Maps, Waze, WhatsApp, Ações Rápidas)**.
4. **Implementação da Contabilidade da Rota (Despesas, Prestação de Contas e Fechamento)**.
5. **Estilização Mobile-First NexRoute SaaS e Testes com `npm run build`**.
