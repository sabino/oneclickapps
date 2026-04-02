#!/bin/sh
set -eu

ROOT="/app/apps/studio/.next/server"

if [ ! -d "$ROOT" ]; then
  exit 0
fi

# The published supabase/studio image ships prebuilt Next server chunks. We patch
# those chunks in-place so one-click users can supply OpenAI-compatible endpoints
# such as Azure OpenAI without maintaining a long-lived upstream fork.
python3 - <<'PY'
import glob
import os
import re

root = "/app/apps/studio/.next/server"
files = [path for path in glob.glob(root + "/**/*.js", recursive=True) if os.path.isfile(path)]

replacements = [
    (
        'openai:{models:{"gpt-5":{default:!1},"gpt-5-mini":{default:!0}},providerOptions:{openai:{reasoningEffort:"minimal"}}}',
        'openai:{models:{[process.env.OPENAI_ADVANCE_MODEL||"gpt-5"]:{default:!1},[process.env.OPENAI_MODEL||"gpt-5-mini"]:{default:!0}},providerOptions:{openai:{reasoningEffort:"minimal"}}}',
    ),
    (
        'openai:{models:{"gpt-5.3-codex":{default:!1},"gpt-5.4-nano":{default:!0}},providerOptions:{openai:{store:!1}}}',
        'openai:{models:{[process.env.OPENAI_ADVANCE_MODEL||"gpt-5.3-codex"]:{default:!1},[process.env.OPENAI_MODEL||"gpt-5.4-nano"]:{default:!0}},providerOptions:{openai:{store:!1}}}',
    ),
]

openai_provider_pattern = re.compile(
    r'model:\(0,([A-Za-z_$][\w$]*)\.openai\)\(([^)]+)\)'
)

direct_openai_client_pattern = re.compile(
    r'new ([A-Za-z_$][\w$]*)(\.default)?\(\{apiKey:([A-Za-z_$][\w$]*)\}\)'
)

patched_files = 0

def replace_openai_provider(match: re.Match[str]) -> str:
    module_name = match.group(1)
    model_var = match.group(2)
    provider_factory = (
        f'((process.env.OPENAI_BASE_URL||process.env.AZURE_OPENAI_BASE_URL)&&{module_name}.createOpenAI'
        f'?{module_name}.createOpenAI({{'
        f'baseURL:process.env.OPENAI_BASE_URL||process.env.AZURE_OPENAI_BASE_URL,'
        f'apiKey:process.env.OPENAI_API_KEY,'
        f'headers:"true"===process.env.AZURE_OPENAI_USE_API_KEY_HEADER?{{"api-key":process.env.OPENAI_API_KEY}}:{{}}'
        f'}})'
        f':{module_name}.openai)'
    )
    return f'model:({provider_factory})({model_var})'

for path in files:
    with open(path, "r", encoding="utf-8") as handle:
        original = handle.read()

    updated = original

    for needle, replacement in replacements:
        updated = updated.replace(needle, replacement)

    updated = openai_provider_pattern.sub(replace_openai_provider, updated)

    def replace_openai_client(match: re.Match[str]) -> str:
        client_name = match.group(1)
        client_suffix = match.group(2) or ""
        api_key_var = match.group(3)
        return (
            f'new {client_name}{client_suffix}('
            f'{{apiKey:{api_key_var},'
            f'baseURL:process.env.OPENAI_BASE_URL||process.env.AZURE_OPENAI_BASE_URL||void 0,'
            f'defaultQuery:process.env.OPENAI_API_VERSION?{{"api-version":process.env.OPENAI_API_VERSION}}:void 0,'
            f'defaultHeaders:"true"===process.env.AZURE_OPENAI_USE_API_KEY_HEADER?{{"api-key":{api_key_var}}}:void 0}}'
            f')'
        )

    updated = direct_openai_client_pattern.sub(replace_openai_client, updated)

    if updated != original:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(updated)
        patched_files += 1

print(f"patch-studio-ai: patched {patched_files} file(s)")
PY
