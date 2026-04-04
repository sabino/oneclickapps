#!/bin/sh
set -eu

ROOT="/app/apps/studio/.next"

if [ ! -d "$ROOT" ]; then
  exit 0
fi

# The published supabase/studio image ships prebuilt Next chunks. We patch
# those chunks in-place so one-click users can supply OpenAI-compatible endpoints
# such as Azure OpenAI and can also run Studio in a self-hosted platform mode
# without the cloud dashboard auth/session assumptions.
python3 - <<'PY'
import glob
import hashlib
import os
import re

root = "/app/apps/studio/.next"
files = [path for path in glob.glob(root + "/**/*.js", recursive=True) if os.path.isfile(path)]
all_files = [path for path in glob.glob(root + "/**/*", recursive=True) if os.path.isfile(path)]

def env_flag(name: str) -> str:
    return "true" if os.environ.get(name, "").strip().lower() == "true" else "false"

def env_expr(name: str) -> str:
    return f'("undefined"!=typeof process&&process.env&&process.env.{name}?process.env.{name}:void 0)'

replacements = [
    (
        'openai:{models:{"gpt-5":{default:!1},"gpt-5-mini":{default:!0}},providerOptions:{openai:{reasoningEffort:"minimal"}}}',
        f'openai:{{models:{{[({env_expr("OPENAI_ADVANCE_MODEL")}||"gpt-5")]:{{default:!1}},[({env_expr("OPENAI_MODEL")}||"gpt-5-mini")]:{{default:!0}}}},providerOptions:{{openai:{{reasoningEffort:"minimal"}}}}}}',
    ),
    (
        'openai:{models:{"gpt-5.3-codex":{default:!1},"gpt-5.4-nano":{default:!0}},providerOptions:{openai:{store:!1}}}',
        f'openai:{{models:{{[({env_expr("OPENAI_ADVANCE_MODEL")}||"gpt-5.3-codex")]:{{default:!1}},[({env_expr("OPENAI_MODEL")}||"gpt-5.4-nano")]:{{default:!0}}}},providerOptions:{{openai:{{store:!1}}}}}}',
    ),
]

openai_provider_pattern = re.compile(
    r'model:\(0,([A-Za-z_$][\w$]*)\.openai\)\(([^)]+)\)'
)

direct_openai_client_pattern = re.compile(
    r'new ([A-Za-z_$][\w$]*)(\.default)?\(\{apiKey:([A-Za-z_$][\w$]*)\}\)'
)

always_logged_in_pattern = re.compile(
    r'alwaysLoggedIn:!([A-Za-z_$][\w$]*)\.IS_PLATFORM'
)

gtroute_url_literal_pattern = re.compile(
    r'url:"http://localhost:8000/auth/v1"'
)

gtroute_env_only_pattern = re.compile(
    r'url:process\.env\.NEXT_PUBLIC_GOTRUE_URL'
)

gtroute_url_chain_pattern = re.compile(
    r'process\.env\.NEXT_PUBLIC_GOTRUE_URL\|\|process\.env\.GOTRUE_EXTERNAL_URL\|\|process\.env\.GOTRUE_URL\|\|\(process\.env\.SUPABASE_PUBLIC_URL\?process\.env\.SUPABASE_PUBLIC_URL\.replace\(/\\/\$/,\"\"\)\+\"/auth/v1\":void 0\)\|\|\"http://localhost:8000/auth/v1\"'
)

patched_files = 0
renamed_assets: list[tuple[str, str, str, str]] = []

