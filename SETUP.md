# SETUP — full Portainer deploy

> **Experimental.** End-to-end instructions to run this stack in **Portainer**,
> expose two host ports, and put **Nginx Proxy Manager** (or nginx) in front.
> You do **not** join Docker networks with NPM.

Replace every placeholder before you start:

| Placeholder | Example |
| --- | --- |
| `YOUR_DOMAIN` | `meine-schule.de` |
| `AUTH_HOST` | `sph-auth.svc.meine-schule.de` |
| `CHAT_HOST` | `element.svc.meine-schule.de` |
| `BRIDGE_PORT` | `3000` |
| `ELEMENT_PORT` | `8080` |

```text
DNS  AUTH_HOST / CHAT_HOST  →  your server
         │
Internet │
         ▼
 Nginx Proxy Manager  (:443 TLS)
         │
         ├─ AUTH_HOST  ──http──►  host port BRIDGE_PORT  ──►  sph-bridge
         └─ CHAT_HOST  ──http──►  host port ELEMENT_PORT ──►  sph-element
                                      │
                         Portainer stack: bridge + element + tuwunel
                         (tuwunel has no host port)
```

---

## 0. What you need beforehand

1. A server with **Docker** + **Portainer** (CE/BE).  
2. **Nginx Proxy Manager** (or other reverse proxy) already working for other sites.  
3. Ability to create **DNS A/AAAA** records.  
4. Access to **Schulportal Hessen** school admin (PaedOrg tools).  
5. For the private image `ghcr.io/alessioc42/sph_tuwunel`: a GitHub user that can
   `read:packages` (and `repo` if the git repo is private).

---

## 1. DNS

Create records pointing at the **public IP of the Docker host**:

```text
AUTH_HOST.    A     YOUR_SERVER_PUBLIC_IP
CHAT_HOST.    A     YOUR_SERVER_PUBLIC_IP
```

Example:

```text
sph-auth.svc.meine-schule.de    A    203.0.113.10
element.svc.meine-schule.de     A    203.0.113.10
```

Wait until they resolve (`dig +short AUTH_HOST`).

Firewall: public **80** and **443** must reach NPM. The compose ports
(`3000` / `8080`) only need to be reachable **from NPM** (same host or LAN),
not from the whole internet.

---

## 2. Generate secrets

On any machine:

```bash
python3 - <<'PY'
import secrets, string
a = string.ascii_letters + string.digits
print("SPH_SECRET=" + "".join(secrets.choice(a) for _ in range(48)))
print("JWT_SECRET=" + "".join(secrets.choice(a) for _ in range(48)))
PY
```

- `SPH_SECRET` → also pasted into the Schulportal tile (letters/digits only).  
- `JWT_SECRET` → stays only in Portainer env (Matrix login signing).

Save both; you will paste them in step 4.

---

## 3. Portainer: registry login (private GHCR image)

1. Portainer → **Registries** → **Add registry** → **Custom registry**  
2. Fill:

| Field | Value |
| --- | --- |
| Name | `ghcr` |
| Registry URL | `ghcr.io` |
| Authentication | On |
| Username | your GitHub username |
| Password | GitHub **PAT** with `read:packages` (and `repo` if needed) |

3. Save.

Without this, pulling `ghcr.io/alessioc42/sph_tuwunel:latest` fails if the
package is private.

---

## 4. Portainer: create the stack

1. Portainer → **Stacks** → **Add stack**  
2. Name: `sph-tuwunel`  
3. Build method: **Repository**

| Field | Value |
| --- | --- |
| Repository URL | `https://github.com/alessioc42/sph_tuwunel` |
| Reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | On if the GitHub repo is private (GitHub username + PAT with `repo`) |

4. Under **Environment variables**, add **all** of the following (edit the
   placeholders). In Portainer you can use “Advanced mode” and paste the block:

```bash
PUBLIC_BASE_URL=https://AUTH_HOST
ELEMENT_WEB_URL=https://CHAT_HOST
MATRIX_SERVER_NAME=YOUR_DOMAIN

SPH_SECRET=PASTE_SPH_SECRET_HERE
JWT_SECRET=PASTE_JWT_SECRET_HERE

FOLDER_NAME=matrix
ALLOW_ALL_IPS=false

BRIDGE_PORT=3000
ELEMENT_PORT=8080

BRIDGE_IMAGE=ghcr.io/alessioc42/sph_tuwunel:latest
ELEMENT_IMAGE=vectorim/element-web:v1.11.95
TUWUNEL_IMAGE=ghcr.io/matrix-construct/tuwunel:latest

BRIDGE_CONTAINER_NAME=sph-bridge
ELEMENT_CONTAINER_NAME=sph-element
TUWUNEL_CONTAINER_NAME=sph-tuwunel-hs

CONNECT_TTL_SECONDS=30
JWT_TTL_SECONDS=3600
```

Concrete example (do not copy secrets from docs into production):

