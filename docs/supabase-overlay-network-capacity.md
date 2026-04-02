# Supabase on CapRover: shared overlay network capacity

The current Supabase templates are large enough that they can expose a pre-existing CapRover swarm networking problem on busy hosts: the shared `captain-overlay-network` can run out of VIP/IP allocations.

## Symptoms

In the CapRover browser deployment flow, you may see:

- `No NodeId was found. Try again in a minute...`

On the Docker host, `docker service ps ...` or daemon logs may show:

- `could not find an available IP while allocating VIP`
- `service ... has pending allocations`

This is not a Supabase-specific runtime bug. It means the shared overlay network CapRover uses for service-to-service traffic does not have enough free addresses.

## Why this happens

CapRover one-click apps do not expose custom Docker swarm network topology in a reliable way. Large templates therefore end up consuming addresses on the shared `captain-overlay-network`.

If that network was created as a `/24`, it only has a small address pool. A sufficiently busy CapRover instance can exhaust it.

## Quick relief

Before migrating the overlay network, try the simpler fixes:

- remove unused apps and services
- remove broken or half-deployed stacks
- retry the install

If the host is still tight on overlay addresses, migrate the network.

## Tested migration: `/24` to `/20`

This is the exact shape that was used successfully on a single-node CapRover swarm host.

### 1. Inspect the current shared overlay

```bash
docker network inspect captain-overlay-network
```

If it shows a `/24` subnet and the symptoms above are present, continue.

### 2. Create a temporary migration network

Use a non-overlapping subnet that is not already in use on the host.

```bash
docker network create \
  --driver overlay \
  --attachable \
  --subnet 10.0.32.0/20 \
  captain-overlay-network-migrate
```

### 3. Attach every swarm service that currently uses `captain-overlay-network`

This adds the temporary network first so services stay reachable during the move.

```bash
for svc in $(docker service ls --format '{{.Name}}'); do
  if docker service inspect "$svc" --format '{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}' | grep -qx 'captain-overlay-network'; then
    docker service update --network-add captain-overlay-network-migrate "$svc"
  fi
done
```

### 4. Remove the old network from those services

```bash
for svc in $(docker service ls --format '{{.Name}}'); do
  if docker service inspect "$svc" --format '{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}' | grep -qx 'captain-overlay-network'; then
    docker service update --network-rm captain-overlay-network "$svc"
  fi
done
```

### 5. Remove and recreate `captain-overlay-network` with a larger subnet

The tested replacement was `10.0.16.0/20`.

```bash
docker network rm captain-overlay-network

docker network create \
  --driver overlay \
  --attachable \
  --subnet 10.0.16.0/20 \
  captain-overlay-network
```

### 6. Move services back onto the recreated shared overlay

```bash
for svc in $(docker service ls --format '{{.Name}}'); do
  if docker service inspect "$svc" --format '{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}' | grep -qx 'captain-overlay-network-migrate'; then
    docker service update --network-add captain-overlay-network "$svc"
  fi
done
```

### 7. Detach the temporary migration network

```bash
for svc in $(docker service ls --format '{{.Name}}'); do
  if docker service inspect "$svc" --format '{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}' | grep -qx 'captain-overlay-network-migrate'; then
    docker service update --network-rm captain-overlay-network-migrate "$svc"
  fi
done
```

### 8. Remove the temporary network

```bash
docker network rm captain-overlay-network-migrate
```

If Docker still shows a ghost entry for the temporary overlay even after all services have left it, a Docker daemon restart usually clears it. Do that only after verifying no service still depends on it.

## Verification

Check the recreated network:

```bash
docker network inspect captain-overlay-network --format '{{json .IPAM.Config}}'
```

The working state should show:

```json
[{"Subnet":"10.0.16.0/20","Gateway":"10.0.16.1"}]
```

Then verify the core CapRover services are healthy again:

```bash
docker service ls --format '{{.Name}} {{.Replicas}}' | grep 'captain-'
```

And finally retry the Supabase one-click install.