def replace_openai_provider(match: re.Match[str]) -> str:
    module_name = match.group(1)
    model_var = match.group(2)
    provider_factory = (
        f'((({env_expr("OPENAI_BASE_URL")}||{env_expr("AZURE_OPENAI_BASE_URL")}))&&{module_name}.createOpenAI'
        f'?{module_name}.createOpenAI({{'
        f'baseURL:{env_expr("OPENAI_BASE_URL")}||{env_expr("AZURE_OPENAI_BASE_URL")},'
        f'apiKey:{env_expr("OPENAI_API_KEY")},'
        f'headers:"true"==={env_expr("AZURE_OPENAI_USE_API_KEY_HEADER")}?{{"api-key":{env_expr("OPENAI_API_KEY")}}}:{{}}'
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
            f'baseURL:{env_expr("OPENAI_BASE_URL")}||{env_expr("AZURE_OPENAI_BASE_URL")}||void 0,'
            f'defaultQuery:{env_expr("OPENAI_API_VERSION")}?{{"api-version":{env_expr("OPENAI_API_VERSION")}}}:void 0,'
            f'defaultHeaders:"true"==={env_expr("AZURE_OPENAI_USE_API_KEY_HEADER")}?{{"api-key":{api_key_var}}}:void 0}}'
            f')'
        )

    updated = direct_openai_client_pattern.sub(replace_openai_client, updated)
    updated = always_logged_in_pattern.sub(
        f'alwaysLoggedIn:({env_flag("SUPABASE_FORCE_PLATFORM_LOGGED_IN")}||!\\1.IS_PLATFORM)',
        updated,
    )
    updated = gtroute_url_literal_pattern.sub(
        f'url:({env_expr("NEXT_PUBLIC_GOTRUE_URL")}||{env_expr("GOTRUE_EXTERNAL_URL")}||{env_expr("GOTRUE_URL")}||({env_expr("SUPABASE_PUBLIC_URL")}?{env_expr("SUPABASE_PUBLIC_URL")}.replace(/\\/$/,"")+"/auth/v1":void 0)||("undefined"!=typeof window&&window.location&&window.location.origin?window.location.origin.replace(/\\/$/,"")+"/auth/v1":"http://localhost:8000/auth/v1"))',
        updated,
    )
    updated = gtroute_env_only_pattern.sub(
        f'url:({env_expr("NEXT_PUBLIC_GOTRUE_URL")}||{env_expr("GOTRUE_EXTERNAL_URL")}||{env_expr("GOTRUE_URL")}||({env_expr("SUPABASE_PUBLIC_URL")}?{env_expr("SUPABASE_PUBLIC_URL")}.replace(/\\/$/,"")+"/auth/v1":void 0)||("undefined"!=typeof window&&window.location&&window.location.origin?window.location.origin.replace(/\\/$/,"")+"/auth/v1":"http://localhost:8000/auth/v1"))',
        updated,
    )
    updated = gtroute_url_chain_pattern.sub(
        f'{env_expr("NEXT_PUBLIC_GOTRUE_URL")}||{env_expr("GOTRUE_EXTERNAL_URL")}||{env_expr("GOTRUE_URL")}||({env_expr("SUPABASE_PUBLIC_URL")}?{env_expr("SUPABASE_PUBLIC_URL")}.replace(/\\/$/,"")+"/auth/v1":void 0)||("undefined"!=typeof window&&window.location&&window.location.origin?window.location.origin.replace(/\\/$/,"")+"/auth/v1":"http://localhost:8000/auth/v1")',
        updated,
    )

    if updated != original:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(updated)
        patched_files += 1

        if "/_next/" in path or "/static/" in path or "/chunks/" in path:
            directory = os.path.dirname(path)
            basename = os.path.basename(path)
            stem, extension = os.path.splitext(basename)
            content_hash = hashlib.sha1(updated.encode("utf-8")).hexdigest()[:12]
            new_basename = f"{stem}.patched.{content_hash}{extension}"
            new_path = os.path.join(directory, new_basename)
            with open(new_path, "w", encoding="utf-8") as handle:
                handle.write(updated)
            renamed_assets.append((path, basename, new_basename, new_path))

if renamed_assets:
    replaceable_files: list[str] = []
    for candidate in all_files:
        try:
            with open(candidate, "rb") as handle:
                sample = handle.read(4096)
            if b"\0" in sample:
                continue
        except OSError:
            continue
        replaceable_files.append(candidate)

    for candidate in replaceable_files:
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                original = handle.read()
        except (UnicodeDecodeError, OSError):
            continue

        updated = original
        for _, old_basename, new_basename, _ in renamed_assets:
            updated = updated.replace(old_basename, new_basename)

        if updated != original:
            with open(candidate, "w", encoding="utf-8") as handle:
                handle.write(updated)

print(f"patch-studio-ai: patched {patched_files} file(s)")
PY
