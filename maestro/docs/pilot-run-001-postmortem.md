# Pilot Run 001 Postmortem

## Resumo

Primeira pilot run real do Maestro concluída com sucesso.

## Projeto alvo

**Nome:** One Piece TCG / One Piece Tag Force  
**Repositório:** https://github.com/AmaDeusAlsoSatan/One-Piece-Tag-Force

## Objetivo da task

Adicionar README interno com instruções básicas de desenvolvimento.

## Resultado final

- **Arquivo criado:** README-INTERNAL.md (103 linhas)
- **Commit no projeto alvo:** `ab89f4fe9dfe2ae10aa5789500b3db950be6e7c9` - docs: add internal development guide
- **Validação original:** PASSED (build passou em 9.4s)
- **Status da run:** FINALIZED
- **Task status:** DONE

## Fluxo executado

1. ✅ Pilot start
2. ✅ Run prepare
3. ✅ Codex Supervisor (plano gerado)
4. ✅ Kiro Handoff (prompt gerado)
5. ✅ Workspace sandbox (criado e isolado)
6. ✅ Kiro Executor (README-INTERNAL.md criado no sandbox)
7. ✅ Validation workspace (falhou por ambiente, não por código)
8. ✅ Capture diff (com untracked files)
9. ✅ Codex Review Package (gerado com diff real embutido)
10. ✅ Codex Reviewer (aprovado)
11. ✅ Human Review Gate (APPROVED)
12. ✅ Patch export (2.50 KB, 103 linhas)
13. ✅ Patch check (CHECK_PASSED)
14. ✅ Patch plan (gerado)
15. ✅ Dry-run apply (DRY_RUN_PASSED)
16. ✅ Apply real (APPLIED)
17. ✅ Validation original (PASSED)
18. ✅ Commit manual (ab89f4f)
19. ✅ Run finalize (FINALIZED)
20. ✅ Memory refresh/checkpoint/context pack

## O que funcionou bem

### Separação de papéis
- Kiro/Executor executou sem revisar o próprio trabalho
- Codex/Reviewer revisou de forma independente
- Humano tomou a decisão final
- Cada papel teve seu espaço bem definido

### Workspace sandbox
- Isolamento completo do repo original
- Kiro trabalhou apenas no sandbox
- Repo original permaneceu limpo durante toda a execução
- Diff capturado corretamente do sandbox

### Handoff do Kiro
- Prompt estruturado e completo
- Contexto suficiente para execução
- Regras claras de escopo
- Formato de relatório bem definido

### Review Package com diff real
- Diff real embutido no prompt do reviewer
- Codex viu o conteúdo completo do arquivo novo
- Não dependeu apenas do relatório do executor
- Revisão baseada em evidência concreta

### Human Review Gate
- Decisão humana explícita e registrada
- Notas detalhadas sobre a aprovação
- Vault atualizado com a decisão
- Task movida para DONE automaticamente

### Patch apply com confirmação explícita
- Dry-run validou antes do apply real
- Confirmação `APPLY_TO_ORIGINAL_REPO` obrigatória
- Preflight checks executados
- Repo original verificado como CLEAN antes do apply

### Validação no repo original
- Build passou após apply real
- Validação confirmou que nada quebrou
- Logs salvos para auditoria
- Comando resolvido corretamente (npm.cmd no Windows)

### UI como mesa de comando
- Visualização clara do estado da run
- Navegação entre arquivos da run
- Anexação de outputs via UI
- Status visual do progresso

## Problemas encontrados

### 1. Untracked files não apareciam no diff

**Descrição:** O arquivo novo `README-INTERNAL.md` aparecia como untracked no workspace, mas `13-git-diff.md` ficava clean porque `git diff` não mostra arquivos untracked por padrão.

**Impacto:** O Codex Reviewer não via o conteúdo do arquivo novo, apenas uma lista dizendo que ele existia.

**Correção:** 
- Uso de `git add -N` (intent-to-add) apenas no workspace sandbox
- Inclusão de arquivos novos no patch export
- Registro em `14-changed-files.md` se untracked foi incluído
- Diff real agora mostra conteúdo completo de arquivos novos

**Commit de correção:** `60f09d1e95ba32cc62a435edc9b8abf0fa2c222b` - fix: include sandbox untracked files in review diff

**Arquivos modificados:**
- `packages/runner/src/git-inspector.ts` - Adicionado suporte para includeUntracked
- `packages/runner/src/patch-promotion.ts` - Patch export inclui novos arquivos
- `packages/memory/src/review-package.ts` - Diff real embutido no prompt
- `packages/memory/src/run-lifecycle.ts` - Captura de diff com untracked

### 2. Validation workspace falhou por ambiente

**Descrição:** O workspace sandbox não copia `node_modules`, então a validação workspace falhou inicialmente porque o build não conseguiu encontrar dependências.

**Impacto:** Validação workspace marcada como FAILED, mas não por erro do código, e sim por limitação do ambiente sandbox.

**Decisão:** Não bloquear a run por falha de validação workspace quando a alteração é apenas documentação. O Codex Reviewer classificou corretamente como "limitação de ambiente do sandbox sem node_modules, não como erro da tarefa".

**Melhoria futura:** 
- Criar estratégia de dependências/caches para validação em workspace
- Opções possíveis:
  - Instalar dependências no workspace
  - Reutilizar cache de dependências
  - Marcar validações de documentação como não bloqueantes quando não houver mudança de código
  - Usar repo original read-only para validação

**Status:** Registrado como pendência no Vault do projeto

### 3. Flag --dry-run não aceitava boolean true

**Descrição:** A função `parseFlags` retorna `true` (boolean) quando uma flag não tem valor, mas o código de `applyPatchCommand` só verificava `=== "true"` (string) ou `=== ""` (string vazia).