```bash
PUBLIC_BASE_URL=https://sph-auth.svc.meine-schule.de
ELEMENT_WEB_URL=https://element.svc.meine-schule.de
MATRIX_SERVER_NAME=meine-schule.de
SPH_SECRET=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf
JWT_SECRET=ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210ZyXwVuTs
FOLDER_NAME=matrix
ALLOW_ALL_IPS=false
BRIDGE_PORT=3000
ELEMENT_PORT=8080
BRIDGE_IMAGE=ghcr.io/alessioc42/sph_tuwunel:latest
ELEMENT_IMAGE=vectorim/element-web:v1.11.95
TUWUNEL_IMAGE=ghcr.io/matrix-construct/tuwunel:latest
BRIDGE_CONTAINER_NAME=sph-bridge
ELEMENT_CONTAINER_NAME=sph-element
TUWUNEL_CONTAINER_NAME=sph-tuwunel-hs
```

5. Click **Deploy the stack**.  
6. Wait until these containers are running:

| Container | Role | Host port |
| --- | --- | --- |
| `sph-tuwunel-config-init-…` | one-shot config writer | exits 0 |
| `sph-tuwunel-hs` | Matrix homeserver | none |
| `sph-bridge` | SPH + Matrix API | `BRIDGE_PORT` → 3000 |
| `sph-element` | Element Web | `ELEMENT_PORT` → 80 |

7. In Portainer → Containers → `sph-bridge` → **Logs**: should show the bridge
   listening.  
