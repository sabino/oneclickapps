#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const prettier = require("prettier");

// Supabase is unusually large for a CapRover one-click app. This generator keeps
// the published YAML self-contained while letting us author the complex pieces as
// real Dockerfile/config templates under scripts/supabase-assets. The published
// result is a single full-stack `public/v4/apps/supabase.yml`.

class Literal {
  constructor(text) {
    this.text = text;
  }
}

const repoRoot = path.resolve(__dirname, "..");
const assetsRoot = path.join(__dirname, "supabase-assets");
const outputDir = path.join(repoRoot, "public", "v4", "apps");
const SUPABASE_SELF_HOST_DOCS = "https://supabase.com/docs/guides/self-hosting/docker";
const OVERLAY_CAPACITY_DOCS = "https://oneclickapps.sabino.pro/docs/increase-overlay-network-capacity/";
const BOOL_REGEX = "/^(true|false)$/";
const NUMBER_REGEX = "/^\\d+$/";
const IMAGE_TAG_REGEX = "/^([^\\s^\\/])+$/";
const DEFAULT_PUBLIC_URL = "https://$$cap_appname.$$cap_root_domain";

function readAsset(relativePath) {
  return fs.readFileSync(path.join(assetsRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function asQuoted(value) {
  if (value === null || value === undefined) {
    return '""';
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  return JSON.stringify(String(value));
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Literal);
}

function renderValue(value, indent) {
  if (value instanceof Literal) {
    const blockIndent = " ".repeat(indent + 2);
    return `|-\n${value.text
      .split("\n")
      .map((line) => `${blockIndent}${line}`)
      .join("\n")}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const pad = " ".repeat(indent);
    return value
      .map((item) => {
        if (item instanceof Literal) {
          const blockIndent = " ".repeat(indent + 4);
          return `${pad}- |-\n${item.text
            .split("\n")
            .map((line) => `${blockIndent}${line}`)
            .join("\n")}`;
        }

        if (isPlainObject(item)) {
          const lines = [`${pad}-`];
          for (const [key, nestedValue] of Object.entries(item)) {
            lines.push(`${" ".repeat(indent + 2)}${key}: ${renderValue(nestedValue, indent + 2)}`);
          }
          return lines.join("\n");
        }

        return `${pad}- ${asQuoted(item)}`;
      })
      .join("\n");
  }

  if (isPlainObject(value)) {
    const pad = " ".repeat(indent);
    return Object.entries(value)
      .map(([key, nestedValue]) => {
        if (Array.isArray(nestedValue) || isPlainObject(nestedValue) || nestedValue instanceof Literal) {
          return `${pad}${key}:\n${renderValue(nestedValue, indent + 4)}`;
        }

        return `${pad}${key}: ${renderValue(nestedValue, indent)}`;
      })
      .join("\n");
  }

  return asQuoted(value);
}

function writeFileInstruction(targetPath, content, executable = false) {
  const escaped = content
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/'/g, "'\"'\"'");
  const commands = [
    `mkdir -p ${path.posix.dirname(targetPath)}`,
    `printf '%b' '${escaped}' > ${targetPath}`,
  ];
  if (executable) {
    commands.push(`chmod +x ${targetPath}`);
  }
  return new Literal(`RUN ${commands.join(" && \\\n    ")}`);
}

function installOpenSslInstruction() {
  return new Literal(`RUN set -eux; \\
    if command -v apk >/dev/null 2>&1; then \\
      apk add --no-cache openssl; \\
    elif command -v apt-get >/dev/null 2>&1; then \\
      apt-get update; \\
      apt-get install -y --no-install-recommends openssl ca-certificates; \\
      rm -rf /var/lib/apt/lists/*; \\
    else \\
      echo "Unable to install openssl: unsupported base image" >&2; \\
      exit 1; \\
    fi`);
}

function transformKongConfig(raw) {
  const replacements = [
    ["http://auth:9999", "http://srv-captain--$$cap_appname-auth:9999"],
    ["http://rest:3000", "http://srv-captain--$$cap_appname-rest:3000"],
    ["http://realtime-dev.supabase-realtime:4000", "http://srv-captain--$$cap_appname-realtime:4000"],
    ["http://storage:5000", "http://srv-captain--$$cap_appname-storage:5000"],
    ["http://meta:8080", "http://srv-captain--$$cap_appname-meta:8080"],
    ["http://functions:9000", "http://srv-captain--$$cap_appname-functions:9000"],
    ["http://studio:3000", "http://srv-captain--$$cap_appname-studio:3000"],
    ["http://analytics:4000", "http://srv-captain--$$cap_appname-analytics:4000"],
  ];

  return replacements.reduce((acc, [from, to]) => acc.split(from).join(to), raw);
}

function transformVectorConfig(raw) {
  const replacements = [
    ['- supabase-vector', '- srv-captain--$$cap_appname-vector'],
    ['.project = "default"', '.project = "$$cap_appname"'],
    ['.appname == "supabase-kong"', 'contains(string!(.appname), "srv-captain--$$cap_appname") && !contains(string!(.appname), "-analytics") && !contains(string!(.appname), "-auth") && !contains(string!(.appname), "-db") && !contains(string!(.appname), "-functions") && !contains(string!(.appname), "-meta") && !contains(string!(.appname), "-realtime") && !contains(string!(.appname), "-rest") && !contains(string!(.appname), "-storage") && !contains(string!(.appname), "-studio") && !contains(string!(.appname), "-supavisor") && !contains(string!(.appname), "-vector")'],
    ['.appname == "supabase-auth"', 'contains(string!(.appname), "srv-captain--$$cap_appname-auth")'],
    ['.appname == "supabase-rest"', 'contains(string!(.appname), "srv-captain--$$cap_appname-rest")'],
    ['.appname == "realtime-dev.supabase-realtime"', 'contains(string!(.appname), "srv-captain--$$cap_appname-realtime")'],
    ['.appname == "supabase-storage"', 'contains(string!(.appname), "srv-captain--$$cap_appname-storage")'],
    ['.appname == "supabase-edge-functions"', 'contains(string!(.appname), "srv-captain--$$cap_appname-functions")'],
    ['.appname == "supabase-db"', 'contains(string!(.appname), "srv-captain--$$cap_appname-db")'],
  ];

  return replacements.reduce((acc, [from, to]) => acc.split(from).join(to), raw);
}

function transformPoolerConfig(raw) {
  return raw.split('"db"').join('"srv-captain--$$cap_appname-db"');
}

const internalPostgresPort = "5432";

function renderDockerfileTemplate(templateName, placeholderMap) {
  const template = readAsset(path.posix.join("dockerfiles", templateName));
  const lines = [];
  for (const line of template.split("\n")) {
    if (Object.prototype.hasOwnProperty.call(placeholderMap, line)) {
      const replacement = placeholderMap[line];
      if (Array.isArray(replacement)) {
        lines.push(...replacement);
      } else if (replacement !== undefined && replacement !== null) {
        lines.push(replacement);
      }
      continue;
    }
    lines.push(line);
  }
  return lines.filter((line) => line !== "");
}

function variable(id, label, defaultValue, options = {}) {
  return {
    id,
    label,
    defaultValue,
    ...options,
  };
}

function imageTagVariable(id, label, defaultValue, description) {
  return variable(id, label, defaultValue, {
    ...(description ? { description } : {}),
    validRegex: IMAGE_TAG_REGEX,
  });
}

function booleanVariable(id, label, defaultValue, description) {
  return variable(id, label, defaultValue, {
    ...(description ? { description } : {}),
    validRegex: BOOL_REGEX,
  });
}

function numericVariable(id, label, defaultValue, description) {
  return variable(id, label, defaultValue, {
    ...(description ? { description } : {}),
    validRegex: NUMBER_REGEX,
  });
}

const kongDockerfileLines = renderDockerfileTemplate("kong.Dockerfile", {
  __INSTALL_OPENSSL__: null,
  __WRITE_LEGACY_KEYS_LIB__: writeFileInstruction(
    "/tmp/legacy-keys.sh",
    readAsset("common/legacy-keys.sh"),
    true,
  ),
  __WRITE_KONG_TEMPLATE__: writeFileInstruction(
    "/tmp/kong-template.yml",
    transformKongConfig(readAsset("api/kong.yml")),
  ),
  __WRITE_KONG_ENTRYPOINT__: writeFileInstruction(
    "/tmp/kong-entrypoint.sh",
    readAsset("api/kong-entrypoint.sh").replaceAll("/usr/local/bin/legacy-keys.sh", "/tmp/legacy-keys.sh"),
    true,
  ),
});

const studioDockerfileLines = renderDockerfileTemplate("studio.Dockerfile", {
  __INSTALL_OPENSSL__: null,
  __WRITE_LEGACY_KEYS_LIB__: writeFileInstruction(
    "/usr/local/bin/legacy-keys.sh",
    readAsset("common/legacy-keys.sh"),
    true,
  ),
  __WRITE_STUDIO_AI_PATCH__: writeFileInstruction(
    "/usr/local/bin/patch-studio-ai.sh",
    readAsset("studio/patch-studio-ai.sh"),
    true,
  ),
  __WRITE_DOCKER_ENTRYPOINT_WRAPPER__: writeFileInstruction(
    "/usr/local/bin/with-legacy-keys-and-ai-patch-docker-entrypoint.sh",
    readAsset("studio/with-legacy-keys-and-ai-patch-docker-entrypoint.sh"),
    true,
  ),
});

const storageDockerfileLines = renderDockerfileTemplate("storage.Dockerfile", {
  __INSTALL_OPENSSL__: installOpenSslInstruction(),
  __WRITE_LEGACY_KEYS_LIB__: writeFileInstruction(
    "/usr/local/bin/legacy-keys.sh",
    readAsset("common/legacy-keys.sh"),
    true,
  ),
  __WRITE_DOCKER_ENTRYPOINT_WRAPPER__: writeFileInstruction(
    "/usr/local/bin/with-legacy-keys-docker-entrypoint.sh",
    readAsset("common/with-legacy-keys-docker-entrypoint.sh"),
    true,
  ),
});

const dbDockerfileLines = renderDockerfileTemplate("db.Dockerfile", {
  __WRITE_DB_SUPABASE_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/migrations/97-_supabase.sql",
    readAsset("db/_supabase.sql"),
  ),
  __WRITE_DB_JWT_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql",
    readAsset("db/jwt.sql"),
  ),
  __WRITE_DB_LOGS_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/migrations/99-logs.sql",
    readAsset("db/logs.sql"),
  ),
  __WRITE_DB_POOLER_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/migrations/99-pooler.sql",
    readAsset("db/pooler.sql"),
  ),
  __WRITE_DB_REALTIME_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/migrations/99-realtime.sql",
    readAsset("db/realtime.sql"),
  ),
  __WRITE_DB_ROLES_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/init-scripts/99-roles.sql",
    readAsset("db/roles.sql"),
  ),
  __WRITE_DB_WEBHOOKS_SQL__: writeFileInstruction(
    "/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql",
    readAsset("db/webhooks.sql"),
  ),
});

const vectorDockerfileLines = renderDockerfileTemplate("vector.Dockerfile", {
  __WRITE_VECTOR_CONFIG__: writeFileInstruction(
    "/etc/vector/vector.yml",
    transformVectorConfig(readAsset("logs/vector.yml")),
  ),
});

const supavisorDockerfileLines = renderDockerfileTemplate("supavisor.Dockerfile", {
  __WRITE_POOLER_CONFIG__: writeFileInstruction(
    "/etc/pooler/pooler.exs",
    transformPoolerConfig(readAsset("pooler/pooler.exs")),
  ),
});

const functionsDockerfileLines = renderDockerfileTemplate("functions.Dockerfile", {
  __INSTALL_OPENSSL__: null,
  __WRITE_LEGACY_KEYS_LIB__: writeFileInstruction(
    "/usr/local/bin/legacy-keys.sh",
    readAsset("common/legacy-keys.sh"),
    true,
  ),
  __WRITE_FUNCTION_HELLO__: writeFileInstruction(
    "/opt/default-functions/hello/index.ts",
    readAsset("functions/hello/index.ts"),
  ),
  __WRITE_FUNCTION_MAIN__: writeFileInstruction(
    "/opt/default-functions/main/index.ts",
    readAsset("functions/main/index.ts"),
  ),
  __WRITE_FUNCTION_SEED_ENTRYPOINT__: writeFileInstruction(
    "/usr/local/bin/seed-functions.sh",
    readAsset("functions/seed-functions.sh"),
    true,
  ),
});

const dnsrrServiceOverride = {
  EndpointSpec: {
    Mode: "dnsrr",
  },
};

const persistentDnsrrServiceOverride = {
  EndpointSpec: {
    Mode: "dnsrr",
  },
  UpdateConfig: {
    Order: "stop-first",
  },
};

// CapRover's one-click installer can mis-handle some persistent app registrations
// inside large one-click templates. Keep the shared mounts limited to the folders
// that are required for self-hosted parity: storage data, Studio snippets, and
// the Edge Functions management folder that is shared between Studio and runtime.
const sharedStorageVolume = "$$cap_appname-storage-data:/var/lib/storage";
const sharedFunctionsVolume = "$$cap_appname-functions-data";
const sharedFunctionsStudioMount = `${sharedFunctionsVolume}:/app/edge-functions`;
const sharedFunctionsRuntimeMount = `${sharedFunctionsVolume}:/home/deno/functions`;
const sharedStudioSnippetsMount = "$$cap_appname-studio-snippets:/app/snippets";

const allServices = {
  "$$cap_appname-studio": {
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-meta"],
    volumes: [sharedStudioSnippetsMount, sharedFunctionsStudioMount],
    environment: {
      HOSTNAME: "::",
      STUDIO_PG_META_URL: "http://srv-captain--$$cap_appname-meta:8080",
      POSTGRES_PORT: internalPostgresPort,
      POSTGRES_HOST: "srv-captain--$$cap_appname-db",
      POSTGRES_DB: "$$cap_postgres_db",
      POSTGRES_PASSWORD: "$$cap_postgres_password",
      PG_META_CRYPTO_KEY: "$$cap_pg_meta_crypto_key",
      PGRST_DB_SCHEMAS: "$$cap_pgrst_db_schemas",
      PGRST_DB_MAX_ROWS: "$$cap_pgrst_db_max_rows",
      PGRST_DB_EXTRA_SEARCH_PATH: "$$cap_pgrst_db_extra_search_path",
      DEFAULT_ORGANIZATION_NAME: "$$cap_studio_default_organization",
      DEFAULT_PROJECT_NAME: "$$cap_studio_default_project",
      OPENAI_API_KEY: "$$cap_openai_api_key",
      OPENAI_BASE_URL: "$$cap_openai_base_url",
      OPENAI_API_VERSION: "$$cap_openai_api_version",
      OPENAI_MODEL: "$$cap_openai_model",
      OPENAI_ADVANCE_MODEL: "$$cap_openai_advance_model",
      AZURE_OPENAI_USE_API_KEY_HEADER: "$$cap_azure_openai_use_api_key_header",
      JWT_SECRET: "$$cap_jwt_secret",
      SUPABASE_URL: "http://srv-captain--$$cap_appname:8000",
      SUPABASE_PUBLIC_URL: DEFAULT_PUBLIC_URL,
      SUPABASE_ANON_KEY: "$$cap_anon_key",
      SUPABASE_SERVICE_KEY: "$$cap_service_role_key",
      AUTH_JWT_SECRET: "$$cap_jwt_secret",
      SNIPPETS_MANAGEMENT_FOLDER: "/app/snippets",
      EDGE_FUNCTIONS_MANAGEMENT_FOLDER: "/app/edge-functions",
      NEXT_PUBLIC_ENABLE_LOGS: "false",
      LOGFLARE_URL: "http://srv-captain--$$cap_appname-analytics:4000",
      LOGFLARE_PRIVATE_ACCESS_TOKEN: "$$cap_logflare_private_access_token",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      dockerfileLines: studioDockerfileLines,
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname": {
    restart: "unless-stopped",
    environment: {
      KONG_DATABASE: "off",
      KONG_DECLARATIVE_CONFIG: "/tmp/kong.yml",
      KONG_DNS_ORDER: "LAST,A,CNAME",
      KONG_DNS_NOT_FOUND_TTL: "1",
      KONG_PLUGINS:
        "request-transformer,cors,key-auth,acl,basic-auth,request-termination,ip-restriction,post-function",
      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: "160k",
      KONG_NGINX_PROXY_PROXY_BUFFERS: "64 160k",
      KONG_PROXY_ACCESS_LOG: "/dev/stdout combined",
      JWT_SECRET: "$$cap_jwt_secret",
      SUPABASE_ANON_KEY: "$$cap_anon_key",
      SUPABASE_SERVICE_KEY: "$$cap_service_role_key",
      SUPABASE_PUBLISHABLE_KEY: "$$cap_publishable_key",
      SUPABASE_SECRET_KEY: "$$cap_secret_key",
      ANON_KEY_ASYMMETRIC: "$$cap_anon_key_asymmetric",
      SERVICE_ROLE_KEY_ASYMMETRIC: "$$cap_service_role_key_asymmetric",
      DASHBOARD_USERNAME: "$$cap_dashboard_username",
      DASHBOARD_PASSWORD: "$$cap_dashboard_password",
    },
    depends_on: ["$$cap_appname-studio"],
    caproverExtra: {
      containerHttpPort: "8000",
      websocketSupport: "true",
      dockerfileLines: kongDockerfileLines,
    },
  },
  "$$cap_appname-auth": {
    image: "supabase/gotrue:$$cap_auth_version",
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db"],
    environment: {
      GOTRUE_API_HOST: "0.0.0.0",
      GOTRUE_API_PORT: "9999",
      API_EXTERNAL_URL: DEFAULT_PUBLIC_URL,
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_DATABASE_URL:
        `postgres://supabase_auth_admin:$$cap_postgres_password@srv-captain--$$cap_appname-db:${internalPostgresPort}/$$cap_postgres_db`,
      GOTRUE_SITE_URL: DEFAULT_PUBLIC_URL,
      GOTRUE_URI_ALLOW_LIST: "$$cap_additional_redirect_urls",
      GOTRUE_DISABLE_SIGNUP: "$$cap_disable_signup",
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
      GOTRUE_JWT_EXP: "$$cap_jwt_expiry",
      GOTRUE_JWT_SECRET: "$$cap_jwt_secret",
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "$$cap_enable_email_signup",
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "$$cap_enable_anonymous_users",
      GOTRUE_MAILER_AUTOCONFIRM: "$$cap_enable_email_autoconfirm",
      GOTRUE_SMTP_ADMIN_EMAIL: "$$cap_smtp_admin_email",
      GOTRUE_SMTP_HOST: "$$cap_smtp_host",
      GOTRUE_SMTP_PORT: "$$cap_smtp_port",
      GOTRUE_SMTP_USER: "$$cap_smtp_user",
      GOTRUE_SMTP_PASS: "$$cap_smtp_pass",
      GOTRUE_SMTP_SENDER_NAME: "$$cap_smtp_sender_name",
      GOTRUE_MAILER_URLPATHS_INVITE: "$$cap_mailer_invite_path",
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: "$$cap_mailer_confirmation_path",
      GOTRUE_MAILER_URLPATHS_RECOVERY: "$$cap_mailer_recovery_path",
      GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: "$$cap_mailer_email_change_path",
      GOTRUE_EXTERNAL_PHONE_ENABLED: "$$cap_enable_phone_signup",
      GOTRUE_SMS_AUTOCONFIRM: "$$cap_enable_phone_autoconfirm",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-rest": {
    image: "postgrest/postgrest:$$cap_rest_version",
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db"],
    environment: {
      PGRST_DB_URI:
        `postgres://authenticator:$$cap_postgres_password@srv-captain--$$cap_appname-db:${internalPostgresPort}/$$cap_postgres_db`,
      PGRST_DB_SCHEMAS: "$$cap_pgrst_db_schemas",
      PGRST_DB_MAX_ROWS: "$$cap_pgrst_db_max_rows",
      PGRST_DB_EXTRA_SEARCH_PATH: "$$cap_pgrst_db_extra_search_path",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: "$$cap_jwt_secret",
      PGRST_DB_USE_LEGACY_GUCS: "false",
      PGRST_APP_SETTINGS_JWT_SECRET: "$$cap_jwt_secret",
      PGRST_APP_SETTINGS_JWT_EXP: "$$cap_jwt_expiry",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-realtime": {
    image: "supabase/realtime:$$cap_realtime_version",
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db"],
    environment: {
      PORT: "4000",
      DB_HOST: "srv-captain--$$cap_appname-db",
      DB_PORT: internalPostgresPort,
      DB_USER: "supabase_admin",
      DB_PASSWORD: "$$cap_postgres_password",
      DB_NAME: "$$cap_postgres_db",
      DB_AFTER_CONNECT_QUERY: "SET search_path TO _realtime",
      DB_ENC_KEY: "supabaserealtime",
      API_JWT_SECRET: "$$cap_jwt_secret",
      SECRET_KEY_BASE: "$$cap_secret_key_base",
      METRICS_JWT_SECRET: "$$cap_jwt_secret",
      ERL_AFLAGS: "-proto_dist inet_tcp",
      DNS_NODES: "''",
      RLIMIT_NOFILE: "10000",
      APP_NAME: "realtime",
      SEED_SELF_HOST: "true",
      RUN_JANITOR: "true",
      DISABLE_HEALTHCHECK_LOGGING: "true",
    },
    hostname: "realtime-dev.supabase-realtime",
    caproverExtra: {
      notExposeAsWebApp: "true",
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-storage": {
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db", "$$cap_appname-rest", "$$cap_appname-imgproxy"],
    volumes: [sharedStorageVolume],
    environment: {
      ANON_KEY: "$$cap_anon_key",
      SERVICE_KEY: "$$cap_service_role_key",
      JWT_SECRET: "$$cap_jwt_secret",
      POSTGREST_URL: "http://srv-captain--$$cap_appname-rest:3000",
      AUTH_JWT_SECRET: "$$cap_jwt_secret",
      DATABASE_URL:
        `postgres://supabase_storage_admin:$$cap_postgres_password@srv-captain--$$cap_appname-db:${internalPostgresPort}/$$cap_postgres_db`,
      STORAGE_PUBLIC_URL: DEFAULT_PUBLIC_URL,
      REQUEST_ALLOW_X_FORWARDED_PATH: "true",
      FILE_SIZE_LIMIT: "$$cap_storage_file_size_limit",
      STORAGE_BACKEND: "file",
      GLOBAL_S3_BUCKET: "$$cap_global_s3_bucket",
      FILE_STORAGE_BACKEND_PATH: "/var/lib/storage",
      TENANT_ID: "$$cap_storage_tenant_id",
      REGION: "$$cap_storage_region",
      ENABLE_IMAGE_TRANSFORMATION: "true",
      IMGPROXY_URL: "http://srv-captain--$$cap_appname-imgproxy:5001",
      S3_PROTOCOL_ACCESS_KEY_ID: "$$cap_s3_protocol_access_key_id",
      S3_PROTOCOL_ACCESS_KEY_SECRET: "$$cap_s3_protocol_access_key_secret",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      dockerfileLines: storageDockerfileLines,
      serviceUpdateOverride: persistentDnsrrServiceOverride,
    },
  },
  "$$cap_appname-imgproxy": {
    image: "darthsim/imgproxy:$$cap_imgproxy_version",
    restart: "unless-stopped",
    volumes: [sharedStorageVolume],
    environment: {
      IMGPROXY_BIND: ":5001",
      IMGPROXY_LOCAL_FILESYSTEM_ROOT: "/",
      IMGPROXY_USE_ETAG: "true",
      IMGPROXY_AUTO_WEBP: "$$cap_imgproxy_auto_webp",
      IMGPROXY_MAX_SRC_RESOLUTION: "16.8",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      serviceUpdateOverride: persistentDnsrrServiceOverride,
    },
  },
  "$$cap_appname-meta": {
    image: "supabase/postgres-meta:$$cap_meta_version",
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db"],
    environment: {
      PG_META_PORT: "8080",
      PG_META_DB_HOST: "srv-captain--$$cap_appname-db",
      PG_META_DB_PORT: internalPostgresPort,
      PG_META_DB_NAME: "$$cap_postgres_db",
      PG_META_DB_USER: "supabase_admin",
      PG_META_DB_PASSWORD: "$$cap_postgres_password",
      CRYPTO_KEY: "$$cap_pg_meta_crypto_key",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-functions": {
    restart: "unless-stopped",
    depends_on: ["$$cap_appname"],
    volumes: [sharedFunctionsRuntimeMount],
    environment: {
      JWT_SECRET: "$$cap_jwt_secret",
      SUPABASE_URL: "http://srv-captain--$$cap_appname:8000",
      SUPABASE_PUBLIC_URL: DEFAULT_PUBLIC_URL,
      SUPABASE_ANON_KEY: "$$cap_anon_key",
      SUPABASE_SERVICE_ROLE_KEY: "$$cap_service_role_key",
      SUPABASE_PUBLISHABLE_KEYS: "{\"default\":\"$$cap_publishable_key\"}",
      SUPABASE_SECRET_KEYS: "{\"default\":\"$$cap_secret_key\"}",
      SUPABASE_DB_URL:
        `postgresql://postgres:$$cap_postgres_password@srv-captain--$$cap_appname-db:${internalPostgresPort}/$$cap_postgres_db`,
      VERIFY_JWT: "$$cap_functions_verify_jwt",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      dockerfileLines: functionsDockerfileLines,
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-analytics": {
    image: "supabase/logflare:$$cap_analytics_version",
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db"],
    environment: {
      LOGFLARE_NODE_HOST: "127.0.0.1",
      DB_USERNAME: "supabase_admin",
      DB_DATABASE: "_supabase",
      DB_HOSTNAME: "srv-captain--$$cap_appname-db",
      DB_PORT: internalPostgresPort,
      DB_PASSWORD: "$$cap_postgres_password",
      DB_SCHEMA: "_analytics",
      LOGFLARE_PUBLIC_ACCESS_TOKEN: "$$cap_logflare_public_access_token",
      LOGFLARE_PRIVATE_ACCESS_TOKEN: "$$cap_logflare_private_access_token",
      LOGFLARE_SINGLE_TENANT: "true",
      LOGFLARE_SUPABASE_MODE: "true",
      POSTGRES_BACKEND_URL:
        `postgresql://supabase_admin:$$cap_postgres_password@srv-captain--$$cap_appname-db:${internalPostgresPort}/_supabase`,
      POSTGRES_BACKEND_SCHEMA: "_analytics",
      LOGFLARE_FEATURE_FLAG_OVERRIDE: "multibackend=true",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-db": {
    restart: "unless-stopped",
    volumes: [
      "$$cap_appname-db-data:/var/lib/postgresql/data",
      "$$cap_appname-db-config:/etc/postgresql-custom",
    ],
    environment: {
      POSTGRES_HOST: "/var/run/postgresql",
      PGPORT: internalPostgresPort,
      POSTGRES_PORT: internalPostgresPort,
      PGPASSWORD: "$$cap_postgres_password",
      POSTGRES_PASSWORD: "$$cap_postgres_password",
      PGDATABASE: "$$cap_postgres_db",
      POSTGRES_DB: "$$cap_postgres_db",
      JWT_SECRET: "$$cap_jwt_secret",
      JWT_EXP: "$$cap_jwt_expiry",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      dockerfileLines: dbDockerfileLines,
      serviceUpdateOverride: persistentDnsrrServiceOverride,
    },
  },
  "$$cap_appname-vector": {
    restart: "unless-stopped",
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
    environment: {
      LOGFLARE_PUBLIC_ACCESS_TOKEN: "$$cap_logflare_public_access_token",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      dockerfileLines: vectorDockerfileLines,
      serviceUpdateOverride: dnsrrServiceOverride,
    },
  },
  "$$cap_appname-supavisor": {
    restart: "unless-stopped",
    depends_on: ["$$cap_appname-db"],
    ports: [
      "$$cap_postgres_session_port:5432",
      "$$cap_postgres_transaction_port:6543",
    ],
    environment: {
      PORT: "4000",
      POSTGRES_PORT: internalPostgresPort,
      POSTGRES_DB: "$$cap_postgres_db",
      POSTGRES_PASSWORD: "$$cap_postgres_password",
      DATABASE_URL:
        `ecto://supabase_admin:$$cap_postgres_password@srv-captain--$$cap_appname-db:${internalPostgresPort}/_supabase`,
      CLUSTER_POSTGRES: "true",
      SECRET_KEY_BASE: "$$cap_secret_key_base",
      VAULT_ENC_KEY: "$$cap_vault_enc_key",
      API_JWT_SECRET: "$$cap_jwt_secret",
      METRICS_JWT_SECRET: "$$cap_jwt_secret",
      REGION: "local",
      ERL_AFLAGS: "-proto_dist inet_tcp",
      POOLER_TENANT_ID: "$$cap_pooler_tenant_id",
      POOLER_DEFAULT_POOL_SIZE: "$$cap_pooler_default_pool_size",
      POOLER_MAX_CLIENT_CONN: "$$cap_pooler_max_client_conn",
      POOLER_POOL_MODE: "transaction",
      DB_POOL_SIZE: "$$cap_pooler_db_pool_size",
    },
    caproverExtra: {
      notExposeAsWebApp: "true",
      dockerfileLines: supavisorDockerfileLines,
    },
  },
};

const imageVersionVariables = [
  imageTagVariable(
    "$$cap_studio_version",
    "Studio image tag",
    "2026.03.16-sha-5528817",
    "Pinned from the current official Supabase self-host Docker stack.",
  ),
  imageTagVariable("$$cap_kong_version", "Kong image tag", "3.9.1"),
  imageTagVariable("$$cap_auth_version", "Auth image tag", "v2.186.0"),
  imageTagVariable("$$cap_rest_version", "PostgREST image tag", "v14.6"),
  imageTagVariable("$$cap_realtime_version", "Realtime image tag", "v2.76.5"),
  imageTagVariable("$$cap_storage_version", "Storage image tag", "v1.44.2"),
  imageTagVariable("$$cap_imgproxy_version", "imgproxy image tag", "v3.30.1"),
  imageTagVariable("$$cap_meta_version", "postgres-meta image tag", "v0.95.2"),
  imageTagVariable("$$cap_functions_version", "Edge Runtime image tag", "v1.71.2"),
  imageTagVariable("$$cap_analytics_version", "Analytics image tag", "1.31.2"),
  imageTagVariable("$$cap_db_version", "Postgres image tag", "15.8.1.085"),
  imageTagVariable("$$cap_vector_version", "Vector image tag", "0.53.0-alpine"),
  imageTagVariable("$$cap_supavisor_version", "Supavisor image tag", "2.7.4"),
];

const routingVariables = [
  variable("$$cap_additional_redirect_urls", "Additional redirect URLs", "", {
    description: "Comma-separated or blank.",
  }),
];

const postgresVariables = [
  variable("$$cap_postgres_db", "Postgres database", "postgres", { validRegex: "/.{1,}/" }),
  variable("$$cap_postgres_password", "Postgres password", "$$cap_gen_random_hex(32)", {
    validRegex: "/.{1,}/",
  }),
  variable("$$cap_postgres_session_port", "Supavisor session mode port", "", {
    description:
      "Required unique host port for direct public/session-mode pooler access. Choose an unused port on this CapRover host.",
    validRegex: NUMBER_REGEX,
  }),
  variable("$$cap_postgres_transaction_port", "Supavisor transaction mode port", "", {
    description:
      "Required unique host port for direct public/transaction-mode pooler access. Choose an unused port on this CapRover host.",
    validRegex: NUMBER_REGEX,
  }),
];

const keyVariables = [
  variable("$$cap_jwt_secret", "JWT secret", "$$cap_gen_random_hex(64)", {
    description:
      "Required shared signing secret. Legacy anon and service_role API keys are auto-generated from this value when left blank.",
    validRegex: "/.{32,}/",
  }),
  variable("$$cap_anon_key", "ANON_KEY", "", {
    description: "Optional override. Leave blank to auto-generate a legacy anon API key from JWT secret.",
  }),
  variable("$$cap_service_role_key", "SERVICE_ROLE_KEY", "", {
    description:
      "Optional override. Leave blank to auto-generate a legacy service_role API key from JWT secret.",
  }),
  variable("$$cap_publishable_key", "SUPABASE_PUBLISHABLE_KEY", "", {
    description:
      "Optional advanced override for opaque publishable keys. Leave blank for the simpler legacy-key flow.",
  }),
  variable("$$cap_secret_key", "SUPABASE_SECRET_KEY", "", {
    description: "Optional advanced override for opaque secret keys. Leave blank for the simpler legacy-key flow.",
  }),
  variable("$$cap_anon_key_asymmetric", "ANON_KEY_ASYMMETRIC", "", {
    description: "Optional advanced override used only with opaque keys.",
  }),
  variable("$$cap_service_role_key_asymmetric", "SERVICE_ROLE_KEY_ASYMMETRIC", "", {
    description: "Optional advanced override used only with opaque keys.",
  }),
  variable("$$cap_dashboard_username", "Dashboard username", "supabase", { validRegex: "/.{1,}/" }),
  variable("$$cap_dashboard_password", "Dashboard password", "supa$$cap_gen_random_hex(16)", {
    description: "Must include at least one letter and avoid special characters.",
    validRegex: "/.{8,}/",
  }),
  variable("$$cap_secret_key_base", "SECRET_KEY_BASE", "$$cap_gen_random_hex(64)", {
    validRegex: "/.{64,}/",
  }),
  variable("$$cap_vault_enc_key", "VAULT_ENC_KEY", "$$cap_gen_random_hex(32)", {
    description: "Exactly 32 characters.",
    validRegex: "/^.{32}$/",
  }),
  variable("$$cap_pg_meta_crypto_key", "PG_META_CRYPTO_KEY", "$$cap_gen_random_hex(48)", {
    validRegex: "/.{32,}/",
  }),
  variable("$$cap_logflare_public_access_token", "LOGFLARE_PUBLIC_ACCESS_TOKEN", "$$cap_gen_random_hex(48)", {
    validRegex: "/.{32,}/",
  }),
  variable("$$cap_logflare_private_access_token", "LOGFLARE_PRIVATE_ACCESS_TOKEN", "$$cap_gen_random_hex(48)", {
    validRegex: "/.{32,}/",
  }),
  variable("$$cap_s3_protocol_access_key_id", "S3 protocol access key id", "$$cap_gen_random_hex(32)", {
    validRegex: "/.{1,}/",
  }),
  variable(
    "$$cap_s3_protocol_access_key_secret",
    "S3 protocol access key secret",
    "$$cap_gen_random_hex(64)",
    { validRegex: "/.{1,}/" },
  ),
];

const poolerVariables = [
  variable("$$cap_pooler_tenant_id", "Supavisor tenant id", "$$cap_appname", {
    validRegex: "/.{1,}/",
  }),
  numericVariable("$$cap_pooler_default_pool_size", "Supavisor default pool size", "20"),
  numericVariable("$$cap_pooler_max_client_conn", "Supavisor max client connections", "100"),
  numericVariable("$$cap_pooler_db_pool_size", "Supavisor internal DB pool size", "5"),
];

const studioVariables = [
  variable("$$cap_studio_default_organization", "Studio default organization", "Default Organization"),
  variable("$$cap_studio_default_project", "Studio default project", "Default Project"),
];

const aiVariables = [
  variable("$$cap_openai_api_key", "Optional OpenAI API key for Studio AI features", ""),
  variable("$$cap_openai_base_url", "Optional OpenAI base URL", "", {
    description:
      "Use for OpenAI-compatible endpoints, including Azure OpenAI v1-style endpoints such as https://YOUR-RESOURCE.openai.azure.com/openai/v1",
  }),
  variable("$$cap_openai_api_version", "Optional OpenAI API version", "", {
    description:
      "Only needed for providers that still require an api-version query parameter. Leave blank for standard OpenAI and Azure v1-style endpoints.",
  }),
  variable("$$cap_openai_model", "Studio default OpenAI model", "gpt-5-mini"),
  variable("$$cap_openai_advance_model", "Studio advanced OpenAI model", "gpt-5"),
  booleanVariable(
    "$$cap_azure_openai_use_api_key_header",
    "Use Azure api-key header for Studio AI",
    "false",
    "Enable this if your compatible endpoint expects the Azure OpenAI api-key header instead of the default Authorization bearer header.",
  ),
];

const authVariables = [
  booleanVariable("$$cap_disable_signup", "Disable signup", "false"),
  numericVariable("$$cap_jwt_expiry", "JWT expiry seconds", "3600"),
  booleanVariable("$$cap_enable_email_signup", "Enable email signup", "true"),
  booleanVariable("$$cap_enable_email_autoconfirm", "Enable email autoconfirm", "false"),
  booleanVariable("$$cap_enable_anonymous_users", "Enable anonymous users", "false"),
  booleanVariable("$$cap_enable_phone_signup", "Enable phone signup", "true"),
  booleanVariable("$$cap_enable_phone_autoconfirm", "Enable phone autoconfirm", "true"),
  variable("$$cap_smtp_admin_email", "SMTP admin email", "noreply@$$cap_root_domain"),
  variable("$$cap_smtp_host", "SMTP host", ""),
  numericVariable("$$cap_smtp_port", "SMTP port", "587"),
  variable("$$cap_smtp_user", "SMTP username", ""),
  variable("$$cap_smtp_pass", "SMTP password", ""),
  variable("$$cap_smtp_sender_name", "SMTP sender name", "Supabase"),
  variable("$$cap_mailer_invite_path", "Mailer invite path", "/auth/v1/verify"),
  variable("$$cap_mailer_confirmation_path", "Mailer confirmation path", "/auth/v1/verify"),
  variable("$$cap_mailer_recovery_path", "Mailer recovery path", "/auth/v1/verify"),
  variable("$$cap_mailer_email_change_path", "Mailer email change path", "/auth/v1/verify"),
];

const apiVariables = [
  variable("$$cap_pgrst_db_schemas", "PostgREST schemas", "public"),
  numericVariable("$$cap_pgrst_db_max_rows", "PostgREST max rows", "1000"),
  variable("$$cap_pgrst_db_extra_search_path", "PostgREST extra search path", "public"),
  numericVariable("$$cap_storage_file_size_limit", "Storage file size limit bytes", "52428800"),
  variable("$$cap_global_s3_bucket", "Storage bucket/directory name", "$$cap_appname"),
  variable("$$cap_storage_region", "Storage region identifier", "local"),
  variable("$$cap_storage_tenant_id", "Storage tenant id", "$$cap_appname"),
  booleanVariable("$$cap_imgproxy_auto_webp", "imgproxy auto webp", "true"),
  booleanVariable("$$cap_functions_verify_jwt", "Verify JWT in Edge Functions", "false"),
];

const allVariables = [
  ...imageVersionVariables,
  ...routingVariables,
  ...postgresVariables,
  ...keyVariables,
  ...poolerVariables,
  ...studioVariables,
  ...aiVariables,
  ...authVariables,
  ...apiVariables,
];

function pickEntries(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function renderDocument(document) {
  const yamlLines = [];

  yamlLines.push(`captainVersion: ${document.captainVersion}`);
  yamlLines.push("services:");
  for (const [serviceName, serviceConfig] of Object.entries(document.services)) {
    yamlLines.push(`    ${serviceName}:`);
    for (const [key, value] of Object.entries(serviceConfig)) {
      if (Array.isArray(value) || isPlainObject(value) || value instanceof Literal) {
        yamlLines.push(`        ${key}:`);
        const rendered = renderValue(value, 12);
        yamlLines.push(...rendered.split("\n"));
      } else {
        yamlLines.push(`        ${key}: ${renderValue(value, 8)}`);
      }
    }
  }

  yamlLines.push("caproverOneClickApp:");
  for (const [key, value] of Object.entries(document.caproverOneClickApp)) {
    if (Array.isArray(value) || isPlainObject(value) || value instanceof Literal) {
      yamlLines.push(`    ${key}:`);
      const rendered = renderValue(value, 8);
      yamlLines.push(...rendered.split("\n"));
    } else {
      yamlLines.push(`    ${key}: ${renderValue(value, 4)}`);
    }
  }

  return yamlLines.join("\n");
}

function writeTemplate(outputFilename, document) {
  const outputPath = path.join(outputDir, outputFilename);
  const generatedHeader = [
    "# This file is generated by scripts/generate_supabase.js.",
    `# Do not edit public/v4/apps/${outputFilename} by hand; update the generator or`,
    "# files under scripts/supabase-assets/ and then run `npm run generate_supabase`.",
    "",
  ].join("\n");

  const formattedYaml = prettier.format(`${generatedHeader}${renderDocument(document)}\n`, {
    parser: "yaml",
  });

  fs.writeFileSync(outputPath, formattedYaml);
  console.log(`Wrote ${outputPath}`);
}

function buildTemplateDocument({
  services,
  variables,
  displayName,
  description,
  startInstructions,
  endInstructions,
}) {
  return {
    captainVersion: 4,
    services,
    caproverOneClickApp: {
      variables,
      instructions: {
        start: startInstructions,
        end: endInstructions,
      },
      displayName,
      isOfficial: true,
      description,
      documentation: SUPABASE_SELF_HOST_DOCS,
    },
  };
}

const overlayCapacityWarning =
  `If deployment fails with \`No NodeId was found\` or Docker logs mention \`could not find an available IP while allocating VIP\`, your shared CapRover swarm overlay is out of addresses. Remove unused services or follow the overlay capacity guide at ${OVERLAY_CAPACITY_DOCS} before retrying.`;
const kongHttpsReminder =
  "After deploy, enable HTTPS/TLS on the `$$cap_appname` service in CapRover. Kong is the public Supabase gateway and should be the service behind your domain and certificate.";

writeTemplate(
  "supabase.yml",
  buildTemplateDocument({
    services: allServices,
    variables: allVariables,
    displayName: "Supabase",
    description:
      "Full self-hosted Supabase stack for CapRover, updated to the current Docker-based deployment layout.",
    startInstructions: `Deploys the current full Supabase self-host Docker stack on CapRover using baked-in upstream config assets. Most fields already have safe defaults; in the common case you only need the app name and can leave the advanced overrides alone.\n\n${overlayCapacityWarning}`,
    endInstructions: `Supabase is deployed behind Kong at https://$$cap_appname.$$cap_root_domain by default. Studio, Auth, REST, Storage, Realtime, Functions, Postgres, Supavisor, and Analytics are included. Review the generated secrets, set a custom domain if needed, and test Studio plus the core APIs after deploy.\n\nSupavisor publishes the two host ports you selected for direct external pooler access. When installing more than one Supabase stack on the same host, these ports must be unique per install.\n\n${kongHttpsReminder}`,
  }),
);