**Impacto:** Comando `maestro run patch apply --run <id> --dry-run` falhava com erro "requires explicit confirmation".

**Correção:** Adicionado `|| flags["dry-run"] === true` na condição de verificação.

**Commit de correção:** `e395bf824dd0290b8a008e4950e7976dea039cc9` - fix: accept boolean dry-run flag

**Arquivo modificado:**
- `apps/cli/src/index.ts` linha 2287

**Código:**
```typescript
// Antes:
const isDryRun = flags["dry-run"] === "true" || flags["dry-run"] === "";

// Depois:
const isDryRun = flags["dry-run"] === "true" || flags["dry-run"] === "" || flags["dry-run"] === true;
```

## Decisões importantes

### O Kiro não deve revisar o próprio trabalho
Manter separação clara de papéis: executor executa, reviewer revisa, humano decide. Isso garante checks and balances no processo.

### O Codex Reviewer precisa receber diff real embutido
Não confiar apenas no relatório do executor. O reviewer deve ver o código real alterado para fazer uma revisão baseada em evidência.

### Apply real só deve ocorrer após múltiplas validações
Sequência obrigatória:
1. Decisão humana APPROVED
2. Patch check (git apply --check)
3. Dry-run (validação sem aplicar)
4. Confirmação explícita `APPLY_TO_ORIGINAL_REPO`

### Commit final continua manual
O Maestro não faz commit automático no repo original. O humano revisa o diff final e commita manualmente, mantendo controle total sobre o que entra no histórico do projeto.

## Melhorias futuras

### Curto prazo
- [ ] Melhorar Pilot Status para reconhecer commit manual/finalização
- [ ] Adicionar botão de `patch apply --dry-run` na UI
- [ ] Adicionar botão de `patch apply real` na UI, mas desabilitado por padrão ou com confirmação forte
- [ ] Melhorar UX do Review Package na UI
- [ ] Criar timeline visual da run na UI

### Médio prazo
- [ ] Melhorar validação em sandbox sem copiar `node_modules`
- [ ] Criar status "COMMITTED" ou "PROMOTED_AND_COMMITTED"
- [ ] Permitir anexar hash do commit final no Maestro
- [ ] Criar relatório final da run com commit do projeto alvo
- [ ] Criar "Run Archive" ou "Completed Runs" na UI
- [ ] Adicionar métricas de tempo por etapa da run

### Longo prazo
- [ ] Integração automática com Codex (opcional, com aprovação)
- [ ] Integração automática com Kiro (opcional, com aprovação)
- [ ] Cache de dependências para workspace sandbox
- [ ] Validação incremental (apenas arquivos alterados)
- [ ] Rollback automático em caso de falha de validação
- [ ] Suporte para múltiplos reviewers
- [ ] Suporte para review em paralelo

## Métricas da run

- **Duração total:** ~13h 37min (com pausas humanas)
- **Tempo de execução ativa:** ~2h (estimado, excluindo pausas)
- **Arquivos gerados:** 25 arquivos de run + arquivos do Vault
- **Tamanho do patch:** 2.50 KB
- **Linhas adicionadas:** 103
- **Validações executadas:** 2 (workspace + original)
- **Commits no Maestro durante a run:** 2 (correções de bugs)
- **Commits no projeto alvo:** 1 (resultado final)

## Lições aprendidas

### Técnicas
1. **Git diff precisa de intent-to-add para arquivos novos** - `git add -N` é essencial para incluir untracked files no diff
2. **Flags booleanas precisam de tratamento especial** - parseFlags retorna `true` (boolean), não string
3. **Validação em sandbox precisa de estratégia de dependências** - Copiar node_modules ou instalar no sandbox
4. **Windows precisa de resolução de comandos** - npm → npm.cmd

### Processo
1. **Separação de papéis funciona** - Executor, Reviewer e Decisor independentes garantem qualidade
2. **Diff real é essencial para revisão** - Não confiar apenas em relatórios
3. **Múltiplas validações antes do apply são necessárias** - Dry-run salvou de possíveis problemas
4. **Commit manual é a escolha certa** - Mantém controle humano sobre o histórico do projeto

### Organizacional
1. **Documentar bugs encontrados é valioso** - Bugs reais são oportunidades de melhoria
2. **Checkpoint após milestone é importante** - Este postmortem documenta aprendizados
3. **UI como mesa de comando funciona bem** - Visualização clara do estado ajuda na operação
4. **Pilot mode guia bem o usuário** - Checklist e next steps são úteis

## Conclusão

O Maestro provou que consegue coordenar uma entrega real com múltiplos papéis, sandbox, revisão, decisão humana, promoção controlada, validação e memória persistente.

A primeira pilot run revelou bugs reais que foram corrigidos durante o processo, demonstrando que o sistema é robusto o suficiente para uso real e flexível o suficiente para evoluir.

O fluxo completo funcionou de ponta a ponta:
- ✅ Planejamento (Codex Supervisor)
- ✅ Execução isolada (Kiro no sandbox)
- ✅ Revisão com evidência (Codex Reviewer com diff real)
- ✅ Decisão humana (Human Review Gate)
- ✅ Promoção segura (Patch Promotion com múltiplas validações)
- ✅ Aplicação controlada (Apply com confirmação explícita)
- ✅ Validação pós-apply (Build no repo original)
- ✅ Commit manual (Controle humano final)
- ✅ Memória persistente (Vault atualizado)

**O Maestro está pronto para tarefas reais.**

---

**Data:** 2026-05-01  
**Run ID:** 2026-05-01T00-57-10-466Z-task-adicionar-readme-interno-description-criar-  
**Projeto:** One Piece TCG  
**Resultado:** ✅ SUCESSO