8. From the Docker host shell (or Portainer console on the host):

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:8080/ | head
```

Expected: JSON with `"ok": true` from `/health`, and HTML from Element.

If `/health` fails: open `sph-bridge` logs; usually wrong env, image pull, or
port conflict.

---

## 5. Nginx Proxy Manager — two Proxy Hosts

The stack already publishes `BRIDGE_PORT` and `ELEMENT_PORT` on the Docker
host. In NPM you only forward each domain to that host port — same as any other
app you already proxy.

**Forward Hostname / IP** is almost always:

| NPM setup | Use |
| --- | --- |
| NPM installed on the host (not a container) | `127.0.0.1` |
| NPM in Docker on the **same** host | `172.17.0.1` (Docker bridge gateway) or `host.docker.internal` if your NPM image supports it |
| NPM on another machine | the LAN IP of the Docker host |

You do **not** add this to the Portainer stack env. It is only the target in the
NPM UI.

Check from the NPM container if needed:

```bash
docker exec -it <npm-container-name> wget -qO- http://172.17.0.1:3000/health
```

### Proxy Host A — bridge (SPH + Matrix)

**Hosts → Proxy Hosts → Add Proxy Host**

**Details**

| Field | Value |
| --- | --- |
| Domain Names | `AUTH_HOST` (e.g. `sph-auth.svc.meine-schule.de`) |
| Scheme | `http` |
| Forward Hostname / IP | `127.0.0.1` or `172.17.0.1` (see table above) |
| Forward Port | `3000` (your `BRIDGE_PORT`) |
| Cache Assets | Off |
| Block Common Exploits | On |
| Websockets Support | **On** (required) |

**SSL**

| Field | Value |
| --- | --- |
| SSL Certificate | Request a new SSL Certificate |
| Force SSL | On |
| HTTP/2 Support | On |
| Agree to Let’s Encrypt ToS | On |
| Email | your admin email |
| Domain Names | same `AUTH_HOST` |

Save.

### Proxy Host B — Element

**Details**

| Field | Value |
| --- | --- |
| Domain Names | `CHAT_HOST` (e.g. `element.svc.meine-schule.de`) |
| Scheme | `http` |
| Forward Hostname / IP | same as Proxy Host A |
| Forward Port | `8080` (your `ELEMENT_PORT`) |
| Block Common Exploits | On |
| Websockets Support | **On** |

**SSL** — same as above for `CHAT_HOST`.

Save.

### Optional: plain nginx instead of NPM

```nginx
# bridge
server {
  listen 443 ssl http2;
  server_name AUTH_HOST;
  # ssl_certificate     /path/fullchain.pem;
  # ssl_certificate_key /path/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}

# element
server {
  listen 443 ssl http2;
  server_name CHAT_HOST;
  # ssl_certificate     /path/fullchain.pem;
  # ssl_certificate_key /path/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## 6. Verify over the public URLs

```bash
curl -fsS https://AUTH_HOST/health
curl -fsS https://AUTH_HOST/.well-known/matrix/client
curl -fsSI https://CHAT_HOST/ | head
```

`well-known` must contain:

```json
{ "m.homeserver": { "base_url": "https://AUTH_HOST" } }
```

Open `https://CHAT_HOST/` in a browser — Element should load (login may wait
until you use the SPH tile).

---

## 7. Schulportal Hessen tile

PaedOrg → Tools → **.htaccess-PHP-Secure-Login** → save:

| Feld in der SPH-UI | Wert |
| --- | --- |
| **Url des Schulportalschutz-Scriptes** | `https://AUTH_HOST/` |
| **Name des Verzeichnisses** | `matrix` |
| **Definiertes Secret** | exact `SPH_SECRET` from Portainer |
| **Username und -Art übertragen** | Username/Art **übermitteln** |
| **Öffnet in neuem Fenster** | `ja` |

Rules:

- URL must be `https://…` and **end with `/`**.  
- Verzeichnis name must equal `FOLDER_NAME` (`matrix`).  
- No special characters in the secret.

Name / Beschreibung / Logo / Farbe: free text for the tile.

---

## 8. End-to-end test

1. Log into Schulportal as a normal user.  
2. Click the tile.  
3. **Desktop browser** → should redirect to Element on `CHAT_HOST` and land
   signed in.  
4. **Lanis-Mobile** (User-Agent contains `Lanis-Mobile`) → same flow returns a
   JWT JSON body for the app instead of an Element redirect.

---

## 9. What each public path does

On `https://AUTH_HOST` (bridge):

| Path | Who | Purpose |
| --- | --- | --- |
| `/?t=…` | SPH servers | Handshake step 1 |
| `/?a=login&…` | SPH servers | Handshake step 2 → refresh URL |
| `/?a=refresh&k=…` | User browser / app | Finish login |
| `/_matrix/…` | Element | Client-Server API (proxied to tuwunel) |
| `/.well-known/matrix/client` | Clients | Points at this bridge |
| `/health` | You | Liveness |

On `https://CHAT_HOST`: Element static UI only. Its configured homeserver is
`https://AUTH_HOST` (written by `config-init` from `PUBLIC_BASE_URL`).

---

## 10. Updates

Portainer → Stacks → `sph-tuwunel` → **Pull and redeploy** (or re-deploy from
git).

After changing `JWT_SECRET`, `PUBLIC_BASE_URL`, `ELEMENT_WEB_URL`, or
`MATRIX_SERVER_NAME`:

1. Update the stack env.  
2. Redeploy so `config-init` runs again.  
3. If Element still shows the old homeserver, remove the stack volume named
   like `sph-tuwunel_element-config`, then redeploy once.

If you change `SPH_SECRET`, also update the Schulportal tile secret.

---

## 11. Optional: localhost-only bind

If NPM/nginx is on the **same** host and you do not want `3000`/`8080` on the
LAN, set:

```bash
BRIDGE_PORT=127.0.0.1:3000
ELEMENT_PORT=127.0.0.1:8080
```

Then NPM on the host uses `127.0.0.1`. NPM **in Docker** cannot use that;
keep `BRIDGE_PORT=3000` and forward via `172.17.0.1:3000` instead.

---

## 12. Troubleshooting

| Symptom | What to do |
| --- | --- |
| Stack deploy: pull denied | Add `ghcr.io` registry credentials in Portainer (step 3) |
| Stack deploy: git clone failed | Enable repo authentication; PAT needs `repo` for private git |
| `config-init` exited non-zero | Missing env var; open its logs in Portainer |
| `curl localhost:3000/health` fails | Port conflict; `docker ps` / change `BRIDGE_PORT` |
| NPM 502 | Wrong forward target (`127.0.0.1` vs `172.17.0.1`); wrong port; bridge not running |
| Let’s Encrypt fails | DNS not pointing here yet; port 80 not reachable on NPM |
| SPH `Ungültiger Aufruf!` | Caller IP not in allowlist (`deploy/ServerIPs.txt` in image); or proxy not sending real client IP |
| SPH `-4` | `SPH_SECRET` ≠ tile secret |
| Element stays on password screen | `PUBLIC_BASE_URL` wrong; Element must use bridge as homeserver; re-run config-init |
| Element shows **Unhealthy** but logs look fine | Image healthcheck used GNU wget; fixed in compose. Pull/redeploy. Nginx “user” warning is harmless. |
| Element restart / Permission denied on `/app/config.json` | Pull latest compose (config is volume-mounted read-only). Redeploy; recreate the `element` container. |
| Mobile JWT missing | App User-Agent must contain `Lanis-Mobile` |

---

## 13. Checklist (print / tick)

- [ ] DNS for `AUTH_HOST` and `CHAT_HOST`  
- [ ] Secrets generated  
- [ ] Portainer registry `ghcr.io` configured  
- [ ] Stack deployed with full env  
- [ ] `http://127.0.0.1:BRIDGE_PORT/health` OK on Docker host  
- [ ] NPM Proxy Host A → host port `BRIDGE_PORT`, websockets on, SSL on  
- [ ] NPM Proxy Host B → host port `ELEMENT_PORT`, websockets on, SSL on  
- [ ] `https://AUTH_HOST/health` OK  
- [ ] `https://AUTH_HOST/.well-known/matrix/client` shows bridge base_url  
- [ ] SPH tile URL `https://AUTH_HOST/`, secret matches, folder `matrix`  
- [ ] Browser click through SPH → Element signed in  

That is the full path from empty Portainer to a working SPH tile.
