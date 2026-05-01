# Orquestrador IA

Sistema de orquestração de IA para gerenciamento de projetos com agentes autônomos.

## 📁 Estrutura do Repositório

- **maestro/** - Sistema principal de orquestração
  - CLI completo para gerenciamento de projetos, tasks e runs
  - Task Manager com backlog persistente
  - Memory Consolidation e Active Context
  - Pilot Run Mode para execução guiada
  - Smoke tests e diagnósticos

## 🚀 Quick Start

```bash
cd maestro
corepack pnpm install
corepack pnpm run build
corepack pnpm run maestro init
```

## 📖 Documentação

Veja a documentação completa em [maestro/README.md](maestro/README.md)

## 🎯 Status Atual

- ✅ Maestro CLI implementado e testado
- ✅ Pilot Run Mode funcional
- ✅ Smoke tests passando
- 🔄 Primeira pilot run real em andamento (One Piece TCG)

## 🔗 Links Úteis

- [Documentação do Maestro](maestro/README.md)
- [Arquitetura](maestro/docs/architecture.md)
- [Roadmap](maestro/docs/roadmap.md)
- [Workflow Supervisor-Executor](maestro/docs/supervisor-executor-workflow.md)

## 📝 Licença

Este é um projeto privado em desenvolvimento.
