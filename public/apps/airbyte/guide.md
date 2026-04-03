# Airbyte

This Airbyte entry is intentionally different from a normal multi-service Swarm app.

It deploys a single CapRover-facing manager service that:

- mounts the host Docker socket
- launches a temporary host-networked runner that executes the official `abctl` bootstrap flow
- creates the `kind` cluster and Helm release on the host
- proxies the Airbyte UI back through the CapRover app domain

## Why the host ingress port is required

`abctl` creates an ingress inside the `kind` cluster and binds it to a host port.

That means every Airbyte installation on the same CapRover host must use its own unique host ingress port. The CapRover app still gives you the normal public domain, but the host port is the bridge between the manager proxy and the Airbyte cluster it creates.

## First install behavior

The first installation can take several minutes while the manager:

- creates the `kind` cluster
- installs the official Airbyte Helm chart
- waits for the platform to become reachable

During that time, the Airbyte app URL serves a bootstrap page instead of a hard `502`.

## Auth and cookies

`Allow insecure cookies` defaults to `true`.

That is deliberate for the first version of this CapRover packaging because the traffic path is:

- browser -> CapRover HTTPS
- CapRover -> manager container HTTP
- manager container -> host Airbyte ingress HTTP

If you know your reverse-proxy chain is preserving the secure cookie assumptions correctly, you can turn this off later and redeploy.

## Remove the cluster cleanly

Deleting the CapRover app alone does not automatically remove the Airbyte `kind` cluster from the host.

If you want the manager to remove the Airbyte installation first:

1. Set `Manager mode` to `uninstall`
2. Optionally set `Remove persisted data on uninstall` to `true`
3. Redeploy the app
4. Wait until the manager reports uninstall completion
5. Delete the CapRover app

## Current implementation notes

- `abctl` version is pinned in the template
- the Airbyte Helm chart version is pinned in the template
- the manager service does not run the Airbyte platform directly; it launches a host-networked helper container through the Docker socket so the `kind` control-plane loopback bindings remain reachable
