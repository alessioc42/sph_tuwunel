export type MatrixLoginResult = {
  access_token: string;
  device_id: string;
  user_id: string;
  home_server?: string;
};

/** Exchange a Matrix JWT for a Client-Server access token on the homeserver. */
export async function loginWithJwt(
  homeserver: string,
  jwt: string,
  deviceName = "SPH Bridge",
): Promise<MatrixLoginResult> {
  const base = homeserver.replace(/\/$/, "");
  const res = await fetch(`${base}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "org.matrix.login.jwt",
      token: jwt,
      initial_device_display_name: deviceName,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`matrix login failed ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as MatrixLoginResult;
}
