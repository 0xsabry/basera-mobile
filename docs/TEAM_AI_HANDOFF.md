# BASERA — Team AI Handoff Guide

How every team member uses this repository with an AI assistant
(ChatGPT, Claude, Gemini, or any coding-capable AI) to prepare their
assigned presentation section — from the **real code**, not from guesses.

Repository: https://github.com/0xsabry/basera-mobile
Canonical branch: `v1.1` (the default branch). The numbered presentation
packs live in [`team/`](../team/).

## The 5-step method

1. **Open your section folder** under `team/` (10 numbered folders, one
   per presentation topic).
2. **Give the AI your folder's `README.md` and `SOURCE_MAP.md`** — paste
   their contents, or share the repository link and the exact folder
   path and ask the AI to read those files first.
3. **State your assigned topic exactly** as it appears in the folder
   index (`team/README.md`).
4. **Use the prompt template below** — fill in your topic, keep the rest
   as-is.
5. **Verify against the originals.** Every claim the AI makes must cite a
   file path and a symbol name that exists in `SOURCE_MAP.md`. Open the
   file and check. If the AI cannot access the repository, it must say
   so — then upload the folder files or the repo ZIP instead of letting
   it guess.

## Ready-to-copy prompt template

```text
You are analyzing the BASERA graduation project repository: https://github.com/0xsabry/basera-mobile

My assigned presentation topic is: [INSERT MY ASSIGNED TOPIC].

Treat the repository's actual source code as the source of truth.

1. Locate all exact source files implementing my topic.
2. Identify the actual functions, components, services, hooks, database tables, APIs, Edge Functions, and tests involved.
3. Extract the relevant original code snippets with exact file paths. Do not invent or rewrite code and present it as original.
4. Explain the implementation step by step in simple Egyptian Arabic, keeping important technical terms in English.
5. Explain how the feature connects to the rest of BASERA.
6. Explain what happens when a user interacts with it.
7. Explain what happens in successful, failed, offline, and permission-denied scenarios where applicable.
8. Explain the role of every relevant technology.
9. Prepare a natural 2–3 minute university presentation script.
10. Prepare likely instructor questions and technically accurate answers.
11. Separate what is implemented in source code from what is currently deployed in production.
12. Cite exact file paths and symbol names for every important claim.

Never infer that I personally implemented a feature from the fact that it exists in the repository. Never invent team responsibilities, test results, production status, or implementation details.

If you cannot access or inspect the repository contents directly, say so and request the relevant files or ZIP instead of guessing.
```

## How to ask for code excerpts (without fabrication)

- Ask by **file and symbol**: "Show me `decodeYoloOutput` from
  `src/ai/yoloPostprocess.ts` and explain its inputs and outputs."
- Ask for **short** excerpts (one function at a time), then the
  explanation. Long pasted files invite summarization errors.
- If an excerpt in the answer does not match the file you open, the
  answer is wrong — regenerate with the real file pasted in.
- Your folder's `CODE_WALKTHROUGH.md` already contains verified
  excerpts; start from those.

## Ground rules that protect your grade

- **Implemented ≠ deployed ≠ device-verified.** The status document
  (`docs/IMPLEMENTATION_AND_DEPLOYMENT_STATUS.md`) is the authority for
  what is live. Examples you must keep straight: the email-bound invite
  hardening is candidate code, not deployed; push delivery for SOS is
  unproven; the smart glasses are a future placeholder.
- **Never claim a test result you did not see.** Test counts change per
  commit; quote only the run named in the docs with its date/commit.
- **Never invent responsibilities.** The repository deliberately does
  not assign topics to named people; present your section as a section.
- **Arabic explanations, English terms.** Explain in simple Egyptian
  Arabic; keep technology and symbol names in English, as the template
  instructs.

## If the AI has no repository access

1. Download the repo ZIP from GitHub (Code → Download ZIP) on the
   canonical branch, or
2. Upload your section folder's six files plus
   `docs/PROJECT_FILE_MAP.md` and
   `docs/FEATURE_IMPLEMENTATION_MAP.md`.
Do not accept an answer produced without the files.
