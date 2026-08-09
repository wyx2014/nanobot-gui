# Skill Permission Spec

## Goals

Skill access must be decided from current state, not from conversation history.

- Built-in skills are global and available to every project and conversation.
- User skills are not global. A user skill is usable only when the current project grants it.
- Project skill grants apply to both new and existing conversations in that project.
- Removing a project grant immediately prevents both new and existing conversations from using that user skill.
- Deleting a user skill removes it from every project grant and prevents every conversation from using it.

## Sources

| Source | Meaning | Permission |
| --- | --- | --- |
| `builtin` | Packaged nanobot skills | Global |
| `workspace` | User-created/downloaded skills under the nanobot workspace | Project grant required |

## Runtime Rule

For every turn, gateway computes the allowed user skills from current state:

```text
allowed_user_skills =
  current_project_grants
  ∩ currently_existing_workspace_skills
  ∩ currently_available_workspace_skills
```

Built-in skills bypass this allowlist. Workspace skills do not.

## Explicit Skills

Explicitly selecting or mentioning a user skill does not grant permission. It only expresses intent.

```text
effective_explicit_workspace_skills =
  requested_explicit_workspace_skills
  ∩ allowed_user_skills
```

If an old message starts with a deleted or ungranted skill mention, the mention is ignored. The remaining user text is still processed.

## Project Grants

Project grants are keyed by normalized project path.

```ts
type ProjectSkillGrants = Record<string, string[]>;
```

Only workspace skills can be stored in project grants. Built-in skills must not be stored there because they are already global.

## GUI Responsibilities

- Show all workspace skills in project skill management.
- Show only usable skills in the chat skill picker:
  - all built-in skills
  - workspace skills granted to the current project
- When saving project grants, drop missing workspace skills.
- When deleting a workspace skill, remove it from all local project grants for immediate UI consistency.

GUI filtering is only UX. Gateway remains the authority.

## Gateway Responsibilities

- Store or receive project grants.
- For every turn, compute the current workspace skill allowlist from the conversation project.
- Filter skills summaries, active skills, file access to skill directories, and explicit skill intent through that allowlist.
- Ignore stale or unauthorized workspace skill names from old conversations or old GUI state.
