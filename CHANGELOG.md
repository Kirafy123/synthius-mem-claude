# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-17

### Added
- Six-domain structured memory system based on Synthius-Mem paper (arXiv:2604.11563)
- SessionStart hook: loads memory index on session begin (~200 tokens)
- SessionEnd hook: consolidates pending memory entries
- Memory Ops Skill (`memory-ops.md`): capture, consolidate, compact, retrieve, load-session
- 51-item test suite covering structure, content, hooks, E2E pipeline, and edge cases
- Install scripts for macOS/Linux (`install.sh`) and Windows (`install.ps1`)
- Architecture documentation
- Bilingual README (Chinese + English)
