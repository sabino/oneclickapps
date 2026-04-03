#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const prettier = require("prettier");

class Literal {
  constructor(text) {
    this.text = text;
  }
}

const repoRoot = path.resolve(__dirname, "..");
const assetsRoot = path.join(__dirname, "airbyte-assets");
const outputPath = path.join(repoRoot, "public", "v4", "apps", "airbyte.yml");
const docsUrl = "https://docs.airbyte.com/platform/using-airbyte/getting-started/oss-quickstart";
const boolRegex = "/^(true|false)$/";
const numberRegex = "/^\\d+$/";
const imageTagRegex = "/^([^\\s^\\/])+$/";
const modeRegex = "/^(install|uninstall)$/";

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
          return `${pad}${key}:\n${renderValue(nestedValue, indent + 2)}`;
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
    if (line !== "") {
      lines.push(line);
    }
  }
  return lines;
}

function variable(id, label, defaultValue, options = {}) {
  return { id, label, defaultValue, ...options };
}

function booleanVariable(id, label, defaultValue, description) {
  return variable(id, label, defaultValue, {
    description,
    validRegex: boolRegex,
  });
}

function numericVariable(id, label, defaultValue, description) {
  return variable(id, label, defaultValue, {
    ...(description ? { description } : {}),
    validRegex: numberRegex,
  });
}

function imageTagVariable(id, label, defaultValue, description) {
  return variable(id, label, defaultValue, {
    ...(description ? { description } : {}),
    validRegex: imageTagRegex,
  });
}

const dockerfileLines = renderDockerfileTemplate("manager.Dockerfile", {
  __WRITE_INSTALL_SCRIPT__: writeFileInstruction(
    "/usr/local/bin/install-airbyte.sh",
    readAsset("install-airbyte.sh"),
    true
  ),
  __WRITE_HOST_RUNNER__: writeFileInstruction(
    "/usr/local/bin/airbyte-host-runner.sh",
    readAsset("airbyte-host-runner.sh"),
    true
  ),
  __WRITE_ENTRYPOINT__: writeFileInstruction(
    "/usr/local/bin/airbyte-entrypoint.sh",
    readAsset("airbyte-entrypoint.sh"),
    true
  ),
  __WRITE_NGINX_TEMPLATE__: writeFileInstruction(
    "/opt/airbyte-manager/nginx.conf.template",
    readAsset("nginx.conf.template")
  ),
  __WRITE_BOOTSTRAPPING_PAGE__: writeFileInstruction(
    "/opt/airbyte-manager/bootstrapping.html",
    readAsset("bootstrapping.html")
  ),
  __WRITE_VALUES_FILE__: writeFileInstruction(
    "/opt/airbyte-manager/airbyte-values.yaml",
    readAsset("airbyte-values.yaml")
  ),
});

