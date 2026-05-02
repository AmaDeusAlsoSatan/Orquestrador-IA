# UI Automation Design - Next Step Engine

## Objetivo

Implementar automação end-to-end na UI do Maestro para que o usuário possa executar runs completas sem precisar rodar comandos CLI manualmente.

## Inspiração: Paperclip

O Paperclip oferece:
- UI tipo task manager/dashboard
- Agentes com funções definidas
- Workspaces/runtime gerenciados
- Governance/approval gates
- Execução coordenada pela plataforma

## Arquitetura Proposta

### 1. CEO Command Center (UI)

**Localização:** `apps/web/src/main.ts` - View "ceo"

**Funcionalidades:**
- Seletor de projeto
- Campo de texto para objetivo em linguagem natural
- Botão "Criar run automática" ou "Iniciar empresa"
- Lista de runs ativas com status

**Implementação:**
```typescript
interface CEOCommandInput {
  projectId: string;
  goal: string;
  autoExecute?: boolean; // Se true, inicia execução automática
}
```

### 2. Next Action Engine (Servidor)

**Localização:** `apps/server/src/index.ts` - Nova ação "NEXT_STEP"

**Lógica de decisão baseada em status:**

```typescript
function determineNextAction(run: RunRecord, state: MaestroState): NextStepAction {
  switch (run.status) {
    case "PREPARED":
      return { type: "INVOKE_AGENT", role: "CTO_SUPERVISOR" };
    
    case "SUPERVISOR_PLANNED":
      return { type: "INVOKE_AGENT", role: "FULL_STACK_EXECUTOR" };
    
    case "EXECUTOR_REPORTED":
      return { type: "INVOKE_AGENT", role: "CODE_REVIEWER" };
    
    case "REVIEWED":
      const decision = state.decisions.find(d => d.runId === run.id);
      if (!decision) {
        return { type: "AWAIT_HUMAN_DECISION" };
      }
      if (decision.status === "APPROVED") {
        return { type: "RUN_ACTION", action: "PATCH_EXPORT" };
      }
      return { type: "MANUAL_INTERVENTION_NEEDED" };
    
    case "PATCH_EXPORTED":
      return { type: "RUN_ACTION", action: "PATCH_CHECK" };
    
    case "PATCH_CHECKED":
      return { type: "RUN_ACTION", action: "PATCH_PLAN" };
    
    case "PATCH_PLANNED":
      return { type: "AWAIT_APPLY_CONFIRMATION" };
    
    case "PATCH_APPLIED":
      return { type: "AWAIT_MANUAL_COMMIT" };
    
    case "FINALIZED":
      return { type: "COMPLETED" };
    
    default:
      return { type: "UNKNOWN_STATUS" };
  }
}
```

### 3. Shared Patch-Based Executor Logic

**Problema:** A lógica do patch-based executor está duplicada no CLI.

**Solução:** Extrair para pacote compartilhado.

**Nova estrutura:**
```
packages/
  executor/
    src/
      patch-executor.ts  # processExecutorPatch()
      index.ts
```

**Funções a compartilhar:**
- `processExecutorPatch()` - Extrai, valida e aplica patch
- Integração com `extractUnifiedDiffFromAgentOutput()`
- Integração com `applyPatchToWorkspace()`
- Captura de diff do workspace

### 4. API Endpoints

**Novos endpoints:**

```typescript
// Executar próximo passo automaticamente
POST /api/runs/:runId/action
Body: { action: "NEXT_STEP" }

// Executar múltiplos passos até gate humano
POST /api/runs/:runId/action
Body: { action: "AUTO_EXECUTE", stopAt: "HUMAN_DECISION" }
```

**Endpoints existentes a usar:**
- `POST /api/runs/:runId/agents/invoke` - Invocar agente
- `POST /api/runs/:runId/action` - Ações da run (já existe)

### 5. UI Components

#### Run Console - Botão "Executar Próximo Passo"

**Localização:** `apps/web/src/main.ts` - `renderRunDetail()`

