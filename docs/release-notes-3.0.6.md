# 3.0.6 — Fix Kimi CLI Model Configuration

## Problem
Kimi CLI exited with:
```
config.invalid: Model "kimi-k2.7-code-highspeed" is not configured in config.toml.
Add a [models."kimi-k2.7-code-highspeed"] entry with max_context_size.
```

Because ayontclaudian offered models in the dropdown that were not registered in `~/.kimi/config.toml`.

## Fix
- **ensureKimiModelConfigured()**: Before starting Kimi CLI with `-m <model>`, the plugin checks whether the model exists in `~/.kimi/config.toml`. If not, it is appended automatically with a matching `display_name` and `max_context_size`.
- **Dropdown cleaned up**: The model selector now only shows configured models (plus the built-in default, env override, and custom models). Unconfigured catalog IDs like `kimi-k2.7-code-highspeed` are no longer offered without reason.

## For you
When you select a Kimi model that is not yet in `config.toml`:
1. ayontclaudian adds it automatically
2. Shows notice: "Added Kimi model ... to ~/.kimi/config.toml"
3. Re-runs the Kimi call

## Quality
- 6165 tests green
- Typecheck: 0 errors
- Lint: 0 errors