const template = {
  captainVersion: 4,
  services: {
    $$cap_appname: {
      restart: "unless-stopped",
      cap_add: ["SYS_ADMIN", "NET_ADMIN"],
      volumes: [
        "$$cap_appname-manager-data:/var/lib/airbyte-manager",
        "/var/run/docker.sock:/var/run/docker.sock",
      ],
      environment: {
        AIRBYTE_MANAGER_HOME: "/var/lib/airbyte-manager",
        AIRBYTE_DOMAIN: "$$cap_appname.$$cap_root_domain",
        AIRBYTE_ADDITIONAL_HOSTS: "$$cap_additional_hosts",
        AIRBYTE_HOST_PORT: "$$cap_airbyte_host_port",
        AIRBYTE_CHART_VERSION: "$$cap_airbyte_chart_version",
        AIRBYTE_MANAGER_MODE: "$$cap_airbyte_manager_mode",
        AIRBYTE_RUNNER_NAME: "$$cap_appname-airbyte-runner",
        AIRBYTE_LOW_RESOURCE_MODE: "$$cap_airbyte_low_resource_mode",
        AIRBYTE_DISABLE_AUTH: "$$cap_airbyte_disable_auth",
        AIRBYTE_INSECURE_COOKIES: "$$cap_airbyte_insecure_cookies",
        AIRBYTE_REMOVE_PERSISTED_DATA: "$$cap_airbyte_remove_persisted_data",
      },
      caproverExtra: {
        containerHttpPort: "80",
        dockerfileLines,
      },
    },
  },
  caproverOneClickApp: {
    variables: [
      imageTagVariable(
        "$$cap_abctl_version",
        "abctl version",
        "v0.30.4",
        "Pinned Airbyte bootstrap CLI version used inside the manager container."
      ),
      imageTagVariable(
        "$$cap_airbyte_chart_version",
        "Airbyte chart version",
        "2.0.19",
        "Pinned official Airbyte Helm chart version."
      ),
      numericVariable(
        "$$cap_airbyte_host_port",
        "Host ingress port",
        "",
        "Required. Choose an unused host port for the Airbyte kind ingress, for example 18080. Current limitation: only one Airbyte deployment per host is supported while this app uses abctl local."
      ),
      variable(
        "$$cap_additional_hosts",
        "Additional hosts",
        "",
        {
          description:
            "Optional comma-separated hostnames to add to the Airbyte ingress, for example airbyte.example.com.",
        }
      ),
      booleanVariable(
        "$$cap_airbyte_low_resource_mode",
        "Low resource mode",
        "true",
        "Recommended on smaller hosts. This mirrors the official abctl --low-resource-mode flag."
      ),
      booleanVariable(
        "$$cap_airbyte_disable_auth",
        "Disable auth",
        "false",
        "Optional. Turn off the built-in Airbyte auth wall."
      ),
      booleanVariable(
        "$$cap_airbyte_insecure_cookies",
        "Allow insecure cookies",
        "true",
        "Recommended behind the CapRover reverse-proxy chain so first login does not fail on cookie restrictions."
      ),
      variable(
        "$$cap_airbyte_manager_mode",
        "Manager mode",
        "install",
        {
          description:
            "Use install for normal operation. Switch to uninstall before deleting the app if you want the manager to remove the kind cluster for you.",
          validRegex: modeRegex,
        }
      ),
      booleanVariable(
        "$$cap_airbyte_remove_persisted_data",
        "Remove persisted data on uninstall",
        "false",
        "Only used when Manager mode is uninstall. Set to true if you want abctl local uninstall --persisted."
      ),
    ],
    instructions: {
      start: `Airbyte is deployed as a manager app that talks to the host Docker daemon and creates the official Airbyte kind cluster under the hood.

Important notes:
- Current limitation: only one Airbyte deployment per host is supported because abctl local uses a singleton kind cluster under the hood.
- Choose an unused Host ingress port for the Airbyte ingress on this host.
- The first install can take several minutes while abctl creates the cluster and installs the Helm chart.
- This app mounts /var/run/docker.sock and adds the required Linux capabilities through cap_add.
- If you later want to remove the Airbyte cluster from the host, switch Manager mode to uninstall, redeploy, wait for completion, and only then delete the CapRover app.`,
      end: `Airbyte manager has been deployed.

Next steps:
1. Enable HTTPS for $$cap_appname in CapRover.
2. Open https://$$cap_appname.$$cap_root_domain
3. If Airbyte is still bootstrapping, keep the page open or refresh after a few minutes.
4. If you want to add a custom domain later, set Additional hosts and redeploy the manager.`,
    },
    displayName: "Airbyte",
    isOfficial: false,
    description:
      "Airbyte bootstrap app for CapRover. Runs abctl against the host Docker socket, creates the kind cluster, and proxies the Airbyte UI through the CapRover app domain. One deployment per host for now.",
    documentation: docsUrl,
  },
};

const header = [
  "# This file is generated by scripts/generate_airbyte.js.",
  "# Do not edit public/v4/apps/airbyte.yml by hand; update the generator or",
  "# files under scripts/airbyte-assets/ and then run `npm run generate_airbyte`.",
].join("\n");

const yamlBody = Object.entries(template)
  .map(([key, value]) => {
    if (Array.isArray(value) || isPlainObject(value) || value instanceof Literal) {
      return `${key}:\n${renderValue(value, 2)}`;
    }
    return `${key}: ${renderValue(value, 0)}`;
  })
  .join("\n");

const prettierConfig = prettier.resolveConfig.sync(outputPath) || {};
const formatted = prettier.format(`${header}\n${yamlBody}\n`, {
  ...prettierConfig,
  parser: "yaml",
});
fs.writeFileSync(outputPath, formatted);
console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