**Implementação:**
```typescript
function renderNextStepButton(run: Run, nextAction: NextAction): string {
  if (nextAction.actionType === "AWAIT_HUMAN_DECISION") {
    return `
      <div class="decision-panel">
        <h3>Decisão Humana Necessária</h3>
        <p>Reviewer verdict: ${run.reviewerVerdict}</p>
        <button data-run-action="DECIDE" data-decision="APPROVED">Aprovar</button>
        <button data-run-action="DECIDE" data-decision="NEEDS_CHANGES">Solicitar Mudanças</button>
      </div>
    `;
  }
  
  if (nextAction.actionType === "AWAIT_APPLY_CONFIRMATION") {
    return `
      <div class="apply-panel">
        <h3>Aplicar Patch ao Repositório Original</h3>
        <p>⚠️ Esta ação modificará o repositório original.</p>
        <label>
          <input type="checkbox" id="confirm-apply" />
          Eu entendo que isso aplicará o patch no repositório original
        </label>
        <button data-run-action="PATCH_APPLY" disabled id="apply-button">Aplicar Patch</button>
      </div>
    `;
  }
  
  return `<button class="primary" data-run-action="NEXT_STEP">Executar Próximo Passo</button>`;
}
```

#### Artifacts Panel

**Mostrar links para:**
- `03-proposed.patch` - Patch proposto pelo executor
- `13-git-diff.md` - Diff do workspace
- `14-changed-files.md` - Arquivos alterados
- `17-promotion-patch.patch` - Patch de promoção
- `20-apply-plan.md` - Plano de aplicação
- `22-apply-result.md` - Resultado da aplicação
- `26-final-commit.md` - Commit final

### 6. Status Tracking

**Novos status da run:**
- `PATCH_EXPORTED` - Patch exportado do workspace
- `PATCH_CHECKED` - Patch validado contra repo original
- `PATCH_PLANNED` - Plano de aplicação gerado
- `PATCH_APPLIED` - Patch aplicado ao repo original

**Atualizar em:** `packages/core/src/types.ts`

## Implementação Faseada

### Fase 1: Shared Executor Logic (Crítico)
1. Criar `packages/executor/`
2. Mover `processExecutorPatch()` do CLI
3. Atualizar CLI para usar shared logic
4. Implementar no servidor

### Fase 2: Next Step Engine (Crítico)
1. Implementar `determineNextAction()` no servidor
2. Adicionar ação "NEXT_STEP" em `runControlledAction()`
3. Testar com run simples

### Fase 3: UI Automation (Alta Prioridade)
1. Adicionar botão "Executar Próximo Passo" no Run Console
2. Implementar lógica de decisão humana na UI
3. Adicionar panel de artifacts

### Fase 4: CEO Command Center (Média Prioridade)
1. Melhorar view "ceo" com campo de objetivo
2. Adicionar opção "auto-execute"
3. Mostrar progresso da run em tempo real

### Fase 5: Polish (Baixa Prioridade)
1. Adicionar indicadores de progresso
2. Melhorar mensagens de erro
3. Adicionar logs detalhados na UI

## Testes

### Teste 1: Fluxo Manual com Botão
1. Criar run via UI
2. Clicar "Executar Próximo Passo" para cada etapa
3. Verificar que cada passo executa corretamente

### Teste 2: Fluxo Semi-Automático
1. Criar run com auto-execute até decisão humana
2. Aprovar decisão
3. Continuar com próximos passos

### Teste 3: Fluxo Completo
1. Criar run simples (adicionar arquivo de docs)
2. Executar end-to-end via UI
3. Verificar commit final no repo

## Segurança

- Patch apply sempre requer confirmação explícita
- Commit manual permanece obrigatório (por enquanto)
- Validações de pré-condições antes de cada passo
- Mensagens de erro claras quando algo falha

## Próximos Passos

1. Implementar Fase 1 (Shared Executor Logic)
2. Implementar Fase 2 (Next Step Engine)
3. Testar com run simples
4. Implementar Fase 3 (UI Automation)
5. Testar fluxo completo
