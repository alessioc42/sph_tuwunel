# Notes

Production path: publish `BRIDGE_PORT` / `ELEMENT_PORT` and reverse-proxy them —
see [SETUP.md](../SETUP.md).

Cinny’s `homeserverList` entry is the **hostname of `PUBLIC_BASE_URL`**
(the public bridge), never a direct tuwunel address. Cinny then loads
`https://AUTH_HOST/.well-known/matrix/client` and uses that `base_url`.

Browser handoff is a query-string token, which Cinny consumes on its own:

`https://CHAT_HOST/?loginToken=…`
