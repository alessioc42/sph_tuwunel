# SPH → Matrix (tuwunel) + Element Web

> **Experimental.** School / lab prototype — not a supported production product.

## Deploy

**Complete Portainer + reverse-proxy instructions:** [`SETUP.md`](SETUP.md)

That guide covers DNS, secrets, Portainer stack env, GHCR login, host ports,
Nginx Proxy Manager (forward to ports — no Docker network modes), Schulportal
tile fields, verification, and troubleshooting.

| Env | Default | Published on Docker host |
| --- | --- | --- |
| `BRIDGE_PORT` | `3000` | SPH handshake + Matrix API |
| `ELEMENT_PORT` | `8080` | Element Web |

```text
NPM/nginx  ─┬─ https://AUTH_HOST  →  host:BRIDGE_PORT  → bridge
            └─ https://CHAT_HOST  →  host:ELEMENT_PORT → element
                                                      bridge → tuwunel (internal)
```

| Client | User-Agent | Result |
| --- | --- | --- |
| Lanis / `matrix_plug` | contains `Lanis-Mobile` | JWT JSON |
| Browser | other | Redirect to Element with `loginToken` |

## Local development

```bash
bun install && bun test
bun run src/index.ts
./docker-build.sh
```

Image: `ghcr.io/alessioc42/sph_tuwunel`
